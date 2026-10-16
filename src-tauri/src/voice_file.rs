//! A voice note dropped on a pane (#497): an Ogg Opus file (`.opus`, `.ogg`, `.oga`, what WhatsApp
//! sends) decoded here, with no ffmpeg, and transcribed locally with whisper.cpp. Where the
//! transcript goes is the frontend's call (`src/voice/files.ts`), as it is for dictation.
//!
//! Files get a bigger model than dictation: large-v3-turbo, which gets the proper names a base
//! model misses (measured on a 3 min 34 s Portuguese note, 7.9 s on Metal). It downloads once,
//! into dictation's models dir, on the first file dropped, and it is let go when the files dropped
//! are done: 574 MB is not held for the next drop. Dictation keeps its own model and its hot path.

use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};
use whisper_rs::WhisperContext;

use crate::voice::{self, lock, Language, VoiceState, WHISPER_RATE};

/// Multilingual large-v3-turbo, 5-bit quantized, from dictation's Hugging Face repo.
pub const FILE_MODEL_FILE: &str = "ggml-large-v3-turbo-q5_0.bin";
const FILE_MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin";
const FILE_MODEL_BYTES: u64 = 574_041_195;
const FILE_MODEL_SHA256: &str = "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2";
/// Points at any ggml whisper model and skips the download (tests, the live check).
const FILE_MODEL_ENV: &str = "MNEMO_WHISPER_FILE_MODEL";

/// A file up to this long is transcribed whole; a longer one is refused, never cut.
pub const MAX_FILE_SECONDS: u64 = 30 * 60;

/// Opus always runs at 48 kHz: the header's pre-skip and every granule position count in it.
const OPUS_RATE: u64 = 48_000;
/// 120 ms, the longest an Opus packet can hold, at the rate it is decoded to.
const MAX_PACKET: usize = WHISPER_RATE as usize * 120 / 1000;

/// What a file whose first packet is not Opus holds, for the failure said about it.
fn codec_of(head: &[u8]) -> &'static str {
    if head.starts_with(b"\x01vorbis") {
        "Ogg Vorbis"
    } else if head.starts_with(b"Speex   ") {
        "Ogg Speex"
    } else if head.starts_with(b"\x7fFLAC") {
        "Ogg FLAC"
    } else if head.starts_with(b"\x80theora") {
        "Ogg Theora video"
    } else {
        "an Ogg stream of another codec"
    }
}

fn minutes(samples_48k: u64) -> u64 {
    samples_48k.div_ceil(OPUS_RATE * 60)
}

