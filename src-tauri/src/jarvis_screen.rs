//! Jarvis looks at the screen (#507): the monitor holding the window in front, captured only when
//! `jarvis_screenshot` is called, scaled to at most `MAX_SIDE` px on its longer side and returned as
//! a `data:image/png;base64,…` URL. The pixels stay in memory: nothing here writes them to disk or
//! logs them. Windows only; other OSes answer with an error.

use std::io::Write;

/// The longer side of the returned image, at most. The model's projector downsamples further, and
/// a 4K screen would only make the request bigger.
pub const MAX_SIDE: u32 = 1600;

/// Pixels as GDI hands them over: 4 bytes each in B, G, R, A order, rows top to bottom.
#[derive(Debug, Clone, PartialEq)]
pub struct Bitmap {
    pub width: u32,
    pub height: u32,
    pub bgra: Vec<u8>,
}

/// The size `width`×`height` takes to fit `max` on its longer side, keeping its shape; the same
/// size when it already fits. Neither side drops below 1.
pub fn fit(width: u32, height: u32, max: u32) -> (u32, u32) {
    let longer = width.max(height);
    if longer <= max {
        return (width, height);
    }
    let scale = |side: u32| ((side as u64 * max as u64 + longer as u64 / 2) / longer as u64).max(1) as u32;
    (scale(width), scale(height))
}

/// `src` scaled down to fit `max`, each new pixel the average of the source pixels it covers, so
/// text thins out rather than breaking into aliasing. Never scales up.
pub fn scale_down(src: &Bitmap, max: u32) -> Bitmap {
    let (w, h) = fit(src.width, src.height, max);
    if (w, h) == (src.width, src.height) {
        return src.clone();
    }
    // The source columns (and rows) each output column covers: [start(x), start(x + 1)).
    let span = |out: u32, from: u32, i: u32| (i as u64 * from as u64 / out as u64) as usize;
    let cols: Vec<(usize, usize)> =
        (0..w).map(|x| (span(w, src.width, x), span(w, src.width, x + 1).max(span(w, src.width, x) + 1))).collect();
    let stride = src.width as usize * 4;
    let mut out = Vec::with_capacity(w as usize * h as usize * 4);
    let mut sums = vec![[0u64; 4]; w as usize];
    for y in 0..h {
        let (y0, y1) = (span(h, src.height, y), span(h, src.height, y + 1).max(span(h, src.height, y) + 1));
        sums.iter_mut().for_each(|s| *s = [0; 4]);
        for row in src.bgra[y0 * stride..y1 * stride].chunks_exact(stride) {
            for (sum, &(x0, x1)) in sums.iter_mut().zip(&cols) {
                for px in row[x0 * 4..x1 * 4].chunks_exact(4) {
                    for c in 0..4 {
                        sum[c] += px[c] as u64;
                    }
                }
            }
        }
        for (sum, &(x0, x1)) in sums.iter().zip(&cols) {
            let n = ((x1 - x0) * (y1 - y0)) as u64;
            out.extend(sum.iter().map(|&s| ((s + n / 2) / n) as u8));
        }
    }
    Bitmap { width: w, height: h, bgra: out }
}

