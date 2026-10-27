//! Healing, matching and blur code copied from PhotoCraft
//! (https://github.com/storytold/photocraft, commit 60ef9d836f62, crates/algo),
//! Copyright (c) 2026 ArtCraft Team and the PhotoCraft contributors,
//! licensed under the MIT License or the Apache License, Version 2.0, at your option.
//! See THIRD_PARTY_NOTICES.md and LICENSES/photocraft-Apache-2.0.txt.
//!
//! Modified: trimmed to these functions: `poisson.rs` (without `membrane_fill_with`),
//! `best_offset` with the `HoleIntegral` table and helpers from `inpaint.rs`, and `local_blur`
//! from `retouch.rs`. Let-chains were rewritten as nested `if`s for edition 2021, and the
//! wasm32 branch was dropped.

//! Gradient-domain ("Poisson") blending, the core of the Healing Brush and Spot Healing.
//!
//! Method: P. Pérez, M. Gangnet, A. Blake, *Poisson Image Editing*, ACM SIGGRAPH 2003. Seamless
//! cloning finds `f` over a region Ω minimising `∬_Ω |∇f − v|²` with `f = f*` (the destination) on
//! the boundary ∂Ω, which gives the Poisson equation `Δf = div v`. With the guidance field taken as
//! the source gradient, `v = ∇g`, the solution splits as `f = g + h` where `h` is the *membrane*
//! (harmonic) interpolant of the boundary mismatch: `Δh = 0` in Ω, `h = f* − g` on ∂Ω (§3 of the
//! paper). So the healed pixels keep the source's texture (its gradients) while their colour and
//! lighting are pulled to match the destination around the stroke.
//!
//! The Laplace equation is solved on the 4-connected pixel grid by successive over-relaxation (SOR,
//! Gauss–Seidel with over-relaxation), accelerated *cascadically*: the problem is restricted to a
//! half-resolution grid recursively, solved there, bilinearly prolonged as the initial guess, and only
//! a few SOR sweeps are needed per level to remove the remaining high-frequency error. Harmonic
//! functions are smooth, so the coarse guess is already close; this keeps a 300 px dab at a few
//! milliseconds.
//!
//! Buffers are planar-per-call but interleaved at the API: `w × h × ch` normalised floats in any
//! colour model (channels are solved independently, in parallel on native targets).


/// Convergence threshold (max per-sweep update) for the SOR sweeps.
const TOL: f32 = 2e-5;
/// SOR sweeps (cap) and relaxation factor on every level above the coarsest: tuned so a 96×72 disc
/// is within ~1e-3 of a fully converged Gauss–Seidel solve (below one 8-bit step).
const FINE_ITERS: usize = 30;
const FINE_OMEGA: f32 = 1.7;

/// Solve `Δv = 0` on `unknown` pixels with Dirichlet values from the known pixels of `v`
/// (out-of-grid neighbours are ignored, i.e. a Neumann boundary). `v` holds the known values on
/// entry and the solution on exit. Cascadic multigrid + SOR.
pub fn solve_membrane(w: usize, h: usize, unknown: &[bool], v: &mut [f32]) {
    assert_eq!(unknown.len(), w * h);
    assert_eq!(v.len(), w * h);
    solve_rec(w, h, unknown, v, 0, &|| false);
}

