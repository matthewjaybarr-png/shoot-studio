// The Draw drawer in Create: Pen, Marker, Highlighter, Glow pen and Eraser, colour swatches, Thickness and
// Transparency. The pens are Fabric's PencilBrush set up differently; each stroke becomes its own path that can be
// moved, recoloured or deleted. The Eraser rubs out just the part of a drawn line it is dragged over, cutting the line
// into pieces (each still its own line), or takes away whole lines. Fabric 7 has no pixel eraser, and a pixel eraser
// would rub out the photos under the drawing too. Needs create.js and phototools.js.

const DRAW_TOOLS = [
  ['pen', 'Pen', '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>'],
  ['marker', 'Marker', '<path d="M6 18l-2 2h5l1-1"/><path d="M7 17l-1-4 8-8 5 5-8 8z" fill="currentColor" fill-opacity=".25"/>'],
  ['highlighter', 'Highlighter', '<path d="M4 20h7"/><path d="M8 16l-1-3 8-8 4 4-8 8z"/><rect x="3" y="18" width="12" height="3" fill="currentColor" fill-opacity=".3" stroke="none"/>'],
  ['glow', 'Glow pen', '<path d="M5 19c4-1 7-5 9-9s4-5 5-5"/><path d="M5 19c4-1 7-5 9-9s4-5 5-5" stroke-width="5" stroke-opacity=".25"/>'],
  ['eraser', 'Eraser', '<path d="M8 20h12"/><path d="M4 15l9-9 6 6-8 8H8z"/><path d="M9 10l6 6"/>']
];
// Each tool's look: how much wider than the Thickness slider, the line ends, how see-through, and its name in Layers.
const DRAW_LOOKS = {
  pen: { k: 1, cap: 'round', opacity: 1, name: 'Drawing' },
  marker: { k: 3, cap: 'round', opacity: 1, name: 'Marker' },
  highlighter: { k: 6, cap: 'butt', opacity: 0.45, name: 'Highlighter', blend: 'multiply' },
  glow: { k: 1.5, cap: 'round', opacity: 1, name: 'Glow pen', glow: true }
};
const DRAW_SWATCHES = ['#222222', '#ffffff', '#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#ec407a', '#8d6e63'];
const drawing = { tool: 'pen', colour: '#444444', width: 3, see: 0, rub: 'part', erased: false, pointer: null };
const erasing = () => mode === 'create' && !!board && drawer === 'draw' && drawing.tool === 'eraser';
const DRAWN = new Set(Object.values(DRAW_LOOKS).map(l => l.name));

