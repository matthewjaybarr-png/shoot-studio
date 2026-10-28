//! Fun effects and Relight for Create's Edit photo drawer. Every function takes and returns 8-bit RGBA of the same size;
//! alpha is kept as it was.
//!
//! - Oil paint: a Kuwahara filter (each pixel takes the mean colour of the calmest of the four squares it is a corner
//!   of), worked on a copy at most `OIL_EDGE` pixels long and scaled back, so brush strokes keep edges sharp.
//! - Pop-art dots: a four-ink colour halftone (cyan, magenta, yellow and black dots on screens turned 15°, 75°, 0° and
//!   45°), each dot as big as the ink under it.
//! - Mosaic: square tiles of their average colour with dark grout between them.
//! - Pencil sketch: the grey picture colour-dodged with its own blurred negative, so only edges stay dark.
//! - Relight follows PhotoCraft's relight.rs (https://github.com/storytold/photocraft, MIT or Apache-2.0, see
//!   THIRD_PARTY_NOTICES.md): the light already in the photo is its heavily blurred brightness (Retinex), whose slopes
//!   act as the surface's tilt; a lamp from the chosen side then shades each tilt like a matte (Lambertian) surface.
//!   Here the lamp's shading is blended in by `amount` rather than replacing the old light, and `even` divides out
//!   some of the old light, which lifts shadows.

use rayon::prelude::*;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Effect {
    Oil,
    Dots,
    Mosaic,
    Sketch,
}

impl Effect {
    pub fn parse(name: &str) -> Option<Effect> {
        Some(match name {
            "oil" => Effect::Oil,
            "dots" => Effect::Dots,
            "mosaic" => Effect::Mosaic,
            "sketch" => Effect::Sketch,
            _ => return None,
        })
    }
}

/// The oil paint is worked at most this long, which keeps the box sums of a big photo to a few hundred megabytes.
const OIL_EDGE: usize = 2400;

/// `size` 0–1: how big the brush strokes, dots, tiles or pencil lines are, relative to the picture.
pub fn effect(w: usize, h: usize, rgba: &[u8], effect: Effect, size: f32) -> Vec<u8> {
    let size = size.clamp(0.0, 1.0);
    let long = w.max(h) as f32;
    let mut out = match effect {
        Effect::Oil => oil(w, h, rgba, size),
        Effect::Dots => dots(w, h, rgba, (long / (160.0 - 120.0 * size)).max(4.0)),
        Effect::Mosaic => mosaic(w, h, rgba, ((long / (120.0 - 90.0 * size)).round() as usize).max(3)),
        Effect::Sketch => sketch(w, h, rgba, (long / (500.0 - 380.0 * size)).max(1.0)),
    };
    for (o, i) in out.as_chunks_mut::<4>().0.iter_mut().zip(rgba.as_chunks::<4>().0.iter()) {
        o[3] = i[3];
    }
    out
}

fn luma(p: &[u8; 4]) -> f32 {
    (0.299 * p[0] as f32 + 0.587 * p[1] as f32 + 0.114 * p[2] as f32) / 255.0
}

/// Mean of each `k`-wide run starting at every place in each row (`n` interleaved channels), clamped at the edges.
fn run_means(w: usize, h: usize, n: usize, v: &[f32], k: usize, along_rows: bool) -> Vec<f32> {
    let mut out = vec![0.0f32; v.len()];
    let (len, lines) = if along_rows { (w, h) } else { (h, w) };
    let at = move |line: usize, i: usize| if along_rows { (line * w + i) * n } else { (i * w + line) * n };
    let lines_out: Vec<Vec<f32>> = (0..lines)
        .into_par_iter()
        .map(|line| {
            let mut res = vec![0.0f32; len * n];
            let mut sum = vec![0.0f64; n];
            for i in 0..k {
                for c in 0..n {
                    sum[c] += v[at(line, i.min(len - 1)) + c] as f64;
                }
            }
            for i in 0..len {
                for c in 0..n {
                    res[i * n + c] = (sum[c] / k as f64) as f32;
                    sum[c] += v[at(line, (i + k).min(len - 1)) + c] as f64 - v[at(line, i) + c] as f64;
                }
            }
            res
        })
        .collect();
    for (line, res) in lines_out.into_iter().enumerate() {
        for i in 0..len {
            out[at(line, i)..at(line, i) + n].copy_from_slice(&res[i * n..i * n + n]);
        }
    }
    out
}

