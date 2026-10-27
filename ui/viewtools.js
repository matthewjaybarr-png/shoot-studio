// Rulers and guide lines, and a grid of every page for finding and reordering them. Needs create.js.

// ---- Rulers: inches for print, pixels for social posts, along the top and left of the page area ----
const RULER = 22;
const rulers = { top: document.createElement('canvas'), left: document.createElement('canvas') };
rulers.top.className = 'ruler ruler-top'; rulers.left.className = 'ruler ruler-left';
rulers.top.title = rulers.left.title = 'Drag from a ruler onto the page to add a guide line';
$('#create-stage').append(rulers.top, rulers.left);
const rulersOn = () => !!settings.rulers && mode === 'create' && !!design;
const guidesOf = () => (design.guides ||= { x: [], y: [] });
const cleanGuides = g => ({ x: (Array.isArray(g?.x) ? g.x : []).filter(Number.isFinite).slice(0, 40), y: (Array.isArray(g?.y) ? g.y : []).filter(Number.isFinite).slice(0, 40) });
let dragGuide = null; // { axis, at (page px), index (an existing guide) or -1 }

function drawRulers() {
  const stage = $('#create-stage'), on = rulersOn();
  rulers.top.hidden = rulers.left.hidden = !on;
  $('#create-rulers').classList.toggle('on', !!settings.rulers);
  const g = design ? guidesOf() : { x: [], y: [] };
  $('#create-guides-clear').hidden = !on || !(g.x.length + g.y.length);
  if (!on || !board) return;
  const vt = board.viewportTransform, zoom = vt[0], dpr = devicePixelRatio || 1, [pw, ph] = pagePx(), social = isSocial(design.page);
  for (const side of ['top', 'left']) {
    const c = rulers[side], horizontal = side === 'top', len = horizontal ? stage.clientWidth : stage.clientHeight;
    const w = horizontal ? len : RULER, h = horizontal ? RULER : len;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.width = w + 'px'; c.style.height = h + 'px'; }
    const ctx = c.getContext('2d'), offset = horizontal ? vt[4] : vt[5], size = horizontal ? pw : ph, screen = v => offset + v * zoom;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f6f0f8'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff'; horizontal ? ctx.fillRect(screen(0), 0, size * zoom, h) : ctx.fillRect(0, screen(0), w, size * zoom); // the page's stretch
    // Tick spacing: eighths of an inch for print, a round number of pixels for social posts, thinned out when zoomed far out.
    const unit = social ? [10, 20, 50, 100, 200, 500, 1000].find(s => s * zoom >= 60) || 1000 : PX, parts = social ? 5 : 8;
    const from = Math.floor(-offset / zoom / unit) * unit, to = (len - offset) / zoom;
    ctx.strokeStyle = '#a597ad'; ctx.fillStyle = '#6f6378'; ctx.font = '10px Lexend, sans-serif'; ctx.lineWidth = 1; ctx.beginPath();
    for (let major = from; major <= to; major += unit) for (let i = 0; i < parts; i++) {
      const step = unit / parts * zoom;
      if (i && step < 5) continue;
      const v = major + unit * i / parts, at = Math.round(screen(v)) + 0.5, long = i === 0 ? 11 : (!social && i === 4) ? 7 : (!social && i % 2 === 0) ? 4 : 3;
      if (horizontal) { ctx.moveTo(at, h); ctx.lineTo(at, h - long); } else { ctx.moveTo(w, at); ctx.lineTo(w - long, at); }
      if (i === 0) {
        const label = String(Math.round(social ? v : v / PX));
        if (horizontal) ctx.fillText(label, at + 3, 10);
        else { ctx.save(); ctx.translate(10, at + 3); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'right'; ctx.fillText(label, 0, 0); ctx.restore(); }
      }
    }
    ctx.stroke();
    // A pink mark for each guide: drag it to move the guide, off the page to remove it.
    ctx.fillStyle = '#d0489b';
    for (const v of horizontal ? g.x : g.y) { const at = screen(v); ctx.beginPath(); if (horizontal) { ctx.moveTo(at - 5, 0); ctx.lineTo(at + 5, 0); ctx.lineTo(at, 8); } else { ctx.moveTo(0, at - 5); ctx.lineTo(0, at + 5); ctx.lineTo(8, at); } ctx.fill(); }
    ctx.fillStyle = '#f6f0f8'; ctx.fillRect(0, 0, RULER, RULER); // the corner
  }
}
// The guide lines across the page area, drawn with the page overlay (and the one being dragged).
function drawGuides(ctx) {
  if (!rulersOn()) return;
  const g = guidesOf(), z = board.getZoom(), far = 1e5;
  ctx.save(); ctx.strokeStyle = '#3aa0d8'; ctx.lineWidth = 1 / z;
  const line = (axis, v) => { ctx.beginPath(); axis === 'x' ? (ctx.moveTo(v, -far), ctx.lineTo(v, far)) : (ctx.moveTo(-far, v), ctx.lineTo(far, v)); ctx.stroke(); };
  g.x.forEach((v, i) => { if (!(dragGuide?.axis === 'x' && dragGuide.index === i)) line('x', v); });
  g.y.forEach((v, i) => { if (!(dragGuide?.axis === 'y' && dragGuide.index === i)) line('y', v); });
  if (dragGuide) { ctx.setLineDash([6 / z, 4 / z]); ctx.strokeStyle = '#d0489b'; line(dragGuide.axis, dragGuide.at); }
  ctx.restore();
}
// Objects snap to guides as they do to the page's edges and middle.
const guideStops = axis => rulersOn() ? guidesOf()[axis] : [];