function paintDrawTools() {
  const tools = $('#draw-tools'), swatches = $('#draw-swatches');
  if (!tools.children.length) tools.append(...DRAW_TOOLS.map(([key, label, icon]) => {
    const b = button('', () => pickDrawTool(key)); b.dataset.draw = key; b.title = label;
    b.insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>`); b.append(label);
    return b;
  }));
  if (!swatches.children.length) swatches.append(...DRAW_SWATCHES.map(c => {
    const b = button('', () => { drawing.colour = c; setDrawBrush(); paintDrawTools(); }); b.dataset.colour = c; b.style.background = c; b.title = c; b.setAttribute('aria-label', 'Colour ' + c);
    return b;
  }));
  for (const b of tools.children) { b.classList.toggle('on', b.dataset.draw === drawing.tool); b.setAttribute('aria-pressed', b.dataset.draw === drawing.tool); }
  for (const b of swatches.children) b.classList.toggle('on', b.dataset.colour === drawing.colour);
  $('#draw-colour').value = drawing.colour;
  $('#draw-width').value = drawing.width; $('#draw-width-out').textContent = drawing.width + ' px';
  $('#draw-see').value = drawing.see; $('#draw-see-out').textContent = drawing.see + '%';
  $('#draw-pen-options').hidden = drawing.tool === 'eraser';
  $('#draw-eraser-options').hidden = drawing.tool !== 'eraser';
  for (const b of $('#draw-rub').children) { b.classList.toggle('on', b.dataset.rub === drawing.rub); b.setAttribute('aria-pressed', b.dataset.rub === drawing.rub); }
  $('#draw-hint').textContent = drawing.tool === 'eraser' ? (drawing.rub === 'part' ? 'Rub over a drawn line to take that part away. Undo brings it back.' : 'Drag over a drawn line to take the whole line away. Undo brings it back.') : drawing.tool === 'highlighter' ? 'Drag over words or a picture to highlight them; they still show through.' : 'Draw on the page with the mouse. Each line is its own item you can move, recolour or delete.';
}
function pickDrawTool(key) {
  drawing.tool = key; setDrawBrush(); paintDrawTools();
  if (drawer === 'draw') toggleDraw(true);
  if (typeof paintTouch === 'function') paintTouch(); // the Eraser takes the mouse like a retouch brush
}
// The pen that draws next, from the tool, colour and thickness.
function setDrawBrush() {
  if (!board) return;
  const look = DRAW_LOOKS[drawing.tool] || DRAW_LOOKS.pen, brush = board.freeDrawingBrush;
  brush.color = look.glow ? mixWhite(drawing.colour, 0.6) : drawing.colour; brush.width = Math.max(1, drawing.width * look.k); brush.strokeLineCap = look.cap; brush.strokeLineJoin = 'round';
  brush.shadow = look.glow ? new fabric.Shadow({ color: drawing.colour, blur: Math.max(14, drawing.width * 6), offsetX: 0, offsetY: 0 }) : null;
}
// The glow pen's bright middle: its colour most of the way to white.
function mixWhite(colour, k) {
  const n = parseInt(colour.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round(v + (255 - v) * k));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}
// A finished line gets the tool's name, how see-through it is, and (for the highlighter) a blend so what's under it shows.
function drawnPath(path) {
  const look = DRAW_LOOKS[drawing.tool] || DRAW_LOOKS.pen;
  path.set({ kbName: look.name, opacity: look.opacity * (1 - drawing.see / 100), globalCompositeOperation: look.blend || 'source-over' });
}
$('#draw-colour').oninput = e => { drawing.colour = e.target.value; setDrawBrush(); paintDrawTools(); };
$('#draw-width').oninput = e => { drawing.width = +e.target.value; setDrawBrush(); paintDrawTools(); };
$('#draw-see').oninput = e => { drawing.see = +e.target.value; paintDrawTools(); };
for (const b of $('#draw-rub').children) b.onclick = () => { drawing.rub = b.dataset.rub; paintDrawTools(); };

// ---- The Eraser ----
const eraserRadius = () => Math.max(6, drawing.width * 3) / board.getZoom();
function eraseAt(at) {
  const r = eraserRadius(), vp = board.viewportTransform, x = at.x * vp[0] + vp[4], y = at.y * vp[3] + vp[5];
  // Touching the line itself, not just its box: any drawn pixel in a square the eraser's size. Fabric looks at one
  // pixel unless told a tolerance, and a thin pen zoomed out is only a pixel wide.
  const tolerance = board.targetFindTolerance;
  board.setTargetFindTolerance(Math.max(2, r * board.getZoom()));
  try {
    for (const o of board.getObjects().filter(o => o.type === 'path' && DRAWN.has(o.kbName) && !o.kbLocked)) {
      const box = o.getBoundingRect();
      if (at.x < box.left - r || at.x > box.left + box.width + r || at.y < box.top - r || at.y > box.top + box.height + r) continue;
      if (drawing.rub === 'part') { if (rubOut(o, at, r)) drawing.erased = true; }
      else if (!board.isTargetTransparent(o, x, y)) { board.remove(o); drawing.erased = true; }
    }
  } finally { board.setTargetFindTolerance(tolerance); }
}
// Rubs out the bits of a line within r of a page point. A pen line is a chain of curves; one the eraser touches is
// traced as points a few pixels apart, the points under the eraser go, and what's left becomes separate lines, each
// placed exactly where it was. A line it doesn't touch is left as it is.
function rubOut(o, at, r) {
  const m = o.calcTransformMatrix(), local = fabric.util.transformPoint(at, fabric.util.invertTransform(m)).add(o.pathOffset);
  const reach = r / Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) + o.strokeWidth / 2, step = Math.max(0.5, Math.min(4, reach / 3));
  const under = p => Math.hypot(p.x - local.x, p.y - local.y) < reach;
  // Each piece of the line as points: straight, quadratic and cubic curves sampled every `step`.
  const traced = [];
  let line = null, pen = null;
  for (const c of o.path) {
    const end = { x: c.at(-2), y: c.at(-1) };
    if (c[0] === 'M' || !line) { line = [end]; traced.push(line); pen = end; if (c[0] === 'M') continue; }
    const k = c[0] === 'Q' ? [pen, { x: c[1], y: c[2] }, end] : c[0] === 'C' ? [pen, { x: c[1], y: c[2] }, { x: c[3], y: c[4] }, end] : [pen, end];
    let length = 0; for (let i = 1; i < k.length; i++) length += Math.hypot(k[i].x - k[i - 1].x, k[i].y - k[i - 1].y);
    const n = Math.max(1, Math.ceil(length / step));
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t;
      line.push(k.length === 2 ? { x: u * pen.x + t * end.x, y: u * pen.y + t * end.y }
        : k.length === 3 ? { x: u * u * k[0].x + 2 * u * t * k[1].x + t * t * k[2].x, y: u * u * k[0].y + 2 * u * t * k[1].y + t * t * k[2].y }
          : { x: u ** 3 * k[0].x + 3 * u * u * t * k[1].x + 3 * u * t * t * k[2].x + t ** 3 * k[3].x, y: u ** 3 * k[0].y + 3 * u * u * t * k[1].y + 3 * u * t * t * k[2].y + t ** 3 * k[3].y });
    }
    pen = end;
  }
  if (!traced.some(points => points.some(under))) return false;
  const runs = [];
  for (const points of traced) {
    let run = null;
    for (const p of points) {
      if (under(p)) { run = null; continue; }
      if (!run) { run = []; runs.push(run); }
      run.push(p);
    }
  }
  const at0 = board.getObjects().indexOf(o), pieces = runs.filter(run => run.length > 1).map(run => {
    const piece = new fabric.Path(run.map((p, i) => [i ? 'L' : 'M', p.x, p.y]), {
      stroke: o.stroke, strokeWidth: o.strokeWidth, strokeLineCap: o.strokeLineCap, strokeLineJoin: o.strokeLineJoin, fill: o.fill,
      opacity: o.opacity, globalCompositeOperation: o.globalCompositeOperation, shadow: o.shadow ? new fabric.Shadow(o.shadow.toObject()) : null,
      angle: o.angle, scaleX: o.scaleX, scaleY: o.scaleY, skewX: o.skewX, skewY: o.skewY, flipX: o.flipX, flipY: o.flipY, kbName: o.kbName
    });
    piece.setPositionByOrigin(fabric.util.transformPoint(piece.pathOffset.subtract(o.pathOffset), m), 'center', 'center');
    piece.setCoords();
    return piece;
  });
  board.remove(o);
  pieces.forEach((piece, i) => board.insertAt(at0 + i, piece));
  return true;
}
function drawToolsDown({ e }) {
  if (!erasing() || spacePan || e.button !== 0) return;
  drawing.erased = false; drawing.down = true; eraseAt(board.getScenePoint(e)); board.requestRenderAll();
}
function drawToolsMove({ e }) {
  if (!erasing()) return;
  drawing.pointer = board.getScenePoint(e);
  if (drawing.down) eraseAt(drawing.pointer);
  board.requestRenderAll();
}
function drawToolsUp() {
  if (!drawing.down) return;
  drawing.down = false;
  if (drawing.erased) { drawing.erased = false; commitDesign(); }
}
function drawDrawTools(ctx) {
  if (!erasing() || !drawing.pointer) return;
  const z = board.getZoom(), r = eraserRadius();
  ctx.save(); ctx.lineWidth = 1.5 / z; ctx.strokeStyle = '#d0489b';
  ctx.beginPath(); ctx.arc(drawing.pointer.x, drawing.pointer.y, r, 0, 2 * Math.PI); ctx.stroke();
  ctx.restore();
}
function startDrawTools() {
  board.on('mouse:down', drawToolsDown);
  board.on('mouse:move', drawToolsMove);
  board.on('mouse:up', drawToolsUp);
  board.on('mouse:out', () => { if (drawing.pointer) { drawing.pointer = null; board.requestRenderAll(); } });
  setDrawBrush(); paintDrawTools();
}
