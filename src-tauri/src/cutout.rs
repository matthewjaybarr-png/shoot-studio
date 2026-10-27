//! Cut out: choosing part of a Create picture (the subject, a box, a colour, a brushed area) and
//! keeping only that part with soft, clean edges. The selecting is PhotoCraft's
//! (`photocraft_select`); this module adapts it to a picture sent from the page.
//!
//! A selection is a coverage mask the picture's size, 0–255. JavaScript holds it, adds to or
//! takes from it, and draws lassos and plain brush strokes itself; Rust does what needs the
//! picture's colours.

use serde::Deserialize;

use crate::photocraft_select::matting::{decontaminate, gaussian_blur, guided_filter_color, EPS};
use crate::photocraft_select::segment::{grabcut, quick, subject, RgbImage, Sampler};
use crate::photocraft_select::{distance::edt, wand_region, Rect, Region};
use crate::retouch::PICTURE_EDGE;

/// What to select. Points and boxes are 0–1 across the picture; sizes are over its long edge.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Pick {
    /// The main thing in the picture.
    Subject,
    /// The thing inside a box: [left, top, right, bottom].
    Box { rect: [f64; 4] },
    /// Pixels like the one clicked; `tolerance` in levels (0–255).
    Wand { at: [f64; 2], tolerance: f32 },
    /// A brush that grows to the edges of what it paints over.
    Smart { points: Vec<[f64; 2]>, size: f64 },
}

/// Most a smart brush stroke may carry, like a retouch stroke.
const MAX_POINTS: usize = 2000;

/// How the kept part's edges are finished.
#[derive(Debug, Deserialize)]
pub struct Finish {
    /// How far (picture pixels) an edge may follow soft detail in the picture, such as hair.
    pub soft: f32,
}

pub const MAX_SOFT: f32 = 32.0;

/// Reads a straight RGBA8 picture for the selecting code.
struct Picture<'a> {
    w: usize,
    rgba: &'a [u8],
}

impl Sampler for Picture<'_> {
    fn rgba(&self, r: Rect) -> Vec<[f32; 4]> {
        let mut out = Vec::with_capacity(r.width() as usize * r.height() as usize);
        for y in r.y0..r.y1 {
            let row = &self.rgba[(y as usize * self.w + r.x0 as usize) * 4..(y as usize * self.w + r.x1 as usize) * 4];
            out.extend(row.as_chunks::<4>().0.iter().map(|p| p.map(|v| v as f32 / 255.0)));
        }
        out
    }
}

fn check(w: usize, h: usize, rgba: &[u8]) -> Result<(), String> {
    if w == 0 || h == 0 || w > PICTURE_EDGE || h > PICTURE_EDGE || rgba.len() != w * h * 4 {
        return Err(format!("not a picture KB Studio can cut out ({w} × {h})"));
    }
    Ok(())
}

/// The selection a pick makes, as a region of the picture (`None` when it finds nothing).
pub fn select(w: usize, h: usize, rgba: &[u8], pick: &Pick) -> Result<Option<Region>, String> {
    check(w, h, rgba)?;
    let canvas = Rect::new(0, 0, w as i32, h as i32);
    let picture = Picture { w, rgba };
    let long = w.max(h) as f64;
    let px = |p: [f64; 2]| -> Result<(f32, f32), String> {
        if !p.iter().all(|v| v.is_finite() && (-1.0..=2.0).contains(v)) {
            return Err("a point off the picture".into());
        }
        Ok(((p[0] * w as f64) as f32, (p[1] * h as f64) as f32))
    };
    Ok(match pick {
        Pick::Subject => subject::select_subject(&picture, canvas),
        Pick::Box { rect } => {
            let (x0, y0) = px([rect[0], rect[1]])?;
            let (x1, y1) = px([rect[2], rect[3]])?;
            let r = Rect::new(x0.min(x1).floor() as i32, y0.min(y1).floor() as i32, x0.max(x1).ceil() as i32, y0.max(y1).ceil() as i32);
            grabcut::object_select(&picture, canvas, r, subject::WORK_PX)
        }
        Pick::Wand { at, tolerance } => {
            if !(0.0..=255.0).contains(tolerance) {
                return Err("tolerance must be 0–255".into());
            }
            let (x, y) = px(*at)?;
            let img: &[[u8; 4]] = rgba.as_chunks::<4>().0;
            wand_region(img, canvas, (x.floor() as i32, y.floor() as i32), *tolerance, true, true)
        }
        Pick::Smart { points, size } => {
            if points.is_empty() || points.len() > MAX_POINTS || !(0.001..=0.5).contains(size) {
                return Err("not a smart brush stroke".into());
            }
            let pts = points.iter().map(|p| px(*p)).collect::<Result<Vec<_>, _>>()?;
            quick::quick_select(&picture, canvas, &pts, (size * long * 2.0) as f32)
        }
    })
}