pub(crate) fn solve_rec(w: usize, h: usize, unknown: &[bool], v: &mut [f32], depth: usize, stop: &(dyn Fn() -> bool + Sync)) {
    if stop() {
        return;
    }
    let n_unknown = unknown.iter().filter(|u| **u).count();
    if n_unknown == 0 {
        return;
    }
    let known: Vec<f32> = v.iter().zip(unknown).filter(|(_, u)| !**u).map(|(x, _)| *x).collect();
    if known.is_empty() {
        return; // nothing to interpolate from
    }
    if w >= 8 && h >= 8 && n_unknown > 64 && depth < 16 {
        // Restrict: a coarse pixel is known if any of its children is (value = mean of known children).
        let (cw, chh) = (w.div_ceil(2), h.div_ceil(2));
        let mut cu = vec![true; cw * chh];
        let mut cv = vec![0.0f32; cw * chh];
        for cy in 0..chh {
            for cx in 0..cw {
                let (mut s, mut n) = (0.0f32, 0u32);
                for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                    let (x, y) = (cx * 2 + dx, cy * 2 + dy);
                    if x < w && y < h && !unknown[y * w + x] {
                        s += v[y * w + x];
                        n += 1;
                    }
                }
                if n > 0 {
                    cu[cy * cw + cx] = false;
                    cv[cy * cw + cx] = s / n as f32;
                }
            }
        }
        solve_rec(cw, chh, &cu, &mut cv, depth + 1, stop);
        // Prolong: bilinear sample of the coarse solution as the initial guess.
        for y in 0..h {
            let fy = ((y as f32 + 0.5) / 2.0 - 0.5).clamp(0.0, (chh - 1) as f32);
            let y0 = fy.floor() as usize;
            let y1 = (y0 + 1).min(chh - 1);
            let ty = fy - y0 as f32;
            for x in 0..w {
                if !unknown[y * w + x] {
                    continue;
                }
                let fx = ((x as f32 + 0.5) / 2.0 - 0.5).clamp(0.0, (cw - 1) as f32);
                let x0 = fx.floor() as usize;
                let x1 = (x0 + 1).min(cw - 1);
                let tx = fx - x0 as f32;
                let a = cv[y0 * cw + x0] + (cv[y0 * cw + x1] - cv[y0 * cw + x0]) * tx;
                let b = cv[y1 * cw + x0] + (cv[y1 * cw + x1] - cv[y1 * cw + x0]) * tx;
                v[y * w + x] = a + (b - a) * ty;
            }
        }
        sor(w, h, unknown, v, FINE_ITERS, FINE_OMEGA, stop);
    } else {
        let mean = known.iter().sum::<f32>() / known.len() as f32;
        for (x, u) in v.iter_mut().zip(unknown) {
            if *u {
                *x = mean;
            }
        }
        sor(w, h, unknown, v, 2000, 1.85, stop);
    }
}

/// SOR sweeps over the unknown pixels until the largest update drops below [`TOL`].
fn sor(w: usize, h: usize, unknown: &[bool], v: &mut [f32], max_iter: usize, omega: f32, stop: &(dyn Fn() -> bool + Sync)) {
    // Precompute the unknown pixels and which neighbours exist.
    let cells: Vec<(u32, u8)> = (0..w * h)
        .filter(|&i| unknown[i])
        .map(|i| {
            let (x, y) = (i % w, i / w);
            let m = u8::from(x > 0) | (u8::from(x + 1 < w) << 1) | (u8::from(y > 0) << 2) | (u8::from(y + 1 < h) << 3);
            (i as u32, m)
        })
        .collect();
    for _ in 0..max_iter {
        if stop() {
            return;
        }
        let mut max_d = 0.0f32;
        for &(i, m) in &cells {
            let i = i as usize;
            let (s, n) = if m == 0b1111 {
                (v[i - 1] + v[i + 1] + v[i - w] + v[i + w], 4.0)
            } else {
                let mut s = 0.0;
                let mut n = 0.0;
                if m & 1 != 0 {
                    s += v[i - 1];
                    n += 1.0;
                }
                if m & 2 != 0 {
                    s += v[i + 1];
                    n += 1.0;
                }
                if m & 4 != 0 {
                    s += v[i - w];
                    n += 1.0;
                }
                if m & 8 != 0 {
                    s += v[i + w];
                    n += 1.0;
                }
                if n == 0.0 {
                    continue;
                }
                (s, n)
            };
            let d = omega * (s / n - v[i]);
            v[i] += d;
            max_d = max_d.max(d.abs());
        }
        if max_d < TOL {
            break;
        }
    }
}

