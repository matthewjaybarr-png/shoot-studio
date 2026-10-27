// Reshape, the fourth tab of Create's Edit photo drawer: Push, Grow and Shrink brushes, like liquify. A stroke builds a
// displacement field (a grid saying, for each place in the picture, how far away its colour now comes from), shown live
// on a small copy; when the mouse comes up Rust's reshape_picture warps the full-size original through it, one Undo a
// stroke. Needs create.js, phototools.js and cutout.js.

const SHAPE_TOOLS = [
  ['push', 'Push', '<path d="M4 12h12"/><path d="M12 7l5 5-5 5"/><circle cx="6" cy="12" r="2"/>'],
  ['grow', 'Grow', '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.5 2.5M16.5 16.5 19 19M19 5l-2.5 2.5M7.5 16.5 5 19"/>'],
  ['shrink', 'Shrink', '<circle cx="12" cy="12" r="2"/><path d="M12 3v5M10 6l2 2 2-2M12 21v-5M10 18l2-2 2 2M3 12h5M6 10l2 2-2 2M21 12h-5M18 10l-2 2 2 2"/>']
];
const SHAPE_HINTS = {
  push: 'Drag on the picture to push it along, like smudging wet paint.',
  grow: 'Hold the mouse down on something to make it bigger. Move while holding to grow more of it.',
  shrink: 'Hold the mouse down on something to make it smaller. Move while holding to shrink more of it.'
};
const SHAPE_GRID = 256; // grid points along the picture's long edge
const SHAPE_PREVIEW = 800; // the live copy's long edge
const shape = { tool: 'push', px: 60, strength: 50, image: null, grid: null, preview: null, drag: null, pointer: null, busy: false, frame: 0, timer: 0 };
const reshaping = () => mode === 'create' && !!board && !!design && drawer === 'retouch' && photoTab === 'reshape' && !cropSession;
const shapeGone = () => !shape.image || !board.getObjects().includes(shape.image);
const shapeSay = text => { $('#shape-hint').textContent = text; };