/// The audio of an Ogg Opus stream as whisper takes it: 16 kHz mono, which libopus decodes to
/// directly (a stereo stream is mixed down by the decoder). The header's pre-skip is dropped from
/// the start and the last page's granule position ends it, so the audio is as long as what was
/// encoded. A stream of another codec, a damaged one, or one longer than `MAX_FILE_SECONDS` is
/// refused with why.
pub fn decode_ogg_opus(bytes: &[u8]) -> Result<Vec<f32>, String> {
    check_pages(bytes)?;
    let mut reader = ogg::PacketReader::new(Cursor::new(bytes));
    let damaged = |e: ogg::OggReadError| format!("it is damaged or not an Ogg file ({e})");
    let head = reader.read_packet().map_err(damaged)?.ok_or("it is empty")?;
    let serial = head.stream_serial();
    let h = &head.data;
    if !h.starts_with(b"OpusHead") {
        return Err(format!("it is {}, not Opus", codec_of(h)));
    }
    if h.len() < 19 || h[8] >> 4 != 0 || h[9] == 0 {
        return Err("its Opus header is damaged".into());
    }
    let pre_skip = u16::from_le_bytes([h[10], h[11]]) as u64;
    let gain_db = i16::from_le_bytes([h[16], h[17]]) as f32 / 256.0;
    if h[18] != 0 {
        return Err(format!("it has {} channels, and only mono and stereo Opus are read", h[9]));
    }
    // Mono or stereo, the decoder hands back the one channel whisper takes.
    let mut decoder = opus::Decoder::new(WHISPER_RATE, opus::Channels::Mono).map_err(|e| format!("opus: {e}"))?;

    let cap = MAX_FILE_SECONDS * OPUS_RATE + pre_skip;
    let mut audio: Vec<f32> = Vec::new();
    let mut frame = vec![0f32; MAX_PACKET];
    let mut tags = false;
    let mut end: Option<u64> = None;
    let mut too_long = false;
    while let Some(packet) = reader.read_packet().map_err(damaged)? {
        if packet.stream_serial() != serial {
            continue;
        }
        if !tags {
            // The comment header, which precedes the audio.
            tags = true;
            if !packet.data.starts_with(b"OpusTags") {
                return Err("its Opus header is damaged".into());
            }
            continue;
        }
        // A packet that ends no page carries no granule position (all bits set).
        let granule = packet.absgp_page();
        if packet.last_in_page() && granule != u64::MAX {
            end = Some(granule);
            if granule > cap {
                too_long = true;
            }
        }
        if !too_long {
            let n = decoder.decode_float(&packet.data, &mut frame, false).map_err(|e| format!("its audio is damaged ({e})"))?;
            audio.extend_from_slice(&frame[..n]);
        }
        if packet.last_in_stream() {
            break;
        }
    }
    if too_long {
        let long = end.unwrap_or(cap).saturating_sub(pre_skip);
        return Err(format!("it is {} min long; files up to {} min are transcribed", minutes(long), MAX_FILE_SECONDS / 60));
    }
    if !tags || audio.is_empty() {
        return Err("it holds no audio".into());
    }
    let per = OPUS_RATE / WHISPER_RATE as u64;
    let decoded = audio.len() as u64 * per;
    // Up to a packet short is the encoder's rounding (a real WhatsApp note), not a lost page.
    if let Some(gp) = end.filter(|&gp| gp > decoded + OPUS_RATE * 120 / 1000) {
        return Err(format!("it is damaged: {:.1} s of its audio is missing", (gp - decoded) as f64 / OPUS_RATE as f64));
    }
    let skip = ((pre_skip + per / 2) / per) as usize;
    let len = match end {
        Some(gp) => (gp.saturating_sub(pre_skip) / per) as usize,
        None => audio.len(),
    };
    let skip = skip.min(audio.len());
    audio.drain(..skip);
    audio.truncate(len);
    if gain_db != 0.0 {
        let g = 10f32.powf(gain_db / 20.0);
        audio.iter_mut().for_each(|s| *s *= g);
    }
    Ok(audio)
}

/// That `bytes` are Ogg pages end to end, each starting where the one before it ends. The reader
/// skips, with no error, whatever it cannot find a page in: a page whose header was damaged would
/// be left out, and the file heard with a hole in it. Not every file marks its last page (a
/// WhatsApp note does not), so one cut exactly between two pages passes; one cut inside a page
/// does not.
fn check_pages(bytes: &[u8]) -> Result<(), String> {
    let mut at = 0;
    while at < bytes.len() {
        if !bytes[at..].starts_with(b"OggS") {
            return Err(if at == 0 { "it is not an Ogg file".into() } else { format!("it is damaged: no page begins at byte {at}") });
        }
        let Some(&segments) = bytes.get(at + 26) else { return Err("it is cut short".into()) };
        let Some(table) = bytes.get(at + 27..at + 27 + segments as usize) else { return Err("it is cut short".into()) };
        at += 27 + table.len() + table.iter().map(|&b| b as usize).sum::<usize>();
    }
    if at > bytes.len() {
        return Err("it is cut short".into());
    }
    Ok(())
}

/// `path` decoded (`decode_ogg_opus`); an error says why, without the path.
pub fn decode_file(path: &Path) -> Result<Vec<f32>, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("it could not be read ({e})"))?;
    if bytes.is_empty() {
        return Err("it is empty".into());
    }
    decode_ogg_opus(&bytes)
}

// ---------------------------------------------------------------------------------------
// Model

