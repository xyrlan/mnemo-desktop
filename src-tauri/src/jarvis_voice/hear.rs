//! Jarvis listening (#506): dictation's whisper.cpp and capture, in Portuguese, with a model of
//! its own. Dictation's `base` model is weak in Portuguese; `MODEL` was picked on accuracy and
//! latency over spoken requests (`bench` below; the numbers are in `MODEL`'s doc).

use std::path::PathBuf;
#[cfg(test)]
use std::path::Path;

use whisper_rs::WhisperContext;

use super::files::{self, Pinned};
use crate::voice::{self, Language};

/// whisper.cpp's models at a pinned revision of ggerganov/whisper.cpp.
macro_rules! whisper {
    ($file:literal, $bytes:literal, $sha:literal) => {
        Pinned {
            file: $file,
            url: concat!("https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/", $file),
            bytes: $bytes,
            sha256: $sha,
        }
    };
}

/// Jarvis's model: `small`, 5-bit. Measured 2026-10-23 on an i9-13900KS (whisper on the CPU,
/// as on every Windows build) over 138 takes Piper spoke (the 46 requests of
/// `scripts/jarvis-bench.jsonl` in two voices other than Jarvis's own, and one of them again
/// with noise), word error rate and median latency per take:
///
/// | model                          | WER   | latency |
/// |--------------------------------|-------|---------|
/// | base q5_1 (dictation's)        | 59.5% | 0.56 s  |
/// | small q5_1                     | 47.0% | 1.76 s  |
/// | small q5_1, prompt, 16 threads | 37.5% | 1.55 s  |
/// | medium q5_0                    | 38.3% | 5.80 s  |
/// | large-v3-turbo q5_0, 16 thr.   | 38.0% | 6.89 s  |
/// | the same, prompt               | 32.0% | 7.04 s  |
///
/// Turbo hears best and takes seven seconds after the key is up, which is not push-to-talk;
/// `small` with the prompt (`prompt`) hears as well as turbo without one, in a quarter of the
/// time. Encoding only as much of whisper's 30 s window as a take fills (`audio_ctx`) cut the
/// time by four and made every model loop on a phrase, confidently: it is not used.
pub const MODEL: Pinned = whisper!("ggml-small-q5_1.bin", 190_085_487, "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb");

/// Jarvis's model on disk, for `voice::load_context`: the config's `voice.whisper` (a ggml model
/// already there), else `MODEL`, fetched once into dictation's models dir. Nothing is fetched for
/// a CPU whisper cannot run on.
pub fn fetch(configured: Option<PathBuf>) -> Result<PathBuf, String> {
    voice::cpu_check()?;
    let mut said = u64::MAX;
    match configured {
        Some(p) if p.is_file() => Ok(p),
        Some(p) => Err(format!("voice.whisper in jarvis.json: {} is not a file", p.display())),
        // Said in the log every 64 MB: nothing on screen shows it.
        None => files::ensure(&files::models_dir(), &MODEL, |done, total| {
            if done >> 26 != said >> 26 || done == total {
                said = done;
                log::info!("jarvis voice: {} {done} of {total} bytes", MODEL.file);
            }
        }),
    }
}

/// What Jarvis heard in a take at 16 kHz mono: the text and the decoder's confidence, 0–1. An
/// empty text is a take with nothing said. `prompt` is `prompt`'s.
pub fn hear(ctx: &WhisperContext, audio: &[f32], prompt: &str) -> Result<(String, f32), String> {
    voice::transcribe_scored(ctx, audio, Language::Pt, &shape(prompt))
}

/// Up to 16 threads, where dictation stops at 8: a Jarvis take is short and the maintainer is
/// waiting on it (large-v3-turbo over the set: 9.4 s a take with 8, 6.9 s with 16, on an
/// i9-13900KS).
fn shape(prompt: &str) -> voice::Shape<'_> {
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(16);
    voice::Shape { prompt: Some(prompt), threads: Some(threads) }
}

/// The words of the maintainer's requests that are not Portuguese, which whisper, told the take
/// is Portuguese, otherwise spells as Portuguese ("o jeito do desktop" for "o git do desktop").
const JARGON: &str = "James, git, commit, PR, CI, checks, issue, README, branch, merge, diff, log, VS Code";
/// Whisper keeps at most 224 tokens of prompt; this many characters stays well inside that.
const PROMPT_CHARS: usize = 480;

/// What whisper reads before each take: Jarvis's name, the jargon, and the projects Jarvis knows
/// by name and alias, so that it writes "mnemo-src", not "memo".
pub fn prompt(projects: &[crate::jarvis::JarvisProject]) -> String {
    let mut out = format!("{JARGON}.");
    let names = projects.iter().flat_map(|p| std::iter::once(&p.name).chain(&p.aliases));
    for (i, name) in names.enumerate() {
        let piece = format!("{}{name}", if i == 0 { " Projetos: " } else { ", " });
        if out.chars().count() + piece.chars().count() + 1 > PROMPT_CHARS {
            break;
        }
        out.push_str(&piece);
    }
    if !out.ends_with('.') {
        out.push('.');
    }
    out
}

