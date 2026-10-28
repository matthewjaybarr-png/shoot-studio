//! Make the paper see-through: a drawing, handwriting or logo on paper keeps its lines and loses
//! the paper, soft pencil and crayon edges included. Or one colour picked in the picture goes.
//!
//! A phone photo of paper is never evenly lit, so first the paper's own colour is found all over
//! the picture (the brightest part of each small square, smoothed), and every pixel is divided by
//! it: the paper becomes pure white everywhere, shadows and yellowing gone. Then white is unmixed
//! from each pixel, PhotoCraft's Color to Alpha: the most see-through colour that, laid over
//! white, gives back the pixel. Grey pencil becomes black at part strength, so it still looks
//! right on any background.
//!
//! `opacity`, `remap` and `unmix` are copied from PhotoCraft
//! (https://github.com/storytold/photocraft, commit d5be9b8aef2d, crates/algo/src/color_to_alpha.rs),
//! Copyright (c) 2026 ArtCraft Team and the PhotoCraft contributors, licensed under the MIT License
//! or the Apache License, Version 2.0, at your option. See THIRD_PARTY_NOTICES.md and
//! LICENSES/photocraft-Apache-2.0.txt. Unmodified apart from these comments.

/// What to make see-through.
pub enum Key {
    /// The paper, wherever it is lit unevenly.
    Paper,
    /// One colour, 8-bit sRGB.
    Colour([u8; 3]),
}

/// The opacity `a` (0–1) a pixel needs to be a mix of some in-range colour and `key`.
/// (PhotoCraft's `opacity`.)
fn opacity(colour: &[f32], key: &[f32]) -> f32 {
    let mut a = 0.0f32;
    for (&p, &c) in colour.iter().zip(key) {
        let ai = if p > c {
            if c < 1.0 { (p - c) / (1.0 - c) } else { 1.0 }
        } else if p < c {
            if c > 0.0 { (c - p) / c } else { 1.0 }
        } else {
            0.0
        };
        if ai.is_finite() {
            a = a.max(ai);
        }
    }
    a.clamp(0.0, 1.0)
}

/// `a <= transparency` → 0, `a >= opacity` → 1, linear in between. (PhotoCraft's `remap`.)
fn remap(a: f32, transparency: f32, opacity: f32) -> f32 {
    if a <= transparency {
        0.0
    } else if a >= opacity {
        1.0
    } else {
        ((a - transparency) / (opacity - transparency)).clamp(0.0, 1.0)
    }
}

/// Unmixes `key` from one pixel's colour in place and returns the factor its alpha is multiplied
/// by. (PhotoCraft's `unmix`.)
fn unmix(colour: &mut [f32], key: &[f32], transparency: f32, opacity_threshold: f32) -> f32 {
    let a = remap(opacity(colour, key), transparency, opacity_threshold);
    if a >= 1.0 {
        return 1.0;
    }
    for (p, &c) in colour.iter_mut().zip(key) {
        *p = if a <= 0.0 { c } else { (c + (*p - c) / a).clamp(0.0, 1.0) };
    }
    a.max(0.0)
}

fn luma(p: &[f32]) -> f32 {
    0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]
}

