// KB Studio Develop: one WebGL2 shader turns a recipe into pixels, for the screen and for saved previews.
// The source is linear light as half floats from Rust (a RAW, or a JPEG linearised there), with any retouch
// strokes already applied. At the default recipe a JPEG renders as itself; a RAW gets a gentle base look so it
// starts close to what the camera would have made.

const SLIDERS = [
  { key: 'temp', label: 'Temperature', group: 'White balance', min: -100, max: 100, step: 1 },
  { key: 'tint', label: 'Tint', min: -100, max: 100, step: 1 },
  { key: 'exposure', label: 'Exposure', group: 'Light', min: -4, max: 4, step: 0.05 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1 },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100, step: 1 },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100, step: 1 },
  { key: 'whites', label: 'Whites', min: -100, max: 100, step: 1 },
  { key: 'blacks', label: 'Blacks', min: -100, max: 100, step: 1 },
  { key: 'vibrance', label: 'Vibrance', group: 'Colour', min: -100, max: 100, step: 1 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1 },
  { key: 'lookAmount', label: 'Strength', group: 'Look', min: 0, max: 100, step: 1, default: 100, unit: '%' },
  { key: 'split', label: 'Amount', group: 'Split toning', min: 0, max: 100, step: 1 },
  { key: 'splitShadow', label: 'Shadow colour', min: 0, max: 359, step: 1, default: 220, unit: '°', hue: true },
  { key: 'splitHighlight', label: 'Highlight colour', min: 0, max: 359, step: 1, default: 50, unit: '°', hue: true },
  { key: 'sharpen', label: 'Sharpen', group: 'Detail', min: 0, max: 100, step: 1 },
  { key: 'sharpenMask', label: 'Masking', min: 0, max: 100, step: 1, default: 25 },
  { key: 'nrColour', label: 'Colour noise', min: 0, max: 100, step: 1 },
  { key: 'nrLuma', label: 'Luminance noise', min: 0, max: 100, step: 1 },
  { key: 'vignette', label: 'Vignette', group: 'Finishing', min: -100, max: 100, step: 1 },
  { key: 'grain', label: 'Grain', min: 0, max: 100, step: 1 },
  { key: 'fade', label: 'Fade', min: 0, max: 100, step: 1 }
];
const RECIPE_VERSION = 6;
const DETAIL_EDGE = 3072; // main.rs DEVELOP_EDGE: Develop's source is averaged down by the whole factor ceil(long side / this), which is also Detail's scale at full size
const SETTINGS = [...SLIDERS.map(s => s.key), 'look']; // everything but retouch and crop: what copy, paste and presets carry

const detailScale = (w, h) => Math.ceil(Math.max(w, h) / DETAIL_EDGE);

// Looks: one grade each, faded in by the Strength slider. Every field is optional:
// mono turns it black and white (filter: how much red, green and blue make the grey),
// lift/gamma/gain are per channel (lift raises blacks, gamma above 1 darkens the middle, gain scales),
// contrast and sat (saturation, 1 = unchanged), shadows and highlights tint by [OkLab hue in degrees, amount],
// fade and grain add to the Finishing sliders (1 = slider at 100).
const LOOKS = [
  { id: 'bw', name: 'Neutral', group: 'Black & white', mono: 1 },
  { id: 'bw-contrast', name: 'High contrast', mono: 1, filter: [0.3, 0.6, 0.1], contrast: 0.5 },
  { id: 'bw-matte', name: 'Soft matte', mono: 1, contrast: -0.2, fade: 0.6 },
  { id: 'bw-film', name: 'Film grain', mono: 1, contrast: 0.25, grain: 0.5, fade: 0.15 },
  { id: 'sepia', name: 'Sepia', group: 'Toned', mono: 1, contrast: -0.05, shadows: [65, 0.05], highlights: [80, 0.04] },
  { id: 'warm-brown', name: 'Warm brown', mono: 1, shadows: [50, 0.075], highlights: [75, 0.035] },
  { id: 'selenium', name: 'Cool selenium', mono: 1, contrast: 0.1, shadows: [285, 0.035], highlights: [250, 0.01] },
  { id: 'warm-soft', name: 'Warm & soft', group: 'Colour', gain: [1.04, 1, 0.94], contrast: -0.15, sat: 0.95, fade: 0.2 },
  { id: 'bright-airy', name: 'Bright & airy', lift: [0.03, 0.03, 0.04], gamma: [0.82, 0.82, 0.8], contrast: -0.2, sat: 0.85 },
  { id: 'clean-contrast', name: 'Clean contrast', contrast: 0.3, sat: 1.08 },
  { id: 'moody', name: 'Moody & dark', gamma: [1.2, 1.2, 1.15], contrast: 0.2, sat: 0.75, shadows: [230, 0.02] },
  { id: 'golden-hour', name: 'Golden hour', gain: [1.08, 1, 0.86], contrast: 0.05, sat: 1.1, highlights: [70, 0.035] },
  { id: 'teal-orange', name: 'Cinematic (teal & orange)', contrast: 0.15, shadows: [215, 0.05], highlights: [60, 0.04] },
  { id: 'pastel', name: 'Pastel', lift: [0.05, 0.05, 0.06], gamma: [0.9, 0.9, 0.9], contrast: -0.25, sat: 0.65 },
  { id: 'vintage', name: 'Vintage faded film', lift: [0.03, 0.02, 0.05], gain: [1.03, 1, 0.9], contrast: -0.05, sat: 0.7, fade: 0.6, grain: 0.2 },
  { id: 'matte', name: 'Matte film', contrast: 0.1, sat: 0.9, fade: 0.8 },
  { id: 'portra', name: 'Warm portrait film', gain: [1.04, 1, 0.95], gamma: [0.96, 0.96, 0.96], contrast: -0.08, sat: 0.9, highlights: [70, 0.015], grain: 0.1 },
  { id: 'cross', name: 'Cross-process', gamma: [0.9, 0.95, 1.2], gain: [1.05, 1.05, 0.85], lift: [0, 0, 0.08], contrast: 0.25, sat: 1.2 }
];
const lookOf = id => LOOKS.find(l => l.id === id);

