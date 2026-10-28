// Retouch in Create: Photos' brushes, and Remove, painted onto any picture on the page and worked out by the same
// Rust code as Develop. Each stroke changes the picture's pixels; Undo takes it back. Edit a photo on the start
// screen opens a page that is just the photo. The Edit photo drawer also holds Cut out (cutout.js). Needs create.js,
// and develop.js and app.js for the stroke rules.

// ---- The brushes ----
// Each with a line icon in the rail's style (24 × 24 paths).
const PHOTO_TOOLS = [
  ['remove', 'Remove', '<path d="M15 4l5 5-9 9H7l-3-3z"/><path d="M9.5 9.5l5 5M4 21h16"/>'],
  ['spot', 'Spot heal', '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/>'],
  ['heal', 'Heal', '<path d="M5.6 13.1l7.5-7.5a3.2 3.2 0 0 1 4.5 4.5l-7.5 7.5a3.2 3.2 0 0 1-4.5-4.5z"/><path d="M11 10.5h.01M13.5 13h.01M11 13h.01M13.5 10.5h.01"/>'],
  ['clone', 'Clone', '<path d="M9.5 3h5v5l3 3v3h-11v-3l3-3z"/><path d="M5 17h14v4H5z"/>'],
  ['soften', 'Soften skin', '<path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z"/>'],
  ['redeye', 'Red eye', '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'],
  ['blur', 'Blur', '<path d="M3 8c3-2 6 2 9 0s6-2 9 0M3 12c3-2 6 2 9 0s6-2 9 0M3 16c3-2 6 2 9 0s6-2 9 0"/>'],
  ['dodge', 'Lighten', '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>'],
  ['burn', 'Darken', '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>']
];
const TOUCH_HINTS = {
  remove: 'Paint over something to make it disappear (a stray hair, a sign, a person in the background), or draw a ring around it. The gap is filled from what is around it.',
  spot: 'Paint over a spot or blemish; clean skin nearby is found and blended in.',
  heal: 'Click Pick where to copy from, click a clean area, then paint. Its texture is blended into the colour around the stroke.',
  clone: 'Click Pick where to copy from, click the area to copy, then paint. An exact copy, with no blending.',
  soften: 'Paint over skin to smooth blotches while keeping pores and fine detail.',
  redeye: 'Click a red pupil, once for each eye: the whole pupil is found and darkened, the white catchlight kept. Or paint over it.',
  blur: 'Paint to blur a busy background. A bigger brush blurs more.',
  dodge: 'Paint to lighten, a little at a time.',
  burn: 'Paint to darken, a little at a time.'
};
const touch = { tool: null, px: 20, strengths: { soften: 0.5, dodge: 0.25, burn: 0.25 }, picking: false, source: null, offset: null, stroke: null, pointer: null, work: null };
let touchQueue = Promise.resolve();
const touchStrength = t => touch.strengths[t] ?? 1;
const touchSay = text => { $('#create-saved').textContent = text; };
let photoTab = 'retouch'; // which part of the Edit photo drawer shows: retouch, cutout, straighten or reshape
const brushing = () => mode === 'create' && !!board && !!design && drawer === 'retouch' && photoTab === 'retouch' && !!touch.tool && !cropSession;
const cuttingOut = () => typeof cutting === 'function' && cutting();