/// Reference solver for tests: plain Gauss–Seidel from a zero start until the update is below `tol`.
pub fn solve_membrane_reference(w: usize, h: usize, unknown: &[bool], v: &mut [f32], tol: f32, max_iter: usize) {
    for (x, u) in v.iter_mut().zip(unknown) {
        if *u {
            *x = 0.0;
        }
    }
    for _ in 0..max_iter {
        let mut max_d = 0.0f32;
        for y in 0..h {
            for x in 0..w {
                let i = y * w + x;
                if !unknown[i] {
                    continue;
                }
                let (mut s, mut n) = (0.0, 0.0);
                for (nx, ny) in [(x.wrapping_sub(1), y), (x + 1, y), (x, y.wrapping_sub(1)), (x, y + 1)] {
                    if nx < w && ny < h {
                        s += v[ny * w + nx];
                        n += 1.0;
                    }
                }
                if n > 0.0 {
                    let nv = s / n;
                    max_d = max_d.max((nv - v[i]).abs());
                    v[i] = nv;
                }
            }
        }
        if max_d < tol {
            break;
        }
    }
}

/// Map `f` over the channels of an interleaved buffer as planar slices (parallel on native).
pub(crate) fn per_channel(w: usize, h: usize, ch: usize, f: impl Fn(usize) -> Vec<f32> + Sync + Send) -> Vec<f32> {
    let planes: Vec<Vec<f32>> = if w * h >= 64 * 64 {
        use rayon::prelude::*;
        (0..ch).into_par_iter().map(&f).collect()
    } else {
        (0..ch).map(&f).collect()
    };
    let mut out = vec![0.0f32; w * h * ch];
    for (c, p) in planes.iter().enumerate() {
        for (i, v) in p.iter().enumerate() {
            out[i * ch + c] = *v;
        }
    }
    out
}

/// Seamless cloning (Pérez et al. 2003, guidance field `v = ∇src`): returns `f` with `f = dst` outside
/// `mask` and, inside, `src` plus the membrane that removes the boundary mismatch. So the result keeps
/// the source's texture and takes the destination's colour and lighting.
///
/// `src`/`dst` are interleaved `w × h × ch`; `mask` has `w × h` entries (`true` = healed). Pixels on the
/// grid edge that are in the mask see a Neumann (free) boundary there, so callers should leave a one
/// pixel unmasked margin for a fully Dirichlet problem.
pub fn seamless_clone(w: usize, h: usize, ch: usize, src: &[f32], dst: &[f32], mask: &[bool]) -> Vec<f32> {
    assert_eq!(src.len(), w * h * ch);
    assert_eq!(dst.len(), w * h * ch);
    assert_eq!(mask.len(), w * h);
    per_channel(w, h, ch, |c| {
        let mut hv: Vec<f32> = (0..w * h).map(|i| if mask[i] { 0.0 } else { dst[i * ch + c] - src[i * ch + c] }).collect();
        solve_membrane(w, h, mask, &mut hv);
        (0..w * h).map(|i| if mask[i] { src[i * ch + c] + hv[i] } else { dst[i * ch + c] }).collect()
    })
}

/// Membrane fill (no source texture): harmonic interpolation of the known pixels into `hole`.
pub fn membrane_fill(w: usize, h: usize, ch: usize, img: &[f32], hole: &[bool]) -> Vec<f32> {
    per_channel(w, h, ch, |c| {
        let mut v: Vec<f32> = (0..w * h).map(|i| if hole[i] { 0.0 } else { img[i * ch + c] }).collect();
        solve_membrane(w, h, hole, &mut v);
        v
    })
}

// ---- inpaint.rs: proximity match ----

/// Count of set cells in the clipped window `[x0, x1) × [y0, y1)`.
fn window_count(s: &[u32], gw: usize, gh: usize, x0: i32, y0: i32, x1: i32, y1: i32) -> u32 {
    let (x0, y0) = (x0.max(0) as usize, y0.max(0) as usize);
    let (x1, y1) = ((x1.max(0) as usize).min(gw), (y1.max(0) as usize).min(gh));
    if x1 <= x0 || y1 <= y0 {
        return 0;
    }
    let w1 = gw + 1;
    s[y1 * w1 + x1] + s[y0 * w1 + x0] - s[y0 * w1 + x1] - s[y1 * w1 + x0]
}