// Retouch strokes, as retouch.rs checks them: points 0–1 across the upright photo, size the brush radius
// over the long edge, offset (source minus destination) for the copying tools, strength (0–1, left out for all of it; soften always has one), and for soften `scaled` (its bands follow the brush; older strokes lack it).
const TOOLS = { spot: 'Spot heal', heal: 'Heal', clone: 'Clone', soften: 'Soften skin', redeye: 'Red eye', blur: 'Blur', dodge: 'Dodge', burn: 'Burn' };
const STROKE_LIMITS = { strokes: 500, points: 2000, minSize: 0.001, maxSize: 0.1 };
const unit = v => Number.isFinite(v) && v >= 0 && v <= 1;
const NO_SOURCE = { redeye: true, blur: true, dodge: true, burn: true }; // tools that copy nothing, so carry no offset
const validStroke = s => !!s && TOOLS[s.tool] && Number.isFinite(s.size) && s.size >= STROKE_LIMITS.minSize && s.size <= STROKE_LIMITS.maxSize
  && Array.isArray(s.points) && s.points.length >= 1 && s.points.length <= STROKE_LIMITS.points && s.points.every(p => Array.isArray(p) && p.length === 2 && p.every(unit))
  && (s.strength === undefined ? s.tool !== 'soften' : unit(s.strength))
  && (s.tool === 'soften' ? s.offset === undefined && (s.scaled === undefined || typeof s.scaled === 'boolean')
    : s.scaled === undefined && (NO_SOURCE[s.tool] ? s.offset === undefined : Array.isArray(s.offset) && s.offset.length === 2 && s.offset.every(v => Number.isFinite(v) && Math.abs(v) <= 1)));

// Crop: a rectangle (x, y, w, h, 0–1) of the straightened photo, which is the upright photo turned
// `angle` degrees clockwise about its centre (keeping its size), then cropped. Copied rather than shared
// between photos, so it stays out of SETTINGS.
const NO_CROP = { x: 0, y: 0, w: 1, h: 1, angle: 0 };
const MAX_ANGLE = 45;
const validCrop = c => !!c && ['x', 'y', 'w', 'h', 'angle'].every(k => Number.isFinite(c[k])) && c.x >= 0 && c.y >= 0 && c.w >= 0.001 && c.h >= 0.001
  && c.x + c.w <= 1 + 1e-9 && c.y + c.h <= 1 + 1e-9 && Math.abs(c.angle) <= MAX_ANGLE;
const sameCrop = (a, b) => ['x', 'y', 'w', 'h', 'angle'].every(k => a[k] === b[k]);

// A saved recipe with any missing setting at its default, and nothing it doesn't know.
const fullRecipe = (saved = {}) => ({
  ...Object.fromEntries(SLIDERS.map(s => [s.key, Number.isFinite(saved[s.key]) ? Math.min(s.max, Math.max(s.min, saved[s.key])) : s.default ?? 0])),
  look: lookOf(saved.look) ? saved.look : '',
  retouch: Array.isArray(saved.retouch) ? saved.retouch.filter(validStroke).slice(0, STROKE_LIMITS.strokes) : [],
  crop: validCrop(saved.crop) ? { x: saved.crop.x, y: saved.crop.y, w: saved.crop.w, h: saved.crop.h, angle: saved.crop.angle } : NO_CROP
});
const isDefault = recipe => SLIDERS.every(s => recipe[s.key] === (s.default ?? 0)) && !recipe.look && !recipe.retouch?.length && sameCrop(recipe.crop || NO_CROP, NO_CROP);
// A recipe's settings without its retouch strokes and crop, which belong to one photo.
const settingsOf = recipe => Object.fromEntries(SETTINGS.map(key => [key, fullRecipe(recipe)[key]]));