function paintReshape() {
  const tools = $('#shape-tools');
  if (!tools.children.length) tools.append(...SHAPE_TOOLS.map(([key, label, icon]) => {
    const b = button('', () => { shape.tool = key; paintReshape(); }); b.dataset.shape = key; b.title = label;
    b.insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>`); b.append(label);
    return b;
  }));
  for (const b of tools.children) { b.classList.toggle('on', b.dataset.shape === shape.tool); b.setAttribute('aria-pressed', b.dataset.shape === shape.tool); }
  $('#shape-size').value = shape.px; $('#shape-size-out').textContent = shape.px + ' px';
  $('#shape-strength').value = shape.strength; $('#shape-strength-out').textContent = shape.strength + '%';
  if (shape.image && shapeGone()) Object.assign(shape, { image: null, grid: null, preview: null, drag: null });
  if (!shape.image && reshaping()) { // the selected picture, or the only one on the page
    const active = board.getActiveObject() || (board.getObjects().includes(touch.wasSelected) ? touch.wasSelected : null), pictures = board.getObjects().filter(o => o.type === 'image' && o.visible !== false);
    const image = active?.type === 'image' ? active : pictures.length === 1 ? pictures[0] : null;
    if (image) shape.image = image;
  }
  if (!shape.busy) shapeSay(shape.image ? SHAPE_HINTS[shape.tool] : 'Click the picture you want to reshape.');
}
$('#shape-size').oninput = e => { shape.px = +e.target.value; paintReshape(); board?.requestRenderAll(); };
$('#shape-strength').oninput = e => { shape.strength = +e.target.value; paintReshape(); };
$('#shape-done').onclick = () => { Object.assign(shape, { image: null, grid: null, preview: null, drag: null }); photoTab = 'retouch'; showDrawer('retouch'); };

// ---- The field: gw × gh points over the picture, each (dx, dy) in the picture's own pixels ----
function newShapeField(image) {
  const [nw, nh] = naturalSize(image), long = Math.max(nw, nh);
  const gw = Math.max(2, Math.round(SHAPE_GRID * nw / long) + 1), gh = Math.max(2, Math.round(SHAPE_GRID * nh / long) + 1);
  return { nw, nh, gw, gh, sx: (nw - 1) / (gw - 1), sy: (nh - 1) / (gh - 1), d: new Float32Array(gw * gh * 2) };
}
// The field at a picture pixel, blended from the grid points around it.
function shapeAt(f, d, x, y) {
  const gx = Math.min(f.gw - 1, Math.max(0, x / f.sx)), gy = Math.min(f.gh - 1, Math.max(0, y / f.sy));
  const x0 = Math.min(f.gw - 2, Math.floor(gx)), y0 = Math.min(f.gh - 2, Math.floor(gy)), fx = gx - x0, fy = gy - y0;
  const k = (y0 * f.gw + x0) * 2, k2 = k + f.gw * 2;
  const mix = c => (d[k + c] * (1 - fx) + d[k + 2 + c] * fx) * (1 - fy) + (d[k2 + c] * (1 - fx) + d[k2 + 2 + c] * fx) * fy;
  return [mix(0), mix(1)];
}
// One dab of the brush at picture pixel (cx, cy) with radius r: each grid point's sampling place moves by `move`
// (weighted by a soft falloff), carrying the field it lands on with it so long pushes stretch smoothly.
function shapeDab(cx, cy, r, move) {
  const f = shape.grid, old = f.d.slice(), k = shape.strength / 100;
  const i0 = Math.max(0, Math.floor((cx - r) / f.sx)), i1 = Math.min(f.gw - 1, Math.ceil((cx + r) / f.sx));
  const j0 = Math.max(0, Math.floor((cy - r) / f.sy)), j1 = Math.min(f.gh - 1, Math.ceil((cy + r) / f.sy));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = i * f.sx, y = j * f.sy, t2 = ((x - cx) ** 2 + (y - cy) ** 2) / (r * r);
    if (t2 >= 1) continue;
    const w = (1 - t2) ** 2 * k, [mx, my] = move(x, y), qx = x + mx * w, qy = y + my * w, [dx, dy] = shapeAt(f, old, qx, qy), n = (j * f.gw + i) * 2;
    f.d[n] = dx + qx - x; f.d[n + 1] = dy + qy - y;
  }
}
const shapeRadius = image => shape.px / board.getZoom() / Math.abs(image.scaleX || 1); // in the picture's pixels

// ---- The live copy ----
function shapePreview(image) {
  const el = image.getElement(), [nw, nh] = naturalSize(image), k = Math.min(1, SHAPE_PREVIEW / Math.max(nw, nh));
  const w = Math.max(1, Math.round(nw * k)), h = Math.max(1, Math.round(nh * k)), ctx = pictureCanvas(w, h).getContext('2d', { willReadFrequently: true });
  ctx.drawImage(el, 0, 0, w, h);
  return { w, h, k, src: ctx.getImageData(0, 0, w, h), out: ctx };
}
function renderShapePreview() {
  shape.frame = 0;
  const p = shape.preview, f = shape.grid;
  if (!p || !f) return;
  const { w, h, src } = p, out = p.out.createImageData(w, h), s = src.data, o = out.data, kx = (f.nw - 1) / Math.max(1, w - 1), ky = (f.nh - 1) / Math.max(1, h - 1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [dx, dy] = shapeAt(f, f.d, x * kx, y * ky), i = (y * w + x) * 4;
    if (!dx && !dy) { o[i] = s[i]; o[i + 1] = s[i + 1]; o[i + 2] = s[i + 2]; o[i + 3] = s[i + 3]; continue; }
    const sx = Math.min(w - 1, Math.max(0, x + dx / kx)), sy = Math.min(h - 1, Math.max(0, y + dy / ky));
    const x0 = Math.min(w - 2, Math.floor(sx)), y0 = Math.min(h - 2, Math.floor(sy)), fx = sx - x0, fy = sy - y0, a = (y0 * w + x0) * 4, b = a + w * 4;
    for (let c = 0; c < 4; c++) o[i + c] = (s[a + c] * (1 - fx) + s[a + 4 + c] * fx) * (1 - fy) + (s[b + c] * (1 - fx) + s[b + 4 + c] * fx) * fy;
  }
  p.out.putImageData(out, 0, 0);
  board.requestRenderAll();
}
const queueShapePreview = () => { shape.frame ||= requestAnimationFrame(renderShapePreview); };

// ---- The mouse ----
function shapeDown({ e }) {
  if (!reshaping() || spacePan || e.button !== 0) return;
  if (shape.busy) return shapeSay('Still reshaping the last stroke…');
  const at = board.getScenePoint(e), image = shape.image?.containsPoint(at) && !shapeGone() ? shape.image : pictureAt(at, 0);
  if (!image) return shapeSay('Click on a picture to reshape it.');
  if (image !== shape.image) { shape.image = image; paintReshape(); }
  Object.assign(shape, { grid: newShapeField(image), preview: shapePreview(image) });
  const [u, v] = toPicture(image, at);
  shape.drag = { last: [u * shape.grid.nw, v * shape.grid.nh] };
  if (shape.tool !== 'push') { shapeTick(); shape.timer = setInterval(shapeTick, 40); } // Grow and Shrink keep working while held
  queueShapePreview();
}
function shapeTick() {
  if (!shape.drag) return;
  const [cx, cy] = shape.drag.last, r = shapeRadius(shape.image), k = shape.tool === 'grow' ? -0.06 : 0.06;
  shapeDab(cx, cy, r, (x, y) => [(x - cx) * k, (y - cy) * k]);
  queueShapePreview();
}
function shapeMove({ e }) {
  if (!reshaping()) return;
  shape.pointer = board.getScenePoint(e);
  if (shape.drag && !shapeGone()) {
    const [u, v] = toPicture(shape.image, shape.pointer), next = [u * shape.grid.nw, v * shape.grid.nh], [lx, ly] = shape.drag.last, r = shapeRadius(shape.image);
    if (shape.tool === 'push') { // short steps, so a fast drag pushes as far as the mouse went
      const steps = Math.max(1, Math.ceil(Math.hypot(next[0] - lx, next[1] - ly) / (r / 4)));
      for (let s = 0; s < steps; s++) {
        const cx = lx + (next[0] - lx) * s / steps, cy = ly + (next[1] - ly) * s / steps, mx = -(next[0] - lx) / steps, my = -(next[1] - ly) / steps;
        shapeDab(cx, cy, r, () => [mx, my]);
      }
    }
    shape.drag.last = next;
    queueShapePreview();
  }
  board.requestRenderAll();
}
async function shapeUp() {
  if (!shape.drag) return;
  clearInterval(shape.timer); shape.drag = null;
  const image = shape.image, f = shape.grid;
  if (!image || shapeGone() || !f || !f.d.some(Boolean)) { shape.grid = shape.preview = null; return board.requestRenderAll(); }
  shape.busy = true; shapeSay('Reshaping…');
  try {
    const work = await touchPixels(image.kbOriginal || image.getSrc()), { width: w, height: h } = work.canvas, pixels = work.ctx.getImageData(0, 0, w, h).data;
    const body = new Uint8Array(16 + pixels.length + f.d.length * 4), view = new DataView(body.buffer);
    view.setUint32(0, w, true); view.setUint32(4, h, true); body.set(pixels, 8);
    view.setUint32(8 + pixels.length, f.gw, true); view.setUint32(12 + pixels.length, f.gh, true);
    // The field is in the shown picture's pixels; the original is the same size, so it applies as it is.
    new Uint8Array(body.buffer, 16 + pixels.length).set(new Uint8Array(f.d.buffer));
    const out = new Uint8Array(await invoke('reshape_picture', body));
    const canvas = pictureCanvas(w, h);
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(out.buffer, 0, w * h * 4), w, h), 0, 0);
    await setPicture(image, { original: canvas.toDataURL(work.clear ? 'image/png' : 'image/jpeg', 0.92) });
  } catch (error) {
    shapeSay(`Couldn't reshape it: ${error}`);
  } finally {
    shape.busy = false; shape.grid = shape.preview = null; board.requestRenderAll();
    if (!$('#shape-hint').textContent.startsWith("Couldn't")) paintReshape();
  }
}

// ---- Drawing: the live copy over the picture while a stroke is on, and the brush ring ----
function drawReshape(ctx) {
  if (!reshaping()) return;
  const z = board.getZoom(), image = shape.image && !shapeGone() ? shape.image : null;
  if (image && shape.preview) {
    const [nw, nh] = naturalSize(image);
    ctx.save(); ctx.transform(...image.calcTransformMatrix());
    ctx.beginPath(); ctx.rect(-image.width / 2, -image.height / 2, image.width, image.height); ctx.clip();
    ctx.drawImage(shape.preview.out.canvas, -image.width / 2 - (image.cropX || 0), -image.height / 2 - (image.cropY || 0), nw, nh);
    ctx.restore();
  }
  if (shape.pointer) {
    ctx.save(); ctx.lineWidth = 1.5 / z; ctx.strokeStyle = '#d0489b';
    ctx.beginPath(); ctx.arc(shape.pointer.x, shape.pointer.y, shape.px / z, 0, 2 * Math.PI); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.beginPath(); ctx.arc(shape.pointer.x, shape.pointer.y, shape.px / z - 1.5 / z, 0, 2 * Math.PI); ctx.stroke();
    ctx.restore();
  }
}

function startReshapeTools() {
  board.on('mouse:down', shapeDown);
  board.on('mouse:move', shapeMove);
  board.on('mouse:up', shapeUp);
  board.on('mouse:out', () => { if (shape.pointer) { shape.pointer = null; board.requestRenderAll(); } });
}
document.addEventListener('keydown', e => { // Esc drops the stroke being made
  if (e.key === 'Escape' && shape.drag && !$('#create').inert) { clearInterval(shape.timer); Object.assign(shape, { drag: null, grid: null, preview: null }); board.requestRenderAll(); }
});