/// Plain bilinear resize of `n`-channel floats.
fn resize(w: usize, h: usize, n: usize, v: &[f32], nw: usize, nh: usize) -> Vec<f32> {
    let mut out = vec![0.0f32; nw * nh * n];
    out.par_chunks_mut(nw * n).enumerate().for_each(|(y, row)| {
        let fy = ((y as f32 + 0.5) * h as f32 / nh as f32 - 0.5).clamp(0.0, (h - 1) as f32);
        let (y0, ty) = (fy as usize, fy.fract());
        let y1 = (y0 + 1).min(h - 1);
        for x in 0..nw {
            let fx = ((x as f32 + 0.5) * w as f32 / nw as f32 - 0.5).clamp(0.0, (w - 1) as f32);
            let (x0, tx) = (fx as usize, fx.fract());
            let x1 = (x0 + 1).min(w - 1);
            for c in 0..n {
                let p = |xx: usize, yy: usize| v[(yy * w + xx) * n + c];
                let top = p(x0, y0) + (p(x1, y0) - p(x0, y0)) * tx;
                let bot = p(x0, y1) + (p(x1, y1) - p(x0, y1)) * tx;
                row[x * n + c] = top + (bot - top) * ty;
            }
        }
    });
    out
}

/// A soft blur of `n`-channel floats with roughly Gaussian `sigma` pixels: three box passes on a copy shrunk so the
/// boxes stay a few pixels wide, then scaled back.
fn soft(w: usize, h: usize, n: usize, v: &[f32], sigma: f32) -> Vec<f32> {
    let f = (sigma / 4.0).max(1.0);
    let (sw, sh) = (((w as f32 / f).round() as usize).max(1), ((h as f32 / f).round() as usize).max(1));
    let mut small = if (sw, sh) == (w, h) { v.to_vec() } else { box_shrink(w, h, n, v, sw, sh) };
    let r = ((sigma / f).round() as usize).max(1);
    for _ in 0..3 {
        small = centred_means(sw, sh, n, &small, r);
    }
    if (sw, sh) == (w, h) { small } else { resize(sw, sh, n, &small, w, h) }
}

/// Box mean over (2r+1)² centred on each pixel.
fn centred_means(w: usize, h: usize, n: usize, v: &[f32], r: usize) -> Vec<f32> {
    let k = 2 * r + 1;
    let shift = |m: Vec<f32>, along_rows: bool| -> Vec<f32> {
        // run_means starts each run at the pixel; centre it by reading r places back
        let mut out = vec![0.0f32; m.len()];
        for y in 0..h {
            for x in 0..w {
                let (sx, sy) = if along_rows { (x.saturating_sub(r), y) } else { (x, y.saturating_sub(r)) };
                let (d, s) = ((y * w + x) * n, (sy * w + sx) * n);
                out[d..d + n].copy_from_slice(&m[s..s + n]);
            }
        }
        out
    };
    let rows = shift(run_means(w, h, n, v, k, true), true);
    shift(run_means(w, h, n, &rows, k, false), false)
}

/// Area-average shrink.
fn box_shrink(w: usize, h: usize, n: usize, v: &[f32], nw: usize, nh: usize) -> Vec<f32> {
    let mut out = vec![0.0f32; nw * nh * n];
    out.par_chunks_mut(nw * n).enumerate().for_each(|(y, row)| {
        let (y0, y1) = (y * h / nh, ((y + 1) * h / nh).max(y * h / nh + 1).min(h));
        for x in 0..nw {
            let (x0, x1) = (x * w / nw, ((x + 1) * w / nw).max(x * w / nw + 1).min(w));
            let count = ((y1 - y0) * (x1 - x0)) as f32;
            for c in 0..n {
                let mut s = 0.0f32;
                for yy in y0..y1 {
                    for xx in x0..x1 {
                        s += v[(yy * w + xx) * n + c];
                    }
                }
                row[x * n + c] = s / count;
            }
        }
    });
    out
}