// A picture's own pixels for a point on the page (0–1 across and down), and back again.
const naturalSize = image => { const el = image.getElement(); return [el.naturalWidth || el.width, el.naturalHeight || el.height]; };
function toPicture(image, at) {
  const p = fabric.util.transformPoint(at, fabric.util.invertTransform(image.calcTransformMatrix())), [nw, nh] = naturalSize(image);
  return [(p.x + image.width / 2 + (image.cropX || 0)) / nw, (p.y + image.height / 2 + (image.cropY || 0)) / nh];
}
function fromPicture(image, [u, v]) {
  const [nw, nh] = naturalSize(image);
  return fabric.util.transformPoint(new fabric.Point(u * nw - (image.cropX || 0) - image.width / 2, v * nh - (image.cropY || 0) - image.height / 2), image.calcTransformMatrix());
}
const onPicture = ([u, v]) => u >= 0 && v >= 0 && u <= 1 && v <= 1;
// The brush is sized on screen, as in Canva, whatever picture is under it. A stroke stores it as a share of that
// picture's long edge, within the limits Rust allows (at most half of a small picture).
const pictureLong = image => Math.max(...naturalSize(image)) * Math.abs(image.scaleX || 1); // on the page
const brushSize = image => Math.min(STROKE_LIMITS.maxStored, Math.max(STROKE_LIMITS.minSize, touch.px / board.getZoom() / pictureLong(image)));
const brushRadius = (image, size = brushSize(image)) => size * pictureLong(image); // on the page
// The topmost picture you can see under the pointer, locked ones included: a Canva background is where things need
// removing. See-through parts don't count, so a Canva layer of scattered leaves lets the brush reach what's below it.
const touchAlpha = new WeakMap(); // picture element → its alpha at up to 512 px
function alphaAt(image, [u, v]) {
  const el = image.getElement();
  if (!touchAlpha.has(el)) {
    const [nw, nh] = naturalSize(image), k = Math.min(1, 512 / Math.max(nw, nh)), w = Math.max(1, Math.round(nw * k)), h = Math.max(1, Math.round(nh * k));
    const ctx = Object.assign(document.createElement('canvas'), { width: w, height: h }).getContext('2d', { willReadFrequently: true });
    ctx.drawImage(el, 0, 0, w, h);
    touchAlpha.set(el, { w, h, data: ctx.getImageData(0, 0, w, h).data });
  }
  const a = touchAlpha.get(el), x = Math.min(a.w - 1, Math.floor(u * a.w)), y = Math.min(a.h - 1, Math.floor(v * a.h));
  return a.data[(y * a.w + x) * 4 + 3];
}
// Anywhere inside the brush counts, so a stroke can start just beside a small leaf and still catch it.
function pictureAt(at, r = board ? touch.px / board.getZoom() : 0) {
  const spots = [at, ...[0.5, 1].flatMap(k => Array.from({ length: 8 }, (_, i) => new fabric.Point(at.x + k * r * Math.cos(i * Math.PI / 4), at.y + k * r * Math.sin(i * Math.PI / 4))))];
  return board.getObjects().slice().reverse().find(o => o.type === 'image' && o.visible !== false && spots.some(p => {
    if (!o.containsPoint(p)) return false;
    const uv = toPicture(o, p);
    return onPicture(uv) && alphaAt(o, uv) > 24;
  })) || null;
}