// Dragging: from the top ruler makes a line across (y), from the left ruler a line down (x); a mark moves its guide.
function rulerDown(side, e) {
  if (!rulersOn() || e.button !== 0) return;
  const r = rulers[side].getBoundingClientRect(), vt = board.viewportTransform, zoom = vt[0];
  const along = side === 'top' ? e.clientX - r.left : e.clientY - r.top, axisOfMarks = side === 'top' ? 'x' : 'y';
  const marks = guidesOf()[axisOfMarks], index = marks.findIndex(v => Math.abs((side === 'top' ? vt[4] : vt[5]) + v * zoom - along) <= 6);
  dragGuide = index >= 0 ? { axis: axisOfMarks, index, at: marks[index] } : { axis: side === 'top' ? 'y' : 'x', index: -1, at: NaN };
  try { rulers[side].setPointerCapture(e.pointerId); } catch { /* no capture for this pointer */ }
  e.preventDefault();
}
function rulerMove(side, e) {
  if (!dragGuide) return;
  const p = board.getScenePoint(e);
  dragGuide.at = Math.round(dragGuide.axis === 'x' ? p.x : p.y);
  board.requestRenderAll();
}
function rulerUp(side, e) {
  if (!dragGuide) return;
  const { axis, index, at } = dragGuide, list = guidesOf()[axis], [pw, ph] = pagePx(), size = axis === 'x' ? pw : ph;
  const r = $('#create-stage').getBoundingClientRect(), overRuler = e.clientX - r.left < RULER || e.clientY - r.top < RULER;
  const keep = Number.isFinite(at) && at >= 0 && at <= size && !overRuler;
  if (index >= 0) { if (keep) list[index] = at; else list.splice(index, 1); }
  else if (keep && list.length < 40) list.push(at);
  dragGuide = null; try { rulers[side].releasePointerCapture(e.pointerId); } catch { /* not captured */ }
  remember(); schedule(); board.requestRenderAll(); drawRulers();
}
for (const side of ['top', 'left']) {
  rulers[side].addEventListener('pointerdown', e => rulerDown(side, e));
  rulers[side].addEventListener('pointermove', e => rulerMove(side, e));
  rulers[side].addEventListener('pointerup', e => rulerUp(side, e));
  rulers[side].addEventListener('pointercancel', () => { dragGuide = null; board?.requestRenderAll(); });
}
$('#create-rulers').onclick = () => { settings.rulers = !settings.rulers; saveSettings(); drawRulers(); board?.requestRenderAll(); };
$('#create-guides-clear').onclick = () => { design.guides = { x: [], y: [] }; remember(); schedule(); drawRulers(); board.requestRenderAll(); };
function startViewTools() { board.on('after:render', drawRulers); }

// ---- Grid view: every page at once; click one to go to it, drag one to move it ----
const gridThumbs = new WeakMap();
const gridThumb = page => { if (!gridThumbs.has(page)) gridThumbs.set(page, drawThumb(design.size, c => c.loadFromJSON(page), 220).catch(() => '')); return gridThumbs.get(page); };
let gridDrag = -1;
async function paintPageGrid() {
  designPages[pageAt] = board.toObject(KEEP); // the page being edited, as it is now
  const list = $('#page-grid-list');
  list.replaceChildren(...designPages.map((page, i) => {
    const card = button('', async () => { closePageGrid(); await showPage(i); });
    card.className = 'page-card' + (i === pageAt ? ' on' : ''); card.title = 'Go to page ' + (i + 1) + ' (drag to move it)'; card.draggable = true;
    const img = new Image(); img.alt = ''; card.append(img, Object.assign(document.createElement('span'), { textContent: 'Page ' + (i + 1) }));
    gridThumb(page).then(url => { if (url) img.src = url; });
    card.ondragstart = e => { gridDrag = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); };
    card.ondragover = e => { if (gridDrag >= 0) { e.preventDefault(); card.classList.add('drop'); } };
    card.ondragleave = () => card.classList.remove('drop');
    card.ondrop = e => { e.preventDefault(); card.classList.remove('drop'); movePageTo(gridDrag, i); gridDrag = -1; };
    card.ondragend = () => { gridDrag = -1; };
    return card;
  }));
  $('#page-grid-count').textContent = designPages.length === 1 ? 'One page' : designPages.length + ' pages';
}
// Moves page `from` to `to`; the page being edited stays the one being edited.
function movePageTo(from, to) {
  if (from < 0 || to < 0 || from === to || from >= designPages.length || to >= designPages.length) return;
  designPages[pageAt] = board.toObject(KEEP);
  const editing = designPages[pageAt], [page] = designPages.splice(from, 1);
  designPages.splice(to, 0, page);
  pageAt = designPages.indexOf(editing);
  commitDesign(); paintPages(); paintPageGrid();
}
function openPageGrid() { if (!design || !pageReady()) return; closeMenus(); $('#page-grid').hidden = false; paintPageGrid(); }
function closePageGrid() { $('#page-grid').hidden = true; }
$('#page-grid-open').onclick = openPageGrid;
$('#page-grid-close').onclick = closePageGrid;
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#page-grid').hidden) closePageGrid(); });
