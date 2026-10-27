//! Straighten in Create's Edit photo: four corners dragged onto something photographed at an angle
//! (a worksheet, a poster, a whiteboard) are pulled out to a flat rectangle, as if photographed
//! from straight in front.

use rayon::prelude::*;

/// The largest picture Straighten will make, in pixels.
const MAX_PIXELS: f64 = 48_000_000.0;

/// The projective map from the unit square to a quad, after Heckbert's "Fundamentals of Texture
/// Mapping": (u, v) in 0–1 goes to the point at that place inside `q` (top left, top right,
/// bottom right, bottom left).
struct SquareToQuad([f64; 8]);

impl SquareToQuad {
    fn new(q: [[f64; 2]; 4]) -> Option<SquareToQuad> {
        let [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
        let (sx, sy) = (x0 - x1 + x2 - x3, y0 - y1 + y2 - y3);
        let (dx1, dx2, dy1, dy2) = (x1 - x2, x3 - x2, y1 - y2, y3 - y2);
        let det = dx1 * dy2 - dx2 * dy1;
        if det.abs() < 1e-12 {
            return None;
        }
        let g = (sx * dy2 - dx2 * sy) / det;
        let h = (dx1 * sy - sx * dy1) / det;
        Some(SquareToQuad([x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h]))
    }
    fn map(&self, u: f64, v: f64) -> [f64; 2] {
        let [a, b, c, d, e, f, g, h] = self.0;
        let z = g * u + h * v + 1.0;
        [(a * u + b * v + c) / z, (d * u + e * v + f) / z]
    }
}

/// Whether the corners, in order, go round a convex shape with some area.
fn convex(q: &[[f64; 2]; 4]) -> bool {
    let turn = |i: usize| {
        let (a, b, c) = (q[i], q[(i + 1) % 4], q[(i + 2) % 4]);
        (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
    };
    let turns = [turn(0), turn(1), turn(2), turn(3)];
    turns.iter().all(|t| *t > 1e-9) || turns.iter().all(|t| *t < -1e-9)
}

/// The flattened picture: `corners` are top left, top right, bottom right and bottom left as
/// 0–1 places in the `w` × `h` RGBA picture. The result is as wide as the longer of the top and
/// bottom edges and as tall as the longer side, so no detail is lost; the four corners may lie
/// outside the picture, and what they take in from outside it is see-through.
pub fn flatten(w: usize, h: usize, rgba: &[u8], corners: [[f64; 2]; 4]) -> Result<(usize, usize, Vec<u8>), String> {
    if corners.iter().flatten().any(|v| !v.is_finite() || v.abs() > 4.0) {
        return Err("the corners are off the picture".into());
    }
    let q = corners.map(|[x, y]| [x * w as f64, y * h as f64]);
    if !convex(&q) {
        return Err("the corners must go round the thing to straighten".into());
    }
    let len = |a: [f64; 2], b: [f64; 2]| (a[0] - b[0]).hypot(a[1] - b[1]);
    let (mut ow, mut oh) = (len(q[0], q[1]).max(len(q[3], q[2])), len(q[0], q[3]).max(len(q[1], q[2])));
    if ow < 4.0 || oh < 4.0 {
        return Err("the corners are too close together".into());
    }
    let k = (MAX_PIXELS / (ow * oh)).sqrt().min(1.0);
    (ow, oh) = (ow * k, oh * k);
    let (ow, oh) = (ow.round() as usize, oh.round() as usize);
    let map = SquareToQuad::new(q).ok_or("the corners must go round the thing to straighten")?;
    let mut out = vec![0u8; ow * oh * 4];
    out.par_chunks_mut(ow * 4).enumerate().for_each(|(y, row)| {
        let v = (y as f64 + 0.5) / oh as f64;
        for (x, px) in row.as_chunks_mut::<4>().0.iter_mut().enumerate() {
            let [sx, sy] = map.map((x as f64 + 0.5) / ow as f64, v);
            px.copy_from_slice(&sample(w, h, rgba, sx - 0.5, sy - 0.5));
        }
    });
    Ok((ow, oh, out))
}

/// Where the corners of the main thing in the picture are (top left, top right, bottom right, bottom
/// left, as 0–1 places), for Straighten's Find the edges: Cut out's subject finder picks out the page
/// or poster, and each corner is the point of it furthest that way. None when nothing stands out or
/// what does is too small to be a page.
pub fn find_corners(w: usize, h: usize, rgba: &[u8]) -> Result<Option<[[f64; 2]; 4]>, String> {
    let Some(region) = crate::cutout::select(w, h, rgba, &crate::cutout::Pick::Subject)? else { return Ok(None) };
    let (bw, x0, y0) = (region.bbox.width() as usize, region.bbox.x0 as f64, region.bbox.y0 as f64);
    // Furthest along each diagonal: smallest x + y is the top left, largest x − y the top right, and so on.
    let mut best = [(f64::MAX, [0.0; 2]), (f64::MIN, [0.0; 2]), (f64::MIN, [0.0; 2]), (f64::MAX, [0.0; 2])];
    let mut count = 0usize;
    for (i, &m) in region.mask.iter().enumerate() {
        if m < 128 {
            continue;
        }
        count += 1;
        let (x, y) = (x0 + (i % bw) as f64 + 0.5, y0 + (i / bw) as f64 + 0.5);
        let p = [x, y];
        if x + y < best[0].0 { best[0] = (x + y, p) }
        if x - y > best[1].0 { best[1] = (x - y, p) }
        if x + y > best[2].0 { best[2] = (x + y, p) }
        if x - y < best[3].0 { best[3] = (x - y, p) }
    }
    if (count as f64) < 0.04 * (w * h) as f64 {
        return Ok(None);
    }
    let corners = best.map(|(_, [x, y])| [x / w as f64, y / h as f64]);
    Ok(convex(&corners.map(|[x, y]| [x * w as f64, y * h as f64])).then_some(corners))
}

/// Bilinear sample at a pixel-centre place, premultiplied so see-through neighbours don't darken
/// the edge; outside the picture is see-through.
pub(crate) fn sample(w: usize, h: usize, rgba: &[u8], x: f64, y: f64) -> [u8; 4] {
    if x <= -1.0 || y <= -1.0 || x >= w as f64 || y >= h as f64 {
        return [0; 4];
    }
    let (x0, y0) = (x.floor(), y.floor());
    let (fx, fy) = (x - x0, y - y0);
    let mut acc = [0f64; 4];
    for (dy, wy) in [(0, 1.0 - fy), (1, fy)] {
        for (dx, wx) in [(0, 1.0 - fx), (1, fx)] {
            let (px, py) = (x0 as i64 + dx, y0 as i64 + dy);
            let k = wx * wy;
            if k == 0.0 || px < 0 || py < 0 || px >= w as i64 || py >= h as i64 {
                continue;
            }
            let i = (py as usize * w + px as usize) * 4;
            let a = rgba[i + 3] as f64 / 255.0;
            for c in 0..3 {
                acc[c] += rgba[i + c] as f64 * a * k;
            }
            acc[3] += a * k;
        }
    }
    if acc[3] <= 1e-6 {
        return [0; 4];
    }
    let rgb = |c: usize| (acc[c] / acc[3]).round().clamp(0.0, 255.0) as u8;
    [rgb(0), rgb(1), rgb(2), (acc[3] * 255.0).round().clamp(0.0, 255.0) as u8]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 200 × 150 picture: grey, with a white sheet photographed at an angle (a quad) and a red
    /// dot near the sheet's top left corner.
    fn tilted() -> (usize, usize, Vec<u8>, [[f64; 2]; 4]) {
        let (w, h) = (200, 150);
        let q = [[40.0, 20.0], [170.0, 35.0], [160.0, 130.0], [30.0, 120.0]];
        let map = SquareToQuad::new(q).unwrap();
        let mut px = vec![0u8; w * h * 4];
        for y in 0..h {
            for x in 0..w {
                px[(y * w + x) * 4..][..4].copy_from_slice(&[90, 90, 90, 255]);
            }
        }
        // Paint the sheet by mapping a fine grid of its own places into the picture.
        for j in 0..=600 {
            for i in 0..=600 {
                let (u, v) = (i as f64 / 600.0, j as f64 / 600.0);
                let [x, y] = map.map(u, v);
                let colour = if (u - 0.1).hypot(v - 0.1) < 0.05 { [220, 20, 20, 255] } else { [250, 250, 250, 255] };
                px[(y as usize * w + x as usize) * 4..][..4].copy_from_slice(&colour);
            }
        }
        (w, h, px, q.map(|[x, y]| [x / w as f64, y / h as f64]))
    }

    #[test]
    fn corners_are_mapped_to_the_corners() {
        let map = SquareToQuad::new([[10.0, 5.0], [90.0, 12.0], [80.0, 70.0], [3.0, 60.0]]).unwrap();
        for ((u, v), want) in [((0.0, 0.0), [10.0, 5.0]), ((1.0, 0.0), [90.0, 12.0]), ((1.0, 1.0), [80.0, 70.0]), ((0.0, 1.0), [3.0, 60.0])] {
            let got = map.map(u, v);
            assert!((got[0] - want[0]).abs() < 1e-9 && (got[1] - want[1]).abs() < 1e-9, "{u},{v} → {got:?}");
        }
    }

    #[test]
    fn a_tilted_sheet_comes_out_flat() {
        let (w, h, px, corners) = tilted();
        let (ow, oh, out) = flatten(w, h, &px, corners).unwrap();
        assert!((125..=140).contains(&ow) && (95..=110).contains(&oh), "{ow} × {oh}");
        let at = |u: f64, v: f64| {
            let i = ((v * oh as f64) as usize * ow + (u * ow as f64) as usize) * 4;
            [out[i], out[i + 1], out[i + 2], out[i + 3]]
        };
        assert_eq!(at(0.1, 0.1)[..3], [220, 20, 20], "the dot is where it was on the sheet");
        for (u, v) in [(0.5, 0.5), (0.03, 0.97), (0.97, 0.03), (0.9, 0.9)] {
            assert!(at(u, v)[0] > 230 && at(u, v)[2] > 230, "sheet at {u},{v}: {:?}", at(u, v));
        }
    }

    #[test]
    fn whole_picture_is_left_alone() {
        let (w, h, px, _) = tilted();
        let (ow, oh, out) = flatten(w, h, &px, [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]).unwrap();
        assert_eq!((ow, oh), (w, h));
        assert_eq!(out, px);
    }

    #[test]
    fn outside_the_picture_is_see_through() {
        let (w, h, px, _) = tilted();
        let (ow, _, out) = flatten(w, h, &px, [[-0.5, 0.0], [1.0, 0.0], [1.0, 1.0], [-0.5, 1.0]]).unwrap();
        assert_eq!(out[3], 0, "left of the picture");
        assert_eq!(out[(ow - 1) * 4 + 3], 255);
    }

    #[test]
    fn find_the_edges_finds_the_sheet() {
        let (w, h, px, want) = tilted();
        let got = find_corners(w, h, &px).unwrap().expect("a sheet is found");
        for (g, c) in got.iter().zip(want.iter()) {
            assert!((g[0] - c[0]).abs() < 0.04 && (g[1] - c[1]).abs() < 0.04, "{got:?} vs {want:?}");
        }
    }

    #[test]
    fn find_the_edges_finds_nothing_in_a_plain_picture() {
        let (w, h) = (120, 80);
        assert_eq!(find_corners(w, h, &vec![128u8; w * h * 4]).unwrap(), None);
    }

    #[test]
    fn bad_corners_are_refused() {
        let (w, h, px, _) = tilted();
        for corners in [
            [[0.0, 0.0], [1.0, 1.0], [1.0, 0.0], [0.0, 1.0]], // crossed
            [[0.5, 0.5], [0.51, 0.5], [0.51, 0.51], [0.5, 0.51]], // tiny
            [[0.0, 0.0], [f64::NAN, 0.0], [1.0, 1.0], [0.0, 1.0]],
            [[0.0, 0.0], [0.5, 0.0], [1.0, 0.0], [0.0, 1.0]], // three in a line
        ] {
            assert!(flatten(w, h, &px, corners).is_err(), "{corners:?}");
        }
    }
}