// White balance relative to as shot: warmer adds red and removes blue, positive tint removes green (magenta).
// Normalised so a neutral grey keeps its brightness. Exactly [1, 1, 1] at 0, 0.
function whiteBalance(temp, tint) {
  const t = temp / 100, g = tint / 100;
  const gains = [2 ** (0.5 * t), 2 ** (-0.35 * g), 2 ** (-0.5 * t)];
  const luma = 0.2126 * gains[0] + 0.7152 * gains[1] + 0.0722 * gains[2];
  return gains.map(v => v / luma);
}

// The crop as an affine map from output uv (0–1 across the cropped picture, top row 0) to source uv
// (0–1 across the upright photo), [a, b, e, c, d, f] for x' = a x + b y + e, y' = c x + d y + f.
// The turn is done in pixels, so a non-square photo isn't sheared.
function cropMap(crop, W, H) {
  const t = -crop.angle * Math.PI / 180, cos = Math.cos(t), sin = Math.sin(t);
  const px = [W * crop.w, W * (crop.x - 0.5)], py = [H * crop.h, H * (crop.y - 0.5)]; // straightened pixels from the centre
  return [cos * px[0] / W, -sin * py[0] / W, (cos * px[1] - sin * py[1]) / W + 0.5,
    sin * px[0] / H, cos * py[0] / H, (sin * px[1] + cos * py[1]) / H + 0.5];
}
const mapPoint = ([a, b, e, c, d, f], [x, y]) => [a * x + b * y + e, c * x + d * y + f];
const unmapPoint = ([a, b, e, c, d, f], [x, y]) => { const det = a * d - b * c, u = x - e, v = y - f; return [(d * u - b * v) / det, (a * v - c * u) / det]; };
// For the shader: column-major mat3.
const cropMatrix = (crop, W, H) => { const [a, b, e, c, d, f] = cropMap(crop, W, H); return new Float32Array([a, c, 0, b, d, 0, e, f, 1]); };

// Whether every corner of the crop lands on the photo (and inside the straightened frame).
const cropFits = (crop, W, H) => crop.x >= -1e-9 && crop.y >= -1e-9 && crop.x + crop.w <= 1 + 1e-9 && crop.y + crop.h <= 1 + 1e-9
  && [[0, 0], [1, 0], [0, 1], [1, 1]].every(p => mapPoint(cropMap(crop, W, H), p).every(v => v >= -1e-6 && v <= 1 + 1e-6));
// Shrink the crop about its centre, keeping its shape, until it fits (first moving the centre toward the
// photo's if the centre itself is off the photo).
function fitCrop(crop, W, H) {
  if (cropFits(crop, W, H)) return crop;
  const at = (c, k) => ({ ...c, x: c.x + c.w * (1 - k) / 2, y: c.y + c.h * (1 - k) / 2, w: c.w * k, h: c.h * k });
  // The boundary between fits(lo) true and fits(hi) false.
  const search = (fits, lo, hi) => { for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; } return lo; };
  let c = crop;
  if (!cropFits(at(c, 1e-6), W, H)) {
    const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
    const moved = t => ({ ...c, x: cx + (0.5 - cx) * t - c.w / 2, y: cy + (0.5 - cy) * t - c.h / 2 });
    c = moved(search(t => cropFits(at(moved(t), 1e-6), W, H), 1, 0));
  }
  return at(c, search(k => cropFits(at(c, k), W, H), 0, 1));
}

// Texture row 0 is the photo's top. On screen that's the top of the viewport; read back with
// readPixels (bottom row first) it must be at the bottom, hence u_flip.
// v_uv is across the cropped picture (for the vignette and grain), v_src where that is on the photo.
const VERTEX = `#version 300 es
in vec2 a_pos; out vec2 v_uv, v_src; uniform bool u_flip; uniform mat3 u_crop; uniform vec4 u_view; // u_view: the part of the picture drawn, x, y, width, height (0–1)
void main() { v_uv = u_view.xy + (vec2(a_pos.x, u_flip ? a_pos.y : -a_pos.y) * 0.5 + 0.5) * u_view.zw; v_src = (u_crop * vec3(v_uv, 1)).xy; gl_Position = vec4(a_pos, 0, 1); }`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform bool u_raw;
uniform vec3 u_wb;
uniform float u_exposure, u_contrast, u_highlights, u_shadows, u_whites, u_blacks, u_vibrance, u_saturation;
// The look, and the finishing that goes on any photo.
uniform float u_look, u_mono, u_lookContrast, u_lookSat, u_fade, u_grain, u_vignette;
uniform vec3 u_filter, u_lift, u_gamma, u_gain;
uniform float u_detailScale, u_sharpen, u_sharpenMask, u_nrColour, u_nrLuma;
uniform vec2 u_toneLo, u_toneHi, u_splitLo, u_splitHi, u_grainScale;
in vec2 v_uv, v_src; out vec4 color;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec3 toSrgb(vec3 x) { x = max(x, 0.0); return mix(12.92 * x, 1.055 * pow(x, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, x)); }
vec3 toLinear(vec3 x) { return mix(x / 12.92, pow((x + 0.055) / 1.055, vec3(2.4)), step(0.04045, x)); }

