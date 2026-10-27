// Gradients in Colours, a photo set as the page background, and see-through PNGs. Needs create.js.

// ---- Gradients: two colours, running down, across, corner to corner or out from the middle ----
const GRADIENT_DIRS = [['down', '↓ Down'], ['across', '→ Across'], ['diagonal', '↘ Corner to corner'], ['round', '◎ From the middle']];
const GRADIENTS = [['#ffd1dc', '#c9b6f2'], ['#fbc2eb', '#a6c1ee'], ['#e0c3fc', '#8ec5fc'], ['#a1c4fd', '#c2e9fb'], ['#ffecd2', '#fcb69f'], ['#ff9a9e', '#fecfef'],
  ['#fdfbfb', '#ebedee'], ['#f6d365', '#fda085'], ['#84fab0', '#8fd3f4'], ['#e8607e', '#9b6bd6'], ['#5aa6e6', '#9b6bd6'], ['#30cfd0', '#330867']];
const UNIT = { down: [0, 0, 0, 1], across: [0, 0, 1, 0], diagonal: [0, 0, 1, 1] };
// Objects use a gradient sized to themselves; the page background needs one in page pixels.
function makeGradient([a, b], dir, size) {
  const [w, h] = size || [1, 1], colorStops = [{ offset: 0, color: a }, { offset: 1, color: b }], gradientUnits = size ? 'pixels' : 'percentage';
  if (dir === 'round') return new fabric.Gradient({ type: 'radial', gradientUnits, colorStops, coords: { x1: w / 2, y1: h / 2, r1: 0, x2: w / 2, y2: h / 2, r2: Math.max(w, h) * (size ? 0.71 : 0.5) } });
  const [x1, y1, x2, y2] = UNIT[dir] || UNIT.down;
  return new fabric.Gradient({ type: 'linear', gradientUnits, colorStops, coords: { x1: x1 * w, y1: y1 * h, x2: x2 * w, y2: y2 * h } });
}
const isGradient = f => !!f?.colorStops;
// What a gradient is made of, read back from the drawing: its two end colours and its direction.
function gradientParts(g) {
  const stops = [...g.colorStops].sort((p, q) => p.offset - q.offset), c = g.coords;
  const dir = g.type === 'radial' ? 'round' : c.x2 !== c.x1 && c.y2 !== c.y1 ? 'diagonal' : c.x2 !== c.x1 ? 'across' : 'down';
  return { colours: [hex(stops[0].color) || '#ffffff', hex(stops.at(-1).color) || '#000000'], dir };
}
const cssGradient = ([a, b], dir) => dir === 'round' ? `radial-gradient(circle, ${a}, ${b})` : `linear-gradient(${{ down: '180deg', across: '90deg', diagonal: '135deg' }[dir]}, ${a}, ${b})`;

// A gradient for the selection (text and shapes; lines keep a plain colour), or the page when nothing is selected.
function applyGradient(colours, dir) {
  if (board.getActiveObject()) change(o => o.type === 'line' || o.type === 'group' || o.type === 'image' || (o.type === 'path' && !o.fill) ? {} : { fill: makeGradient(colours, dir) });
  else { board.backgroundColor = makeGradient(colours, dir, pagePx()); board.requestRenderAll(); commitDesign(); }
  paintPanel(); paintGradientMaker();
}
const gradientNow = () => [$('#grad-a').value, $('#grad-b').value];
$('#gradients').replaceChildren(...GRADIENTS.map(pair => {
  const b = button('', () => { $('#grad-a').value = pair[0]; $('#grad-b').value = pair[1]; applyGradient(pair, $('#grad-dir').value); });
  b.className = 'swatch gradient'; b.title = 'Gradient'; b.style.background = cssGradient(pair, 'diagonal');
  return b;
}));
$('#grad-dir').replaceChildren(...GRADIENT_DIRS.map(([value, label]) => Object.assign(document.createElement('option'), { value, textContent: label })));
$('#grad-apply').onclick = () => applyGradient(gradientNow(), $('#grad-dir').value);
$('#grad-swap').onclick = () => { const [a, b] = gradientNow(); $('#grad-a').value = b; $('#grad-b').value = a; paintGradientMaker(); };
for (const id of ['#grad-a', '#grad-b', '#grad-dir']) $(id).addEventListener('input', () => paintGradientMaker());
// The maker shows the gradient that's selected (or on the page), so it can be changed rather than started again.
function paintGradientMaker(load) {
  if (load) {
    const o = board?.getActiveObject(), fill = o ? o.fill : board?.backgroundColor;
    if (isGradient(fill)) { const { colours, dir } = gradientParts(fill); $('#grad-a').value = colours[0]; $('#grad-b').value = colours[1]; $('#grad-dir').value = dir; }
  }
  $('#grad-preview').style.background = cssGradient(gradientNow(), $('#grad-dir').value);
}
$('#colours-open').addEventListener('click', () => paintGradientMaker(true));
// Called by paintPanel: a gradient shows its first colour in the colour box, and the page's in Background.
function paintGradient(o) {
  if (isGradient(o?.fill)) $('#prop-fill').value = gradientParts(o.fill).colours[0];
  if (!o && isGradient(board.backgroundColor)) $('#create-bg').value = gradientParts(board.backgroundColor).colours[0];
}

// ---- Set a photo as the page background: it fills the page, goes to the back and is locked there ----
function setAsBackground(o = board.getActiveObject()) {
  if (o?.type !== 'image' || o.kbLocked) return;
  const [w, h] = pagePx(), scale = Math.max(w / o.width, h / o.height);
  o.set({ clipPath: undefined, kbFrame: undefined, angle: 0, skewX: 0, skewY: 0, scaleX: scale, scaleY: scale, kbName: 'Background photo', kbLocked: true });
  o.setPositionByOrigin(new fabric.Point(w / 2, h / 2), 'center', 'center'); o.setCoords();
  board.sendObjectToBack(o); applyLock(o);
  board.discardActiveObject(); board.requestRenderAll(); commitDesign(); paintPanel();
}
$('#prop-set-bg').onclick = () => setAsBackground();

// ---- See-through PNGs: the page colour is left out, so only what's on it is drawn ----
const seeThrough = page => $('#create-transparent').checked ? { ...page, background: '' } : page;