/// Keeps the selected part of the picture: alpha becomes the picture's own alpha times the
/// selection, its edge follows soft detail up to `finish.soft` pixels from where it was (the
/// guided filter, as PhotoCraft's Refine Edge does it), and colour bleeding in from the old
/// background is taken out of the edge. Returns the rectangle that still shows; the RGBA
/// outside it is cleared.
pub fn keep(w: usize, h: usize, rgba: &mut [u8], mask: &[u8], finish: &Finish) -> Result<Option<Rect>, String> {
    check(w, h, rgba)?;
    if mask.len() != w * h {
        return Err("the selection is not the picture's size".into());
    }
    if !(0.0..=MAX_SOFT).contains(&finish.soft) {
        return Err(format!("soft edges must be 0–{MAX_SOFT} pixels"));
    }
    let Some(sel) = bounds(mask, w, h) else {
        rgba.fill(0);
        return Ok(None);
    };
    // Work only around the selection: as far as an edge can move, plus the filter's reach.
    let r = finish.soft.ceil() as i32;
    let area = sel.inflate(3 * r + 4).intersect(&Rect::new(0, 0, w as i32, h as i32));
    let (aw, ah) = (area.width() as usize, area.height() as usize);
    let at = |x: usize, y: usize| (area.y0 as usize + y) * w + area.x0 as usize + x;
    let m: Vec<f32> = (0..aw * ah).map(|i| mask[at(i % aw, i / aw)] as f32 / 255.0).collect();
    let mut rgb: Vec<[f32; 3]> = (0..aw * ah).map(|i| { let o = at(i % aw, i / aw) * 4; [0, 1, 2].map(|c| rgba[o + c] as f32 / 255.0) }).collect();
    let a = if r > 0 { follow_edges(&RgbImage { w: aw, h: ah, px: rgb.clone() }, &m, finish.soft) } else { m };
    decontaminate(&mut rgb, &a, aw, ah, finish.soft.max(3.0), 1.0);
    let mut shown = Rect::EMPTY;
    let mut out = vec![0u8; rgba.len()];
    for y in 0..ah {
        for x in 0..aw {
            let (i, o) = (y * aw + x, at(x, y) * 4);
            let alpha = (a[i].clamp(0.0, 1.0) * rgba[o + 3] as f32).round() as u8;
            if alpha == 0 {
                continue;
            }
            for c in 0..3 {
                out[o + c] = (rgb[i][c].clamp(0.0, 1.0) * 255.0).round() as u8;
            }
            out[o + 3] = alpha;
            let (px, py) = (area.x0 + x as i32, area.y0 + y as i32);
            shown = if shown.is_empty() { Rect::new(px, py, px + 1, py + 1) } else { Rect::new(shown.x0.min(px), shown.y0.min(py), shown.x1.max(px + 1), shown.y1.max(py + 1)) };
        }
    }
    rgba.copy_from_slice(&out);
    Ok((!shown.is_empty()).then_some(shown))
}