/// The paper's colour under every pixel, 0–1 sRGB, three a pixel. Each square of the grid takes
/// the average of its brightest tenth (paper is lighter than what's drawn on it); squares that are
/// mostly drawing come out much darker than the paper around them, so they borrow their
/// neighbours'; then the grid is smoothed and spread back over the pixels.
fn paper(w: usize, h: usize, px: &[f32]) -> Vec<f32> {
    let cell = (w.max(h) / 48).max(8);
    let (gw, gh) = (w.div_ceil(cell), h.div_ceil(cell));
    let mut grid = vec![[0f32; 3]; gw * gh];
    let mut solid = vec![true; gw * gh];
    let mut lumas = Vec::new();
    for gy in 0..gh {
        for gx in 0..gw {
            let mut cellpx: Vec<(f32, [f32; 3])> = Vec::with_capacity(cell * cell);
            for y in gy * cell..((gy + 1) * cell).min(h) {
                for x in gx * cell..((gx + 1) * cell).min(w) {
                    let p = &px[(y * w + x) * 4..(y * w + x) * 4 + 3];
                    cellpx.push((luma(p), [p[0], p[1], p[2]]));
                }
            }
            cellpx.sort_by(|a, b| b.0.total_cmp(&a.0));
            let top = &cellpx[..(cellpx.len() / 10).max(1)];
            let mut c = [0f32; 3];
            for (_, p) in top {
                for k in 0..3 {
                    c[k] += p[k] / top.len() as f32;
                }
            }
            grid[gy * gw + gx] = c;
            lumas.push(luma(&c));
        }
    }
    let mut sorted = lumas.clone();
    sorted.sort_by(f32::total_cmp);
    let typical = sorted[sorted.len() * 3 / 4];
    // The paper's tint: its colour relative to its own brightness, which shade doesn't change. A square
    // coloured in (a yellow crayon sun) is nearly as light as paper but a different tint, so it isn't paper.
    let tint = |c: &[f32; 3]| {
        let m = (c[0] + c[1] + c[2]) / 3.0;
        c.map(|v| v / m.max(1e-3))
    };
    let mut paper_tint = [0f32; 3];
    let bright: Vec<_> = grid.iter().zip(&lumas).filter(|(_, l)| **l >= typical).map(|(c, _)| tint(c)).collect();
    for t in &bright {
        for k in 0..3 {
            paper_tint[k] += t[k] / bright.len() as f32;
        }
    }
    for (i, l) in lumas.iter().enumerate() {
        let t = tint(&grid[i]);
        solid[i] = *l >= typical * 0.8 && (0..3).all(|k| (t[k] - paper_tint[k]).abs() < 0.12);
    }
    // Fill the drawn-over squares from their paper neighbours, ring by ring.
    for _ in 0..gw.max(gh) {
        let mut changed = false;
        let before = solid.clone();
        for gy in 0..gh {
            for gx in 0..gw {
                let i = gy * gw + gx;
                if before[i] {
                    continue;
                }
                let (mut c, mut n) = ([0f32; 3], 0.0);
                for (dx, dy) in [(-1i32, 0i32), (1, 0), (0, -1), (0, 1), (-1, -1), (1, 1), (-1, 1), (1, -1)] {
                    let (x, y) = (gx as i32 + dx, gy as i32 + dy);
                    if x < 0 || y < 0 || x >= gw as i32 || y >= gh as i32 || !before[y as usize * gw + x as usize] {
                        continue;
                    }
                    let q = grid[y as usize * gw + x as usize];
                    for k in 0..3 {
                        c[k] += q[k];
                    }
                    n += 1.0;
                }
                if n > 0.0 {
                    grid[i] = c.map(|v| v / n);
                    solid[i] = true;
                    changed = true;
                }
            }
        }
        if !changed {
            break;
        }
    }
    // Smooth twice with a 3 × 3 average.
    for _ in 0..2 {
        let g = grid.clone();
        for gy in 0..gh {
            for gx in 0..gw {
                let (mut c, mut n) = ([0f32; 3], 0.0);
                for y in gy.saturating_sub(1)..(gy + 2).min(gh) {
                    for x in gx.saturating_sub(1)..(gx + 2).min(gw) {
                        for k in 0..3 {
                            c[k] += g[y * gw + x][k];
                        }
                        n += 1.0;
                    }
                }
                grid[gy * gw + gx] = c.map(|v| v / n);
            }
        }
    }
    // Bilinear between square centres.
    let mut out = vec![0f32; w * h * 3];
    for y in 0..h {
        let fy = ((y as f32 + 0.5) / cell as f32 - 0.5).clamp(0.0, (gh - 1) as f32);
        let (y0, ty) = (fy.floor() as usize, fy.fract());
        let y1 = (y0 + 1).min(gh - 1);
        for x in 0..w {
            let fx = ((x as f32 + 0.5) / cell as f32 - 0.5).clamp(0.0, (gw - 1) as f32);
            let (x0, tx) = (fx.floor() as usize, fx.fract());
            let x1 = (x0 + 1).min(gw - 1);
            for k in 0..3 {
                let top = grid[y0 * gw + x0][k] * (1.0 - tx) + grid[y0 * gw + x1][k] * tx;
                let bottom = grid[y1 * gw + x0][k] * (1.0 - tx) + grid[y1 * gw + x1][k] * tx;
                out[(y * w + x) * 3 + k] = top * (1.0 - ty) + bottom * ty;
            }
        }
    }
    out
}

