// Shoot Studio Develop: one WebGL2 shader turns a recipe into pixels, for the screen and for saved previews.
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
  { key: 'vignette', label: 'Vignette', group: 'Finishing', min: -100, max: 100, step: 1 },
  { key: 'grain', label: 'Grain', min: 0, max: 100, step: 1 },
  { key: 'fade', label: 'Fade', min: 0, max: 100, step: 1 }
];
const RECIPE_VERSION = 3;
const SETTINGS = [...SLIDERS.map(s => s.key), 'look']; // everything but retouch: what copy, paste and presets carry

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
// over the long edge, offset (source minus destination) for the copying tools, strength for soften.
const TOOLS = { spot: 'Spot heal', heal: 'Heal', clone: 'Clone', soften: 'Soften skin', redeye: 'Red eye' };
const STROKE_LIMITS = { strokes: 500, points: 2000, minSize: 0.001, maxSize: 0.1 };
const unit = v => Number.isFinite(v) && v >= 0 && v <= 1;
const validStroke = s => !!s && TOOLS[s.tool] && Number.isFinite(s.size) && s.size >= STROKE_LIMITS.minSize && s.size <= STROKE_LIMITS.maxSize
  && Array.isArray(s.points) && s.points.length >= 1 && s.points.length <= STROKE_LIMITS.points && s.points.every(p => Array.isArray(p) && p.length === 2 && p.every(unit))
  && (s.tool === 'soften' ? unit(s.strength) && s.offset === undefined
    : s.tool === 'redeye' ? s.strength === undefined && s.offset === undefined
    : s.strength === undefined && Array.isArray(s.offset) && s.offset.length === 2 && s.offset.every(v => Number.isFinite(v) && Math.abs(v) <= 1));

// A saved recipe with any missing setting at its default, and nothing it doesn't know.
const fullRecipe = (saved = {}) => ({
  ...Object.fromEntries(SLIDERS.map(s => [s.key, Number.isFinite(saved[s.key]) ? Math.min(s.max, Math.max(s.min, saved[s.key])) : s.default ?? 0])),
  look: lookOf(saved.look) ? saved.look : '',
  retouch: Array.isArray(saved.retouch) ? saved.retouch.filter(validStroke).slice(0, STROKE_LIMITS.strokes) : []
});
const isDefault = recipe => SLIDERS.every(s => recipe[s.key] === (s.default ?? 0)) && !recipe.look && !recipe.retouch?.length;
// A recipe's settings without its retouch strokes, which belong to one photo.
const settingsOf = recipe => Object.fromEntries(SETTINGS.map(key => [key, fullRecipe(recipe)[key]]));

// White balance relative to as shot: warmer adds red and removes blue, positive tint removes green (magenta).
// Normalised so a neutral grey keeps its brightness. Exactly [1, 1, 1] at 0, 0.
function whiteBalance(temp, tint) {
  const t = temp / 100, g = tint / 100;
  const gains = [2 ** (0.5 * t), 2 ** (-0.35 * g), 2 ** (-0.5 * t)];
  const luma = 0.2126 * gains[0] + 0.7152 * gains[1] + 0.0722 * gains[2];
  return gains.map(v => v / luma);
}

// Texture row 0 is the photo's top. On screen that's the top of the viewport; read back with
// readPixels (bottom row first) it must be at the bottom, hence u_flip.
const VERTEX = `#version 300 es
in vec2 a_pos; out vec2 v_uv; uniform bool u_flip;
void main() { v_uv = vec2(a_pos.x, u_flip ? a_pos.y : -a_pos.y) * 0.5 + 0.5; gl_Position = vec4(a_pos, 0, 1); }`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform bool u_raw;
uniform vec3 u_wb;
uniform float u_exposure, u_contrast, u_highlights, u_shadows, u_whites, u_blacks, u_vibrance, u_saturation;
// The look, and the finishing that goes on any photo.
uniform float u_look, u_mono, u_lookContrast, u_lookSat, u_fade, u_grain, u_vignette;
uniform vec3 u_filter, u_lift, u_gamma, u_gain;
uniform vec2 u_toneLo, u_toneHi, u_splitLo, u_splitHi;
in vec2 v_uv; out vec4 color;
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

// Film grain: smooth noise about 1.5 photo pixels across, the same wherever the photo is drawn.
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

