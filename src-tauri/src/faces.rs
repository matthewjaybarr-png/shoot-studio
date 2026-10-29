//! Touch up faces in Create's Edit photo: finding the faces (PhotoCraft's port of libfacedetection, in
//! `photocraft_faces`) and the tone touch-ups done on each one: smoother skin, brighter eyes and whiter teeth.
//! The shape changes (bigger eyes, a smile, a slimmer face) are a displacement field built in JavaScript from the
//! same landmarks and warped by `reshape`, so a cut-out edge moves with the face.

use crate::photocraft_faces;
use serde::{Deserialize, Serialize};

/// Faces scoring below this are left out (libfacedetection's own threshold for a reliable face).
const MIN_SCORE: f32 = 0.5;
/// Real faces score about 0.9; things that only look a bit like a face (a row of bottles) score 0.5 to 0.65 and are
/// tiny. A face scoring below this is kept only if it is at least a quarter as wide as the biggest one.
const SURE_SCORE: f32 = 0.8;

/// One face, in pixels of the picture it was found in.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Face {
    pub score: f32,
    /// Left, top, width and height.
    pub rect: [f32; 4],
    /// The eye on the picture's left, the other eye, the nose tip, the mouth corner on the picture's left, the
    /// other mouth corner.
    pub landmarks: [[f32; 2]; 5],
}

/// The faces in the `w` × `h` RGBA picture, best first.
pub fn find(w: usize, h: usize, rgba: &[u8]) -> Result<Vec<Face>, String> {
    let px: Vec<[f32; 4]> = rgba.as_chunks::<4>().0.iter().map(|p| p.map(|v| v as f32 / 255.0)).collect();
    let found = photocraft_faces::detect(&px, w, h, MIN_SCORE).ok_or("the picture is not the size it says")?;
    Ok(likely(found.into_iter().map(|f| Face { score: f.score, rect: f.rect, landmarks: f.landmarks }).collect()))
}

/// The faces worth touching up: sure ones, and less sure ones that are a fair size next to the biggest.
fn likely(faces: Vec<Face>) -> Vec<Face> {
    let biggest = faces.iter().map(|f| f.rect[2]).fold(0.0, f32::max);
    faces.into_iter().filter(|f| f.score >= SURE_SCORE || (f.score >= 0.6 && f.rect[2] >= biggest / 4.0)).collect()
}

/// How much of each touch-up, 0 to 1.
#[derive(Clone, Copy, Debug, Default)]
pub struct Tones {
    pub smooth: f32,
    pub eyes: f32,
    pub teeth: f32,
}

const fn smoothstep(a: f32, b: f32, x: f32) -> f32 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
/// 1 inside the ellipse at `c` with radii `r`, fading to 0 over its outer quarter.
fn ellipse(x: f32, y: f32, c: [f32; 2], r: [f32; 2]) -> f32 {
    let d = (((x - c[0]) / r[0]).powi(2) + ((y - c[1]) / r[1]).powi(2)).sqrt();
    1.0 - smoothstep(0.75, 1.0, d)
}
fn dist(a: [f32; 2], b: [f32; 2]) -> f32 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt()
}

/// A box of the picture, clamped to it: x0, y0, x1, y1 (exclusive).
fn region(w: usize, h: usize, c: [f32; 2], r: [f32; 2]) -> (usize, usize, usize, usize) {
    let clamp = |v: f32, n: usize| (v.max(0.0) as usize).min(n);
    (clamp(c[0] - r[0], w), clamp(c[1] - r[1], h), clamp(c[0] + r[0] + 1.0, w), clamp(c[1] + r[1] + 1.0, h))
}

/// The mean of `v` (one value a pixel, `rw` × `rh`) over a (2r + 1)² box, through a summed-area table.
fn box_mean(v: &[f32], rw: usize, rh: usize, r: usize) -> Vec<f32> {
    let mut sum = vec![0.0f64; (rw + 1) * (rh + 1)];
    for y in 0..rh {
        let mut row = 0.0f64;
        for x in 0..rw {
            row += v[y * rw + x] as f64;
            sum[(y + 1) * (rw + 1) + x + 1] = sum[y * (rw + 1) + x + 1] + row;
        }
    }
    let mut out = vec![0.0f32; rw * rh];
    for y in 0..rh {
        let (y0, y1) = (y.saturating_sub(r), (y + r + 1).min(rh));
        for x in 0..rw {
            let (x0, x1) = (x.saturating_sub(r), (x + r + 1).min(rw));
            let s = sum[y1 * (rw + 1) + x1] - sum[y0 * (rw + 1) + x1] - sum[y1 * (rw + 1) + x0] + sum[y0 * (rw + 1) + x0];
            out[y * rw + x] = (s / ((x1 - x0) * (y1 - y0)) as f64) as f32;
        }
    }
    out
}