// ---- Brush mode: while a brush is picked, the page paints instead of selecting ----
let touchMode = false;
function setTouchMode(on) {
  if (!board || touchMode === on) return;
  touchMode = on;
  if (on) { touch.wasSelected = board.getActiveObject(); board.discardActiveObject(); } // Straighten still knows which picture was picked
  board.skipTargetFind = on || spacePan; board.selection = !on && !spacePan && !cropSession;
  board.defaultCursor = on ? 'crosshair' : spacePan ? 'grab' : 'default'; board.setCursor(board.defaultCursor);
  board.requestRenderAll(); paintPanel();
}
function pickTouchTool(name) {
  touch.tool = touch.tool === name ? null : name;
  if (!['heal', 'clone'].includes(touch.tool)) touch.picking = false;
  paintTouch();
}
function paintTouch() {
  for (const b of document.querySelectorAll('#photo-tabs [data-photo-tab]')) { b.classList.toggle('on', b.dataset.photoTab === photoTab); b.setAttribute('aria-pressed', b.dataset.photoTab === photoTab); }
  $('#photo-retouch').hidden = photoTab !== 'retouch'; $('#photo-cutout').hidden = photoTab !== 'cutout'; $('#photo-straighten').hidden = photoTab !== 'straighten'; $('#photo-reshape').hidden = photoTab !== 'reshape';
  if (photoTab === 'cutout' && typeof paintCut === 'function') paintCut();
  if (photoTab === 'straighten' && typeof paintStraighten === 'function') paintStraighten();
  if (photoTab === 'reshape' && typeof paintReshape === 'function') paintReshape();
  const tools = $('#touch-tools');
  if (!tools.children.length) tools.append(...PHOTO_TOOLS.map(([key, label, icon]) => {
    const b = button('', () => pickTouchTool(key)); b.dataset.touch = key; b.title = label;
    b.insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>`); b.append(label);
    return b;
  }));
  for (const b of tools.children) { b.classList.toggle('on', b.dataset.touch === touch.tool); b.setAttribute('aria-pressed', b.dataset.touch === touch.tool); }
  const size = $('#touch-size'), strength = $('#touch-strength');
  size.value = touch.px; $('#touch-size-out').textContent = touch.px + ' px';
  strength.value = Math.round(touchStrength(touch.tool) * 100); $('#touch-strength-out').textContent = strength.value + '%';
  $('#touch-strength-row').hidden = !touch.tool || touch.tool === 'remove';
  const copies = ['heal', 'clone'].includes(touch.tool);
  $('#touch-source').hidden = !copies;
  $('#touch-source').classList.toggle('on', touch.picking);
  $('#touch-source').textContent = touch.picking ? 'Now click where to copy from…' : touch.source ? 'Pick a different place to copy from' : 'Pick where to copy from';
  $('#touch-hint').textContent = touch.tool ? TOUCH_HINTS[touch.tool] : 'Pick a brush, then paint on any picture on the page.';
  setTouchMode(brushing() || cuttingOut() || (typeof straightening === 'function' && straightening()) || (typeof reshaping === 'function' && reshaping()));
}
for (const b of document.querySelectorAll('#photo-tabs [data-photo-tab]')) b.onclick = () => { photoTab = b.dataset.photoTab; paintTouch(); board?.requestRenderAll(); };
$('#touch-size').oninput = e => { touch.px = +e.target.value; paintTouch(); board?.requestRenderAll(); };
$('#touch-strength').oninput = e => { if (touch.tool && touch.tool !== 'remove') touch.strengths[touch.tool] = +e.target.value / 100; paintTouch(); };
$('#touch-source').onclick = () => { touch.picking = !touch.picking; paintTouch(); };
$('#touch-done').onclick = () => { touch.tool = null; touch.picking = false; showDrawer('retouch'); };
$('#prop-retouch').onclick = () => {
  const image = board.getActiveObject();
  touch.tool ||= 'remove'; photoTab = 'retouch';
  if (drawer !== 'retouch') showDrawer('retouch'); else paintTouch();
  if (image?.type === 'image') touchSay('Paint on the picture with the brush.');
};

// ---- Painting ----
function touchDown({ e }) {
  if (!brushing() || spacePan || e.button !== 0) return;
  const at = board.getScenePoint(e), image = pictureAt(at);
  if (!image) return touchSay('Paint on a picture to retouch it.');
  const uv = toPicture(image, at).map(round);
  if (touch.picking || ((e.altKey || e.ctrlKey) && ['heal', 'clone'].includes(touch.tool))) {
    touch.source = { image, uv }; touch.offset = null; touch.picking = false; paintTouch(); board.requestRenderAll();
    return touchSay('Now paint where it should go.');
  }
  if (['heal', 'clone'].includes(touch.tool)) {
    if (touch.source?.image !== image) { touch.picking = true; paintTouch(); return touchSay('First click where to copy from on this picture.'); }
    touch.offset ||= [round(touch.source.uv[0] - uv[0]), round(touch.source.uv[1] - uv[1])]; // kept for the next strokes, as in Photos
  }
  touch.stroke = { image, tool: touch.tool, size: brushSize(image), strength: touchStrength(touch.tool), points: [uv.map(v => Math.min(1, Math.max(0, v)))], scene: [at] };
  board.requestRenderAll();
}
function touchMove({ e }) {
  if (!brushing()) { if (touch.pointer) { touch.pointer = null; board.requestRenderAll(); } return; }
  const at = board.getScenePoint(e);
  touch.pointer = at;
  const s = touch.stroke;
  if (s && s.points.length < STROKE_LIMITS.points) {
    const uv = toPicture(s.image, at).map(v => round(Math.min(1, Math.max(0, v)))), last = s.points.at(-1), [nw, nh] = naturalSize(s.image);
    if (Math.hypot((uv[0] - last[0]) * nw, (uv[1] - last[1]) * nh) >= Math.max(1, s.size * Math.max(nw, nh) / 4)) { s.points.push(uv); s.scene.push(at); }
  }
  board.requestRenderAll();
}
function touchUp() {
  const s = touch.stroke;
  touch.stroke = null;
  if (!s) return;
  board.requestRenderAll();
  const done = { tool: s.tool, size: round(s.size), points: s.points };
  if (s.tool === 'soften') Object.assign(done, { strength: round(s.strength), scaled: true });
  else if (s.tool !== 'remove' && s.strength < 1) done.strength = round(s.strength);
  if (s.tool === 'redeye' && s.points.length === 1) { // a click: Rust finds the whole pupil around it
    touchQueue = touchQueue.then(() => retouchPicture(s.image, { ...done, click: true })).catch(error => touchSay('Could not fix it: ' + error));
    return track(touchQueue);
  }
  if (s.tool === 'spot') done.offset = [0, 0]; // Rust finds the clean patch
  if (['heal', 'clone'].includes(s.tool)) done.offset = touch.offset;
  if (!validStroke(done)) return touchSay("That stroke can't be used.");
  touchQueue = touchQueue.then(() => retouchPicture(s.image, done)).catch(error => touchSay('Could not retouch it: ' + error));
  track(touchQueue);
}

// The picture's own pixels (its unfiltered original when it has a filter), kept between strokes.
async function touchPixels(src) {
  if (touch.work?.src === src) return touch.work;
  const img = new Image(); img.src = src; await img.decode();
  const canvas = Object.assign(document.createElement('canvas'), { width: img.naturalWidth, height: img.naturalHeight });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let clear = false;
  for (let i = 3; i < data.length && !clear; i += 4) clear = data[i] < 255;
  return (touch.work = { src, canvas, ctx, clear });
}
// One stroke: the pixels go to Rust, the rectangle it changed comes back, and the picture is redrawn (and refiltered).
async function retouchPicture(image, stroke) {
  if (!board.getObjects().includes(image)) return;
  touchSay(stroke.tool === 'remove' ? 'Removing…' : stroke.click ? 'Fixing the red eye…' : 'Retouching…');
  const base = image.kbOriginal || image.getSrc(), work = await touchPixels(base), { width: w, height: h } = work.canvas;
  const pixels = work.ctx.getImageData(0, 0, w, h).data, body = new Uint8Array(8 + pixels.length);
  new DataView(body.buffer).setUint32(0, w, true); new DataView(body.buffer).setUint32(4, h, true); body.set(pixels, 8);
  const out = new Uint8Array(stroke.click
    ? await invoke('red_eye_picture', body, { headers: { at: JSON.stringify(stroke.points[0]), radius: String(Math.round(stroke.size * Math.max(w, h))), amount: String(Math.round((stroke.strength ?? 1) * 100)) } })
    : await invoke('retouch_picture', body, { headers: { strokes: encodeURIComponent(JSON.stringify([stroke])) } }));
  const view = new DataView(out.buffer, out.byteOffset), [x, y, rw, rh] = [0, 4, 8, 12].map(i => view.getUint32(i, true));
  if (!rw || !rh) return touchSay(stroke.click ? 'No red pupil there. Click the middle of the red, or make the brush bigger.' : 'Nothing changed there.');
  if (!board.getObjects().includes(image) || (image.kbOriginal || image.getSrc()) !== base) return; // undone or replaced meanwhile
  work.ctx.putImageData(new ImageData(new Uint8ClampedArray(out.subarray(16, 16 + rw * rh * 4)), rw, rh), x, y);
  const next = work.canvas.toDataURL(work.clear || base.startsWith('data:image/png') ? 'image/png' : 'image/jpeg', 0.95);
  work.src = next;
  await setPicture(image, { original: next }); // filtered, adjusted and masked again from the new pixels
  touchSay(stroke.tool === 'remove' ? 'Removed. Undo brings it back.' : stroke.click ? 'Red eye fixed. Undo takes it back.' : 'Retouched. Undo takes it back.');
}

// The brush ring, the stroke being painted and where Heal and Clone copy from, drawn with the page overlay.
function drawTouch(ctx) {
  if (!brushing()) return;
  const z = board.getZoom(), ring = (p, r, colour) => {
    for (const [c, wd] of [['rgba(0,0,0,.55)', 3], [colour, 1.5]]) { ctx.strokeStyle = c; ctx.lineWidth = wd / z; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.stroke(); }
  };
  const s = touch.stroke;
  if (s?.scene.length) {
    ctx.save(); ctx.strokeStyle = s.tool === 'remove' ? 'rgba(208,72,155,.45)' : 'rgba(255,255,255,.4)'; ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 2 * brushRadius(s.image, s.size); ctx.lineCap = ctx.lineJoin = 'round'; ctx.beginPath();
    s.scene.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    if (s.scene.length === 1) { ctx.arc(s.scene[0].x, s.scene[0].y, brushRadius(s.image, s.size), 0, 2 * Math.PI); ctx.fill(); } else ctx.stroke();
    ctx.restore();
  }
  const src = touch.source;
  if (src && board.getObjects().includes(src.image) && ['heal', 'clone'].includes(touch.tool)) {
    const r = brushRadius(src.image);
    if (s && touch.offset && touch.pointer) { const uv = toPicture(s.image, touch.pointer); ring(fromPicture(s.image, [uv[0] + touch.offset[0], uv[1] + touch.offset[1]]), r, '#7fc8f8'); }
    else if (!s) { const p = fromPicture(src.image, src.uv); ring(p, r, '#7fc8f8'); ctx.beginPath(); ctx.moveTo(p.x - r / 2, p.y); ctx.lineTo(p.x + r / 2, p.y); ctx.moveTo(p.x, p.y - r / 2); ctx.lineTo(p.x, p.y + r / 2); ctx.stroke(); }
  }
  if (touch.pointer) {
    const image = s?.image || pictureAt(touch.pointer);
    if (image) ring(touch.pointer, s ? brushRadius(image, s.size) : brushRadius(image), touch.picking ? '#7fc8f8' : '#ffffff');
  }
}
function startPhotoTools() {
  board.on('mouse:down', touchDown);
  board.on('mouse:move', touchMove);
  board.on('mouse:up', touchUp);
  board.on('mouse:out', () => { if (touch.pointer) { touch.pointer = null; board.requestRenderAll(); } });
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && brushing() && !$('#create').inert) { touch.tool = null; touch.picking = false; paintTouch(); }
});

// ---- Edit a photo: a page exactly the photo's size, the photo filling it, ready to retouch ----
// The page is the photo's pixels at 300 dpi, so Download gives back a picture the same size as the photo.
function editPhoto(file) {
  return navigateDesign(async () => {
    startBoard();
    const url = await shrink(file), probe = new Image(); probe.src = url; await probe.decode();
    const name = file.name.replace(/\.[^.]*$/, '').slice(0, 60) || 'Photo';
    const size = [probe.naturalWidth, probe.naturalHeight].map(v => Math.min(MAX_SIDE, Math.max(1, Math.round(v / DPI * 1000) / 1000)));
    await open({ format: 2, page: 'custom', size, pages: [blankPage()] }, await uniqueTitle(name), null);
    const image = await fabric.FabricImage.fromURL(url), [w] = pagePx();
    image.set({ left: 0, top: 0, scaleX: w / image.width, scaleY: w / image.width, kbName: 'Photo ' + name });
    board.add(image); image.setCoords(); commitDesign(); // the page thumbnail and Layers too
    touch.tool = 'remove'; touch.source = null; photoTab = 'retouch';
    if (drawer !== 'retouch') showDrawer('retouch'); else paintTouch();
    touchSay('Paint over anything you want gone, or pick another brush.');
  });
}
$('#home-edit').onclick = () => $('#edit-file').click();
$('#edit-file').onchange = event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (file) editPhoto(file).catch(error => { $('#home-status').textContent = `Could not open ${file.name}: ${error}`; });
};
paintTouch();
