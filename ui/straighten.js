// Straighten, the third tab of Create's Edit photo drawer: drag four corners onto something photographed at an angle
// (a worksheet, a poster, a whiteboard) and Rust's straighten_picture pulls it out flat, as if photographed from straight
// in front. A loupe shows the pixels under a corner while it's dragged. Needs create.js, phototools.js and cutout.js.

const straightTool = { image: null, corners: null, drag: null, busy: false };
const STRAIGHT_START = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]; // top left, top right, bottom right, bottom left
const straightening = () => mode === 'create' && !!board && !!design && drawer === 'retouch' && photoTab === 'straighten' && !cropSession;
const straightGone = () => !straightTool.image || !board.getObjects().includes(straightTool.image);
const straightSay = text => { $('#straight-hint').textContent = text; };

function paintStraighten() {
  if (straightTool.image && straightGone()) Object.assign(straightTool, { image: null, corners: null, drag: null });
  if (!straightTool.image && straightening()) { // the selected picture, or the only one on the page
    const active = board.getActiveObject() || (board.getObjects().includes(touch.wasSelected) ? touch.wasSelected : null), pictures = board.getObjects().filter(o => o.type === 'image' && o.visible !== false);
    const image = active?.type === 'image' ? active : pictures.length === 1 ? pictures[0] : null;
    if (image) chooseStraighten(image);
  }
  $('#straight-actions').hidden = !straightTool.image;
  $('#straight-go').disabled = straightTool.busy;
  if (!straightTool.busy) straightSay(straightTool.image ? 'Drag the four pink corners onto the corners of the page, poster or board in the photo, then click Straighten.' : 'Click the picture you want to straighten.');
}
function chooseStraighten(image) {
  Object.assign(straightTool, { image, corners: STRAIGHT_START.map(c => c.slice()), drag: null });
  board.requestRenderAll();
}

// ---- Dragging the corners ----
const straightPoints = () => straightTool.corners.map(uv => fromPicture(straightTool.image, uv));
function straightCorner(at) {
  const r = 14 / board.getZoom(), points = straightPoints();
  let best = -1, near = r;
  points.forEach((p, i) => { const d = Math.hypot(p.x - at.x, p.y - at.y); if (d < near) { near = d; best = i; } });
  return best;
}
function straightDown({ e }) {
  if (!straightening() || spacePan || e.button !== 0 || straightTool.busy) return;
  const at = board.getScenePoint(e);
  if (straightTool.image && !straightGone()) {
    const i = straightCorner(at);
    if (i >= 0) { straightTool.drag = { i, at }; board.requestRenderAll(); return; }
    if (straightTool.image.containsPoint(at)) return;
  }
  const image = pictureAt(at, 0);
  if (image && image !== straightTool.image) { chooseStraighten(image); paintStraighten(); }
}
function straightMove({ e }) {
  if (!straightening() || !straightTool.image) return;
  const at = board.getScenePoint(e);
  if (straightTool.drag) {
    // Corners may go a little past the picture, for a page whose corner is cut off by the photo's edge.
    straightTool.corners[straightTool.drag.i] = toPicture(straightTool.image, at).map(v => Math.min(1.5, Math.max(-0.5, v)));
    straightTool.drag.at = at;
    board.requestRenderAll();
  } else board.setCursor(straightCorner(at) >= 0 ? 'move' : 'crosshair');
}
function straightUp() {
  if (!straightTool.drag) return;
  straightTool.drag = null; board.requestRenderAll();
}