fn hole_bbox(w: usize, h: usize, hole: &[bool]) -> Option<(usize, usize, usize, usize)> {
    let mut b: Option<(usize, usize, usize, usize)> = None;
    for y in 0..h {
        for x in 0..w {
            if hole[y * w + x] {
                b = Some(match b {
                    None => (x, y, x + 1, y + 1),
                    Some((x0, y0, x1, y1)) => (x0.min(x), y0.min(y), x1.max(x + 1), y1.max(y + 1)),
                });
            }
        }
    }
    b
}

struct HoleIntegral {
    x0: i32,
    y0: i32,
    w: usize,
    h: usize,
    data: Vec<u32>,
}

impl HoleIntegral {
    fn new(stride: usize, hole: &[bool], (x0, y0, x1, y1): (usize, usize, usize, usize)) -> Option<Self> {
        let (w, h) = (x1.checked_sub(x0)?, y1.checked_sub(y0)?);
        let row_stride = w.checked_add(1)?;
        let len = row_stride.checked_mul(h.checked_add(1)?)?;
        let mut data = Vec::new();
        data.try_reserve_exact(len).ok()?;
        data.resize(len, 0u32);
        for (y, sy) in (y0..y1).enumerate() {
            let base = sy.checked_mul(stride)?;
            let row = hole.get(base.checked_add(x0)?..base.checked_add(x1)?)?;
            let mut count = 0u32;
            for (x, &set) in row.iter().enumerate() {
                count = count.checked_add(u32::from(set))?;
                let above = *data.get(y * row_stride + x + 1)?;
                *data.get_mut((y + 1) * row_stride + x + 1)? = above.checked_add(count)?;
            }
        }
        Some(Self { x0: i32::try_from(x0).ok()?, y0: i32::try_from(y0).ok()?, w, h, data })
    }

    fn count(&self, x0: i32, y0: i32, x1: i32, y1: i32) -> u32 {
        window_count(
            &self.data,
            self.w,
            self.h,
            x0.saturating_sub(self.x0),
            y0.saturating_sub(self.y0),
            x1.saturating_sub(self.x0),
            y1.saturating_sub(self.y0),
        )
    }
}