/// The picture with each face touched up. Each change stays inside its own part of the face (skin, the eyes, the
/// teeth), fading out at the edges, so nothing else in the picture moves.
pub fn tones(w: usize, h: usize, rgba: &[u8], faces: &[Face], t: Tones) -> Vec<u8> {
    let mut out = rgba.to_vec();
    for f in faces {
        let fw = f.rect[2];
        let [eye_a, eye_b, _nose, mouth_a, mouth_b] = f.landmarks;
        let eyes = dist(eye_a, eye_b).max(fw * 0.25);
        if t.smooth > 0.0 {
            smooth_skin(w, h, &mut out, f, t.smooth);
        }
        if t.eyes > 0.0 {
            for c in [eye_a, eye_b] {
                brighten_eye(w, h, &mut out, c, [eyes * 0.2, eyes * 0.1], t.eyes);
            }
        }
        if t.teeth > 0.0 {
            let mw = dist(mouth_a, mouth_b).max(fw * 0.2);
            let c = [(mouth_a[0] + mouth_b[0]) / 2.0, (mouth_a[1] + mouth_b[1]) / 2.0];
            whiten_teeth(w, h, &mut out, c, [mw * 0.45, mw * 0.2], t.teeth); // a band along the lips: teeth show only between them
        }
    }
    out
}

/// Skin: a self-guided filter per channel (it flattens blotches but keeps edges such as the nose and jaw), mixed in
/// where the face's skin is, with a little of the finest texture put back so it doesn't look plastic.
fn smooth_skin(w: usize, h: usize, px: &mut [u8], f: &Face, amount: f32) {
    let [fx, fy, fw, fh] = f.rect;
    let c = [fx + fw / 2.0, fy + fh * 0.55];
    let r = [fw * 0.62, fh * 0.72];
    let (x0, y0, x1, y1) = region(w, h, c, r);
    let (rw, rh) = (x1 - x0, y1 - y0);
    if rw < 4 || rh < 4 {
        return;
    }
    let [eye_a, eye_b, _, mouth_a, mouth_b] = f.landmarks;
    let eyes = dist(eye_a, eye_b).max(fw * 0.25);
    let mouth = [(mouth_a[0] + mouth_b[0]) / 2.0, (mouth_a[1] + mouth_b[1]) / 2.0];
    let mw = dist(mouth_a, mouth_b).max(fw * 0.2);
    let radius = ((fw / 20.0).round() as usize).clamp(2, 60);
    let eps = 0.008f32; // blotches vary less than this; the nose and jaw edges more
    let src: Vec<f32> = (0..rw * rh * 4).map(|n| px[((y0 + n / 4 / rw) * w + x0 + n / 4 % rw) * 4 + n % 4] as f32 / 255.0).collect();
    let at = |x: usize, y: usize, k: usize| src[(y * rw + x) * 4 + k];

    // Where the skin is: skin-coloured, inside the face, not the eyes, brows or mouth; softened so it has no edge.
    let mut mask = vec![0.0f32; rw * rh];
    for y in 0..rh {
        for x in 0..rw {
            let (r8, g8, b8) = (at(x, y, 0) * 255.0, at(x, y, 1) * 255.0, at(x, y, 2) * 255.0);
            let (mx, mn) = (r8.max(g8).max(b8), r8.min(g8).min(b8));
            let skin = r8 > 95.0 && g8 > 40.0 && b8 > 20.0 && mx - mn > 15.0 && (r8 - g8).abs() > 15.0 && r8 > g8 && r8 > b8;
            if !skin {
                continue;
            }
            let (sx, sy) = ((x0 + x) as f32, (y0 + y) as f32);
            let features = [eye_a, eye_b]
                .iter()
                .map(|e| ellipse(sx, sy, [e[0], e[1] - eyes * 0.08], [eyes * 0.38, eyes * 0.3]))
                .fold(ellipse(sx, sy, mouth, [mw * 0.62, mw * 0.36]), f32::max);
            mask[y * rw + x] = ellipse(sx, sy, c, r) * (1.0 - features);
        }
    }
    let mask = box_mean(&mask, rw, rh, radius);

    for k in 0..3 {
        let i: Vec<f32> = (0..rw * rh).map(|n| at(n % rw, n / rw, k)).collect();
        let ii: Vec<f32> = i.iter().map(|v| v * v).collect();
        let (mean, mean2) = (box_mean(&i, rw, rh, radius), box_mean(&ii, rw, rh, radius));
        let a: Vec<f32> = mean.iter().zip(&mean2).map(|(m, m2)| { let var = (m2 - m * m).max(0.0); var / (var + eps) }).collect();
        let b: Vec<f32> = mean.iter().zip(&a).map(|(m, a)| m * (1.0 - a)).collect();
        let (ma, mb) = (box_mean(&a, rw, rh, radius), box_mean(&b, rw, rh, radius));
        let fine = box_mean(&i, rw, rh, (radius / 5).max(1)); // pores and fine lines are smaller than this; blotches bigger
        for n in 0..rw * rh {
            let m = mask[n] * amount * 0.9;
            if m <= 0.0 {
                continue;
            }
            let smooth = ma[n] * i[n] + mb[n] + (i[n] - fine[n]) * 0.7;
            let v = i[n] + (smooth - i[n]) * m;
            px[((y0 + n / rw) * w + x0 + n % rw) * 4 + k] = (v.clamp(0.0, 1.0) * 255.0).round() as u8;
        }
    }
}