/// A take as the microphone gave it, made ready for whisper.
pub fn to_whisper(samples: &[f32], rate: u32) -> Vec<f32> {
    voice::resample(samples, rate, voice::WHISPER_RATE)
}

/// Reads a 16-bit WAV as 16 kHz mono, through the same mix and resample a live take gets.
#[cfg(test)]
pub(crate) fn wav(path: &Path) -> Vec<f32> {
    let mut reader = hound::WavReader::open(path).expect("wav");
    let spec = reader.spec();
    let ints: Vec<i16> = reader.samples::<i16>().map(|s| s.unwrap()).collect();
    let mut mono = vec![];
    voice::mix_to_mono(&ints, spec.channels as usize, &mut mono);
    to_whisper(&mono, spec.sample_rate)
}

#[cfg(test)]
mod tests {
    use super::*;

/// Words of a transcript for scoring: lower case, no punctuation.
    pub fn words(text: &str) -> Vec<String> {
        text.to_lowercase()
            .chars()
            .map(|c| if c.is_alphanumeric() { c } else { ' ' })
            .collect::<String>()
            .split_whitespace()
            .map(str::to_string)
            .collect()
    }
    
    /// Word edits (substitutions, insertions, deletions) from `truth` to `heard`.
    pub fn word_errors(truth: &[String], heard: &[String]) -> usize {
        let mut prev: Vec<usize> = (0..=heard.len()).collect();
        for (i, t) in truth.iter().enumerate() {
            let mut cur = vec![i + 1; heard.len() + 1];
            for (j, h) in heard.iter().enumerate() {
                cur[j + 1] = (prev[j] + usize::from(t != h)).min(prev[j + 1] + 1).min(cur[j] + 1);
            }
            prev = cur;
        }
        prev[heard.len()]
    }

    fn w(s: &str) -> Vec<String> {
        words(s)
    }

    #[test]
    fn word_errors_count_edits_without_case_or_punctuation() {
        assert_eq!(words("Quais PRs estão abertos no Tauri?"), ["quais", "prs", "estão", "abertos", "no", "tauri"]);
        assert_eq!(word_errors(&w("o ci do llama tá verde"), &w("O CI do Llama tá verde?")), 0);
        assert_eq!(word_errors(&w("o ci do llama tá verde"), &w("o ci da lama tá verde")), 2);
        assert_eq!(word_errors(&w("mostra o pr 500"), &w("mostra pr 500 agora")), 2);
        assert_eq!(word_errors(&w("a b"), &[]), 2);
    }

    #[test]
    fn the_prompt_names_the_projects_and_their_aliases_within_whispers_budget() {
        let p = |name: &str, aliases: &[&str]| crate::jarvis::JarvisProject {
            name: name.into(),
            aliases: aliases.iter().map(|a| a.to_string()).collect(),
            root: String::new(),
        };
        assert_eq!(prompt(&[]), format!("{JARGON}."));
        assert_eq!(
            prompt(&[p("mnemo-desktop", &["desktop"]), p("mnemo-src", &["a cli do mnemo"])]),
            format!("{JARGON}. Projetos: mnemo-desktop, desktop, mnemo-src, a cli do mnemo.")
        );
        let many: Vec<_> = (0..200).map(|i| p(&format!("project-{i}"), &[])).collect();
        let long = prompt(&many);
        assert!(long.chars().count() <= PROMPT_CHARS && long.ends_with('.') && long.contains("project-0,"), "{long}");
    }

    #[test]
    fn confidence_is_between_zero_and_one_and_zero_for_nothing_heard() {
        assert_eq!(voice::geometric_mean(&[]), 0.0);
        assert!((voice::geometric_mean(&[0.5, 0.5]) - 0.5).abs() < 1e-6);
        assert!((voice::geometric_mean(&[1.0, 0.25]) - 0.5).abs() < 1e-6);
        // A probability whisper rounds to 0 or past 1 still gives a number in range.
        let g = voice::geometric_mean(&[0.0, 1.5, 0.9]);
        assert!((0.0..=1.0).contains(&g), "{g}");

        let ctx = voice::load_context(&voice::test_model()).expect("load");
        let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/voice");
        let (text, confidence) = hear(&ctx, &wav(&fixtures.join("ola.wav")), JARGON).unwrap();
        assert!(text.to_lowercase().contains("bom dia"), "{text}");
        assert!(confidence > 0.3 && confidence <= 1.0, "{confidence}");
        assert_eq!(hear(&ctx, &vec![0.0; 32_000], JARGON).unwrap(), (String::new(), 0.0));
        // Noise that passes the silence gate: whatever whisper makes of it, its confidence is in
        // range, and lower than for the sentence.
        let mut seed = 0x1234_5678u32;
        let babble: Vec<f32> = (0..48_000)
            .map(|_| {
                seed ^= seed << 13;
                seed ^= seed >> 17;
                seed ^= seed << 5;
                (seed as f32 / u32::MAX as f32 - 0.5) * 0.3
            })
            .collect();
        let (_, noise) = hear(&ctx, &babble, JARGON).unwrap();
        assert!((0.0..=1.0).contains(&noise) && noise < confidence, "{noise} vs {confidence}");
    }