/// Proximity match: the displacement `(dx, dy)` (within `max_radius`) whose surroundings best match the
/// ring of `ring` pixels around the hole, with the displaced hole fully inside the grid and outside the
/// hole. `None` if no displacement fits.
pub fn best_offset(w: usize, h: usize, ch: usize, img: &[f32], hole: &[bool], ring: usize, max_radius: i32) -> Option<(i32, i32)> {
    let (bx0, by0, bx1, by1) = hole_bbox(w, h, hole)?;
    // No valid translation can move farther than the source image's extent.
    // Bound arbitrary public API inputs before constructing i32 search ranges:
    // usize -> i32 truncation and signed increments otherwise overflow or hang.
    let extent = w.max(h).min((i32::MAX / 4) as usize) as i32;
    let max_radius = max_radius.max(0).min(extent);
    if max_radius == 0 {
        return None;
    }
    let ring = ring.max(1).min(extent as usize) as i32;
    // Every set cell lies in the hole bounds. Counts outside that rectangle are zero,
    // so source rejection needs a table for the hole, not for the whole photo.
    let hs = HoleIntegral::new(w, hole, (bx0, by0, bx1, by1))?;
    // Sample points: the hole's ring (dilated minus hole), subsampled for speed.
    let mut pts = Vec::new();
    let (x0, y0) = (bx0 as i32 - ring, by0 as i32 - ring);
    let (x1, y1) = (bx1 as i32 + ring, by1 as i32 + ring);
    for y in y0.max(0)..y1.min(h as i32) {
        for x in x0.max(0)..x1.min(w as i32) {
            if hole[y as usize * w + x as usize] {
                continue;
            }
            if hs.count(x - ring, y - ring, x + ring + 1, y + ring + 1) > 0 {
                pts.push((x, y));
            }
        }
    }
    let stride = (pts.len() / 2000).max(1);
    let pts: Vec<(i32, i32)> = pts.into_iter().step_by(stride).collect();
    let eval = |dx: i32, dy: i32, cutoff: f32| -> Option<f32> {
        let (hx0, hy0, hx1, hy1) = (x0 + dx, y0 + dy, x1 + dx, y1 + dy);
        let inside = hx0 >= 0 && hy0 >= 0 && hx1 <= w as i32 && hy1 <= h as i32;
        if (dx, dy) == (0, 0) || !inside || hs.count(hx0, hy0, hx1, hy1) != 0 {
            return None;
        }
        let mut e = 0.0f32;
        let n = pts.len().max(1) as f32;
        let penalty = 1.0 + 1e-3 * ((dx as f32).hypot(dy as f32) / max_radius as f32);
        for (i, &(x, y)) in pts.iter().enumerate() {
            let (a, b) = ((y as usize * w + x as usize) * ch, ((y + dy) as usize * w + (x + dx) as usize) * ch);
            for c in 0..ch {
                let d = img[a + c] - img[b + c];
                e += d * d;
            }
            // SSD terms are nonnegative. The partial score is a lower bound on the
            // final score; use the same division and penalty to keep float rounding
            // and strict tie ordering unchanged. Check in batches to keep this cheap.
            if i % 32 == 31 && cutoff.is_finite() && e / n * penalty >= cutoff {
                return None;
            }
        }
        // Mild preference for nearer sources on ties.
        Some(e / n * penalty)
    };
    // Coarse grid over the search window, then a full-resolution refinement around the winner.
    let step = (max_radius / 24).max(1);
    let mut best: Option<((i32, i32), f32)> = None;
    let consider = |dx: i32, dy: i32, best: &mut Option<((i32, i32), f32)>| {
        if let Some(e) = eval(dx, dy, best.map_or(f32::INFINITY, |(_, error)| error)) {
            if best.is_none_or(|(_, be)| e < be) {
                *best = Some(((dx, dy), e));
            }
        }
    };
    let mut dy = -max_radius;
    while dy <= max_radius {
        let mut dx = -max_radius;
        while dx <= max_radius {
            consider(dx, dy, &mut best);
            dx += step;
        }
        dy += step;
    }
    if step > 1 {
        if let Some(((bx, by), _)) = best {
            for dy in (by - step)..=(by + step) {
                for dx in (bx - step)..=(bx + step) {
                    consider(dx, dy, &mut best);
                }
            }
        }
    }
    best.map(|b| b.0)
}


// ---- retouch.rs: local blur ----