/// An eye: the midtones lifted and a touch of clarity, so the whites and the iris catch the light.
fn brighten_eye(w: usize, h: usize, px: &mut [u8], c: [f32; 2], r: [f32; 2], amount: f32) {
    let (x0, y0, x1, y1) = region(w, h, c, r);
    let (rw, rh) = (x1 - x0, y1 - y0);
    if rw < 2 || rh < 2 {
        return;
    }
    let src: Vec<f32> = (0..rw * rh * 4).map(|n| px[((y0 + n / 4 / rw) * w + x0 + n / 4 % rw) * 4 + n % 4] as f32 / 255.0).collect();
    for k in 0..3 {
        let ch: Vec<f32> = (0..rw * rh).map(|n| src[n * 4 + k]).collect();
        let blur = box_mean(&ch, rw, rh, ((r[1] / 6.0) as usize).max(1));
        for n in 0..rw * rh {
            let m = ellipse((x0 + n % rw) as f32, (y0 + n / rw) as f32, c, r) * amount;
            if m <= 0.0 {
                continue;
            }
            let v = ch[n];
            let lifted = v + 0.3 * v * (1.0 - v) + 0.4 * (v - blur[n]);
            px[((y0 + n / rw) * w + x0 + n % rw) * 4 + k] = ((v + (lifted - v) * m).clamp(0.0, 1.0) * 255.0).round() as u8;
        }
    }
}

