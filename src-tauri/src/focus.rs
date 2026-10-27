//! Blur the background, in Create's Cut out: the main thing in the picture stays sharp and what's
//! behind it goes soft, as with a portrait lens. Cut out's subject finder makes the mask; the blur
//! averages only background pixels, so the subject doesn't bleed into it as a halo.

use rayon::prelude::*;

/// Strongest blur, as a share of the picture's long edge.
const MAX_RADIUS: f32 = 0.03;

/// Three passes of a running-sum box blur of radius `r` across each row then down each column, close
/// to a Gaussian. `ch` values a pixel.
fn blur(v: &mut [f32], w: usize, h: usize, ch: usize, r: usize) {
    if r == 0 {
        return;
    }
    for _ in 0..3 {
        v.par_chunks_mut(w * ch).for_each(|row| box_line(row, w, ch, r));
        let mut t = transpose(v, w, h, ch);
        t.par_chunks_mut(h * ch).for_each(|col| box_line(col, h, ch, r));
        v.copy_from_slice(&transpose(&t, h, w, ch));
    }
}
fn box_line(line: &mut [f32], n: usize, ch: usize, r: usize) {
    let src = line.to_vec();
    let at = |i: isize, c: usize| src[(i.clamp(0, n as isize - 1) as usize) * ch + c];
    let k = 1.0 / (2 * r + 1) as f32;
    for c in 0..ch {
        let mut sum: f32 = (-(r as isize)..=r as isize).map(|i| at(i, c)).sum();
        for i in 0..n {
            line[i * ch + c] = sum * k;
            sum += at(i as isize + r as isize + 1, c) - at(i as isize - r as isize, c);
        }
    }
}
fn transpose(v: &[f32], w: usize, h: usize, ch: usize) -> Vec<f32> {
    let mut out = vec![0.0; v.len()];
    out.par_chunks_mut(h * ch).enumerate().for_each(|(x, col)| {
        for y in 0..h {
            col[y * ch..][..ch].copy_from_slice(&v[(y * w + x) * ch..][..ch]);
        }
    });
    out
}

/// The `w` × `h` RGBA picture with what's behind its main thing blurred; `amount` is 1–100. None when
/// nothing stands out from the background.
pub fn blur_background(w: usize, h: usize, rgba: &[u8], amount: f32) -> Result<Option<Vec<u8>>, String> {
    if !(1.0..=100.0).contains(&amount) {
        return Err("the blur amount must be 1–100".into());
    }
    let Some(region) = crate::cutout::select(w, h, rgba, &crate::cutout::Pick::Subject)? else { return Ok(None) };
    let long = w.max(h) as f32;
    // The subject's coverage over the whole picture, its edge softened a little so the change is gentle.
    let mut keep = vec![0f32; w * h];
    let (bw, x0, y0) = (region.bbox.width() as usize, region.bbox.x0 as usize, region.bbox.y0 as usize);
    for (i, &m) in region.mask.iter().enumerate() {
        let (x, y) = (x0 + i % bw, y0 + i / bw);
        if x < w && y < h {
            keep[y * w + x] = m as f32 / 255.0;
        }
    }
    blur(&mut keep, w, h, 1, (long * 0.002).round() as usize);
    // Background only, premultiplied by how much is background, blurred, then divided back out.
    let mut back = vec![0f32; w * h * 4];
    back.par_chunks_mut(4).zip(rgba.par_chunks(4)).zip(keep.par_iter()).for_each(|((b, p), &k)| {
        let a = 1.0 - k;
        for c in 0..3 {
            b[c] = p[c] as f32 * a;
        }
        b[3] = a;
    });
    // Box passes stack: three of radius r spread about as far as a Gaussian of r.
    blur(&mut back, w, h, 4, (long * MAX_RADIUS * amount / 100.0).round().max(1.0) as usize);
    let mut out = rgba.to_vec();
    out.par_chunks_mut(4).zip(back.par_chunks(4)).zip(keep.par_iter()).for_each(|((o, b), &k)| {
        if b[3] <= 1e-4 || k >= 1.0 {
            return;
        }
        for c in 0..3 {
            let soft = b[c] / b[3];
            o[c] = (o[c] as f32 * k + soft * (1.0 - k)).round().clamp(0.0, 255.0) as u8;
        }
    });
    Ok(Some(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A red disc on a background of fine black and white stripes.
    fn disc() -> (usize, usize, Vec<u8>) {
        let (w, h) = (240, 160);
        let mut px = vec![0u8; w * h * 4];
        for y in 0..h {
            for x in 0..w {
                let inside = (x as f32 - 120.0).hypot(y as f32 - 80.0) < 45.0;
                let c = if inside { [210, 30, 30, 255] } else if x % 4 < 2 { [250, 250, 250, 255] } else { [20, 20, 20, 255] };
                px[(y * w + x) * 4..][..4].copy_from_slice(&c);
            }
        }
        (w, h, px)
    }
    fn px(v: &[u8], w: usize, x: usize, y: usize) -> [u8; 3] {
        let i = (y * w + x) * 4;
        [v[i], v[i + 1], v[i + 2]]
    }

    #[test]
    fn the_background_goes_soft_and_the_subject_stays_sharp() {
        let (w, h, img) = disc();
        let out = blur_background(w, h, &img, 60.0).unwrap().expect("the disc stands out");
        // The stripes average out to grey, and grey from the stripes, not pink from the disc.
        for (x, y) in [(10, 10), (230, 150), (20, 80)] {
            let [r, g, b] = px(&out, w, x, y);
            assert!((90..=180).contains(&r) && r.abs_diff(g) < 12 && r.abs_diff(b) < 12, "background at {x},{y}: {:?}", [r, g, b]);
        }
        assert_eq!(px(&out, w, 120, 80), [210, 30, 30], "the middle of the disc is untouched");
        // Just outside the disc, the blur took nothing from it.
        let [r, g, _] = px(&out, w, 120 + 52, 80);
        assert!(r.abs_diff(g) < 25, "no pink halo: {:?}", px(&out, w, 172, 80));
    }

    #[test]
    fn nothing_standing_out_is_left_alone() {
        let (w, h) = (100, 60);
        assert_eq!(blur_background(w, h, &vec![128u8; w * h * 4], 50.0).unwrap(), None);
    }

    /// cargo test --release focus -- --ignored --nocapture
    #[test]
    #[ignore]
    fn timing_at_twelve_megapixels() {
        let (w, h) = (4000, 3000);
        let mut px = vec![0u8; w * h * 4];
        for (i, p) in px.chunks_mut(4).enumerate() {
            let (x, y) = ((i % w) as f32, (i / w) as f32);
            let c = if (x - 2000.0).hypot(y - 1500.0) < 800.0 { [210, 30, 30, 255] } else { [(x as usize % 256) as u8, 120, 200, 255] };
            p.copy_from_slice(&c);
        }
        let t = std::time::Instant::now();
        blur_background(w, h, &px, 100.0).unwrap();
        eprintln!("blur_background at {w} × {h}: {:?}", t.elapsed());
    }

    #[test]
    fn a_bad_amount_is_refused() {
        let (w, h, img) = disc();
        assert!(blur_background(w, h, &img, 0.0).is_err());
        assert!(blur_background(w, h, &img, 101.0).is_err());
    }
}