fn oil(w: usize, h: usize, rgba: &[u8], size: f32) -> Vec<u8> {
    let k = (OIL_EDGE as f32 / w.max(h) as f32).min(1.0);
    let (sw, sh) = (((w as f32 * k).round() as usize).max(1), ((h as f32 * k).round() as usize).max(1));
    // r, g, b, luma, luma² per pixel
    let mut v: Vec<f32> = rgba.as_chunks::<4>().0.iter().flat_map(|p| { let l = luma(p); [p[0] as f32, p[1] as f32, p[2] as f32, l, l * l] }).collect();
    if (sw, sh) != (w, h) {
        v = box_shrink(w, h, 5, &v, sw, sh);
    }
    let r = (2.0 + size * sw.max(sh) as f32 / 160.0).round() as usize;
    let q = r + 1;
    let m = run_means(sw, sh, 5, &run_means(sw, sh, 5, &v, q, true), q, false); // m at (x, y): mean of the q² square from there
    let mut painted = vec![0.0f32; sw * sh * 3];
    painted.par_chunks_mut(sw * 3).enumerate().for_each(|(y, row)| {
        for x in 0..sw {
            let mut best = (f32::INFINITY, 0);
            for (qx, qy) in [(x.saturating_sub(r), y.saturating_sub(r)), (x, y.saturating_sub(r)), (x.saturating_sub(r), y), (x, y)] {
                let i = (qy * sw + qx) * 5;
                let var = m[i + 4] - m[i + 3] * m[i + 3];
                if var < best.0 {
                    best = (var, i);
                }
            }
            row[x * 3..x * 3 + 3].copy_from_slice(&m[best.1..best.1 + 3]);
        }
    });
    let full = if (sw, sh) == (w, h) { painted } else { resize(sw, sh, 3, &painted, w, h) };
    full.as_chunks::<3>().0.iter().flat_map(|p| [p[0].round() as u8, p[1].round() as u8, p[2].round() as u8, 255]).collect()
}

fn dots(w: usize, h: usize, rgba: &[u8], cell: f32) -> Vec<u8> {
    // The inks under each dot come from a blur about the dot's size, with a little extra colour for the pop-art look.
    let rgb: Vec<f32> = rgba.as_chunks::<4>().0.iter().flat_map(|p| {
        let (r, g, b) = (p[0] as f32 / 255.0, p[1] as f32 / 255.0, p[2] as f32 / 255.0);
        let l = 0.299 * r + 0.587 * g + 0.114 * b;
        [r, g, b].map(|c| (l + (c - l) * 1.2).clamp(0.0, 1.0))
    }).collect();
    let rgb = soft(w, h, 3, &rgb, cell / 3.0);
    let screens = [15f32, 75.0, 0.0, 45.0].map(|a| a.to_radians().sin_cos());
    let mut out = vec![0u8; w * h * 4];
    out.par_chunks_mut(w * 4).enumerate().for_each(|(y, row)| {
        for x in 0..w {
            let mut ink_out = [0.0f32; 4];
            for (s, &(sin, cos)) in screens.iter().enumerate() {
                let (fx, fy) = (x as f32 + 0.5, y as f32 + 0.5);
                let (u, v) = (fx * cos + fy * sin, -fx * sin + fy * cos);
                let (cu, cv) = (((u / cell).floor() + 0.5) * cell, ((v / cell).floor() + 0.5) * cell);
                let (px, py) = (cu * cos - cv * sin, cu * sin + cv * cos);
                let (sx, sy) = ((px.max(0.0) as usize).min(w - 1), (py.max(0.0) as usize).min(h - 1));
                let p = &rgb[(sy * w + sx) * 3..(sy * w + sx) * 3 + 3];
                let k = 1.0 - p[0].max(p[1]).max(p[2]);
                let ink = if s == 3 { k } else if k >= 1.0 { 0.0 } else { (1.0 - p[s] - k) / (1.0 - k) };
                let radius = cell * 0.71 * ink.clamp(0.0, 1.0).sqrt();
                let d = ((u - cu).powi(2) + (v - cv).powi(2)).sqrt();
                ink_out[s] = (radius - d + 0.5).clamp(0.0, 1.0) * (radius * 2.0).min(1.0); // no ink, no speck
            }
            let k = 1.0 - ink_out[3];
            for c in 0..3 {
                row[x * 4 + c] = ((1.0 - ink_out[c]) * k * 255.0).round() as u8;
            }
            row[x * 4 + 3] = 255;
        }
    });
    out
}