// ---- Straighten: the original's pixels go to Rust; the flat picture comes back in the same place ----
async function straightenPicture() {
  const image = straightTool.image;
  if (!image || straightGone() || straightTool.busy) return;
  straightTool.busy = true; paintStraighten(); straightSay('Straightening…');
  try {
    const work = await touchPixels(image.kbOriginal || image.getSrc()), { width: w, height: h } = work.canvas, pixels = work.ctx.getImageData(0, 0, w, h).data;
    const body = new Uint8Array(8 + pixels.length), view = new DataView(body.buffer);
    view.setUint32(0, w, true); view.setUint32(4, h, true); body.set(pixels, 8);
    const out = new Uint8Array(await invoke('straighten_picture', body, { headers: { corners: encodeURIComponent(JSON.stringify(straightTool.corners)) } }));
    const ow = new DataView(out.buffer).getUint32(0, true), oh = new DataView(out.buffer).getUint32(4, true);
    const canvas = pictureCanvas(ow, oh), ctx = canvas.getContext('2d');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(out.buffer, 8, ow * oh * 4), ow, oh), 0, 0);
    let clear = work.clear;
    for (let i = 8 + 3; i < out.length && !clear; i += 4) clear = out[i] < 255;
    const next = canvas.toDataURL(clear ? 'image/png' : 'image/jpeg', 0.92);
    // Where the corners were on the page becomes the flat picture's middle; the pixel scale stays the same.
    const middle = straightPoints().reduce((m, p) => ({ x: m.x + p.x / 4, y: m.y + p.y / 4 }), { x: 0, y: 0 });
    const done = await setPicture(image, { original: next, kbMask: undefined, kbLocal: undefined, resized: true, place: o => o.setPositionByOrigin(new fabric.Point(middle.x, middle.y), 'center', 'center') });
    if (done) { chooseStraighten(image); straightSay('Straightened. Click Undo to put it back, or drag the corners again.'); }
  } catch (error) {
    straightSay(`Couldn't straighten it: ${error}`);
  } finally {
    straightTool.busy = false; $('#straight-go').disabled = false;
  }
}
$('#straight-go').onclick = straightenPicture;
$('#straight-reset').onclick = () => { if (straightTool.image) { straightTool.corners = STRAIGHT_START.map(c => c.slice()); board.requestRenderAll(); } };
$('#straight-done').onclick = () => { Object.assign(straightTool, { image: null, corners: null, drag: null }); photoTab = 'retouch'; showDrawer('retouch'); };

// ---- Drawing: the rest of the picture dimmed, the shape to flatten outlined, and the loupe ----
function drawStraighten(ctx) {
  if (!straightening() || !straightTool.image || straightGone()) return;
  const z = board.getZoom(), image = straightTool.image, points = straightPoints(), box = image.getCoords();
  ctx.save();
  ctx.beginPath(); box.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
  points.slice().reverse().forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
  ctx.fillStyle = 'rgba(40,30,50,.45)'; ctx.fill('evenodd');
  ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
  ctx.strokeStyle = '#d0489b'; ctx.lineWidth = 2 / z; ctx.stroke();
  // Thirds inside the shape, so its lines can be checked against the page's printed lines.
  ctx.setLineDash([4 / z, 4 / z]); ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1 / z;
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  for (const t of [1 / 3, 2 / 3]) {
    for (const [a, b, c, d] of [[0, 1, 3, 2], [0, 3, 1, 2]]) { const p = lerp(points[a], points[b], t), q = lerp(points[c], points[d], t); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
  }
  ctx.setLineDash([]);
  points.forEach((p, i) => {
    ctx.beginPath(); ctx.arc(p.x, p.y, (straightTool.drag?.i === i ? 9 : 7) / z, 0, 2 * Math.PI);
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 3 / z; ctx.strokeStyle = '#d0489b'; ctx.stroke();
  });
  if (straightTool.drag) drawStraightLoupe(ctx, points[straightTool.drag.i], z);
  ctx.restore();
}
// A circle above the dragged corner showing the picture three times bigger, with a cross where the corner is.
function drawStraightLoupe(ctx, p, z) {
  const image = straightTool.image, r = 56 / z, k = 3, centre = { x: p.x, y: p.y - r - 24 / z }, [nw, nh] = naturalSize(image);
  ctx.save();
  ctx.beginPath(); ctx.arc(centre.x, centre.y, r, 0, 2 * Math.PI); ctx.fillStyle = '#fff'; ctx.fill(); ctx.clip();
  ctx.translate(centre.x, centre.y); ctx.scale(k, k); ctx.translate(-p.x, -p.y);
  ctx.transform(...image.calcTransformMatrix());
  ctx.drawImage(image.getElement(), -image.width / 2 - (image.cropX || 0), -image.height / 2 - (image.cropY || 0), nw, nh);
  ctx.restore();
  ctx.save(); ctx.strokeStyle = '#d0489b'; ctx.lineWidth = 2 / z;
  ctx.beginPath(); ctx.arc(centre.x, centre.y, r, 0, 2 * Math.PI); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(centre.x - 10 / z, centre.y); ctx.lineTo(centre.x + 10 / z, centre.y); ctx.moveTo(centre.x, centre.y - 10 / z); ctx.lineTo(centre.x, centre.y + 10 / z); ctx.stroke();
  ctx.restore();
}

function startStraightenTools() {
  board.on('mouse:down', straightDown);
  board.on('mouse:move', straightMove);
  board.on('mouse:up', straightUp);
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && straightTool.drag && !$('#create').inert) { straightTool.drag = null; board.requestRenderAll(); }
});