/// Gaussian blur of the window `[x0, x1) × [y0, y1)` of an interleaved `w × h × ch` buffer, reading
/// neighbours with edge clamping. With an alpha channel (`alpha = Some(index)`), colour is blurred
/// premultiplied so transparent pixels don't bleed their (meaningless) colour. Returns the window's
/// blurred pixels (`(x1−x0) × (y1−y0) × ch`).
#[allow(clippy::too_many_arguments)]
pub fn local_blur(data: &[f32], w: usize, h: usize, ch: usize, alpha: Option<usize>, win: (usize, usize, usize, usize), sigma: f32) -> Vec<f32> {
    let (x0, y0, x1, y1) = win;
    let (ow, oh) = (x1 - x0, y1 - y0);
    let r = (sigma * 3.0).ceil().max(1.0) as i32;
    let k: Vec<f32> = (-r..=r).map(|i| (-((i * i) as f32) / (2.0 * sigma * sigma).max(1e-6)).exp()).collect();
    let ks: f32 = k.iter().sum();
    let k: Vec<f32> = k.into_iter().map(|v| v / ks).collect();
    let get = |x: i32, y: i32, out: &mut [f32]| {
        let (xx, yy) = (x.clamp(0, w as i32 - 1) as usize, y.clamp(0, h as i32 - 1) as usize);
        let i = (yy * w + xx) * ch;
        out.copy_from_slice(&data[i..i + ch]);
        if let Some(a) = alpha {
            let av = out[a];
            for (c, v) in out.iter_mut().enumerate() {
                if c != a {
                    *v *= av;
                }
            }
        }
    };
    // Horizontal pass over the window rows extended vertically by r.
    let th = oh + 2 * r as usize;
    let mut tmp = vec![0.0f32; ow * th * ch];
    let mut px = vec![0.0f32; ch];
    for ty in 0..th {
        let y = y0 as i32 + ty as i32 - r;
        for ox in 0..ow {
            let o = (ty * ow + ox) * ch;
            for (i, kv) in k.iter().enumerate() {
                get(x0 as i32 + ox as i32 + i as i32 - r, y, &mut px);
                for c in 0..ch {
                    tmp[o + c] += px[c] * kv;
                }
            }
        }
    }
    let mut out = vec![0.0f32; ow * oh * ch];
    for oy in 0..oh {
        for ox in 0..ow {
            let o = (oy * ow + ox) * ch;
            for (i, kv) in k.iter().enumerate() {
                let s = ((oy + i) * ow + ox) * ch;
                for c in 0..ch {
                    out[o + c] += tmp[s + c] * kv;
                }
            }
            if let Some(a) = alpha {
                let av = out[o + a];
                for c in 0..ch {
                    if c != a {
                        out[o + c] = if av > 1e-6 { out[o + c] / av } else { data[((y0 + oy) * w + x0 + ox) * ch + c] };
                    }
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn disc(w: usize, h: usize, cx: f32, cy: f32, r: f32) -> Vec<bool> {
        (0..w * h).map(|i| ((i % w) as f32 - cx).hypot((i / w) as f32 - cy) < r).collect()
    }

    #[test]
    fn membrane_reproduces_linear_boundary() {
        // A linear function is harmonic: the solve must reproduce it exactly inside the hole.
        let (w, h) = (80, 60);
        let unknown = disc(w, h, 40.0, 30.0, 20.0);
        let truth: Vec<f32> = (0..w * h).map(|i| 0.2 + 0.005 * (i % w) as f32 + 0.003 * (i / w) as f32).collect();
        let mut v: Vec<f32> = truth.iter().zip(&unknown).map(|(t, u)| if *u { 0.0 } else { *t }).collect();
        solve_membrane(w, h, &unknown, &mut v);
        let err = v.iter().zip(&truth).map(|(a, b)| (a - b).abs()).fold(0.0, f32::max);
        assert!(err < 2e-3, "{err}");
    }

    #[test]
    fn multigrid_matches_reference_solve() {
        let (w, h) = (96, 72);
        let unknown = disc(w, h, 45.0, 36.0, 28.0);
        // Arbitrary, non-harmonic boundary data.
        let init: Vec<f32> = (0..w * h).map(|i| ((i % w) as f32 * 0.21).sin() * 0.3 + ((i / w) as f32 * 0.13).cos() * 0.2 + 0.5).collect();
        let mut fast = init.clone();
        solve_membrane(w, h, &unknown, &mut fast);
        let mut reference = init.clone();
        solve_membrane_reference(w, h, &unknown, &mut reference, 1e-7, 100_000);
        let err = fast.iter().zip(&reference).map(|(a, b)| (a - b).abs()).fold(0.0, f32::max);
        assert!(err < 2e-3, "max error vs reference {err}");
        // Known pixels untouched.
        assert!(fast.iter().zip(&init).zip(&unknown).all(|((a, b), u)| *u || a == b));
    }

    #[test]
    fn seamless_clone_takes_destination_colour_and_source_texture() {
        let (w, h, ch) = (64, 64, 3);
        let mask = disc(w, h, 32.0, 32.0, 20.0);
        // Destination: flat reddish; source: bluish with a stripe texture.
        let dst: Vec<f32> = (0..w * h).flat_map(|_| [0.7, 0.3, 0.2]).collect();
        let tex = |x: usize| if (x / 4).is_multiple_of(2) { 0.05 } else { -0.05 };
        let src: Vec<f32> = (0..w * h)
            .flat_map(|i| {
                let t = tex(i % w);
                [0.1 + t, 0.2 + t, 0.8 + t]
            })
            .collect();
        let out = seamless_clone(w, h, ch, &src, &dst, &mask);
        // Mean colour inside the mask matches the destination.
        let inside: Vec<usize> = (0..w * h).filter(|&i| mask[i]).collect();
        for c in 0..ch {
            let m = inside.iter().map(|&i| out[i * ch + c]).sum::<f32>() / inside.len() as f32;
            assert!((m - dst[c]).abs() < 0.02, "channel {c} mean {m}");
        }
        // Source gradients carried: horizontal differences inside match the source's.
        let (mut e, mut n) = (0.0f32, 0);
        for &i in &inside {
            if mask[i + 1] {
                e += ((out[(i + 1) * ch] - out[i * ch]) - (src[(i + 1) * ch] - src[i * ch])).abs();
                n += 1;
            }
        }
        assert!(e / (n as f32) < 0.01, "gradient error {}", e / n as f32);
        // Outside untouched.
        assert_eq!(&out[..3], &dst[..3]);
    }

    #[test]
    fn proximity_finds_matching_offset() {
        let (w, h, ch) = (80, 60, 1);
        // Periodic pattern with period 10 in x: a match is any multiple-of-10 displacement.
        let img: Vec<f32> = (0..w * h).map(|i| ((i % w) as f32 * std::f32::consts::TAU / 10.0).sin() * 0.4 + 0.5).collect();
        let hole = disc(w, h, 40.0, 30.0, 5.0);
        let (dx, dy) = best_offset(w, h, ch, &img, &hole, 3, 20).unwrap();
        assert_eq!(dx.rem_euclid(10), 0, "dx {dx} dy {dy}");
        assert!((dx, dy) != (0, 0));
    }

    #[test]
    fn proximity_search_clamps_hostile_radii_without_overflow_or_hanging() {
        let (w, h, ch) = (24, 20, 1);
        let img: Vec<f32> = (0..w * h).map(|i| (i % w) as f32 / w as f32).collect();
        let hole = disc(w, h, 12.0, 10.0, 2.0);
        // User-supplied values used to overflow i32 loops, cast a huge usize
        // ring into a negative number, or take billions of search iterations.
        let result = best_offset(w, h, ch, &img, &hole, usize::MAX, i32::MAX);
        if let Some((dx, dy)) = result {
            assert!(dx.abs() <= w as i32 && dy.abs() <= h as i32);
        }
        assert_eq!(best_offset(w, h, ch, &img, &hole, 2, -1), None);
        assert_eq!(best_offset(w, h, ch, &img, &hole, 2, 0), None);
    }

    #[test]
    fn blur_reduces_variance() {
        let (w, h, ch) = (16, 16, 1);
        let data: Vec<f32> = (0..w * h).map(|i| if (i % w + i / w) % 2 == 0 { 0.2 } else { 0.8 }).collect();
        let var = |v: &[f32]| {
            let m = v.iter().sum::<f32>() / v.len() as f32;
            v.iter().map(|x| (x - m).powi(2)).sum::<f32>() / v.len() as f32
        };
        let win = (4, 4, 12, 12);
        let orig: Vec<f32> = (4..12).flat_map(|y| (4..12).map(move |x| (x, y))).map(|(x, y)| data[y * w + x]).collect();
        let b = local_blur(&data, w, h, ch, None, win, 1.5);
        assert!(var(&b) < var(&orig) * 0.2);
    }
}