fn mosaic(w: usize, h: usize, rgba: &[u8], tile: usize) -> Vec<u8> {
    let (tw, th) = (w.div_ceil(tile), h.div_ceil(tile));
    let mut means = vec![[0f32; 3]; tw * th];
    means.par_chunks_mut(tw).enumerate().for_each(|(ty, row)| {
        for (tx, m) in row.iter_mut().enumerate() {
            let (mut s, mut count) = ([0f32; 3], 0.0);
            for y in ty * tile..((ty + 1) * tile).min(h) {
                for x in tx * tile..((tx + 1) * tile).min(w) {
                    let p = &rgba[(y * w + x) * 4..];
                    for c in 0..3 {
                        s[c] += p[c] as f32;
                    }
                    count += 1.0;
                }
            }
            *m = s.map(|v| v / count);
        }
    });
    let grout = (tile / 10).max(1);
    let mut out = vec![0u8; w * h * 4];
    out.par_chunks_mut(w * 4).enumerate().for_each(|(y, row)| {
        for x in 0..w {
            let (lx, ly) = (x % tile, y % tile);
            let m = means[(y / tile) * tw + x / tile];
            let line = lx < grout || ly < grout;
            // a little light on the top-left of each tile and shade on the bottom-right, like glazed glass
            let lift = if line { 0.25 } else { 1.0 + 0.12 * (1.0 - (lx + ly) as f32 / tile as f32) - 0.06 };
            for c in 0..3 {
                row[x * 4 + c] = (m[c] * lift).round().clamp(0.0, 255.0) as u8;
            }
            row[x * 4 + 3] = 255;
        }
    });
    out
}

fn sketch(w: usize, h: usize, rgba: &[u8], sigma: f32) -> Vec<u8> {
    let grey: Vec<f32> = rgba.as_chunks::<4>().0.iter().map(luma).collect();
    let negative: Vec<f32> = grey.iter().map(|g| 1.0 - g).collect();
    let blurred = soft(w, h, 1, &negative, sigma);
    grey.iter()
        .zip(&blurred)
        .flat_map(|(&g, &b)| {
            let v = (g / (1.0 - b).max(1e-3)).min(1.0).powf(1.6);
            let v = (v * 255.0).round() as u8;
            [v, v, v, 255]
        })
        .collect()
}

fn to_linear(v: u8) -> f32 {
    let c = v as f32 / 255.0;
    if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) }
}

fn to_srgb(c: f32) -> u8 {
    let c = c.clamp(0.0, 1.0);
    let v = if c <= 0.0031308 { c * 12.92 } else { 1.055 * c.powf(1.0 / 2.4) - 0.055 };
    (v * 255.0).round() as u8
}

/// Light colour from warmth −1 (cool) to 1 (warm), PhotoCraft's constants.
fn light_colour(warmth: f32) -> [f32; 3] {
    let w = warmth.clamp(-1.0, 1.0);
    if w >= 0.0 { [1.0 + 0.15 * w, 1.0 - 0.05 * w, 1.0 - 0.25 * w] } else { [1.0 + 0.20 * w, 1.0 + 0.10 * w, 1.0 - 0.15 * w] }
}

