// Cut out in Create: choose part of a picture (the subject, a box, a colour, a painted area, a lasso) and keep only
// that part, erase it, or make a sticker of it. Choosing by colour and edges, and the soft clean edge at the end, are
// worked out in Rust (PhotoCraft's selection code); lassos and plain brush strokes are drawn here. The choice is a
// mask the picture's size, shown by dimming everything not chosen. Needs phototools.js for the picture under the
// pointer, its pixels and the page's paint mode.

// ---- Ways to choose ----
const CUT_TOOLS = [
  ['smart', 'Smart brush', '<path d="M4 20c2.5 0 4-1.2 4-3a2 2 0 0 0-4 0v3M8 17l8.5-8.5 2 2L10 19"/><path d="M18 2.5v3M16.5 4h3M21 8v2M20 9h2"/>'],
  ['box', 'Box', '<rect x="3.5" y="5" width="17" height="14" rx="1" stroke-dasharray="3 2.4"/><path d="M9 14l2-3 2 2 2-3"/>'],
  ['wand', 'Magic wand', '<path d="M4 20 14.5 9.5M12.5 7.5l4 4"/><path d="M17 2.5v3M15.5 4h3M20.5 7v2M19.5 8h2M10 3.5v2M9 4.5h2"/>'],
  ['lasso', 'Lasso', '<ellipse cx="12.5" cy="9.5" rx="8" ry="5.5"/><path d="M7.5 14c-1.6 1.2-1.6 3.6.5 3.8 1.8.2 2.3 1.7 1.3 3.2"/>'],
  ['brush', 'Brush', '<path d="M18.5 3.5l2 2-9 9-2-2z"/><path d="M9.5 12.5c-2 0-3.5 1.5-3.5 3.5 0 1.5-1 2.5-2.5 2.5 1 1.5 2.5 2 4 2 2.5 0 4-1.6 4-4z"/>']
];
const CUT_HINTS = {
  smart: 'Paint over what you want. The choice grows out to its edges.',
  box: 'Drag a box around the thing you want; it finds the thing inside.',
  wand: 'Click a colour to choose everything that colour around it, like a plain sky or wall. Colour match sets how alike.',
  lasso: 'Hold the mouse button down and draw around what you want.',
  brush: 'Paint exactly what to add or take away, to fix an edge.'
};
const CUT_STEPS = 6; // Step back remembers this many choices (each is a copy of the mask)
const cut = { loading: false, tool: 'smart', take: false, px: 30, tolerance: 32, soft: 3, image: null, base: null, w: 0, h: 0, mask: null, any: false, steps: [], drag: null, pointer: null, view: null };
let cutQueue = Promise.resolve();
const cutting = () => mode === 'create' && !!board && !!design && drawer === 'retouch' && photoTab === 'cutout' && !cropSession;
const cutPictureGone = () => !cut.image || !board.getObjects().includes(cut.image) || (cut.image.kbOriginal || cut.image.getSrc()) !== cut.base;