/// The file model in `dir`, downloaded first if it is missing or truncated, and checked against
/// its published hash after the download: a file that does not match is deleted rather than kept
/// to fail at load.
pub fn ensure_file_model(dir: &Path, progress: impl FnMut(u64, u64)) -> Result<PathBuf, String> {
    let path = dir.join(FILE_MODEL_FILE);
    if std::fs::metadata(&path).map(|m| m.len() == FILE_MODEL_BYTES).unwrap_or(false) {
        return Ok(path);
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    voice::download(FILE_MODEL_URL, &path, FILE_MODEL_BYTES, voice::STALL, progress).map_err(|e| format!("model download: {e}"))?;
    let got = sha256_of(&path)?;
    if got != FILE_MODEL_SHA256 {
        let _ = std::fs::remove_file(&path);
        return Err(format!("model download: the file's sha256 is {got}, not the published {FILE_MODEL_SHA256}; it was deleted"));
    }
    Ok(path)
}

fn sha256_of(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut hash = Sha256::new();
    let mut chunk = vec![0u8; 1 << 20];
    loop {
        let n = file.read(&mut chunk).map_err(|e| format!("{}: {e}", path.display()))?;
        if n == 0 {
            break;
        }
        hash.write_all(&chunk[..n]).map_err(|e| e.to_string())?;
    }
    Ok(hash.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// The file model while drops are being transcribed. One drop at a time: a drop made while
/// another runs waits its turn (`waiting`) and finds the model still loaded; the last one done
/// lets it go.
#[derive(Default)]
pub struct FileState {
    turn: Mutex<Option<Arc<WhisperContext>>>,
    waiting: AtomicUsize,
}

// ---------------------------------------------------------------------------------------
// Command

/// What `voice_transcribe_files` tells the drop as it goes. `index` is the file's place in the
/// paths it was given.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FileEvent {
    /// The first file's model download, in bytes.
    Download { downloaded: u64, total: u64 },
    /// Whisper is this far through the file, in percent.
    Transcribing { index: usize, percent: i32 },
    Done { index: usize, text: String },
    /// The file was not transcribed: why, to say beside its name.
    Failed { index: usize, error: String },
}

/// Transcribes each file in turn, in `language`, telling `send` as it goes. `model` is asked for
/// the model at the first file that decodes, once: a model that cannot be had fails that file and
/// every one after it. Nothing is transcribed of a file that is silent.
pub fn transcribe_files(
    paths: &[PathBuf],
    language: Language,
    mut model: impl FnMut() -> Result<Arc<WhisperContext>, String>,
    send: impl Fn(FileEvent) + Clone + 'static,
) {
    let mut ctx: Option<Result<Arc<WhisperContext>, String>> = None;
    for (index, path) in paths.iter().enumerate() {
        let audio = match decode_file(path) {
            Ok(a) => a,
            Err(error) => {
                send(FileEvent::Failed { index, error });
                continue;
            }
        };
        if voice::is_silent(&audio) {
            send(FileEvent::Failed { index, error: "no speech in it".into() });
            continue;
        }
        let ctx = match ctx.get_or_insert_with(&mut model) {
            Ok(c) => c.clone(),
            Err(e) => {
                send(FileEvent::Failed { index, error: e.clone() });
                continue;
            }
        };
        send(FileEvent::Transcribing { index, percent: 0 });
        let tell = send.clone();
        let mut last = 0;
        let progress = move |percent: i32| {
            if percent > last {
                last = percent;
                tell(FileEvent::Transcribing { index, percent });
            }
        };
        send(match voice::transcribe_with(&ctx, &audio, language, Some(progress)) {
            Ok(text) if text.is_empty() => FileEvent::Failed { index, error: "no speech in it".into() },
            Ok(text) => FileEvent::Done { index, text },
            Err(error) => FileEvent::Failed { index, error },
        });
    }
}

/// The file model, loaded into `slot` unless it already is, downloading it first on first use.
fn file_model(slot: &mut Option<Arc<WhisperContext>>, on: &Channel<FileEvent>) -> Result<Arc<WhisperContext>, String> {
    voice::cpu_check()?;
    if let Some(ctx) = slot.as_ref() {
        return Ok(ctx.clone());
    }
    let path = match std::env::var_os(FILE_MODEL_ENV) {
        Some(p) => PathBuf::from(p),
        None => ensure_file_model(&voice::models_dir(), |downloaded, total| {
            let _ = on.send(FileEvent::Download { downloaded, total });
        })?,
    };
    let ctx = Arc::new(voice::load_context(&path)?);
    *slot = Some(ctx.clone());
    Ok(ctx)
}

/// Transcribes the dropped files at `paths`, in order, in dictation's language, telling `on` how
/// each goes. Resolves once every file is done or failed; a failure is a `Failed` event, never a
/// rejection, so the files after it still go.
#[tauri::command]
pub async fn voice_transcribe_files(app: AppHandle, paths: Vec<String>, on: Channel<FileEvent>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let files = app.state::<FileState>();
        let language = app.state::<VoiceState>().language();
        files.waiting.fetch_add(1, Ordering::SeqCst);
        let mut slot = lock(&files.turn);
        files.waiting.fetch_sub(1, Ordering::SeqCst);
        let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
        let tell = on.clone();
        let started = std::time::Instant::now();
        transcribe_files(&paths, language, || file_model(&mut slot, &on), move |e| {
            let _ = tell.send(e);
        });
        log::info!("voice: {} dropped file(s) in {:.1}s", paths.len(), started.elapsed().as_secs_f32());
        // Nobody is waiting for it: 574 MB is not kept for a drop that may never come.
        if files.waiting.load(Ordering::SeqCst) == 0 {
            *slot = None;
        }
    })
    .await
    .map_err(|e| format!("voice: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_path(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/voice").join(name)
    }

    fn fixture(name: &str) -> Vec<u8> {
        std::fs::read(fixture_path(name)).expect("fixture")
    }

    /// The fixture WAV's length in seconds.
    fn wav_seconds(name: &str) -> f64 {
        let r = hound::WavReader::open(fixture_path(name)).unwrap();
        r.duration() as f64 / r.spec().sample_rate as f64
    }

    fn rms(s: &[f32]) -> f32 {
        (s.iter().map(|x| x * x).sum::<f32>() / s.len() as f32).sqrt()
    }

    #[test]
    fn a_mono_opus_note_decodes_to_16k_mono_as_long_as_the_wav_it_was_made_from() {
        // ola.opus is ola.wav (48 kHz mono) through libopus at 24 kb/s, as WhatsApp sends a note.
        let audio = decode_ogg_opus(&fixture("ola.opus")).unwrap();
        let seconds = audio.len() as f64 / WHISPER_RATE as f64;
        assert!((seconds - wav_seconds("ola.wav")).abs() < 0.001, "{seconds} s");
        // The speech is there, at about the level it was recorded at.
        let want = rms(&voice_fixture("ola.wav"));
        assert!((rms(&audio) - want).abs() < want * 0.2, "rms {} vs {want}", rms(&audio));
    }

    #[test]
    fn a_stereo_opus_file_is_mixed_down_and_keeps_its_length() {
        // hello-stereo.ogg is hello.wav (44.1 kHz mono) as stereo Opus, which runs at 48 kHz.
        let audio = decode_ogg_opus(&fixture("hello-stereo.ogg")).unwrap();
        let seconds = audio.len() as f64 / WHISPER_RATE as f64;
        assert!((seconds - wav_seconds("hello.wav")).abs() < 0.001, "{seconds} s");
        assert!(!voice::is_silent(&audio));
    }

    #[test]
    fn an_ogg_file_of_another_codec_is_refused_saying_what_it_is() {
        assert_eq!(decode_ogg_opus(&fixture("ola-vorbis.ogg")).unwrap_err(), "it is Ogg Vorbis, not Opus");
    }

    #[test]
    fn a_damaged_or_foreign_file_is_refused() {
        assert_eq!(decode_ogg_opus(&fixture("ola.wav")).unwrap_err(), "it is not an Ogg file");
        let dir = crate::testutil::temp_dir("voice-empty");
        std::fs::write(dir.join("empty.opus"), b"").unwrap();
        assert_eq!(decode_file(&dir.join("empty.opus")).unwrap_err(), "it is empty");
        let whole = fixture("ola.opus");
        let pages = pages(&whole);
        assert_eq!(pages.len(), 4, "two header pages and two of audio");
        let at = |page: usize| pages[..page].iter().map(|p| p.len()).sum::<usize>();
        let flipped = |byte: usize| {
            let mut bad = whole.clone();
            bad[byte] ^= 0x55;
            decode_ogg_opus(&bad).unwrap_err()
        };
        // A flipped byte in the audio fails its page's checksum.
        let err = flipped(at(2) + 100);
        assert!(err.starts_with("it is damaged or not an Ogg file (CRC32"), "{err}");
        // One in a page's capture pattern would hide the page from the reader, which skips it.
        assert_eq!(flipped(at(2) + 1), format!("it is damaged: no page begins at byte {}", at(2)));
        assert_eq!(flipped(at(3) + 1), format!("it is damaged: no page begins at byte {}", at(3)));
        // Cut inside a page; cut after its headers, it holds nothing to hear.
        assert_eq!(decode_ogg_opus(&whole[..at(3) + 100]).unwrap_err(), "it is cut short");
        assert_eq!(decode_ogg_opus(&whole[..at(2)]).unwrap_err(), "it holds no audio");
        // A page the reader would still see, whose packets came up short of its granule position.
        let mut short = whole[..at(3)].to_vec();
        let mut last = pages[3].to_vec();
        let granule = u64::from_le_bytes(last[6..14].try_into().unwrap()) + 48_000;
        last[6..14].copy_from_slice(&granule.to_le_bytes());
        crc(&mut last);
        short.extend_from_slice(&last);
        assert_eq!(decode_ogg_opus(&short).unwrap_err(), "it is damaged: 1.0 s of its audio is missing");
    }

    /// Rewrites an Ogg page's checksum after its bytes were changed.
    fn crc(page: &mut [u8]) {
        page[22..26].fill(0);
        let mut c = 0u32;
        for &b in page.iter() {
            c ^= (b as u32) << 24;
            for _ in 0..8 {
                c = if c & 0x8000_0000 != 0 { (c << 1) ^ 0x04c1_1db7 } else { c << 1 };
            }
        }
        page[22..26].copy_from_slice(&c.to_le_bytes());
    }

    /// The Ogg pages of a file, each as its bytes.
    fn pages(bytes: &[u8]) -> Vec<&[u8]> {
        let mut out = vec![];
        let mut at = 0;
        while at + 27 <= bytes.len() {
            let segments = bytes[at + 26] as usize;
            let body: usize = bytes[at + 27..at + 27 + segments].iter().map(|&b| b as usize).sum();
            let len = 27 + segments + body;
            out.push(&bytes[at..at + len]);
            at += len;
        }
        out
    }

    /// An Ogg Opus stream of `seconds` of audio, as an encoder writes one: 20 ms packets holding
    /// the 312 samples of pre-skip before it and part of a last packet after it, which the last
    /// page's granule position cuts off.
    fn opus_stream(seconds: u64) -> Vec<u8> {
        let mut enc = opus::Encoder::new(48_000, opus::Channels::Mono, opus::Application::Voip).unwrap();
        let tone: Vec<f32> = (0..960).map(|i| 0.2 * (i as f32 * 0.05).sin()).collect();
        let packet = enc.encode_vec_float(&tone, 400).unwrap();
        let mut out = Vec::new();
        {
            let mut w = ogg::PacketWriter::new(&mut out);
            let mut head = b"OpusHead".to_vec();
            head.extend_from_slice(&[1, 1]);
            head.extend_from_slice(&312u16.to_le_bytes());
            head.extend_from_slice(&48_000u32.to_le_bytes());
            head.extend_from_slice(&[0, 0, 0]);
            w.write_packet(head, 7, ogg::PacketWriteEndInfo::EndPage, 0).unwrap();
            let mut tags = b"OpusTags".to_vec();
            tags.extend_from_slice(&[0; 8]);
            w.write_packet(tags, 7, ogg::PacketWriteEndInfo::EndPage, 0).unwrap();
            let n = seconds * 50 + 1;
            for i in 1..=n {
                let (end, granule) = if i == n {
                    (ogg::PacketWriteEndInfo::EndStream, 312 + seconds * 48_000)
                } else if i % 50 == 0 {
                    (ogg::PacketWriteEndInfo::EndPage, i * 960)
                } else {
                    (ogg::PacketWriteEndInfo::NormalPacket, i * 960)
                };
                w.write_packet(packet.clone(), 7, end, granule).unwrap();
            }
        }
        out
    }

    #[test]
    fn thirty_minutes_are_decoded_whole_and_a_longer_file_is_refused_with_its_length() {
        let whole = decode_ogg_opus(&opus_stream(MAX_FILE_SECONDS)).unwrap();
        assert_eq!(whole.len() as u64, MAX_FILE_SECONDS * WHISPER_RATE as u64);
        assert_eq!(
            decode_ogg_opus(&opus_stream(MAX_FILE_SECONDS + 61)).unwrap_err(),
            "it is 32 min long; files up to 30 min are transcribed"
        );
    }

    #[test]
    fn a_failed_file_does_not_stop_the_ones_after_it_and_events_come_in_order() {
        let dir = crate::testutil::temp_dir("voice-files");
        let silent = dir.join("silent.opus");
        std::fs::write(&silent, opus_silence()).unwrap();
        let paths = vec![fixture_path("ola-vorbis.ogg"), dir.join("missing.opus"), silent, fixture_path("ola.opus")];
        let got = Arc::new(Mutex::new(Vec::new()));
        let seen = got.clone();
        let mut asked = 0;
        transcribe_files(&paths, Language::Pt, || {
            asked += 1;
            Err("no model here".into())
        }, move |e| lock(&seen).push(e));
        let got = lock(&got).clone();
        assert_eq!(asked, 1, "the model is asked for once, at the first file that decodes");
        assert_eq!(got.len(), 4, "{got:?}");
        assert_eq!(got[0], FileEvent::Failed { index: 0, error: "it is Ogg Vorbis, not Opus".into() });
        assert!(matches!(&got[1], FileEvent::Failed { index: 1, error } if error.starts_with("it could not be read")), "{:?}", got[1]);
        assert_eq!(got[2], FileEvent::Failed { index: 2, error: "no speech in it".into() });
        assert_eq!(got[3], FileEvent::Failed { index: 3, error: "no model here".into() });
    }

    /// Two seconds of digital silence as Ogg Opus.
    fn opus_silence() -> Vec<u8> {
        let mut enc = opus::Encoder::new(48_000, opus::Channels::Mono, opus::Application::Voip).unwrap();
        let packet = enc.encode_vec_float(&[0.0; 960], 400).unwrap();
        let mut out = Vec::new();
        {
            let mut w = ogg::PacketWriter::new(&mut out);
            let mut head = b"OpusHead".to_vec();
            head.extend_from_slice(&[1, 1, 0, 0]);
            head.extend_from_slice(&48_000u32.to_le_bytes());
            head.extend_from_slice(&[0, 0, 0]);
            w.write_packet(head, 3, ogg::PacketWriteEndInfo::EndPage, 0).unwrap();
            w.write_packet(b"OpusTags\0\0\0\0\0\0\0\0".to_vec(), 3, ogg::PacketWriteEndInfo::EndPage, 0).unwrap();
            for i in 1..=100u64 {
                let end = if i == 100 { ogg::PacketWriteEndInfo::EndStream } else { ogg::PacketWriteEndInfo::NormalPacket };
                w.write_packet(packet.clone(), 3, end, i * 960).unwrap();
            }
        }
        out
    }

    #[test]
    fn events_reach_the_frontend_tagged_by_kind() {
        let json = |e: FileEvent| serde_json::to_value(e).unwrap();
        assert_eq!(json(FileEvent::Download { downloaded: 1, total: 2 }), serde_json::json!({ "kind": "download", "downloaded": 1, "total": 2 }));
        assert_eq!(json(FileEvent::Transcribing { index: 0, percent: 5 }), serde_json::json!({ "kind": "transcribing", "index": 0, "percent": 5 }));
        assert_eq!(json(FileEvent::Done { index: 1, text: "oi".into() }), serde_json::json!({ "kind": "done", "index": 1, "text": "oi" }));
        assert_eq!(json(FileEvent::Failed { index: 2, error: "x".into() }), serde_json::json!({ "kind": "failed", "index": 2, "error": "x" }));
    }

    /// A fixture WAV as 16 kHz mono.
    fn voice_fixture(name: &str) -> Vec<f32> {
        let mut reader = hound::WavReader::open(fixture_path(name)).expect("fixture");
        let spec = reader.spec();
        let ints: Vec<i16> = reader.samples::<i16>().map(|s| s.unwrap()).collect();
        let mut mono = vec![];
        voice::mix_to_mono(&ints, spec.channels as usize, &mut mono);
        voice::resample(&mono, spec.sample_rate, WHISPER_RATE)
    }

    /// The Opus fixture heard by dictation's model, which CI already fetches for
    /// `voice::tests::transcribes_the_fixtures`: the decode feeds whisper what it understands.
    #[test]
    fn the_opus_fixture_is_heard_by_dictations_model() {
        let ctx = voice::load_context(&voice::test_model()).expect("load");
        let audio = decode_file(&fixture_path("ola.opus")).unwrap();
        let text = voice::transcribe(&ctx, &audio, Language::Pt).unwrap().to_lowercase();
        assert!(text.contains("bom dia") && text.contains("você"), "{text:?}");
    }

    /// The file model on the Opus fixtures, opt-in: it is 574 MB.
    /// `MNEMO_WHISPER_FILE_MODEL=~/.cache/whisper-cpp/ggml-large-v3-turbo-q5_0.bin cargo test --lib
    /// voice_file::tests::the_file_model -- --ignored --nocapture`, or with no variable it downloads.
    /// `MNEMO_VOICE_FILE` adds a note of your own, whose timing and word count are printed.
    #[test]
    #[ignore]
    fn the_file_model_hears_the_fixtures() {
        let started = std::time::Instant::now();
        let path = match std::env::var_os(FILE_MODEL_ENV) {
            Some(p) => PathBuf::from(p),
            None => ensure_file_model(&std::env::temp_dir().join("mnemo-desktop-models"), |_, _| {}).expect("model"),
        };
        let ctx = voice::load_context(&path).expect("load");
        eprintln!("load {:.1}s", started.elapsed().as_secs_f32());
        let text = voice::transcribe(&ctx, &decode_file(&fixture_path("ola.opus")).unwrap(), Language::Pt).unwrap().to_lowercase();
        assert!(text.contains("bom dia"), "{text:?}");
        let text = voice::transcribe(&ctx, &decode_file(&fixture_path("hello-stereo.ogg")).unwrap(), Language::En).unwrap().to_lowercase();
        assert!(text.contains("hello"), "{text:?}");
        if let Some(own) = std::env::var_os("MNEMO_VOICE_FILE") {
            let t = std::time::Instant::now();
            let audio = decode_file(Path::new(&own)).unwrap();
            let decoded = t.elapsed().as_secs_f32();
            let text = voice::transcribe(&ctx, &audio, Language::Auto).unwrap();
            // Only numbers: the note's words are its owner's.
            eprintln!(
                "{:.1} s of audio: decode {decoded:.2}s, transcribe {:.1}s, {} words",
                audio.len() as f32 / WHISPER_RATE as f32,
                t.elapsed().as_secs_f32() - decoded,
                text.split_whitespace().count()
            );
        }
    }
}
