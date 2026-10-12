//! Retouch: brush strokes saved in the recipe and replayed on the linear source pixels
//! before the Develop shader runs. Strokes are append-only, so adding one only touches its
//! own rectangle; undo replays the rest from the clean image.

use crate::photocraft::{best_offset, local_blur, seamless_clone};
use serde::{Deserialize, Serialize};
use std::sync::atomic::AtomicU64;
use std::sync::Mutex;

pub const MAX_STROKES: usize = 500;
pub const MAX_POINTS: usize = 2000;

#[derive(Clone, Copy, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Tool {
    /// Heal from a source the app picks nearby.
    Spot,
    /// Heal from a chosen source: texture from there, colour and light from here.
    Heal,
    /// Copy the source exactly.
    Clone,
    /// Smooth skin while keeping its fine texture.
    Soften,
}

/// One brush stroke. Points are 0–1 across the upright image, `size` is the brush radius over
/// the image's long edge, and `offset` is source minus destination in the same units as points.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct Stroke {
    pub tool: Tool,
    pub size: f64,
    pub points: Vec<[f64; 2]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offset: Option<[f64; 2]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strength: Option<f64>,
}

/// Pixel rectangle; `w == 0` means nothing changed.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Rect {
    pub x: usize,
    pub y: usize,
    pub w: usize,
    pub h: usize,
}

impl Rect {
    fn union(self, o: Rect) -> Rect {
        if self.w == 0 || self.h == 0 {
            return o;
        }
        if o.w == 0 || o.h == 0 {
            return self;
        }
        let (x, y) = (self.x.min(o.x), self.y.min(o.y));
        let x1 = (self.x + self.w).max(o.x + o.w);
        let y1 = (self.y + self.h).max(o.y + o.h);
        Rect { x, y, w: x1 - x, h: y1 - y }
    }
}

pub fn validate(strokes: &[Stroke]) -> Result<(), String> {
    if strokes.len() > MAX_STROKES {
        return Err(format!("too many retouch strokes ({}, at most {MAX_STROKES})", strokes.len()));
    }
    for (i, s) in strokes.iter().enumerate() {
        let bad = |what: &str| Err(format!("retouch stroke {} has {what}", i + 1));
        if !(0.001..=0.1).contains(&s.size) {
            return bad("a bad size");
        }
        if s.points.is_empty() || s.points.len() > MAX_POINTS {
            return bad("too many or no points");
        }
        if !s.points.iter().flatten().all(|v| (0.0..=1.0).contains(v)) {
            return bad("a point outside the photo");
        }
        match (s.tool, s.offset, s.strength) {
            (Tool::Soften, None, Some(k)) if (0.0..=1.0).contains(&k) => {}
            (Tool::Spot | Tool::Heal | Tool::Clone, Some(o), None)
                if o.iter().all(|v| (-1.0..=1.0).contains(v)) => {}
            _ => return bad("a bad offset or strength"),
        }
    }
    Ok(())
}

fn radius(stroke: &Stroke, w: usize, h: usize) -> f64 {
    (stroke.size * w.max(h) as f64).max(1.0)
}

/// Where the brush touched and how strongly (0–1), within the returned rectangle.
pub fn coverage(stroke: &Stroke, w: usize, h: usize) -> (Rect, Vec<f32>) {
    // ponytail: fixed hardness; full strength to half the radius, then a smooth fade.
    const HARD: f64 = 0.5;
    let r = radius(stroke, w, h);
    let pts: Vec<(f64, f64)> = stroke.points.iter().map(|p| (p[0] * w as f64, p[1] * h as f64)).collect();
    // Dabs every quarter radius along the path.
    let spacing = r / 4.0;
    let mut dabs = vec![pts[0]];
    let mut carry = 0.0;
    for seg in pts.windows(2) {
        let ((ax, ay), (bx, by)) = (seg[0], seg[1]);
        let len = (bx - ax).hypot(by - ay);
        let mut t = spacing - carry;
        while t <= len {
            dabs.push((ax + (bx - ax) * t / len, ay + (by - ay) * t / len));
            t += spacing;
        }
        carry = len - (t - spacing);
    }
    let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for &(x, y) in &dabs {
        (x0, y0, x1, y1) = (x0.min(x - r), y0.min(y - r), x1.max(x + r), y1.max(y + r));
    }
    let clip = |v: f64, max: usize| (v.max(0.0) as usize).min(max);
    let (rx0, ry0) = (clip(x0.floor(), w), clip(y0.floor(), h));
    let (rx1, ry1) = (clip(x1.ceil(), w), clip(y1.ceil(), h));
    let rect = Rect { x: rx0, y: ry0, w: rx1 - rx0, h: ry1 - ry0 };
    let mut cov = vec![0f32; rect.w * rect.h];
    for &(cx, cy) in &dabs {
        let (dx0, dy0) = (clip((cx - r).floor(), rx1).max(rx0), clip((cy - r).floor(), ry1).max(ry0));
        let (dx1, dy1) = (clip((cx + r).ceil(), rx1), clip((cy + r).ceil(), ry1));
        for y in dy0..dy1 {
            for x in dx0..dx1 {
                let t = (x as f64 + 0.5 - cx).hypot(y as f64 + 0.5 - cy) / r;
                if t >= 1.0 {
                    continue;
                }
                let u = ((1.0 - t) / (1.0 - HARD)).min(1.0);
                let v = (u * u * (3.0 - 2.0 * u)) as f32;
                let c = &mut cov[(y - ry0) * rect.w + x - rx0];
                *c = c.max(v);
            }
        }
    }
    (rect, cov)
}