/// `bitmap` as a PNG: 8-bit RGB (the screen has no transparency, so alpha is dropped), each row
/// filtered against its left neighbour, which flat screen colours compress well under.
pub fn png(bitmap: &Bitmap) -> Vec<u8> {
    let (w, h) = (bitmap.width as usize, bitmap.height as usize);
    let mut raw = Vec::with_capacity(h * (1 + w * 3));
    for row in bitmap.bgra.chunks_exact(w * 4).take(h) {
        raw.push(1); // filter type Sub
        let mut left = [0u8; 3];
        for px in row.chunks_exact(4) {
            let rgb = [px[2], px[1], px[0]];
            raw.extend((0..3).map(|c| rgb[c].wrapping_sub(left[c])));
            left = rgb;
        }
    }
    let mut z = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::new(4));
    z.write_all(&raw).expect("writing to memory");
    let idat = z.finish().expect("writing to memory");

    let mut ihdr = Vec::with_capacity(13);
    ihdr.extend(bitmap.width.to_be_bytes());
    ihdr.extend(bitmap.height.to_be_bytes());
    ihdr.extend([8, 2, 0, 0, 0]); // 8 bits, RGB, deflate, filtering method 0, no interlace

    let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
    for (kind, data) in [(b"IHDR", &ihdr[..]), (b"IDAT", &idat[..]), (b"IEND", &[][..])] {
        out.extend((data.len() as u32).to_be_bytes());
        let mut crc = flate2::Crc::new();
        crc.update(kind);
        crc.update(data);
        out.extend(kind);
        out.extend(data);
        out.extend(crc.sum().to_be_bytes());
    }
    out
}

/// `bitmap` fitted to `MAX_SIDE` as a `data:image/png;base64,…` URL.
pub fn data_url(bitmap: &Bitmap) -> String {
    use base64::Engine;
    let png = png(&scale_down(bitmap, MAX_SIDE));
    format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png))
}

/// The monitor holding the window in front (the primary one when no window is), as GDI sees it.
#[cfg(windows)]
pub fn capture() -> Result<Bitmap, String> {
    use std::ptr::null_mut;
    use windows_sys::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, GetMonitorInfoW,
        MonitorFromWindow, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS,
        MONITORINFO, MONITOR_DEFAULTTOPRIMARY, SRCCOPY,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    // SAFETY: plain GDI calls on handles made here, each released before returning; `buf` holds
    // exactly the `width * height` 32-bit pixels GetDIBits is asked for.
    unsafe {
        let monitor = MonitorFromWindow(GetForegroundWindow(), MONITOR_DEFAULTTOPRIMARY);
        let mut info: MONITORINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(monitor, &mut info) == 0 {
            return Err("could not find the monitor in front".into());
        }
        let r = info.rcMonitor;
        let (width, height) = (r.right - r.left, r.bottom - r.top);
        if width <= 0 || height <= 0 {
            return Err(format!("the monitor in front has no area ({width}×{height})"));
        }

        let screen = GetDC(null_mut());
        if screen.is_null() {
            return Err("could not open the screen".into());
        }
        let mem = CreateCompatibleDC(screen);
        let bmp = CreateCompatibleBitmap(screen, width, height);
        let mut buf = vec![0u8; width as usize * height as usize * 4];
        let result = if mem.is_null() || bmp.is_null() {
            Err("could not make a bitmap the size of the screen".to_string())
        } else {
            let old = SelectObject(mem, bmp);
            // CAPTUREBLT: layered windows (menus, tooltips, overlays) are in the picture too.
            let copied = BitBlt(mem, 0, 0, width, height, screen, r.left, r.top, SRCCOPY | CAPTUREBLT);
            SelectObject(mem, old);
            let mut bi: BITMAPINFO = std::mem::zeroed();
            bi.bmiHeader = BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height, // top-down rows
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB as _,
                ..std::mem::zeroed()
            };
            if copied == 0 {
                Err("could not copy the screen".to_string())
            } else if GetDIBits(mem, bmp, 0, height as u32, buf.as_mut_ptr().cast(), &mut bi, DIB_RGB_COLORS) != height {
                Err("could not read the screen's pixels".to_string())
            } else {
                Ok(())
            }
        };
        if !bmp.is_null() {
            DeleteObject(bmp);
        }
        if !mem.is_null() {
            DeleteDC(mem);
        }
        ReleaseDC(null_mut(), screen);
        result.map(|()| Bitmap { width: width as u32, height: height as u32, bgra: buf })
    }
}

#[cfg(not(windows))]
pub fn capture() -> Result<Bitmap, String> {
    Err("Jarvis can only look at the screen on Windows".into())
}