/// Teeth: bright, not very colourful pixels around the mouth lose their yellow and lift a little. Lips are red and
/// the inside of the mouth is dark, so both are left as they are.
fn whiten_teeth(w: usize, h: usize, px: &mut [u8], c: [f32; 2], r: [f32; 2], amount: f32) {
    let (x0, y0, x1, y1) = region(w, h, c, r);
    for y in y0..y1 {
        for x in x0..x1 {
            let m = ellipse(x as f32, y as f32, c, r);
            if m <= 0.0 {
                continue;
            }
            let i = (y * w + x) * 4;
            let [r8, g8, b8] = [px[i], px[i + 1], px[i + 2]].map(|v| v as f32 / 255.0);
            let (mx, mn) = (r8.max(g8).max(b8), r8.min(g8).min(b8));
            if mx <= 0.0 {
                continue;
            }
            let (sat, red) = ((mx - mn) / mx, (r8 - g8) / mx);
            let teeth = smoothstep(0.3, 0.5, mx) * (1.0 - smoothstep(0.3, 0.5, sat)) * (1.0 - smoothstep(0.12, 0.25, red));
            let k = m * teeth * amount;
            if k <= 0.0 {
                continue;
            }
            let grey = (r8 + g8 + b8) / 3.0;
            let lift = |v: f32| v + (1.0 - v) * 0.12 * k;
            let out = [r8, g8, b8].map(|v| lift(v + (grey - v) * 0.8 * k));
            for (n, v) in out.into_iter().enumerate() {
                px[i + n] = (v.clamp(0.0, 1.0) * 255.0).round() as u8;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn face() -> Face {
        Face { score: 0.9, rect: [20.0, 20.0, 60.0, 70.0], landmarks: [[38.0, 45.0], [62.0, 45.0], [50.0, 60.0], [40.0, 72.0], [60.0, 72.0]] }
    }

    #[test]
    fn a_flat_picture_has_no_faces_and_a_wrong_size_is_refused() {
        assert_eq!(find(32, 24, &vec![128; 32 * 24 * 4]), Ok(vec![]));
        assert!(find(4, 4, &[0; 12]).is_err());
    }

    #[test]
    fn specks_that_look_a_little_like_faces_are_left_out() {
        let at = |score, width| Face { score, rect: [0.0, 0.0, width, width], ..face() };
        let kept = likely(vec![at(0.93, 230.0), at(0.63, 23.0), at(0.51, 200.0), at(0.7, 80.0), at(0.85, 20.0)]);
        assert_eq!(kept.iter().map(|f| f.rect[2]).collect::<Vec<_>>(), [230.0, 80.0, 20.0]);
    }

    #[test]
    fn nothing_on_means_nothing_changes() {
        let px: Vec<u8> = (0..100 * 100 * 4).map(|i| (i * 7 % 251) as u8).collect();
        assert_eq!(tones(100, 100, &px, &[face()], Tones::default()), px);
    }

    #[test]
    fn skin_gets_smoother_inside_the_face_only() {
        // Skin-coloured blotches everywhere.
        let mut px = vec![0u8; 100 * 100 * 4];
        for (n, p) in px.chunks_mut(4).enumerate() {
            let grain = (((n % 100 / 4) * 31 + (n / 400) * 17) * 2654435761 % 41) as i32 - 20;
            p.copy_from_slice(&[(200 + grain) as u8, (150 + grain) as u8, (120 + grain) as u8, 255]);
        }
        let out = tones(100, 100, &px, &[face()], Tones { smooth: 1.0, ..Tones::default() });
        let spread = |img: &[u8], x0: usize, y0: usize| {
            let v: Vec<f32> = (0..8).flat_map(|y| (0..8).map(move |x| ((y0 + y) * 100 + x0 + x) * 4)).map(|i| img[i] as f32).collect();
            let m = v.iter().sum::<f32>() / v.len() as f32;
            (v.iter().map(|x| (x - m).powi(2)).sum::<f32>() / v.len() as f32).sqrt()
        };
        assert!(spread(&out, 34, 80) < spread(&px, 34, 80) * 0.7, "a cheek is smoother: {} → {}", spread(&px, 34, 80), spread(&out, 34, 80));
        assert_eq!(spread(&out, 0, 0), spread(&px, 0, 0), "a corner far from the face is untouched");
    }

    #[test]
    fn teeth_lose_their_yellow_but_lips_stay_red() {
        let mut px = vec![0u8; 100 * 100 * 4];
        for (n, p) in px.chunks_mut(4).enumerate() {
            let y = n / 100;
            p.copy_from_slice(&if y < 72 { [235, 220, 170, 255] } else { [190, 60, 70, 255] });
        }
        let out = tones(100, 100, &px, &[face()], Tones { teeth: 1.0, ..Tones::default() });
        let at = |img: &[u8], x: usize, y: usize| { let i = (y * 100 + x) * 4; [img[i] as i32, img[i + 1] as i32, img[i + 2] as i32] };
        let (before, after) = (at(&px, 50, 70), at(&out, 50, 70));
        assert!(after[0] - after[2] < (before[0] - before[2]) / 2, "less yellow: {before:?} → {after:?}");
        assert_eq!(at(&out, 50, 75), at(&px, 50, 75), "lips untouched");
    }

    #[test]
    fn eyes_get_brighter() {
        let px: Vec<u8> = (0..100 * 100).flat_map(|_| [110, 100, 95, 255]).collect();
        let out = tones(100, 100, &px, &[face()], Tones { eyes: 1.0, ..Tones::default() });
        let i = (45 * 100 + 38) * 4;
        assert!(out[i] > px[i] + 15, "{} → {}", px[i], out[i]);
        assert_eq!(out[(5 * 100 + 5) * 4], px[(5 * 100 + 5) * 4]);
    }
}