/// The box around a mask's non-zero pixels.
fn bounds(mask: &[u8], w: usize, h: usize) -> Option<Rect> {
    let (mut x0, mut y0, mut x1, mut y1) = (usize::MAX, usize::MAX, 0, 0);
    for y in 0..h {
        let row = &mask[y * w..(y + 1) * w];
        if let (Some(a), Some(b)) = (row.iter().position(|v| *v != 0), row.iter().rposition(|v| *v != 0)) {
            (x0, x1, y0, y1) = (x0.min(a), x1.max(b + 1), y0.min(y), y + 1);
        }
    }
    (x0 != usize::MAX).then(|| Rect::new(x0 as i32, y0 as i32, x1 as i32, y1 as i32))
}

/// The edge-detection part of PhotoCraft's `refine_buffer` (`crates/algo/src/matting.rs`): within
/// `radius` of the selection's edge, coverage comes from the guided filter, so the edge takes on
/// the picture's own soft transitions; a light blur then smooths what is left of the step.
fn follow_edges(img: &RgbImage, m: &[f32], radius: f32) -> Vec<f32> {
    let (w, h) = (img.w, img.h);
    let bin: Vec<bool> = m.iter().map(|v| *v >= 0.5).collect();
    let mut boundary = vec![false; w * h];
    let mut any = false;
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let v = bin[i];
            let diff = (x > 0 && bin[i - 1] != v) || (x + 1 < w && bin[i + 1] != v) || (y > 0 && bin[i - w] != v) || (y + 1 < h && bin[i + w] != v);
            boundary[i] = diff;
            any |= diff;
        }
    }
    let mut a = m.to_vec();
    if any {
        let dist = edt(&boundary, w, h);
        let q = guided_filter_color(img, m, radius.ceil().clamp(1.0, 64.0) as usize, EPS);
        for i in 0..w * h {
            let wgt = (radius + 1.0 - dist[i]).clamp(0.0, 1.0);
            if wgt > 0.0 {
                a[i] = m[i] + (q[i].clamp(0.0, 1.0) - m[i]) * wgt;
            }
        }
    }
    gaussian_blur(&a, w, h, 0.5)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A red disc on a blue-grey background with a little noise.
    fn disc(w: usize, h: usize) -> Vec<u8> {
        let mut out = Vec::with_capacity(w * h * 4);
        for y in 0..h {
            for x in 0..w {
                let (dx, dy) = (x as f32 - w as f32 * 0.5, y as f32 - h as f32 * 0.5);
                let inside = dx * dx + dy * dy < (w.min(h) as f32 * 0.3).powi(2);
                let n = ((x * 7 + y * 13) % 9) as u8;
                out.extend_from_slice(&if inside { [200 + n, 40, 40 + n, 255] } else { [90, 110 + n, 150, 255] });
            }
        }
        out
    }

    fn inside_share(r: &Region, w: usize, h: usize) -> (f32, f32) {
        let (mut hit, mut stray, mut total) = (0.0, 0.0, 0.0);
        for y in 0..h as i32 {
            for x in 0..w as i32 {
                let (dx, dy) = (x as f32 - w as f32 * 0.5, y as f32 - h as f32 * 0.5);
                let inside = dx * dx + dy * dy < (w.min(h) as f32 * 0.3).powi(2);
                let v = r.at(x, y);
                if inside {
                    hit += v;
                    total += 1.0;
                } else {
                    stray += v;
                }
            }
        }
        (hit / total, stray / total)
    }

    #[test]
    fn each_pick_finds_the_disc() {
        let (w, h) = (240, 180);
        let img = disc(w, h);
        let picks = [
            Pick::Subject,
            Pick::Box { rect: [0.2, 0.15, 0.8, 0.85] },
            Pick::Wand { at: [0.5, 0.5], tolerance: 32.0 },
            Pick::Smart { points: vec![[0.45, 0.5], [0.55, 0.5]], size: 0.04 },
        ];
        for pick in &picks {
            let r = select(w, h, &img, pick).unwrap().unwrap_or_else(|| panic!("{pick:?} found nothing"));
            let (hit, stray) = inside_share(&r, w, h);
            assert!(hit > 0.97 && stray < 0.03, "{pick:?}: {hit} of the disc, {stray} beside it");
        }
    }

    #[test]
    fn bad_picks_are_refused() {
        let img = disc(40, 30);
        assert!(select(40, 30, &img, &Pick::Wand { at: [f64::NAN, 0.5], tolerance: 10.0 }).is_err());
        assert!(select(40, 30, &img, &Pick::Wand { at: [0.5, 0.5], tolerance: 300.0 }).is_err());
        assert!(select(40, 30, &img, &Pick::Smart { points: vec![], size: 0.05 }).is_err());
        assert!(select(40, 30, &img, &Pick::Smart { points: vec![[0.5, 0.5]], size: 0.9 }).is_err());
        assert!(select(40, 31, &img, &Pick::Subject).is_err());
        let json: Pick = serde_json::from_str(r#"{"kind":"box","rect":[0,0,1,1]}"#).unwrap();
        assert!(matches!(json, Pick::Box { .. }));
    }

    #[test]
    fn keeping_clears_the_rest_and_cleans_the_edge() {
        let (w, h) = (120, 90);
        let mut img = disc(w, h);
        let before = img.clone();
        let r = select(w, h, &img, &Pick::Wand { at: [0.5, 0.5], tolerance: 32.0 }).unwrap().unwrap();
        let mut mask = vec![0u8; w * h];
        for y in 0..h {
            for x in 0..w {
                mask[y * w + x] = (r.at(x as i32, y as i32) * 255.0).round() as u8;
            }
        }
        let shown = keep(w, h, &mut img, &mask, &Finish { soft: 4.0 }).unwrap().unwrap();
        let px = |x: usize, y: usize| &img[(y * w + x) * 4..(y * w + x) * 4 + 4];
        assert_eq!(px(2, 2), [0, 0, 0, 0], "the background goes");
        assert_eq!(px(60, 45), &before[(45 * w + 60) * 4..(45 * w + 60) * 4 + 4], "the middle stays as it was");
        assert!(shown.x0 > 20 && shown.x1 < 100 && shown.y0 > 10 && shown.y1 < 80, "{shown:?}");
        // The edge keeps the disc's red, not the blue it was cut from.
        for x in 0..w {
            let p = px(x, 45);
            if p[3] > 10 && p[3] < 245 {
                assert!(p[0] > 150 && p[2] < 110, "edge pixel {x} is {p:?}");
            }
        }
    }

    #[test]
    #[ignore = "timing: cargo test --release cutout -- --ignored --nocapture"]
    fn cutting_out_is_quick_at_picture_size() {
        let (w, h) = (3300, 2475);
        let mut img = disc(w, h);
        let t = std::time::Instant::now();
        let r = select(w, h, &img, &Pick::Subject).unwrap().unwrap();
        let picked = t.elapsed();
        let mut mask = vec![0u8; w * h];
        for y in r.bbox.y0..r.bbox.y1 {
            for x in r.bbox.x0..r.bbox.x1 {
                mask[y as usize * w + x as usize] = (r.at(x, y) * 255.0).round() as u8;
            }
        }
        let t = std::time::Instant::now();
        keep(w, h, &mut img, &mask, &Finish { soft: 8.0 }).unwrap();
        println!("subject {picked:?}, keep {:?}", t.elapsed());
    }

    #[test]
    fn keeping_nothing_leaves_nothing() {
        let (w, h) = (20, 10);
        let mut img = disc(w, h);
        assert!(keep(w, h, &mut img, &vec![0; w * h], &Finish { soft: 2.0 }).unwrap().is_none());
        assert!(img.iter().all(|v| *v == 0));
        assert!(keep(w, h, &mut img, &[0; 3], &Finish { soft: 2.0 }).is_err());
        assert!(keep(w, h, &mut img, &vec![0; w * h], &Finish { soft: 99.0 }).is_err());
    }
}
