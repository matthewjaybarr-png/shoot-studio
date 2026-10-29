// The Draw drawer in Create: Pen, Marker, Highlighter, Glow pen and Eraser, colour swatches, Thickness and
// Transparency. The pens are Fabric's PencilBrush set up differently; each stroke becomes its own path that can be
// moved, recoloured or deleted. The Eraser takes away whole drawn strokes it is dragged over (Fabric 7 has no pixel
// eraser, and a stroke at a time is easy to predict and to Undo). Needs create.js and phototools.js.

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
const drawing = { tool: 'pen', colour: '#444444', width: 3, see: 0, erased: false, pointer: null };
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
  $('#draw-hint').textContent = drawing.tool === 'eraser' ? 'Drag over a drawn line to take it away. Undo brings it back.' : drawing.tool === 'highlighter' ? 'Drag over words or a picture to highlight them; they still show through.' : 'Draw on the page with the mouse. Each line is its own item you can move, recolour or delete.';
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
  brush.color = drawing.colour; brush.width = Math.max(1, drawing.width * look.k); brush.strokeLineCap = look.cap; brush.strokeLineJoin = 'round';
  brush.shadow = look.glow ? new fabric.Shadow({ color: drawing.colour, blur: Math.max(8, drawing.width * 4), offsetX: 0, offsetY: 0 }) : null;
}
// A finished line gets the tool's name, how see-through it is, and (for the highlighter) a blend so what's under it shows.
function drawnPath(path) {
  const look = DRAW_LOOKS[drawing.tool] || DRAW_LOOKS.pen;
  path.set({ kbName: look.name, opacity: look.opacity * (1 - drawing.see / 100), globalCompositeOperation: look.blend || 'source-over' });
}
$('#draw-colour').oninput = e => { drawing.colour = e.target.value; setDrawBrush(); paintDrawTools(); };
$('#draw-width').oninput = e => { drawing.width = +e.target.value; setDrawBrush(); paintDrawTools(); };
$('#draw-see').oninput = e => { drawing.see = +e.target.value; paintDrawTools(); };

// ---- The Eraser ----
const eraserRadius = () => Math.max(6, drawing.width * 3) / board.getZoom();
function eraseAt(at) {
  const r = eraserRadius(), probes = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r * 0.7, r * 0.7], [-r * 0.7, r * 0.7], [r * 0.7, -r * 0.7], [-r * 0.7, -r * 0.7]];
  for (const o of board.getObjects().filter(o => o.type === 'path' && DRAWN.has(o.kbName) && !o.kbLocked)) {
    const box = o.getBoundingRect();
    if (at.x < box.left - r || at.x > box.left + box.width + r || at.y < box.top - r || at.y > box.top + box.height + r) continue;
    // Touching the line itself, not just its box: the drawn pixels under the eraser's ring.
    const vp = board.viewportTransform, hit = probes.some(([dx, dy]) => {
      const x = (at.x + dx) * vp[0] + vp[4], y = (at.y + dy) * vp[3] + vp[5];
      return !board.isTargetTransparent(o, x, y);
    });
    if (hit) { board.remove(o); drawing.erased = true; }
  }
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