/// Makes `key` see-through in 8-bit RGBA. `clean` (0–1) is how unlike the key a pixel may be and
/// still go completely, which clears paper grain and JPEG speckle. Returns the new RGBA, or None
/// when nothing would change.
pub fn see_through(w: usize, h: usize, rgba: &[u8], key: Key, clean: f32) -> Result<Option<Vec<u8>>, String> {
    if w == 0 || h == 0 || w.checked_mul(h).and_then(|n| n.checked_mul(4)) != Some(rgba.len()) {
        return Err("the picture is the wrong size".into());
    }
    if !(0.0..=0.6).contains(&clean) {
        return Err("the clean-up amount is out of range".into());
    }
    let mut px: Vec<f32> = rgba.iter().map(|v| *v as f32 / 255.0).collect();
    // Anything at least this solid stays fully solid, so colours unlike the key never go faintly
    // see-through (pure Color to Alpha leaves only the key's exact opposite fully solid). On paper
    // the bar is lower: a light crayon colour unmixed from white is only part solid, but a coloured-in
    // sun should stay a solid sun.
    let solid = if matches!(key, Key::Paper) { 0.6f32 } else { 0.85 };
    let keys = match key {
        Key::Paper => {
            let paper = paper(w, h, &px);
            // Divide out the paper: it becomes white, everything on it keeps its colour.
            for i in 0..w * h {
                for k in 0..3 {
                    px[i * 4 + k] = (px[i * 4 + k] / paper[i * 3 + k].max(0.05)).min(1.0);
                }
            }
            None
        }
        Key::Colour(c) => Some(c.map(|v| v as f32 / 255.0)),
    };
    let key = keys.unwrap_or([1.0; 3]);
    let mut out = Vec::with_capacity(rgba.len());
    let mut changed = false;
    for (i, p) in px.as_chunks_mut::<4>().0.iter_mut().enumerate() {
        // How solid it shows comes from the thresholds; its colour is unmixed at its true opacity, so a
        // pencil line stays dark rather than greying as it's made more solid.
        let a = remap(opacity(&p[..3], &key), clean, solid.max(clean + 0.01));
        if a < 1.0 {
            unmix(&mut p[..3], &key, 0.0, 1.0);
        }
        let alpha = (rgba[i * 4 + 3] as f32 * a).round() as u8;
        if alpha != rgba[i * 4 + 3] {
            changed = true;
        }
        if alpha == rgba[i * 4 + 3] && a >= 1.0 {
            out.extend_from_slice(&rgba[i * 4..i * 4 + 4]); // untouched pixels stay exactly as they were
        } else {
            out.extend(p[..3].iter().map(|v| (v * 255.0).round() as u8));
            out.push(alpha);
        }
    }
    Ok(changed.then_some(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A sheet of paper lit from the top left (bright corner 250, far corner 190, a little yellow),
    /// with a black line across the middle, a soft grey pencil dot and a big yellow crayon sun.
    fn drawing() -> (usize, usize, Vec<u8>) {
        let (w, h) = (240usize, 180usize);
        let mut v = Vec::with_capacity(w * h * 4);
        for y in 0..h {
            for x in 0..w {
                let light = 250.0 - 60.0 * (x + y) as f32 / (w + h) as f32;
                let paper = [light, light * 0.97, light * 0.88];
                if ((x as f32 - 180.0).powi(2) + (y as f32 - 45.0).powi(2)).sqrt() < 30.0 {
                    v.extend_from_slice(&[(242.0 * light / 250.0) as u8, (177.0 * light / 250.0) as u8, (52.0 * light / 250.0) as u8, 255]);
                    continue;
                }
                let ink = if (88..93).contains(&y) && (20..220).contains(&x) {
                    1.0
                } else {
                    let d = ((x as f32 - 60.0).powi(2) + (y as f32 - 40.0).powi(2)).sqrt();
                    if d < 12.0 { 0.4 } else { 0.0 }
                };
                for c in paper {
                    v.push((c * (1.0 - ink) + 20.0 * ink).round() as u8);
                }
                v.push(255);
            }
        }
        (w, h, v)
    }
    fn at(v: &[u8], w: usize, x: usize, y: usize) -> [u8; 4] {
        v[(y * w + x) * 4..(y * w + x) * 4 + 4].try_into().unwrap()
    }

    #[test]
    fn the_paper_goes_even_where_its_shadowed_and_the_drawing_stays() {
        let (w, h, v) = drawing();
        let out = see_through(w, h, &v, Key::Paper, 0.12).unwrap().unwrap();
        for (x, y) in [(5, 5), (230, 170), (120, 20), (200, 150)] {
            assert_eq!(at(&out, w, x, y)[3], 0, "paper at {x},{y} is {:?}", at(&out, w, x, y));
        }
        let line = at(&out, w, 120, 90);
        assert_eq!(line[3], 255, "the line stays solid: {line:?}");
        assert!(line[0] < 40, "and dark: {line:?}");
        let sun = at(&out, w, 180, 45);
        assert_eq!(sun[3], 255, "a big light crayon fill isn't paper: {sun:?}");
        let pencil = at(&out, w, 60, 40);
        assert!((60..200).contains(&pencil[3]), "pencil is part see-through: {pencil:?}");
        assert!(pencil[0] < 60, "and dark rather than grey: {pencil:?}");
    }

    #[test]
    fn a_picked_colour_goes_and_other_colours_stay() {
        let (w, h) = (4usize, 1usize);
        let v = vec![0, 200, 0, 255, 0, 200, 0, 255, 200, 0, 0, 255, 0, 0, 0, 255];
        let out = see_through(w, h, &v, Key::Colour([0, 200, 0]), 0.05).unwrap().unwrap();
        assert_eq!(out[3], 0);
        assert_eq!(out[7], 0);
        assert_eq!(&out[8..12], &[200, 0, 0, 255]);
        assert_eq!(&out[12..16], &[0, 0, 0, 255]);
    }

    #[test]
    fn nothing_to_remove_changes_nothing() {
        let v = [10, 20, 30, 255].repeat(64);
        assert!(see_through(8, 8, &v, Key::Colour([255, 255, 255]), 0.0).unwrap().is_none());
    }

    #[test]
    fn earlier_see_through_parts_stay_see_through() {
        let v = vec![255, 255, 255, 0, 0, 0, 0, 128];
        let out = see_through(2, 1, &v, Key::Colour([255, 255, 255]), 0.1).unwrap();
        let out = out.unwrap_or(v);
        assert_eq!(out[3], 0);
        assert_eq!(out[7], 128);
    }

    #[test]
    fn bad_input_is_refused() {
        assert!(see_through(2, 2, &[0; 3], Key::Paper, 0.1).is_err());
        assert!(see_through(1, 1, &[0; 4], Key::Paper, 0.9).is_err());
    }

    #[test]
    fn timing_at_twelve_megapixels() {
        let (w, h) = (4000usize, 3000usize);
        let v = vec![240u8; w * h * 4];
        let t = std::time::Instant::now();
        let _ = see_through(w, h, &v, Key::Paper, 0.12).unwrap();
        eprintln!("see-through at 12 MP: {:?}", t.elapsed());
    }
}
