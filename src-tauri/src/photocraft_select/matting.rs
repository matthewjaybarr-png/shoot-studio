//! Soft edges for a cut-out: the guided filter (K. He, J. Sun and X. Tang, "Guided Image
//! Filtering", ECCV 2010 / PAMI 2013) and colour decontamination, from PhotoCraft's
//! `crates/algo/src/matting.rs` (see the module above for the licence).

use super::segment::RgbImage;

/// Guided-filter regulariser (colour guide, samples in 0–1).
pub const EPS: f32 = 1e-4;

/// Box mean with radius `r` (window clipped to the image, divided by the pixel count).
pub fn box_mean(src: &[f32], w: usize, h: usize, r: usize) -> Vec<f32> {
    let mut tmp = vec![0.0f32; w * h];
    let mut pre = vec![0.0f64; w.max(h) + 1];
    for y in 0..h {
        let row = &src[y * w..(y + 1) * w];
        for x in 0..w {
            pre[x + 1] = pre[x] + row[x] as f64;
        }
        for x in 0..w {
            let (lo, hi) = (x.saturating_sub(r), (x + r + 1).min(w));
            tmp[y * w + x] = ((pre[hi] - pre[lo]) / (hi - lo) as f64) as f32;
        }
    }
    let mut out = vec![0.0f32; w * h];
    let mut col = vec![0.0f64; (h + 1) * w];
    for y in 0..h {
        for x in 0..w {
            col[(y + 1) * w + x] = col[y * w + x] + tmp[y * w + x] as f64;
        }
    }
    for y in 0..h {
        let (lo, hi) = (y.saturating_sub(r), (y + r + 1).min(h));
        let n = (hi - lo) as f64;
        for x in 0..w {
            out[y * w + x] = ((col[hi * w + x] - col[lo * w + x]) / n) as f32;
        }
    }
    out
}

/// Guided filter with a colour guide (He et al., Eq. 19–21: `a_k = (Σ_k + εU)⁻¹ cov_k(I, p)`).
pub fn guided_filter_color(guide: &RgbImage, p: &[f32], r: usize, eps: f32) -> Vec<f32> {
    let (w, h) = (guide.w, guide.h);
    let n = w * h;
    let ch = |c: usize| -> Vec<f32> { guide.px.iter().map(|q| q[c]).collect() };
    let chans = [ch(0), ch(1), ch(2)];
    let m: Vec<Vec<f32>> = chans.iter().map(|c| box_mean(c, w, h, r)).collect();
    let mp = box_mean(p, w, h, r);
    let mip: Vec<Vec<f32>> = chans.iter().map(|c| box_mean(&c.iter().zip(p).map(|(a, b)| a * b).collect::<Vec<_>>(), w, h, r)).collect();
    let pairs = [(0, 0), (0, 1), (0, 2), (1, 1), (1, 2), (2, 2)];
    let mii: Vec<Vec<f32>> = pairs.iter().map(|&(a, b)| box_mean(&chans[a].iter().zip(&chans[b]).map(|(x, y)| x * y).collect::<Vec<_>>(), w, h, r)).collect();
    let mut av = [vec![0.0f32; n], vec![0.0f32; n], vec![0.0f32; n]];
    let mut bv = vec![0.0f32; n];
    for i in 0..n {
        let mu = [m[0][i] as f64, m[1][i] as f64, m[2][i] as f64];
        let s = |k: usize, a: usize, b: usize| mii[k][i] as f64 - mu[a] * mu[b];
        let e = eps as f64;
        let (rr, rg, rb, gg, gb, bb) = (s(0, 0, 0) + e, s(1, 0, 1), s(2, 0, 2), s(3, 1, 1) + e, s(4, 1, 2), s(5, 2, 2) + e);
        let cov = [mip[0][i] as f64 - mu[0] * mp[i] as f64, mip[1][i] as f64 - mu[1] * mp[i] as f64, mip[2][i] as f64 - mu[2] * mp[i] as f64];
        // Inverse of the symmetric 3×3 matrix.
        let i00 = gg * bb - gb * gb;
        let i01 = gb * rb - rg * bb;
        let i02 = rg * gb - gg * rb;
        let i11 = rr * bb - rb * rb;
        let i12 = rb * rg - rr * gb;
        let i22 = rr * gg - rg * rg;
        let det = rr * i00 + rg * i01 + rb * i02;
        let (a0, a1, a2) = if det.abs() < 1e-30 {
            (0.0, 0.0, 0.0)
        } else {
            (
                (i00 * cov[0] + i01 * cov[1] + i02 * cov[2]) / det,
                (i01 * cov[0] + i11 * cov[1] + i12 * cov[2]) / det,
                (i02 * cov[0] + i12 * cov[1] + i22 * cov[2]) / det,
            )
        };
        av[0][i] = a0 as f32;
        av[1][i] = a1 as f32;
        av[2][i] = a2 as f32;
        bv[i] = (mp[i] as f64 - a0 * mu[0] - a1 * mu[1] - a2 * mu[2]) as f32;
    }
    let ma: Vec<Vec<f32>> = av.iter().map(|a| box_mean(a, w, h, r)).collect();
    let mb = box_mean(&bv, w, h, r);
    (0..n).map(|i| ma[0][i] * chans[0][i] + ma[1][i] * chans[1][i] + ma[2][i] * chans[2][i] + mb[i]).collect()
}