/// The stroke's source offset in whole pixels.
fn shift(stroke: &Stroke, w: usize, h: usize) -> (i64, i64) {
    let o = stroke.offset.unwrap_or([0.0, 0.0]);
    ((o[0] * w as f64).round() as i64, (o[1] * h as f64).round() as i64)
}

/// Apply one stroke to interleaved linear RGB in place; returns the rectangle it changed.
pub fn apply(img: &mut [f32], w: usize, h: usize, stroke: &Stroke) -> Rect {
    let (rect, cov) = coverage(stroke, w, h);
    if rect.w == 0 || rect.h == 0 {
        return Rect::default();
    }
    let at = |x: i64, y: i64| (y.clamp(0, h as i64 - 1) as usize * w + x.clamp(0, w as i64 - 1) as usize) * 3;
    let (sx, sy) = shift(stroke, w, h);
    // New pixels for the rectangle, mixed in by coverage below.
    let target: Vec<f32> = match stroke.tool {
        Tool::Spot | Tool::Heal => {
            // A one pixel unmasked margin gives the solve its boundary (destination) values.
            let wx0 = rect.x.saturating_sub(1);
            let wy0 = rect.y.saturating_sub(1);
            let wx1 = (rect.x + rect.w + 1).min(w);
            let wy1 = (rect.y + rect.h + 1).min(h);
            let (ww, wh) = (wx1 - wx0, wy1 - wy0);
            let mut src = Vec::with_capacity(ww * wh * 3);
            let mut dst = Vec::with_capacity(ww * wh * 3);
            let mut mask = Vec::with_capacity(ww * wh);
            for y in wy0..wy1 {
                for x in wx0..wx1 {
                    let s = at(x as i64 + sx, y as i64 + sy);
                    src.extend_from_slice(&img[s..s + 3]);
                    let d = (y * w + x) * 3;
                    dst.extend_from_slice(&img[d..d + 3]);
                    let inside = x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h;
                    mask.push(inside && cov[(y - rect.y) * rect.w + x - rect.x] > 0.0);
                }
            }
            let healed = seamless_clone(ww, wh, 3, &src, &dst, &mask);
            let mut out = Vec::with_capacity(rect.w * rect.h * 3);
            for y in rect.y..rect.y + rect.h {
                let i = ((y - wy0) * ww + rect.x - wx0) * 3;
                out.extend_from_slice(&healed[i..i + rect.w * 3]);
            }
            out
        }
        Tool::Clone => {
            let mut out = Vec::with_capacity(rect.w * rect.h * 3);
            for y in rect.y..rect.y + rect.h {
                for x in rect.x..rect.x + rect.w {
                    let s = at(x as i64 + sx, y as i64 + sy);
                    out.extend_from_slice(&img[s..s + 3]);
                }
            }
            out
        }
        Tool::Soften => {
            // Frequency separation: keep the broad tone and the fine texture (pores),
            // drop the blotchy middle band.
            // ponytail: Gaussian low band can halo at hairlines; guided filter if it shows
            let long = w.max(h) as f32;
            let win = (rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
            let low = local_blur(img, w, h, 3, None, win, (0.01 * long).max(1.0));
            let fine = local_blur(img, w, h, 3, None, win, (0.001 * long).max(0.5));
            let mut out = Vec::with_capacity(rect.w * rect.h * 3);
            for y in rect.y..rect.y + rect.h {
                for x in rect.x..rect.x + rect.w {
                    let (d, i) = ((y * w + x) * 3, ((y - rect.y) * rect.w + x - rect.x) * 3);
                    for c in 0..3 {
                        out.push((low[i + c] + img[d + c] - fine[i + c]).max(0.0));
                    }
                }
            }
            out
        }
    };
    let amount = stroke.strength.unwrap_or(1.0) as f32;
    for y in 0..rect.h {
        for x in 0..rect.w {
            let k = cov[y * rect.w + x] * amount;
            if k <= 0.0 {
                continue;
            }
            let (d, t) = (((rect.y + y) * w + rect.x + x) * 3, (y * rect.w + x) * 3);
            for c in 0..3 {
                img[d + c] += (target[t + c] - img[d + c]) * k;
            }
        }
    }
    rect
}

/// A nearby clean patch for a spot stroke: source minus destination, normalised like points.
pub fn spot_source(img: &[f32], w: usize, h: usize, stroke: &Stroke) -> [f64; 2] {
    let (rect, cov) = coverage(stroke, w, h);
    let r = radius(stroke, w, h) as usize;
    let ring = (r / 2).max(2);
    let reach = rect.w.max(rect.h).max(16) * 2;
    // Search a crop around the stroke rather than the whole photo.
    let pad = reach + ring;
    let (cx0, cy0) = (rect.x.saturating_sub(pad), rect.y.saturating_sub(pad));
    let (cx1, cy1) = ((rect.x + rect.w + pad).min(w), (rect.y + rect.h + pad).min(h));
    let (cw, ch) = (cx1 - cx0, cy1 - cy0);
    let mut crop = Vec::with_capacity(cw * ch * 3);
    let mut hole = vec![false; cw * ch];
    for y in cy0..cy1 {
        crop.extend_from_slice(&img[(y * w + cx0) * 3..(y * w + cx1) * 3]);
    }
    for y in 0..rect.h {
        for x in 0..rect.w {
            hole[(rect.y + y - cy0) * cw + rect.x + x - cx0] = cov[y * rect.w + x] > 0.0;
        }
    }
    // Nothing clean fits (a huge stroke in a corner): take the patch beside it.
    let (dx, dy) = best_offset(cw, ch, 3, &crop, &hole, ring, reach as i32).unwrap_or_else(|| {
        let side = rect.w as i32 + 1;
        if rect.x + rect.w + rect.w < w { (side, 0) } else { (-side, 0) }
    });
    [dx as f64 / w as f64, dy as f64 / h as f64]
}

/// The photo open in Develop: its clean pixels, the pixels with `applied` strokes, and those
/// strokes. ponytail: two full copies of a 3072 px float image is about 150 MB; fine for
/// one photo at a time, tile it if memory gets tight.
pub struct Session {
    pub dir: String,
    pub name: String,
    pub w: usize,
    pub h: usize,
    pub clean: Vec<f32>,
    pub current: Vec<f32>,
    pub applied: Vec<Stroke>,
}

#[derive(Default)]
pub struct Retouching {
    pub session: Mutex<Option<Session>>,
    /// Bumped by each develop_source so a slow decode can't replace a newer photo.
    pub opened: AtomicU64,
}

impl Session {
    pub fn new(dir: String, name: String, w: usize, h: usize, clean: Vec<f32>, strokes: Vec<Stroke>) -> Self {
        let mut s = Session { dir, name, w, h, current: clean.clone(), clean, applied: Vec::new() };
        s.update(strokes);
        s
    }

    /// Bring `current` to `strokes`: only the new ones when they extend what is applied,
    /// otherwise replay everything from clean. Returns what changed.
    pub fn update(&mut self, strokes: Vec<Stroke>) -> Rect {
        let n = self.applied.len();
        let mut dirty = Rect::default();
        if strokes.len() >= n && strokes[..n] == self.applied[..] {
            for s in &strokes[n..] {
                dirty = dirty.union(apply(&mut self.current, self.w, self.h, s));
            }
        } else {
            self.current.copy_from_slice(&self.clean);
            for s in &strokes {
                apply(&mut self.current, self.w, self.h, s);
            }
            dirty = Rect { x: 0, y: 0, w: self.w, h: self.h };
        }
        self.applied = strokes;
        dirty
    }

    /// x, y, w, h as little-endian u32s, then the rectangle's RGB as half floats.
    pub fn region(&self, r: Rect) -> Vec<u8> {
        let mut out = Vec::with_capacity(16 + r.w * r.h * 6);
        for v in [r.x, r.y, r.w, r.h] {
            out.extend_from_slice(&(v as u32).to_le_bytes());
        }
        for y in r.y..r.y + r.h {
            for v in &self.current[(y * self.w + r.x) * 3..(y * self.w + r.x + r.w) * 3] {
                out.extend_from_slice(&half::f16::from_f32(*v).to_le_bytes());
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A softly textured gradient, the kind of skin or sky a spot sits on.
    fn textured(w: usize, h: usize) -> Vec<f32> {
        (0..w * h)
            .flat_map(|i| {
                let (x, y) = ((i % w) as f32, (i / w) as f32);
                let t = 0.02 * ((x * 0.9).sin() * (y * 0.7).cos());
                let g = 0.2 + 0.3 * x / w as f32 + 0.1 * y / h as f32 + t;
                [g, g * 0.8, g * 0.6]
            })
            .collect()
    }

    fn stroke(tool: Tool, size: f64, points: &[[f64; 2]]) -> Stroke {
        let (offset, strength) = match tool {
            Tool::Soften => (None, Some(1.0)),
            _ => (Some([0.0, 0.0]), None),
        };
        Stroke { tool, size, points: points.to_vec(), offset, strength }
    }

    #[test]
    fn spot_removes_a_dark_dot_and_nothing_outside_changes() {
        let (w, h) = (200, 150);
        let clean = textured(w, h);
        let mut img = clean.clone();
        let dot = |x: usize, y: usize| (x as f32 - 100.0).hypot(y as f32 - 75.0) < 4.0;
        for i in 0..w * h {
            if dot(i % w, i / w) {
                img[i * 3..i * 3 + 3].copy_from_slice(&[0.02, 0.02, 0.02]);
            }
        }
        let before = img.clone();
        let mut s = stroke(Tool::Spot, 8.0 / 200.0, &[[100.5 / 200.0, 75.5 / 150.0]]);
        s.offset = Some(spot_source(&img, w, h, &s));
        assert_ne!(s.offset, Some([0.0, 0.0]));
        let rect = apply(&mut img, w, h, &s);
        let err = (0..w * h)
            .filter(|&i| dot(i % w, i / w))
            .flat_map(|i| (0..3).map(move |c| i * 3 + c))
            .map(|i| (img[i] - clean[i]).abs())
            .fold(0.0, f32::max);
        assert!(err < 0.03, "dot still there: {err}");
        for y in 0..h {
            for x in 0..w {
                let inside = x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h;
                if !inside {
                    let i = (y * w + x) * 3;
                    assert_eq!(img[i..i + 3], before[i..i + 3], "changed outside at {x},{y}");
                }
            }
        }
    }

    #[test]
    fn adding_strokes_one_by_one_equals_a_full_replay() {
        let (w, h) = (160, 120);
        let mut strokes = vec![
            stroke(Tool::Spot, 0.03, &[[0.3, 0.3], [0.35, 0.32]]),
            stroke(Tool::Clone, 0.04, &[[0.6, 0.5], [0.62, 0.6], [0.58, 0.7]]),
            stroke(Tool::Heal, 0.02, &[[0.5, 0.5]]),
            stroke(Tool::Soften, 0.05, &[[0.4, 0.6], [0.5, 0.65]]),
        ];
        strokes[0].offset = Some([0.1, 0.0]);
        strokes[1].offset = Some([-0.2, -0.1]);
        strokes[2].offset = Some([0.05, 0.05]);
        let mut live = Session::new("d".into(), "p".into(), w, h, textured(w, h), Vec::new());
        for n in 1..=strokes.len() {
            let r = live.update(strokes[..n].to_vec());
            assert!(r.w > 0 && r.w < w, "{r:?}");
        }
        let replay = Session::new("d".into(), "p".into(), w, h, textured(w, h), strokes.clone());
        assert!(live.current.iter().zip(&replay.current).all(|(a, b)| a.to_bits() == b.to_bits()));
        // Undo replays from clean.
        let r = live.update(strokes[..2].to_vec());
        assert_eq!(r, Rect { x: 0, y: 0, w, h });
        let two = Session::new("d".into(), "p".into(), w, h, textured(w, h), strokes[..2].to_vec());
        assert_eq!(live.current, two.current);
    }

    #[test]
    fn validate_rejects_bad_strokes() {
        let ok = stroke(Tool::Spot, 0.01, &[[0.5, 0.5]]);
        assert!(validate(&[ok.clone()]).is_ok());
        let soften = stroke(Tool::Soften, 0.01, &[[0.5, 0.5]]);
        assert!(validate(&[soften.clone()]).is_ok());
        let bad = |f: &dyn Fn(&mut Stroke)| {
            let mut s = ok.clone();
            f(&mut s);
            validate(&[s]).is_err()
        };
        assert!(bad(&|s| s.points[0][0] = f64::NAN));
        assert!(bad(&|s| s.points[0][1] = 1.2));
        assert!(bad(&|s| s.size = f64::INFINITY));
        assert!(bad(&|s| s.size = 0.5));
        assert!(bad(&|s| s.size = 0.0001));
        assert!(bad(&|s| s.offset = None));
        assert!(bad(&|s| s.offset = Some([f64::NAN, 0.0])));
        assert!(bad(&|s| s.strength = Some(0.5)));
        assert!(bad(&|s| s.points.clear()));
        assert!(bad(&|s| s.points = vec![[0.5, 0.5]; MAX_POINTS + 1]));
        let mut strong = soften.clone();
        strong.strength = Some(1.5);
        assert!(validate(&[strong]).is_err());
        assert!(validate(&vec![ok.clone(); MAX_STROKES]).is_ok());
        assert!(validate(&vec![ok; MAX_STROKES + 1]).is_err());
        let json = r#"{"tool":"spot","size":0.01,"points":[[0.5,0.5]],"offset":[0.1,0]}"#;
        assert!(validate(&[serde_json::from_str(json).unwrap()]).is_ok());
        assert!(serde_json::from_str::<Stroke>(r#"{"tool":"blur","size":0.01,"points":[]}"#).is_err());
    }

    #[test]
    fn soften_smooths_blotches_but_keeps_fine_texture() {
        let (w, h) = (2000, 200); // long edge 2000: sigmas 2 px and 20 px
        let fine = |x: usize, y: usize| if (x + y) % 2 == 0 { 0.01 } else { -0.01 };
        let mid = |x: usize, y: usize| 0.05 * ((x as f32 * 0.2).sin() * (y as f32 * 0.2).sin());
        let img: Vec<f32> = (0..w * h)
            .flat_map(|i| {
                let (x, y) = (i % w, i / w);
                [0.3 + mid(x, y) + fine(x, y); 3]
            })
            .collect();
        let mut out = img.clone();
        apply(&mut out, w, h, &stroke(Tool::Soften, 0.05, &[[0.5, 0.5]]));
        // Measure in the brush's full-strength middle.
        let var = |f: &dyn Fn(usize, usize) -> f32| {
            let v: Vec<f32> = (80..120).flat_map(|y| (980..1020).map(move |x| (x, y))).map(|(x, y)| f(x, y)).collect();
            let m = v.iter().sum::<f32>() / v.len() as f32;
            v.iter().map(|a| (a - m).powi(2)).sum::<f32>() / v.len() as f32
        };
        let px = |p: &[f32], x: usize, y: usize| p[(y * w + x) * 3];
        // Mid band: a 3x3 box mean (removes the checkerboard) shows the blotches.
        let boxed = |p: &[f32], x: usize, y: usize| {
            (0..9).map(|k| px(p, x + k % 3 - 1, y + k / 3 - 1)).sum::<f32>() / 9.0
        };
        let high = |p: &[f32], x: usize, y: usize| px(p, x, y) - boxed(p, x, y);
        let (mid_in, mid_out) = (var(&|x, y| boxed(&img, x, y)), var(&|x, y| boxed(&out, x, y)));
        assert!(mid_out < mid_in * 0.5, "mid band {mid_in} -> {mid_out}");
        let (hi_in, hi_out) = (var(&|x, y| high(&img, x, y)), var(&|x, y| high(&out, x, y)));
        assert!((hi_out / hi_in - 1.0).abs() < 0.1, "fine texture {hi_in} -> {hi_out}");
    }

    #[test]
    fn region_layout() {
        let s = Session::new("d".into(), "p".into(), 4, 2, (0..24).map(|v| v as f32).collect(), Vec::new());
        let b = s.region(Rect { x: 1, y: 1, w: 2, h: 1 });
        assert_eq!(&b[..16], &[1, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0]);
        let first = half::f16::from_le_bytes([b[16], b[17]]).to_f32();
        assert_eq!(first, 15.0); // pixel (1, 1) = index 5, red
        assert_eq!(b.len(), 16 + 2 * 3 * 2);
    }
}