// Contrast as a power curve each side of a mid-grey pivot: keeps 0 and 1, steeper or flatter in between.
vec3 contrast(vec3 d, float a) {
  float g = exp2(a), p = 0.46;
  vec3 lo = p * pow(d / p, vec3(g)), hi = 1.0 - (1.0 - p) * pow((1.0 - d) / (1.0 - p), vec3(g));
  return mix(lo, hi, step(p, d));
}

// RAW base look: half a stop of baseline exposure (Canon's JPEGs are about that much brighter than
// the raw data), a soft shoulder that rolls highlights (kept above 1 by the decoder) into white
// instead of clipping them, without shifting their hue; then sRGB and some contrast.
vec3 baseLook(vec3 x) {
  x *= 1.41;
  float y = max(dot(x, LUMA), 1e-6), k = 0.75;
  float y2 = y < k ? y : k + (1.0 - k) * (1.0 - exp(-(y - k) / (1.0 - k)));
  x *= y2 / y;
  float top = max(x.r, max(x.g, x.b));
  if (top > 1.0) x = y2 + (x - y2) * (1.0 - y2) / (top - y2);
  return contrast(toSrgb(x), 0.4);
}

// OkLab (Björn Ottosson), for colour changes that keep brightness and hue steady.
vec3 oklab(vec3 c) {
  vec3 lms = mat3(0.4122214708, 0.2119034982, 0.0883024619, 0.5363325363, 0.6806995451, 0.2817188376, 0.0514459929, 0.1073969566, 0.6299787005) * c;
  lms = sign(lms) * pow(abs(lms), vec3(1.0 / 3.0));
  return mat3(0.2104542553, 1.9779984951, 0.0259040371, 0.7936177850, -2.4285922050, 0.7827717662, -0.0040720468, 0.4505937099, -0.8086757660) * lms;
}
vec3 fromOklab(vec3 lab) {
  vec3 lms = mat3(1.0, 1.0, 1.0, 0.3963377774, -0.1055613458, -0.0894841775, 0.2158037573, -0.0638541728, -1.2914855480) * lab;
  return mat3(4.0767416621, -1.2684380046, -0.0041960863, -3.3077115913, 2.6097574011, -0.7034186147, 0.2309699292, -0.3413193965, 1.7076147010) * (lms * lms * lms);
}

// Saturation and tinting in OkLab: shadows pushed toward one colour, highlights toward another,
// easing off at pure black and white so they stay clean.
vec3 grade(vec3 d, float sat, vec2 lo, vec2 hi) {
  vec3 lab = oklab(toLinear(d));
  float l = clamp(lab.x, 0.0, 1.0), ends = smoothstep(0.0, 0.15, l) * (1.0 - smoothstep(0.92, 1.0, l));
  lab.yz = lab.yz * sat + (lo * (1.0 - l) + hi * l) * ends;
  return toSrgb(clamp(fromOklab(lab), 0.0, 1.0));
}

// Film grain: smooth noise about 1.5 pixels across at 3000 px on the long edge, the same at any size.
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