/// Relight: a lamp from `lamp` degrees (0 from the right, 90 from above, image space), or from the front when None.
/// `amount` 0–1 is how strong the new light is, `even` 0–1 how much of the old light (and its shadows) is evened out,
/// `warmth` −1–1 the lamp's colour.
pub fn relight(w: usize, h: usize, rgba: &[u8], lamp: Option<f32>, amount: f32, even: f32, warmth: f32) -> Vec<u8> {
    let (front, angle) = (lamp.is_none(), lamp.unwrap_or(90.0));
    let (amount, even) = (amount.clamp(0.0, 1.0), even.clamp(0.0, 1.0));
    let lut: Vec<f32> = (0..=255).map(to_linear).collect();
    let y: Vec<f32> = rgba.as_chunks::<4>().0.iter().map(|p| 0.2126 * lut[p[0] as usize] + 0.7152 * lut[p[1] as usize] + 0.0722 * lut[p[2] as usize]).collect();
    let sigma = (w.max(h) as f32 / 40.0).max(2.0);
    let shading = soft(w, h, 1, &y, sigma);
    let mean = (shading.iter().map(|&v| v as f64).sum::<f64>() / shading.len().max(1) as f64) as f32;
    let elevation: f32 = if front { 75f32.to_radians() } else { 35f32.to_radians() };
    let (s, c) = angle.to_radians().sin_cos();
    let light = [c * elevation.cos(), -s * elevation.cos(), elevation.sin()];
    let flat = 0.4 + light[2]; // what a surface facing the camera gets, so untilted places keep their brightness
    let colour = light_colour(warmth).map(|v| 1.0 + (v - 1.0) * amount);
    let step = (sigma as usize).max(1);
    let scale = 10.0 / mean.max(0.05); // slopes are relative to the picture's own brightness
    let mut out = vec![0u8; rgba.len()];
    out.par_chunks_mut(w * 4).enumerate().for_each(|(yy, row)| {
        for x in 0..w {
            let sh = |xx: usize, yy: usize| shading[yy * w + xx];
            let s0 = sh(x, yy).max(0.01);
            let nx = (sh(x.saturating_sub(step), yy) - sh((x + step).min(w - 1), yy)) * scale;
            let ny = (sh(x, yy.saturating_sub(step)) - sh(x, (yy + step).min(h - 1))) * scale;
            let len = (nx * nx + ny * ny + 1.0).sqrt();
            let lit = ((nx * light[0] + ny * light[1] + light[2]) / len).max(0.0);
            let lamp = 1.0 + ((0.4 + lit) / flat - 1.0) * amount;
            let evened = (mean / s0).powf(0.7 * even).clamp(0.5, 3.0);
            let i = (yy * w + x) * 4;
            for ch in 0..3 {
                row[x * 4 + ch] = to_srgb(lut[rgba[i + ch] as usize] * lamp * evened * colour[ch]);
            }
            row[x * 4 + 3] = rgba[i + 3];
        }
    });
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A grey picture with a dark disc in the middle and a light top half.
    fn picture(w: usize, h: usize) -> Vec<u8> {
        let mut v = vec![0u8; w * h * 4];
        for y in 0..h {
            for x in 0..w {
                let d = ((x as f32 - w as f32 / 2.0).powi(2) + (y as f32 - h as f32 / 2.0).powi(2)).sqrt();
                let grain = ((x * 7919 + y * 104_729) % 23) as u8; // texture for the brushes to smooth
                let g = grain + if d < w as f32 / 6.0 { 40 } else if y < h / 2 { 200 } else { 120 };
                v[(y * w + x) * 4..(y * w + x) * 4 + 4].copy_from_slice(&[g, g / 2 + 40, g, if x < 4 { 0 } else { 255 }]);
            }
        }
        v
    }

    #[test]
    fn every_effect_keeps_size_and_alpha() {
        let (w, h) = (161, 97);
        let src = picture(w, h);
        for e in [Effect::Oil, Effect::Dots, Effect::Mosaic, Effect::Sketch] {
            let out = effect(w, h, &src, e, 0.5);
            assert_eq!(out.len(), src.len(), "{e:?}");
            assert!(out.as_chunks::<4>().0.iter().zip(src.as_chunks::<4>().0.iter()).all(|(o, i)| o[3] == i[3]), "{e:?} keeps alpha");
            assert_ne!(out, src, "{e:?} changes something");
        }
    }

    #[test]
    fn oil_paint_keeps_a_hard_edge() {
        let (w, h) = (200, 100);
        let src: Vec<u8> = (0..w * h).flat_map(|i| if i % w < 100 { [20, 20, 20, 255] } else { [230, 230, 230, 255] }).collect();
        let out = effect(w, h, &src, Effect::Oil, 0.5);
        let at = |x: usize| out[(50 * w + x) * 4];
        assert!(at(97) < 40 && at(103) > 210, "the edge stays sharp: {} {}", at(97), at(103));
    }

    #[test]
    fn mosaic_tiles_are_flat_with_grout() {
        let (w, h) = (300, 300);
        let src = picture(w, h);
        let out = effect(w, h, &src, Effect::Mosaic, 0.0);
        let tile = (300.0f32 / 120.0).round() as usize;
        assert!(tile >= 3);
        assert!(out[0] < out[((tile / 2) * w + tile / 2) * 4], "grout is darker than the tile");
    }

    #[test]
    fn dots_are_white_on_white_and_black_on_black() {
        let (w, h) = (120, 120);
        let white = vec![255u8; w * h * 4];
        assert!(effect(w, h, &white, Effect::Dots, 0.5).as_chunks::<4>().0.iter().all(|p| p[0] > 250 && p[1] > 250 && p[2] > 250));
        let black: Vec<u8> = (0..w * h).flat_map(|_| [0, 0, 0, 255]).collect();
        let out = effect(w, h, &black, Effect::Dots, 0.5);
        let dark = out.as_chunks::<4>().0.iter().filter(|p| p[0] < 60).count();
        assert!(dark > w * h * 9 / 10, "black becomes mostly black dots: {dark}");
    }

    #[test]
    fn sketch_leaves_flat_areas_white_and_edges_dark() {
        let (w, h) = (200, 100);
        let src: Vec<u8> = (0..w * h).flat_map(|i| if i % w < 100 { [90, 90, 90, 255] } else { [180, 180, 180, 255] }).collect();
        let out = effect(w, h, &src, Effect::Sketch, 0.5);
        let at = |x: usize| out[(50 * w + x) * 4];
        assert!(at(20) > 240 && at(180) > 240, "flat paper stays white: {} {}", at(20), at(180));
        assert!(at(99) < 200, "the edge is drawn: {}", at(99));
    }

    #[test]
    fn relight_brightens_the_side_facing_the_lamp() {
        // a soft bright hill in the middle: lit from the left, its left slope gets lighter than its right
        let (w, h) = (240, 240);
        let src: Vec<u8> = (0..w * h).flat_map(|i| {
            let (x, y) = ((i % w) as f32 - 120.0, (i / w) as f32 - 120.0);
            let g = (90.0 + 120.0 * (-(x * x + y * y) / (2.0 * 40.0 * 40.0)).exp()) as u8;
            [g, g, g, 255]
        }).collect();
        let out = relight(w, h, &src, Some(180.0), 1.0, 0.0, 0.0);
        let change = |x: usize| out[(120 * w + x) * 4] as i32 - src[(120 * w + x) * 4] as i32;
        assert!(change(70) > change(170) + 10, "left slope {} vs right slope {}", change(70), change(170));
        let none = relight(w, h, &src, Some(180.0), 0.0, 0.0, 0.0);
        assert!(none.iter().zip(&src).all(|(a, b)| a.abs_diff(*b) <= 1), "amount 0 changes nothing");
    }

    #[test]
    fn even_out_lifts_the_shadow_side() {
        let (w, h) = (200, 100);
        let src: Vec<u8> = (0..w * h).flat_map(|i| if i % w < 100 { [40, 40, 40, 255] } else { [200, 200, 200, 255] }).collect();
        let out = relight(w, h, &src, None, 0.0, 1.0, 0.0);
        assert!(out[(50 * w + 10) * 4] > 60, "the dark side comes up: {}", out[(50 * w + 10) * 4]);
    }

    #[test]
    fn big_photos_are_quick() {
        let (w, h) = (4000, 3000);
        let src = picture(w, h);
        for e in [Effect::Oil, Effect::Dots, Effect::Mosaic, Effect::Sketch] {
            let t = std::time::Instant::now();
            effect(w, h, &src, e, 1.0);
            eprintln!("{e:?}: {:?}", t.elapsed());
        }
        let t = std::time::Instant::now();
        relight(w, h, &src, Some(45.0), 1.0, 0.5, 0.3);
        eprintln!("relight: {:?}", t.elapsed());
    }
}
