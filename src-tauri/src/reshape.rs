//! Reshape in Create's Edit photo: the Push, Grow and Shrink brushes build a displacement field in
//! JavaScript (a grid saying, for each place in the new picture, how far away in the old picture its
//! colour comes from), and this warps the full-size picture through it once the stroke ends.

use rayon::prelude::*;

/// The largest field accepted, in grid points each way.
pub const MAX_GRID: usize = 1024;

/// A displacement field: `gw` × `gh` points spread evenly over the picture, corners on its corner
/// pixels, each holding (dx, dy) in picture pixels.
pub struct Field<'a> {
    pub gw: usize,
    pub gh: usize,
    pub d: &'a [f32],
}

impl Field<'_> {
    /// The field at a pixel, blended from the four grid points around it.
    fn at(&self, w: usize, h: usize, x: f64, y: f64) -> (f64, f64) {
        let gx = x * (self.gw - 1) as f64 / (w.max(2) - 1) as f64;
        let gy = y * (self.gh - 1) as f64 / (h.max(2) - 1) as f64;
        let (x0, y0) = (gx.floor().min((self.gw - 2) as f64), gy.floor().min((self.gh - 2) as f64));
        let (fx, fy) = (gx - x0, gy - y0);
        let (x0, y0) = (x0 as usize, y0 as usize);
        let point = |i: usize, j: usize| {
            let k = (j * self.gw + i) * 2;
            (self.d[k] as f64, self.d[k + 1] as f64)
        };
        let (a, b, c, d) = (point(x0, y0), point(x0 + 1, y0), point(x0, y0 + 1), point(x0 + 1, y0 + 1));
        let mix = |a: f64, b: f64, c: f64, d: f64| (a * (1.0 - fx) + b * fx) * (1.0 - fy) + (c * (1.0 - fx) + d * fx) * fy;
        (mix(a.0, b.0, c.0, d.0), mix(a.1, b.1, c.1, d.1))
    }
}

/// The `w` × `h` RGBA picture warped through `field`. Places pushed in from beyond the picture's
/// edge take its edge colour, so a push near the edge leaves no hole.
pub fn warp(w: usize, h: usize, rgba: &[u8], field: &Field) -> Result<Vec<u8>, String> {
    if field.gw < 2 || field.gh < 2 || field.gw > MAX_GRID || field.gh > MAX_GRID || field.d.len() != field.gw * field.gh * 2 {
        return Err("the reshape grid is the wrong size".into());
    }
    if field.d.iter().any(|v| !v.is_finite() || v.abs() > 4.0 * w.max(h) as f32) {
        return Err("the reshape grid is out of range".into());
    }
    let mut out = vec![0u8; w * h * 4];
    out.par_chunks_mut(w * 4).enumerate().for_each(|(y, row)| {
        for (x, px) in row.as_chunks_mut::<4>().0.iter_mut().enumerate() {
            let (dx, dy) = field.at(w, h, x as f64, y as f64);
            if dx == 0.0 && dy == 0.0 {
                px.copy_from_slice(&rgba[(y * w + x) * 4..][..4]);
                continue;
            }
            let (sx, sy) = ((x as f64 + dx).clamp(0.0, (w - 1) as f64), (y as f64 + dy).clamp(0.0, (h - 1) as f64));
            px.copy_from_slice(&crate::straighten::sample(w, h, rgba, sx, sy));
        }
    });
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 100 × 60 picture with a 2 px black vertical line at x = 40.
    fn lined() -> (usize, usize, Vec<u8>) {
        let (w, h) = (100, 60);
        let mut px = vec![255u8; w * h * 4];
        for y in 0..h {
            for x in 40..42 {
                px[(y * w + x) * 4..][..3].copy_from_slice(&[0, 0, 0]);
            }
        }
        (w, h, px)
    }
    fn dark(px: &[u8], w: usize, x: usize, y: usize) -> bool {
        px[(y * w + x) * 4] < 128
    }

    #[test]
    fn no_field_changes_nothing() {
        let (w, h, px) = lined();
        let d = vec![0.0; 11 * 7 * 2];
        assert_eq!(warp(w, h, &px, &Field { gw: 11, gh: 7, d: &d }).unwrap(), px);
    }

    #[test]
    fn a_steady_field_moves_the_picture() {
        let (w, h, px) = lined();
        // Every place takes its colour from 10 px to its left, so the line moves 10 px right.
        let d: Vec<f32> = (0..5 * 5).flat_map(|_| [-10.0, 0.0]).collect();
        let out = warp(w, h, &px, &Field { gw: 5, gh: 5, d: &d }).unwrap();
        assert!(dark(&out, w, 50, 30) && dark(&out, w, 51, 30) && !dark(&out, w, 40, 30), "the line moved");
        assert!(!dark(&out, w, 2, 30), "the left edge is filled from the edge colour, not left see-through");
        assert_eq!(out[(30 * w + 2) * 4 + 3], 255);
    }

    #[test]
    fn a_local_push_only_moves_the_middle() {
        let (w, h, px) = lined();
        // Grid points 10 px apart; only the middle row's points near the line push it right.
        let (gw, gh) = (11, 7);
        let mut d = vec![0.0f32; gw * gh * 2];
        for i in 3..=5 {
            d[(3 * gw + i) * 2] = -8.0;
        }
        let out = warp(w, h, &px, &Field { gw, gh, d: &d }).unwrap();
        assert!(dark(&out, w, 48, 30), "pushed at the middle");
        assert!(dark(&out, w, 40, 2) && dark(&out, w, 40, 58), "left alone at the top and bottom");
    }

    #[test]
    fn bad_fields_are_refused() {
        let (w, h, px) = lined();
        assert!(warp(w, h, &px, &Field { gw: 1, gh: 5, d: &[0.0; 10] }).is_err());
        assert!(warp(w, h, &px, &Field { gw: 3, gh: 3, d: &[0.0; 10] }).is_err());
        let mut d = vec![0.0f32; 18];
        d[4] = f32::NAN;
        assert!(warp(w, h, &px, &Field { gw: 3, gh: 3, d: &d }).is_err());
    }
}