// Detail, on source texels (linear light, before white balance and exposure). Kernels are sized for the
// Develop proxy (DETAIL_EDGE on the long side); a bigger source (full-size Deliver) scales them up by the factor Rust's downscale used, so the
// same recipe covers the same part of the photo on screen and in Deliver. Each stage is skipped at 0, so a photo without Detail renders as before.
// ponytail: at fit zoom and web-size Deliver the downscale hides most sharpening; output sharpening is deferred.
// A source texel's neighbourhood as Rust's proxy makes it: the average of the detailScale x detailScale block
// about uv, as bilinear fetches (each averages a pair of texels, weighted by the texels it carries so the block is
// exactly uniform). At most 3x3 fetches, so past scale 6 it thins out. Point taps spaced detailScale apart would
// miss noise at the source's own pitch, e.g. every other column.
// ponytail: an even scale puts the block half a texel off the pixel; not worth correcting.
float tapAt(int i, float f) {
  if (f > 6.0) return 1.0 - f * 0.5 + float(i) * (f - 2.0) * 0.5 + (mod(f, 2.0) == 0.0 ? 0.5 : 0.0);
  return -floor((f - 1.0) * 0.5) + 2.0 * float(i) + (float(i) < floor(f * 0.5) ? 0.5 : 0.0); // a pair's corner, or the odd texel
}
float tapWeight(int i, float f) { return f > 6.0 ? 1.0 / 3.0 : (float(i) < floor(f * 0.5) ? 2.0 : 1.0) / f; }
vec3 box(vec2 uv) {
  float f = u_detailScale;
  if (f < 1.5) return texture(u_src, uv).rgb;
  int k = min(int(ceil(f * 0.5)), 3);
  vec3 sum = vec3(0);
  for (int j = 0; j < k; j++) for (int i = 0; i < k; i++)
    sum += tapWeight(i, f) * tapWeight(j, f) * texture(u_src, uv + vec2(tapAt(i, f), tapAt(j, f)) / vec2(textureSize(u_src, 0))).rgb;
  return sum;
}
float yp(vec3 c) { return sqrt(max(dot(c, LUMA), 0.0)); }
vec3 detail(vec2 uv) {
  vec2 px = u_detailScale / vec2(textureSize(u_src, 0));
  vec3 c = texture(u_src, uv).rgb;
  // Colour noise: average chroma (colour minus luma) over two rings of taps, each weighted down by its luma difference.
  if (u_nrColour > 0.0) {
    float y0 = dot(c, LUMA), p0 = yp(c), r = 1.0 + u_nrColour * 5.0;
    vec3 sum = c - y0; float w = 1.0;
    for (int i = 0; i < 16; i++) {
      float a = float(i) * 0.7853982 + (i < 8 ? 0.0 : 0.3927), rr = i < 8 ? r : r * 0.5;
      vec3 t = box(uv + vec2(cos(a), sin(a)) * rr * px);
      float d = (yp(t) - p0) / 0.1, k = exp(-d * d);
      sum += (t - dot(t, LUMA)) * k; w += k;
    }
    c = max(y0 + sum / w, 0.0);
  }
  // Luminance noise and sharpen share one window of perceptual luma (7x7, or 3x3 with sharpen alone), so sharpen
  // works on the denoised neighbourhood instead of putting the noise back: each of the 3x3 values it needs is
  // a 5x5 bilateral of that window (range sigma from the slider), and the result is one gain on c clamped to 0.5-2.
  if (u_nrLuma > 0.0 || u_sharpen > 0.0) {
    int n = u_nrLuma > 0.0 ? 3 : 1, m = u_sharpen > 0.0 ? 1 : 0;
    float W[49], v[9];
    for (int j = -n; j <= n; j++) for (int i = -n; i <= n; i++) W[(j + 3) * 7 + i + 3] = yp(box(uv + vec2(i, j) * px));
    float s = 0.01 + u_nrLuma * 0.12;
    for (int j = -m; j <= m; j++) for (int i = -m; i <= m; i++) {
      float q0 = W[(j + 3) * 7 + i + 3];
      if (u_nrLuma > 0.0) {
        float sum = 0.0, w = 0.0;
        for (int b = -2; b <= 2; b++) for (int a = -2; a <= 2; a++) {
          float q = W[(j + b + 3) * 7 + i + a + 3], d = (q - q0) / s, k = exp(-d * d - 0.125 * float(a * a + b * b));
          sum += q * k; w += k;
        }
        q0 = sum / w;
      }
      v[(j + 1) * 3 + i + 1] = q0;
    }
    float p0 = yp(c), base = u_nrLuma > 0.0 ? v[4] : p0; // without noise reduction keep the texel's own fine detail
    float target = base;
    // Sharpen: unsharp mask (3x3 Gaussian), only where the edge is strong enough for Masking.
    if (u_sharpen > 0.0) {
      float blur = 0.0;
      for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) blur += v[j * 3 + i] * ((i == 1 ? 2.0 : 1.0) * (j == 1 ? 2.0 : 1.0) / 16.0);
      float gx = (v[2] + 2.0 * v[5] + v[8]) - (v[0] + 2.0 * v[3] + v[6]), gy = (v[6] + 2.0 * v[7] + v[8]) - (v[0] + 2.0 * v[1] + v[2]);
      float t = u_sharpenMask * 0.2, mask = u_sharpenMask > 0.0 ? smoothstep(t, t + 0.05, length(vec2(gx, gy)) / 4.0) : 1.0;
      target = max(base + (v[4] - blur) * u_sharpen * 3.0 * mask, 0.0);
    }
    float g = (target + 0.01) / (p0 + 0.01);
    c *= clamp(g * g, 0.5, 2.0);
  }
  return c;
}