function paintCut() {
  const tools = $('#cut-tools');
  if (!tools.children.length) tools.append(...CUT_TOOLS.map(([key, label, icon]) => {
    const b = button('', () => { cut.tool = key; cut.drag = null; paintCut(); }); b.dataset.cut = key; b.title = label;
    b.insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>`); b.append(label);
    return b;
  }));
  for (const b of tools.children) { b.classList.toggle('on', b.dataset.cut === cut.tool); b.setAttribute('aria-pressed', b.dataset.cut === cut.tool); }
  for (const b of document.querySelectorAll('#cut-mode [data-cut-mode]')) { const on = (b.dataset.cutMode === 'take') === cut.take; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }
  $('#cut-size').value = cut.px; $('#cut-size-out').textContent = cut.px + ' px';
  $('#cut-tolerance').value = cut.tolerance; $('#cut-tolerance-out').textContent = cut.tolerance;
  $('#cut-soft').value = cut.soft; $('#cut-soft-out').textContent = cut.soft ? cut.soft + ' px' : 'Off';
  $('#cut-size-row').hidden = !['smart', 'brush'].includes(cut.tool);
  $('#cut-tolerance-row').hidden = cut.tool !== 'wand';
  if (cut.image && cutPictureGone()) resetCut();
  if (!cut.image && !cut.loading && cutting()) { // a page with one picture, as Edit a photo makes, needs no click to choose it
    const pictures = board.getObjects().filter(o => o.type === 'image' && o.visible !== false);
    if (pictures.length === 1) { cut.loading = true; cutQueued(() => chooseCutPicture(pictures[0]).finally(() => { cut.loading = false; })); }
  }
  $('#cut-actions').hidden = !cut.any;
  $('#cut-back').disabled = !cut.steps.length;
  $('#cut-hint').textContent = !cut.image ? 'Click the picture you want to cut out.' : CUT_HINTS[cut.tool];
}
for (const b of document.querySelectorAll('#cut-mode [data-cut-mode]')) b.onclick = () => { cut.take = b.dataset.cutMode === 'take'; paintCut(); };
$('#cut-size').oninput = e => { cut.px = +e.target.value; paintCut(); board?.requestRenderAll(); };
$('#cut-tolerance').oninput = e => { cut.tolerance = +e.target.value; paintCut(); };
$('#cut-soft').oninput = e => { cut.soft = +e.target.value; paintCut(); };

// ---- The picture being cut out, and its mask ----
function resetCut() {
  Object.assign(cut, { image: null, base: null, w: 0, h: 0, mask: null, any: false, steps: [], drag: null, view: null });
}
async function chooseCutPicture(image) {
  const base = image.kbOriginal || image.getSrc(), work = await touchPixels(base);
  Object.assign(cut, { image, base, w: work.canvas.width, h: work.canvas.height, mask: new Uint8Array(work.canvas.width * work.canvas.height), any: false, steps: [], view: null });
  paintCut(); board.requestRenderAll();
}
// [w][h][RGBA] then any extra bytes, the body Rust's picture commands take.
async function cutBody(extra) {
  const work = await touchPixels(cut.base), { width: w, height: h } = work.canvas, pixels = work.ctx.getImageData(0, 0, w, h).data;
  const body = new Uint8Array(8 + pixels.length + (extra ? extra.length : 0)), view = new DataView(body.buffer);
  view.setUint32(0, w, true); view.setUint32(4, h, true); body.set(pixels, 8);
  if (extra) body.set(extra, 8 + pixels.length);
  return body;
}
// Adds a region (x, y, w, h and one byte a pixel) to the mask, or takes it away.
function mergeCut(x, y, rw, rh, bytes, replace = false) {
  cut.steps.push(cut.mask.slice()); if (cut.steps.length > CUT_STEPS) cut.steps.shift();
  if (replace) cut.mask.fill(0);
  for (let yy = 0; yy < rh; yy++) {
    const row = (y + yy) * cut.w + x;
    for (let xx = 0; xx < rw; xx++) {
      const v = bytes[yy * rw + xx], i = row + xx;
      cut.mask[i] = cut.take && !replace ? Math.max(0, cut.mask[i] - v) : Math.max(cut.mask[i], v);
    }
  }
  cutChanged();
}
function cutChanged() {
  const had = cut.any;
  cut.any = cut.mask.some(v => v > 0);
  cut.view = cut.any ? cutView() : null;
  paintCut(); board.requestRenderAll();
  if (cut.any && !had) $('#cut-actions').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); // the buttons can sit below a small window's edge
}
// What the page shows: everything not chosen dimmed, with a pink line along the edge about 2 screen pixels wide, at
// up to 1000 px. Redrawn when zooming changes how wide the line would look.
function cutView() {
  const k = Math.min(1, 1000 / Math.max(cut.w, cut.h)), vw = Math.max(1, Math.round(cut.w * k)), vh = Math.max(1, Math.round(cut.h * k));
  const zoom = board.getZoom(), onScreen = cut.image.width * Math.abs(cut.image.scaleX || 1) * zoom / (cut.image.width / k); // screen px a view px
  const line = Math.max(1, Math.min(12, Math.round(2 / Math.max(onScreen, 0.01))));
  const canvas = Object.assign(document.createElement('canvas'), { width: vw, height: vh, kbZoom: zoom }), ctx = canvas.getContext('2d'), img = ctx.createImageData(vw, vh);
  const inside = new Uint8Array(vw * vh);
  for (let y = 0; y < vh; y++) {
    const row = Math.min(cut.h - 1, Math.floor((y + 0.5) / k)) * cut.w;
    for (let x = 0; x < vw; x++) inside[y * vw + x] = cut.mask[row + Math.min(cut.w - 1, Math.floor((x + 0.5) / k))] >= 128;
  }
  // Inside pixels within `line` of an outside one, by a square window: count outside pixels across, then down.
  const across = new Uint16Array(vw * vh), near = new Uint16Array(vw * vh);
  for (let y = 0; y < vh; y++) {
    let n = 0;
    for (let x = -line; x < vw; x++) {
      if (x + line < vw && !inside[y * vw + x + line]) n++;
      if (x - line - 1 >= 0 && !inside[y * vw + x - line - 1]) n--;
      if (x >= 0) across[y * vw + x] = n;
    }
  }
  for (let x = 0; x < vw; x++) {
    let n = 0;
    for (let y = -line; y < vh; y++) {
      if (y + line < vh) n += across[(y + line) * vw + x];
      if (y - line - 1 >= 0) n -= across[(y - line - 1) * vw + x];
      if (y >= 0) near[y * vw + x] = n;
    }
  }
  for (let i = 0; i < vw * vh; i++) img.data.set(!inside[i] ? [40, 16, 48, 150] : near[i] ? [255, 79, 163, 255] : [0, 0, 0, 0], i * 4);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// ---- Choosing ----
const cutSay = text => { $('#create-saved').textContent = text; };
const cutRadius = () => cut.px / board.getZoom() / Math.abs(cut.image.scaleX || 1); // brush radius in the picture's own pixels
async function cutPick(pick, replace = false) {
  cutSay('Looking…');
  const base = cut.base, out = new Uint8Array(await invoke('select_picture', await cutBody(), { headers: { pick: encodeURIComponent(JSON.stringify(pick)) } }));
  if (cutPictureGone() || cut.base !== base) return false;
  const view = new DataView(out.buffer, out.byteOffset), [x, y, rw, rh] = [0, 4, 8, 12].map(i => view.getUint32(i, true));
  if (!rw || !rh) { cutSay(pick.kind === 'subject' ? 'No clear subject found. Choose it with the Smart brush or the Box.' : 'Nothing was found there.'); return false; }
  mergeCut(x, y, rw, rh, out.subarray(16, 16 + rw * rh), replace);
  cutSay(cut.take ? 'Taken away.' : 'Chosen. Keep going, or pick what to do with it below.');
  return true;
}
// A lasso or plain brush stroke, drawn into a mask of just the area it covers.
function cutDraw(points, brushR) {
  const pts = points.map(([u, v]) => [u * cut.w, v * cut.h]), pad = brushR ? brushR + 2 : 2;
  const x0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p[0])) - pad)), y0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p[1])) - pad));
  const x1 = Math.min(cut.w, Math.ceil(Math.max(...pts.map(p => p[0])) + pad)), y1 = Math.min(cut.h, Math.ceil(Math.max(...pts.map(p => p[1])) + pad));
  if (x1 <= x0 || y1 <= y0) return;
  const rw = x1 - x0, rh = y1 - y0, ctx = Object.assign(document.createElement('canvas'), { width: rw, height: rh }).getContext('2d', { willReadFrequently: true });
  ctx.translate(-x0, -y0); ctx.fillStyle = ctx.strokeStyle = '#fff'; ctx.beginPath();
  pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  if (brushR) {
    ctx.lineWidth = 2 * brushR; ctx.lineCap = ctx.lineJoin = 'round';
    if (pts.length === 1) { ctx.arc(pts[0][0], pts[0][1], brushR, 0, 2 * Math.PI); ctx.fill(); } else ctx.stroke();
  } else { ctx.closePath(); ctx.fill(); }
  const data = ctx.getImageData(0, 0, rw, rh).data, bytes = new Uint8Array(rw * rh);
  for (let i = 0; i < bytes.length; i++) bytes[i] = data[i * 4 + 3];
  mergeCut(x0, y0, rw, rh, bytes);
  cutSay(cut.take ? 'Taken away.' : 'Chosen. Keep going, or pick what to do with it below.');
}
function cutQueued(job) {
  cutQueue = cutQueue.then(job).catch(error => cutSay('Could not cut it out: ' + error));
  track(cutQueue);
  return cutQueue;
}

function cutDown({ e }) {
  if (!cutting() || spacePan || e.button !== 0) return;
  const at = board.getScenePoint(e), image = pictureAt(at, cut.px / board.getZoom());
  if (cut.image && cutPictureGone()) resetCut();
  if (!image) return cutSay('Click on a picture to cut it out.');
  if (image !== cut.image) {
    const started = !!cut.image;
    cutQueued(() => chooseCutPicture(image).then(() => cutSay(started ? 'Started again on this picture.' : 'Now choose what to keep, or click Remove the background.')));
    return;
  }
  const uv = toPicture(image, at).map(round);
  if (cut.tool === 'wand') return void cutQueued(() => cutPick({ kind: 'wand', at: uv, tolerance: cut.tolerance }));
  cut.drag = { start: at, points: [uv], scene: [at] };
  board.requestRenderAll();
}
function cutMove({ e }) {
  if (!cutting()) { if (cut.pointer) { cut.pointer = null; board.requestRenderAll(); } return; }
  const at = board.getScenePoint(e), d = cut.drag;
  cut.pointer = at;
  if (d && cut.image && d.points.length < 2000) {
    const uv = toPicture(cut.image, at).map(round), last = d.points.at(-1), step = ['smart', 'brush'].includes(cut.tool) ? Math.max(1, cutRadius() / 4) : 2;
    if (Math.hypot((uv[0] - last[0]) * cut.w, (uv[1] - last[1]) * cut.h) >= step) { d.points.push(uv); d.scene.push(at); }
  }
  board.requestRenderAll();
}
function cutUp() {
  const d = cut.drag;
  cut.drag = null;
  if (!d || !cut.image) return;
  board.requestRenderAll();
  const end = d.points.at(-1);
  if (cut.tool === 'box') {
    const [a, b] = [d.points[0], end];
    if (Math.abs(a[0] - b[0]) * cut.w < 4 || Math.abs(a[1] - b[1]) * cut.h < 4) return cutSay('Drag a box around the thing you want.');
    cutQueued(() => cutPick({ kind: 'box', rect: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])] }));
  } else if (cut.tool === 'lasso') {
    if (d.points.length < 3) return cutSay('Hold the mouse button down and draw right around it.');
    cutDraw(d.points, 0);
  } else if (cut.tool === 'brush') cutDraw(d.points, cutRadius());
  else if (cut.tool === 'smart') {
    const size = Math.min(0.5, Math.max(0.001, cutRadius() / Math.max(cut.w, cut.h)));
    cutQueued(() => cutPick({ kind: 'smart', points: d.points.map(p => p.map(v => Math.min(1, Math.max(0, v)))), size: round(size) }));
  }
}

// ---- Using the choice ----
// Rust keeps what the mask covers, with a soft clean edge, and sends back the part that still shows.
async function cutKeep(mask) {
  const base = cut.base, out = new Uint8Array(await invoke('cutout_picture', await cutBody(mask), { headers: { finish: encodeURIComponent(JSON.stringify({ soft: cut.soft })) } }));
  if (cutPictureGone() || cut.base !== base) return null;
  const view = new DataView(out.buffer, out.byteOffset), [x, y, w, h] = [0, 4, 8, 12].map(i => view.getUint32(i, true));
  return { x, y, w, h, pixels: w && h ? new ImageData(new Uint8ClampedArray(out.subarray(16, 16 + w * h * 4)), w, h) : null };
}
// The picture's pixels replaced by what was kept, refiltered, as one undo step.
async function cutReplace(kept, done) {
  const image = cut.image, canvas = Object.assign(document.createElement('canvas'), { width: cut.w, height: cut.h });
  if (kept.pixels) canvas.getContext('2d').putImageData(kept.pixels, kept.x, kept.y);
  const next = canvas.toDataURL('image/png'), keep = { width: image.width, height: image.height, cropX: image.cropX, cropY: image.cropY };
  await image.setSrc(image.kbFilter ? await filterPicture(next, image.kbFilter) : next); image.set(keep); // same pixel size, so a crop stays put
  if (image.kbFilter) image.kbOriginal = next;
  image.setCoords(); commitDesign();
  await chooseCutPicture(image); // carry on cutting the new pixels
  cutSay(done);
}
function cutInverse() { return cut.mask.map(v => 255 - v); }
$('#cut-keep').onclick = () => cutQueued(async () => {
  if (!cut.any) return;
  cutSay('Cutting out…');
  const kept = await cutKeep(cut.mask);
  if (kept) await cutReplace(kept, 'Only the chosen part is left. Undo brings the rest back.');
});
$('#cut-erase').onclick = () => cutQueued(async () => {
  if (!cut.any) return;
  cutSay('Erasing…');
  const kept = await cutKeep(cutInverse());
  if (kept) await cutReplace(kept, 'Erased. Undo brings it back.');
});
// A sticker is a new picture of just the chosen part (as much as the crop shows), placed exactly over it, with an
// optional white outline as Canva gives stickers.
$('#cut-sticker').onclick = () => cutQueued(async () => {
  if (!cut.any) return;
  cutSay('Making a sticker…');
  const image = cut.image, mask = cut.mask.slice(), cx = Math.round(image.cropX || 0), cy = Math.round(image.cropY || 0), cw = Math.round(image.width), ch = Math.round(image.height);
  for (let y = 0; y < cut.h; y++) for (let x = 0; x < cut.w; x++) if (x < cx || y < cy || x >= cx + cw || y >= cy + ch) mask[y * cut.w + x] = 0;
  const kept = await cutKeep(mask);
  if (!kept) return;
  if (!kept.pixels) return cutSay('That part is outside the crop.');
  const outline = $('#cut-outline').checked ? Math.max(2, Math.round(Math.max(kept.w, kept.h) * 0.025)) : 0;
  const piece = Object.assign(document.createElement('canvas'), { width: kept.w, height: kept.h });
  piece.getContext('2d').putImageData(kept.pixels, 0, 0);
  const sheet = Object.assign(document.createElement('canvas'), { width: kept.w + 2 * outline, height: kept.h + 2 * outline }), ctx = sheet.getContext('2d');
  if (outline) {
    for (let i = 0; i < 24; i++) ctx.drawImage(piece, outline + outline * Math.cos(i * Math.PI / 12), outline + outline * Math.sin(i * Math.PI / 12));
    ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, sheet.width, sheet.height);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.drawImage(piece, outline, outline);
  const sticker = await fabric.FabricImage.fromURL(sheet.toDataURL('image/png'));
  sticker.set({ scaleX: image.scaleX, scaleY: image.scaleY, angle: image.angle, flipX: image.flipX, flipY: image.flipY, kbName: 'Sticker' });
  sticker.setPositionByOrigin(fromPicture(image, [(kept.x + kept.w / 2) / cut.w, (kept.y + kept.h / 2) / cut.h]), 'center', 'center');
  board.add(sticker); sticker.setCoords();
  cutDone();
  board.setActiveObject(sticker); board.requestRenderAll(); commitDesign(); paintPanel();
  cutSay('Sticker added on top. Drag it anywhere, or save it to My elements.');
});
$('#cut-back').onclick = () => { if (cut.steps.length) { cut.mask = cut.steps.pop(); cutChanged(); } };
$('#cut-clear').onclick = () => { if (cut.mask) { mergeCut(0, 0, 0, 0, [], true); cutSay('Cleared. Choose again.'); } };
function cutDone() { cut.drag = null; resetCut(); photoTab = 'retouch'; if (drawer === 'retouch') showDrawer('retouch'); }
$('#cut-done').onclick = cutDone;

// One click: find the subject and keep only it.
$('#cut-auto').onclick = () => cutQueued(async () => {
  if (cut.image && cutPictureGone()) resetCut();
  if (!cut.image) {
    const pictures = board.getObjects().filter(o => o.type === 'image' && o.visible !== false);
    if (pictures.length !== 1) return cutSay('First click the picture whose background should go.');
    await chooseCutPicture(pictures[0]);
  }
  cutSay('Finding the subject…');
  const take = cut.take; cut.take = false;
  const found = await cutPick({ kind: 'subject' }, true).finally(() => { cut.take = take; });
  if (!found) return;
  cutSay('Removing the background…');
  const kept = await cutKeep(cut.mask);
  if (kept) await cutReplace(kept, 'Background removed. Undo brings it back.');
});
$('#prop-cutout').onclick = () => {
  const image = board.getActiveObject();
  photoTab = 'cutout';
  if (drawer !== 'retouch') showDrawer('retouch'); else paintTouch();
  if (image?.type === 'image' && image !== cut.image) cutQueued(() => chooseCutPicture(image).then(() => cutSay('Choose what to keep, or click Remove the background.')));
};

// The chosen picture's outline, the dimmed part not chosen, and the box, lasso or brush being drawn.
function drawCut(ctx) {
  if (!cutting()) return;
  const z = board.getZoom(), image = cut.image && !cutPictureGone() ? cut.image : null;
  if (image) {
    const [nw, nh] = naturalSize(image);
    ctx.save(); ctx.transform(...image.calcTransformMatrix());
    ctx.beginPath(); ctx.rect(-image.width / 2, -image.height / 2, image.width, image.height); ctx.clip();
    if (cut.view && Math.abs(Math.log(z / cut.view.kbZoom)) > 0.4) cut.view = cutView();
    if (cut.view) ctx.drawImage(cut.view, -image.width / 2 - (image.cropX || 0), -image.height / 2 - (image.cropY || 0), nw, nh);
    ctx.restore();
    const corners = image.getCoords();
    ctx.save(); ctx.strokeStyle = '#d0489b'; ctx.lineWidth = 2 / z; ctx.setLineDash([6 / z, 4 / z]); ctx.beginPath();
    corners.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.stroke(); ctx.restore();
  }
  const d = cut.drag, colour = cut.take ? 'rgba(60,60,70,.45)' : 'rgba(208,72,155,.45)';
  if (d && image) {
    ctx.save(); ctx.lineWidth = 2 / z; ctx.strokeStyle = '#d0489b';
    if (cut.tool === 'box' && cut.pointer) { ctx.setLineDash([6 / z, 4 / z]); ctx.strokeRect(d.start.x, d.start.y, cut.pointer.x - d.start.x, cut.pointer.y - d.start.y); }
    else if (cut.tool === 'lasso') { ctx.beginPath(); d.scene.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke(); }
    else {
      const r = cut.px / z;
      ctx.strokeStyle = ctx.fillStyle = colour; ctx.lineWidth = 2 * r; ctx.lineCap = ctx.lineJoin = 'round'; ctx.beginPath();
      d.scene.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      if (d.scene.length === 1) { ctx.arc(d.scene[0].x, d.scene[0].y, r, 0, 2 * Math.PI); ctx.fill(); } else ctx.stroke();
    }
    ctx.restore();
  }
  if (cut.pointer && ['smart', 'brush'].includes(cut.tool) && image) {
    for (const [c, wd] of [['rgba(0,0,0,.55)', 3], ['#ffffff', 1.5]]) { ctx.strokeStyle = c; ctx.lineWidth = wd / z; ctx.beginPath(); ctx.arc(cut.pointer.x, cut.pointer.y, cut.px / z, 0, 2 * Math.PI); ctx.stroke(); }
  }
}
function startCutTools() {
  board.on('mouse:down', cutDown);
  board.on('mouse:move', cutMove);
  board.on('mouse:up', cutUp);
  board.on('mouse:out', () => { if (cut.pointer) { cut.pointer = null; board.requestRenderAll(); } });
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && cut.drag && !$('#create').inert) { cut.drag = null; board.requestRenderAll(); }
});
paintCut();