/// Separable Gaussian blur (edge-clamped).
pub fn gaussian_blur(src: &[f32], w: usize, h: usize, sigma: f32) -> Vec<f32> {
    if sigma < 0.1 {
        return src.to_vec();
    }
    let r = (sigma * 3.0).ceil() as i64;
    let k: Vec<f32> = (-r..=r).map(|i| (-(i * i) as f32 / (2.0 * sigma * sigma)).exp()).collect();
    let s: f32 = k.iter().sum();
    let k: Vec<f32> = k.iter().map(|v| v / s).collect();
    let mut tmp = vec![0.0f32; w * h];
    for y in 0..h {
        for x in 0..w {
            let mut a = 0.0;
            for (i, kv) in k.iter().enumerate() {
                let xx = (x as i64 + i as i64 - r).clamp(0, w as i64 - 1) as usize;
                a += src[y * w + xx] * kv;
            }
            tmp[y * w + x] = a;
        }
    }
    let mut out = vec![0.0f32; w * h];
    for y in 0..h {
        for x in 0..w {
            let mut a = 0.0;
            for (i, kv) in k.iter().enumerate() {
                let yy = (y as i64 + i as i64 - r).clamp(0, h as i64 - 1) as usize;
                a += tmp[yy * w + x] * kv;
            }
            out[y * w + x] = a;
        }
    }
    out
}

/// Decontaminates colours in the soft fringe of `alpha` (`w × h`, 0–1): each fringe pixel of the
/// straight RGB buffer `rgb` moves towards the average colour of nearby fully selected pixels
/// (normalised convolution with a box of radius `max(radius, 3)`, widened ×4 where no such pixel
/// is near), by `amount` (0–1) scaled by its transparency. Rewritten from PhotoCraft's
/// `decontaminate`, which works tile by tile on a raster surface.
pub fn decontaminate(rgb: &mut [[f32; 3]], alpha: &[f32], w: usize, h: usize, radius: f32, amount: f32) {
    let rad = radius.max(3.0).ceil() as usize;
    let amount = amount.clamp(0.0, 1.0);
    let soft = |a: f32| a > 0.02 && a < 0.98;
    if !alpha.iter().any(|a| soft(*a)) {
        return;
    }
    let wts: Vec<f32> = alpha.iter().map(|a| if *a >= 0.98 { 1.0 } else { 0.0 }).collect();
    let den = box_mean(&wts, w, h, rad);
    let den2 = box_mean(&wts, w, h, rad * 4);
    let mut nums = Vec::with_capacity(3);
    for c in 0..3 {
        let v: Vec<f32> = wts.iter().zip(rgb.iter()).map(|(k, p)| k * p[c]).collect();
        nums.push((box_mean(&v, w, h, rad), box_mean(&v, w, h, rad * 4)));
    }
    for i in 0..w * h {
        let a = alpha[i];
        let k = if soft(a) { amount * ((1.0 - a) * 4.0).clamp(0.0, 1.0) } else { 0.0 };
        if k == 0.0 {
            continue;
        }
        for (c, num) in nums.iter().enumerate() {
            let v = rgb[i][c];
            let f = if den[i] > 1e-4 {
                num.0[i] / den[i]
            } else if den2[i] > 1e-4 {
                num.1[i] / den2[i]
            } else {
                v
            };
            rgb[i][c] = v + (f - v) * k;
        }
    }
}