void main() {
  // Off the photo (the corners of a turned photo while cropping): the editor's background.
  vec2 margin = 0.5 / vec2(textureSize(u_src, 0));
  if (any(lessThan(v_src, -margin)) || any(greaterThan(v_src, 1.0 + margin))) { color = vec4(0.043, 0.047, 0.063, 1); return; }
  vec3 c = detail(v_src) * u_wb * u_exposure;
  vec3 d = clamp(u_raw ? baseLook(c) : toSrgb(c), 0.0, 1.0);
  // Tone, on display values. Each term is zero at 0 and keeps the curve rising.
  if (u_contrast != 0.0) d = contrast(d, u_contrast);
  d += u_highlights * (u_highlights < 0.0 ? 3.0 : 1.0) * d * d * d * (1.0 - d);
  d += u_shadows * (u_shadows > 0.0 ? 3.0 : 1.0) * d * pow(1.0 - d, vec3(3.0));
  d += u_whites * 0.25 * d * d;
  d += u_blacks * 0.15 * (1.0 - d) * (1.0 - d);
  d = clamp(d, 0.0, 1.0);
  if (u_vibrance != 0.0 || u_saturation != 0.0) {
    vec3 lab = oklab(toLinear(d));
    float chroma = length(lab.yz), hue = atan(lab.z, lab.y);
    // Vibrance lifts muted colours most and goes easy on skin (OkLab hue about 1 radian).
    float skin = u_vibrance > 0.0 ? 1.0 - 0.6 * exp(-pow((hue - 1.0) / 0.4, 2.0)) : 1.0;
    lab.yz *= (1.0 + u_saturation) * (1.0 + u_vibrance * (1.0 - smoothstep(0.0, 0.25, chroma)) * skin);
    d = toSrgb(clamp(fromOklab(lab), 0.0, 1.0));
  }
  if (u_look > 0.0) {
    vec3 o = d;
    if (u_mono > 0.0) d = vec3(dot(d, u_filter));
    d = pow(clamp(d * u_gain + u_lift * (1.0 - d), 0.0, 1.0), u_gamma);
    if (u_lookContrast != 0.0) d = contrast(d, u_lookContrast);
    d = grade(d, u_lookSat, u_toneLo, u_toneHi);
    d = mix(o, d, u_look);
  }
  if (u_splitLo != vec2(0) || u_splitHi != vec2(0)) d = grade(d, 1.0, u_splitLo, u_splitHi);
  // Fade lifts the blacks and dims the whites a little, like a faded print.
  d = u_fade * 0.15 + d * (1.0 - u_fade * 0.2);
  if (u_vignette != 0.0) {
    float edge = smoothstep(0.3, 1.0, length(v_uv - 0.5) * 1.4142);
    d = u_vignette < 0.0 ? d * (1.0 + 0.8 * u_vignette * edge) : mix(d, vec3(1), 0.8 * u_vignette * edge);
  }
  if (u_grain > 0.0) {
    float n = noise(v_uv * u_grainScale / 1.5) + noise(v_uv * u_grainScale / 0.8 + 17.0) - 1.0;
    d += n * u_grain * 0.12 * (0.3 + 2.8 * d * (1.0 - d));
  }
  color = vec4(clamp(d, 0.0, 1.0), 1.0);
}`;

class Developer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = this.gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw Error('this computer\'s graphics can\'t run the editor (no WebGL2)');
    const shader = (type, source) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
      return s;
    };
    const program = this.program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    this.uniform = name => gl.getUniformLocation(program, name);
    this.texture = gl.createTexture();
    this.width = this.height = 0;
    this.crop = NO_CROP; // what the screen shows; saved looks use their recipe's own
    this.clear();
  }

  // Draw nothing until the next photo's pixels arrive (the texture keeps the last one for saving its look).
  clear() { this.blank = true; this.fit(); }

  // Zoom: null fits the photo; a number is device pixels per photo pixel. cx, cy: the photo point (0–1) at the centre.
  fit() { this.view = { zoom: null, cx: 0.5, cy: 0.5 }; }

  #upload(setup) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    setup(gl);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  }

  // `bytes`: the develop_source layout, width and height as u32s then linear RGB half floats.
  // `raw` picks the RAW base look; a JPEG's pixels are shown as they are.
  setRaw(bytes, raw = true) {
    const [w, h] = new Uint32Array(bytes, 0, 2);
    this.#upload(gl => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB16F, w, h, 0, gl.RGB, gl.HALF_FLOAT, new Uint16Array(bytes, 8, w * h * 3)));
    Object.assign(this, { width: w, height: h, raw, blank: false, revision: (this.revision || 0) + 1 });
    this.fit();
  }

  // `bytes`: the retouch layout, a rectangle's x, y, width and height as u32s then its half floats.
  patch(bytes) {
    const [x, y, w, h] = new Uint32Array(bytes, 0, 4), gl = this.gl;
    if (!w || !h) return;
    this.revision++;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RGB, gl.HALF_FLOAT, new Uint16Array(bytes, 16, w * h * 3));
  }

  // The cropped picture's size in photo pixels.
  size(crop = this.crop) { return [crop.w * this.width, crop.h * this.height]; }

  #draw(recipe, flip, crop, view = [0, 0, 1, 1]) {
    const gl = this.gl, r = fullRecipe(recipe), u = this.uniform, [fw, fh] = this.size(crop);
    gl.uniform1i(u('u_raw'), this.raw ? 1 : 0);
    gl.uniform1i(u('u_flip'), flip ? 1 : 0);
    gl.uniform4fv(u('u_view'), view);
    gl.uniformMatrix3fv(u('u_crop'), false, cropMatrix(crop, this.width, this.height));
    gl.uniform2f(u('u_grainScale'), 3000 * fw / Math.max(fw, fh), 3000 * fh / Math.max(fw, fh));
    gl.uniform3fv(u('u_wb'), whiteBalance(r.temp, r.tint));
    gl.uniform1f(u('u_exposure'), 2 ** r.exposure);
    for (const key of ['contrast', 'highlights', 'shadows', 'whites', 'blacks', 'vibrance', 'saturation', 'vignette']) gl.uniform1f(u('u_' + key), r[key] / 100);
    const look = lookOf(r.look) || {}, amount = look.id ? r.lookAmount / 100 : 0;
    const tint = ([hue, amount] = [0, 0], k = 1) => [k * amount * Math.cos(hue * Math.PI / 180), k * amount * Math.sin(hue * Math.PI / 180)];
    gl.uniform1f(u('u_look'), amount);
    gl.uniform1f(u('u_mono'), look.mono || 0);
    gl.uniform3fv(u('u_filter'), look.filter || [0.2126, 0.7152, 0.0722]);
    gl.uniform3fv(u('u_lift'), look.lift || [0, 0, 0]);
    gl.uniform3fv(u('u_gamma'), look.gamma || [1, 1, 1]);
    gl.uniform3fv(u('u_gain'), look.gain || [1, 1, 1]);
    gl.uniform1f(u('u_lookContrast'), look.contrast || 0);
    gl.uniform1f(u('u_lookSat'), look.sat ?? 1);
    gl.uniform2fv(u('u_toneLo'), tint(look.shadows));
    gl.uniform2fv(u('u_toneHi'), tint(look.highlights));
    gl.uniform2fv(u('u_splitLo'), tint([r.splitShadow, 0.08], r.split / 100));
    gl.uniform2fv(u('u_splitHi'), tint([r.splitHighlight, 0.08], r.split / 100));
    gl.uniform1f(u('u_detailScale'), detailScale(this.width, this.height));
    for (const key of ['sharpen', 'sharpenMask', 'nrColour', 'nrLuma']) gl.uniform1f(u('u_' + key), r[key] / 100);
    gl.uniform1f(u('u_fade'), Math.min(1, (look.fade || 0) * amount + r.fade / 100));
    gl.uniform1f(u('u_grain'), Math.min(1, (look.grain || 0) * amount + r.grain / 100));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // Where the cropped picture sits on the canvas in CSS pixels ({ x, y, w, h }, and `scale` in CSS pixels
  // per photo pixel), fitted or zoomed and panned.
  placement() {
    const box = this.canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, v = this.view;
    if (!this.width || this.blank) return null;
    const [fw, fh] = this.size(), fit = Math.min(box.width / fw, box.height / fh);
    const scale = v.zoom ? Math.max(fit, v.zoom / dpr) : fit, w = fw * scale, h = fh * scale;
    // Zoomed in, keep the photo covering the view where it can.
    const centre = (c0, size, box) => size <= box ? 0.5 : Math.min(1 - box / 2 / size, Math.max(box / 2 / size, c0));
    if (v.zoom) { v.cx = centre(v.cx, w, box.width); v.cy = centre(v.cy, h, box.height); }
    return { x: box.width / 2 - v.cx * w, y: box.height / 2 - v.cy * h, w, h, scale };
  }

  // A point on screen as 0–1 across and down the cropped picture shown.
  toView(clientX, clientY) {
    const p = this.placement(), box = this.canvas.getBoundingClientRect();
    return p ? [(clientX - box.left - p.x) / p.w, (clientY - box.top - p.y) / p.h] : null;
  }
  // And back, relative to the canvas's top left in CSS pixels.
  fromView([x, y]) { const p = this.placement(); return p && [p.x + x * p.w, p.y + y * p.h]; }

  // A point on screen as photo coordinates, 0–1 across and down the upright photo (outside it is <0 or >1).
  toImage(clientX, clientY) { const v = this.toView(clientX, clientY); return v && mapPoint(cropMap(this.crop, this.width, this.height), v); }
  fromImage(at) { return this.fromView(unmapPoint(cropMap(this.crop, this.width, this.height), at)); }

  // Device pixels per photo pixel now, and the most it can be (1600%).
  static ZOOM_MAX = 16;
  percent() { const p = this.placement(); return p ? Math.round(p.scale * (window.devicePixelRatio || 1) * 100) : 0; }

  // Zoom to `z` device pixels per photo pixel, keeping the point under the pointer still. At or below the fitted size it fits.
  zoomTo(z, clientX, clientY) {
    const at = this.toView(clientX, clientY), box = this.canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (!at) return;
    const [fw, fh] = this.size(), fit = Math.min(box.width / fw, box.height / fh) * dpr;
    z = Math.min(Developer.ZOOM_MAX, z);
    if (z <= fit * 1.001) return this.fit();
    const w = fw * z / dpr, h = fh * z / dpr;
    this.view = { zoom: z, cx: at[0] + (box.width / 2 - (clientX - box.left)) / w, cy: at[1] + (box.height / 2 - (clientY - box.top)) / h };
  }
  zoomBy(clientX, clientY, factor) { const p = this.placement(); if (p) this.zoomTo(p.scale * (window.devicePixelRatio || 1) * factor, clientX, clientY); }

  // Z: between fitting the photo and 100% (one photo pixel per screen pixel).
  toggleZoom(clientX, clientY) { if (this.view.zoom) this.fit(); else this.zoomTo(1, clientX, clientY); }

  // The part of the cropped picture on screen, as fractions ({ x, y, w, h }), for the navigator; null when fitted.
  viewBox() {
    const p = this.placement(), box = this.canvas.getBoundingClientRect();
    if (!p || !this.view.zoom) return null;
    const w = Math.min(1, box.width / p.w), h = Math.min(1, box.height / p.h);
    return { x: this.view.cx - w / 2, y: this.view.cy - h / 2, w, h };
  }
  // Centre the view on a point of the cropped picture (0–1); placement() keeps it in bounds.
  centreOn(fx, fy) { if (this.view.zoom) { this.view.cx = fx; this.view.cy = fy; } }

  // Drag the photo by (dx, dy) CSS pixels.
  pan(dx, dy) {
    const p = this.placement();
    if (!p || !this.view.zoom) return;
    this.view.cx -= dx / p.w; this.view.cy -= dy / p.h;
  }

  show(recipe) {
    const gl = this.gl, c = this.canvas, dpr = window.devicePixelRatio || 1;
    const bw = Math.max(1, Math.round(c.clientWidth * dpr)), bh = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== bw || c.height !== bh) Object.assign(c, { width: bw, height: bh });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0.043, 0.047, 0.063, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    const p = this.placement();
    if (!p) return;
    // Draw only what the canvas shows: a zoomed photo can be far bigger than the GPU's viewport limit.
    const box = c.getBoundingClientRect(), x0 = Math.max(0, p.x), x1 = Math.min(box.width, p.x + p.w), y0 = Math.max(0, p.y), y1 = Math.min(box.height, p.y + p.h);
    const left = Math.round(x0 * dpr), right = Math.round(x1 * dpr), top = Math.round(y0 * dpr), bottom = Math.round(y1 * dpr);
    if (right <= left || bottom <= top) return;
    gl.viewport(left, bh - bottom, right - left, bottom - top);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    // Past 200% show real pixels, not a blur.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, p.scale * dpr > 2 ? gl.NEAREST : gl.LINEAR);
    this.#draw(recipe, false, this.crop, [(x0 - p.x) / p.w, (y0 - p.y) / p.h, (x1 - x0) / p.w, (y1 - y0) / p.h]);
  }

  // The largest picture this GPU can render, in pixels on each side.
  maxEdge() { const gl = this.gl; return Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), ...gl.getParameter(gl.MAX_VIEWPORT_DIMS)); }

  // Render the recipe, cropped, off screen with the long edge at most `maxEdge`: RGBA bytes, top row first.
  pixels(recipe, maxEdge, crop = fullRecipe(recipe).crop) {
    const gl = this.gl, [fw, fh] = this.size(crop), scale = Math.min(1, maxEdge / Math.max(fw, fh));
    const w = Math.max(1, Math.round(fw * scale)), h = Math.max(1, Math.round(fh * scale));
    const target = gl.createTexture(), fb = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, target);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.viewport(0, 0, w, h);
    this.#draw(recipe, true, crop);
    const data = new Uint8ClampedArray(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb); gl.deleteTexture(target);
    return new ImageData(data, w, h);
  }

  // The photo around `at` (a point as toImage gives it) as the view shows it, turned like the crop, a
  // `size`-CSS-pixel square drawn off screen: ImageData. Null with no photo.
  // ponytail: one small GPU pass and readback per call; cache by source and size if brush moves feel slow.
  around(recipe, at, size) {
    const p = this.placement(), { width: W, height: H } = this;
    if (!p) return null;
    const t = -this.crop.angle * Math.PI / 180, cos = Math.cos(t), sin = Math.sin(t);
    const x = (at[0] - 0.5) * W, y = (at[1] - 0.5) * H; // from the centre, in photo pixels; turn back into the straightened frame
    const w = size / p.scale / W, h = size / p.scale / H;
    const crop = { angle: this.crop.angle, w, h, x: (cos * x + sin * y) / W + 0.5 - w / 2, y: (-sin * x + cos * y) / H + 0.5 - h / 2 };
    return this.pixels(recipe, Math.max(1, Math.round(size * (window.devicePixelRatio || 1))), crop);
  }

  async jpeg(recipe, maxEdge, quality = 0.9) {
    const image = this.pixels(recipe, maxEdge);
    const canvas = Object.assign(document.createElement('canvas'), { width: image.width, height: image.height });
    canvas.getContext('2d').putImageData(image, 0, 0);
    return new Promise(done => canvas.toBlob(done, 'image/jpeg', quality));
  }
}