void main() {
  vec3 c = texture(u_src, v_uv).rgb * u_wb * u_exposure;
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
    float n = noise(v_uv * vec2(textureSize(u_src, 0)) / 1.5) + noise(v_uv * vec2(textureSize(u_src, 0)) / 0.8 + 17.0) - 1.0;
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
    Object.assign(this, { width: w, height: h, raw, blank: false });
    this.fit();
  }

  // `bytes`: the retouch layout, a rectangle's x, y, width and height as u32s then its half floats.
  patch(bytes) {
    const [x, y, w, h] = new Uint32Array(bytes, 0, 4), gl = this.gl;
    if (!w || !h) return;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RGB, gl.HALF_FLOAT, new Uint16Array(bytes, 16, w * h * 3));
  }

  #draw(recipe, flip) {
    const gl = this.gl, r = fullRecipe(recipe), u = this.uniform;
    gl.uniform1i(u('u_raw'), this.raw ? 1 : 0);
    gl.uniform1i(u('u_flip'), flip ? 1 : 0);
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
    gl.uniform1f(u('u_fade'), Math.min(1, (look.fade || 0) * amount + r.fade / 100));
    gl.uniform1f(u('u_grain'), Math.min(1, (look.grain || 0) * amount + r.grain / 100));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // Where the photo sits on the canvas in CSS pixels ({ x, y, w, h }), fitted or zoomed and panned.
  placement() {
    const box = this.canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, v = this.view;
    if (!this.width || this.blank) return null;
    const fit = Math.min(box.width / this.width, box.height / this.height);
    const scale = v.zoom ? Math.max(fit, v.zoom / dpr) : fit, w = this.width * scale, h = this.height * scale;
    // Zoomed in, keep the photo covering the view where it can.
    const centre = (c0, size, box) => size <= box ? 0.5 : Math.min(1 - box / 2 / size, Math.max(box / 2 / size, c0));
    if (v.zoom) { v.cx = centre(v.cx, w, box.width); v.cy = centre(v.cy, h, box.height); }
    return { x: box.width / 2 - v.cx * w, y: box.height / 2 - v.cy * h, w, h };
  }

  // A point on screen as photo coordinates, 0–1 across and down the upright photo (outside it is <0 or >1).
  toImage(clientX, clientY) {
    const p = this.placement(), box = this.canvas.getBoundingClientRect();
    return p ? [(clientX - box.left - p.x) / p.w, (clientY - box.top - p.y) / p.h] : null;
  }

  // And back, relative to the canvas's top left in CSS pixels.
  fromImage([x, y]) { const p = this.placement(); return p && [p.x + x * p.w, p.y + y * p.h]; }

  // Z: between fitting the photo and 100% (one photo pixel per screen pixel), keeping the point under the pointer still.
  toggleZoom(clientX, clientY) {
    const at = this.toImage(clientX, clientY), box = this.canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (!at) return;
    if (this.view.zoom) return this.fit();
    const scale = 1 / dpr, w = this.width * scale, h = this.height * scale;
    this.view = { zoom: 1, cx: at[0] + (box.width / 2 - (clientX - box.left)) / w, cy: at[1] + (box.height / 2 - (clientY - box.top)) / h };
  }

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
    const w = Math.round(p.w * dpr), h = Math.round(p.h * dpr), x = Math.round(p.x * dpr);
    gl.viewport(x, bh - Math.round(p.y * dpr) - h, w, h);
    this.#draw(recipe, false);
  }

  // Render off screen with the long edge at most `maxEdge`: RGBA bytes, top row first.
  pixels(recipe, maxEdge) {
    const gl = this.gl, scale = Math.min(1, maxEdge / Math.max(this.width, this.height));
    const w = Math.max(1, Math.round(this.width * scale)), h = Math.max(1, Math.round(this.height * scale));
    const target = gl.createTexture(), fb = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, target);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.viewport(0, 0, w, h);
    this.#draw(recipe, true);
    const data = new Uint8ClampedArray(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb); gl.deleteTexture(target);
    return new ImageData(data, w, h);
  }

  async jpeg(recipe, maxEdge, quality = 0.9) {
    const image = this.pixels(recipe, maxEdge);
    const canvas = Object.assign(document.createElement('canvas'), { width: image.width, height: image.height });
    canvas.getContext('2d').putImageData(image, 0, 0);
    return new Promise(done => canvas.toBlob(done, 'image/jpeg', quality));
  }
}
