// Shoot Studio, Step 2: one WebGL2 shader turns a recipe into pixels, for the screen and for saved previews.
// Sources are linear RAW light (half floats from Rust) or a JPEG (decoded here). At the default recipe a JPEG
// renders as itself; a RAW gets a gentle base look so it starts close to what the camera would have made.

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
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1 }
];
const RECIPE_VERSION = 1;
const DEVELOP_EDGE = 3072; // long edge of the editing image, as in main.rs

// A saved recipe with any missing setting at its default, and nothing it doesn't know.
const fullRecipe = (saved = {}) => Object.fromEntries(SLIDERS.map(s => [s.key, Number.isFinite(saved[s.key]) ? Math.min(s.max, Math.max(s.min, saved[s.key])) : 0]));
const isDefault = recipe => SLIDERS.every(s => !recipe[s.key]);

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
  color = vec4(d, 1.0);
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
    this.clear();
  }

  // Nothing to draw until the next photo's pixels arrive.
  clear() { this.width = this.height = 0; }

  #upload(setup) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    setup(gl);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  }

  // `bytes`: the develop_source layout, width and height as u32s then RGB half floats.
  setRaw(bytes) {
    const [w, h] = new Uint32Array(bytes, 0, 2);
    this.#upload(gl => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB16F, w, h, 0, gl.RGB, gl.HALF_FLOAT, new Uint16Array(bytes, 8, w * h * 3)));
    Object.assign(this, { width: w, height: h, raw: true });
  }

  // An ImageBitmap or canvas holding sRGB pixels; the texture format linearises them before filtering.
  setImage(image) {
    this.#upload(gl => gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, image));
    Object.assign(this, { width: image.width, height: image.height, raw: false });
  }

  #draw(recipe, flip) {
    const gl = this.gl, r = fullRecipe(recipe), u = this.uniform;
    gl.uniform1i(u('u_raw'), this.raw ? 1 : 0);
    gl.uniform1i(u('u_flip'), flip ? 1 : 0);
    gl.uniform3fv(u('u_wb'), whiteBalance(r.temp, r.tint));
    gl.uniform1f(u('u_exposure'), 2 ** r.exposure);
    for (const key of ['contrast', 'highlights', 'shadows', 'whites', 'blacks', 'vibrance', 'saturation']) gl.uniform1f(u('u_' + key), r[key] / 100);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // Fit the photo into the canvas's on-screen box at device resolution.
  show(recipe) {
    const gl = this.gl, c = this.canvas, dpr = window.devicePixelRatio || 1;
    const bw = Math.max(1, Math.round(c.clientWidth * dpr)), bh = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== bw || c.height !== bh) Object.assign(c, { width: bw, height: bh });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0.043, 0.047, 0.063, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.width) return;
    const scale = Math.min(bw / this.width, bh / this.height), w = Math.round(this.width * scale), h = Math.round(this.height * scale);
    gl.viewport((bw - w) >> 1, (bh - h) >> 1, w, h);
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