/// The screen in front, as a `data:image/png;base64,…` URL at most `MAX_SIDE` px on its longer
/// side (#507). Taken on this call only, and never kept.
#[tauri::command]
pub async fn jarvis_screenshot() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| capture().map(|b| data_url(&b))).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    /// A `width`×`height` bitmap whose pixel at (x, y) is `f(x, y)` as (r, g, b).
    fn bitmap(width: u32, height: u32, f: impl Fn(u32, u32) -> (u8, u8, u8)) -> Bitmap {
        let mut bgra = Vec::new();
        for y in 0..height {
            for x in 0..width {
                let (r, g, b) = f(x, y);
                bgra.extend([b, g, r, 255]);
            }
        }
        Bitmap { width, height, bgra }
    }

    fn rgb(b: &Bitmap, x: u32, y: u32) -> (u8, u8, u8) {
        let i = ((y * b.width + x) * 4) as usize;
        (b.bgra[i + 2], b.bgra[i + 1], b.bgra[i])
    }

    /// The chunks of a PNG, by kind, each checked against its CRC.
    fn chunks(png: &[u8]) -> Vec<([u8; 4], Vec<u8>)> {
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        let mut out = Vec::new();
        let mut rest = &png[8..];
        while !rest.is_empty() {
            let len = u32::from_be_bytes(rest[..4].try_into().unwrap()) as usize;
            let kind: [u8; 4] = rest[4..8].try_into().unwrap();
            let data = rest[8..8 + len].to_vec();
            let mut crc = flate2::Crc::new();
            crc.update(&rest[4..8 + len]);
            assert_eq!(crc.sum().to_be_bytes(), rest[8 + len..12 + len], "crc of {}", String::from_utf8_lossy(&kind));
            out.push((kind, data));
            rest = &rest[12 + len..];
        }
        out
    }

    /// A PNG this module wrote, back to (width, height, rgb rows), undoing the Sub filter.
    fn decode(png: &[u8]) -> (u32, u32, Vec<u8>) {
        let chunks = chunks(png);
        let kinds: Vec<&[u8; 4]> = chunks.iter().map(|(k, _)| k).collect();
        assert_eq!(kinds, [b"IHDR", b"IDAT", b"IEND"]);
        let ihdr = &chunks[0].1;
        let (w, h) = (u32::from_be_bytes(ihdr[..4].try_into().unwrap()), u32::from_be_bytes(ihdr[4..8].try_into().unwrap()));
        assert_eq!(ihdr[8..], [8, 2, 0, 0, 0]);
        let mut raw = Vec::new();
        flate2::read::ZlibDecoder::new(&chunks[1].1[..]).read_to_end(&mut raw).unwrap();
        assert_eq!(raw.len(), h as usize * (1 + w as usize * 3));
        let mut pixels = Vec::new();
        for row in raw.chunks_exact(1 + w as usize * 3) {
            assert_eq!(row[0], 1);
            let start = pixels.len();
            for (i, &v) in row[1..].iter().enumerate() {
                let left = if i >= 3 { pixels[start + i - 3] } else { 0u8 };
                pixels.push(v.wrapping_add(left));
            }
        }
        (w, h, pixels)
    }

    #[test]
    fn fit_keeps_the_shape_and_caps_the_longer_side() {
        assert_eq!(fit(3840, 2160, 1600), (1600, 900));
        assert_eq!(fit(2160, 3840, 1600), (900, 1600));
        assert_eq!(fit(2560, 1440, 1600), (1600, 900));
        assert_eq!(fit(3440, 1440, 1600), (1600, 670));
        assert_eq!(fit(1600, 1200, 1600), (1600, 1200));
        assert_eq!(fit(1280, 720, 1600), (1280, 720));
        assert_eq!(fit(10000, 2, 1600), (1600, 1));
    }

    #[test]
    fn scaling_down_averages_the_pixels_each_one_covers() {
        // A 4×2 checkerboard of black and white halves to 2×1 grey.
        let src = bitmap(4, 2, |x, y| if (x + y) % 2 == 0 { (255, 255, 255) } else { (0, 0, 0) });
        let out = scale_down(&src, 2);
        assert_eq!((out.width, out.height), (2, 1));
        assert_eq!(rgb(&out, 0, 0), (128, 128, 128));
        assert_eq!(rgb(&out, 1, 0), (128, 128, 128));

        // Left half red, right half blue, keeps its halves.
        let src = bitmap(3200, 1800, |x, _| if x < 1600 { (255, 0, 0) } else { (0, 0, 255) });
        let out = scale_down(&src, MAX_SIDE);
        assert_eq!((out.width, out.height), (1600, 900));
        assert_eq!(out.bgra.len(), 1600 * 900 * 4);
        assert_eq!(rgb(&out, 0, 0), (255, 0, 0));
        assert_eq!(rgb(&out, 799, 899), (255, 0, 0));
        assert_eq!(rgb(&out, 800, 0), (0, 0, 255));
        assert_eq!(rgb(&out, 1599, 899), (0, 0, 255));
    }

    #[test]
    fn scaling_by_an_uneven_factor_covers_every_source_pixel() {
        // 2560 wide to 1600: each output column covers one or two source columns, never none.
        let src = bitmap(2560, 10, |x, _| ((x % 256) as u8, 7, 9));
        let out = scale_down(&src, MAX_SIDE);
        assert_eq!((out.width, out.height), (1600, 6));
        assert!((0..1600).all(|x| rgb(&out, x, 0).1 == 7 && rgb(&out, x, 5).2 == 9));
    }

    #[test]
    fn a_screen_that_fits_is_left_as_it_is() {
        let src = bitmap(1280, 720, |x, y| (x as u8, y as u8, 3));
        assert_eq!(scale_down(&src, MAX_SIDE), src);
    }

    #[test]
    fn the_png_holds_the_pixels_in_rgb() {
        let src = bitmap(5, 3, |x, y| ((x * 50) as u8, (y * 100) as u8, 200 - (x * 10) as u8));
        let (w, h, pixels) = decode(&png(&src));
        assert_eq!((w, h), (5, 3));
        for y in 0..3 {
            for x in 0..5 {
                let i = ((y * 5 + x) * 3) as usize;
                assert_eq!((pixels[i], pixels[i + 1], pixels[i + 2]), rgb(&src, x, y), "pixel {x},{y}");
            }
        }
    }

    #[test]
    fn the_data_url_is_a_base64_png_fitted_to_the_cap() {
        use base64::Engine;
        let src = bitmap(3840, 2160, |x, y| ((x / 15) as u8, (y / 9) as u8, 40));
        let url = data_url(&src);
        let b64 = url.strip_prefix("data:image/png;base64,").expect("a png data url");
        let png = base64::engine::general_purpose::STANDARD.decode(b64).unwrap();
        let (w, h, pixels) = decode(&png);
        assert_eq!((w, h), (1600, 900));
        assert_eq!(&pixels[..3], &[0, 0, 40]);
    }

    /// One real capture, its size and time printed; the pixels are dropped. Run by hand:
    /// `cargo test --release --lib jarvis_screen::tests::live -- --ignored --nocapture`.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn live_capture() {
        let start = std::time::Instant::now();
        let shot = capture().unwrap();
        let captured = start.elapsed();
        let url = data_url(&shot);
        let (w, h) = fit(shot.width, shot.height, MAX_SIDE);
        println!(
            "monitor {}×{} → {w}×{h}, {} KB as a data URL; capture {captured:?}, total {:?}",
            shot.width,
            shot.height,
            url.len() / 1024,
            start.elapsed()
        );
        assert!(url.starts_with("data:image/png;base64,"));
    }

    #[cfg(not(windows))]
    #[test]
    fn other_oses_say_they_cannot() {
        assert!(capture().unwrap_err().contains("only"));
    }
}