    /// Accuracy and latency of Jarvis's candidate models over a set of spoken requests, for the
    /// PR that picks one: `MNEMO_JARVIS_BENCH=<dir with *.wav and truth.json {file: text}>`
    /// `MNEMO_JARVIS_MODELS=<ggml model>;<ggml model>…`
    /// `cargo test --release --lib jarvis_voice::hear::tests::bench -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn bench() {
        let dir = PathBuf::from(std::env::var_os("MNEMO_JARVIS_BENCH").expect("MNEMO_JARVIS_BENCH"));
        let truth: std::collections::BTreeMap<String, String> =
            serde_json::from_str(&std::fs::read_to_string(dir.join("truth.json")).unwrap()).unwrap();
        let takes: Vec<(String, Vec<f32>, Vec<String>)> =
            truth.iter().map(|(f, t)| (f.clone(), wav(&dir.join(f)), words(t))).collect();
        let models = std::env::var("MNEMO_JARVIS_MODELS").expect("MNEMO_JARVIS_MODELS");
        // `MNEMO_JARVIS_PROMPT`: a prompt instead of none, `jarvis` for `prompt` over the projects
        // of the benchmark's set.
        let bench_prompt = match std::env::var("MNEMO_JARVIS_PROMPT").ok().as_deref() {
            None | Some("") => String::new(),
            Some("jarvis") => {
                let p = |name: &str, aliases: &[&str]| crate::jarvis::JarvisProject {
                    name: name.into(),
                    aliases: aliases.iter().map(|a| a.to_string()).collect(),
                    root: String::new(),
                };
                prompt(&[
                    p("llama.cpp", &["llama"]),
                    p("mnemo", &["mnemo-src", "a cli do mnemo"]),
                    p("mnemo-desktop", &["desktop", "o app"]),
                    p("tauri", &[]),
                    p("whisper.cpp", &["whisper"]),
                ])
            }
            Some(other) => other.to_string(),
        };
        eprintln!("prompt: {bench_prompt:?}");
        for model in models.split(';').filter(|m| !m.is_empty()) {
            let t = std::time::Instant::now();
            let ctx = voice::load_context(Path::new(model)).expect("load");
            let loaded = t.elapsed().as_secs_f32();
            let _ = hear(&ctx, &takes[0].1, &bench_prompt);
            let (mut errors, mut total, mut exact) = (0usize, 0usize, 0usize);
            let mut times = vec![];
            let (mut sure_right, mut sure_wrong) = (vec![], vec![]);
            let mut by_kind: std::collections::BTreeMap<&str, (usize, usize)> = Default::default();
            for (name, audio, truth) in &takes {
                let t = std::time::Instant::now();
                let (text, confidence) = hear(&ctx, audio, &bench_prompt).unwrap();
                times.push(t.elapsed().as_secs_f32());
                let e = word_errors(truth, &words(&text));
                errors += e;
                total += truth.len();
                let kind = if name.contains("noise") { "noisy" } else { "clean" };
                let k = by_kind.entry(kind).or_default();
                k.0 += e;
                k.1 += truth.len();
                if e == 0 {
                    exact += 1;
                    sure_right.push(confidence);
                } else {
                    sure_wrong.push(confidence);
                    eprintln!("  {name} ({confidence:.2}): {text}");
                }
            }
            times.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let mean = |v: &[f32]| if v.is_empty() { f32::NAN } else { v.iter().sum::<f32>() / v.len() as f32 };
            eprintln!(
                "{}: load {loaded:.2}s; WER {:.1}% ({}); exact {exact}/{}; latency median {:.2}s p90 {:.2}s max {:.2}s; confidence right {:.2} wrong {:.2}",
                Path::new(model).file_name().unwrap().to_string_lossy(),
                100.0 * errors as f32 / total as f32,
                by_kind.iter().map(|(k, (e, n))| format!("{k} {:.1}%", 100.0 * *e as f32 / *n as f32)).collect::<Vec<_>>().join(", "),
                takes.len(),
                times[times.len() / 2],
                times[times.len() * 9 / 10],
                times[times.len() - 1],
                mean(&sure_right),
                mean(&sure_wrong),
            );
        }
    }
}
