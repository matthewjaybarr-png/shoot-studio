// Create: a small Canva-style maker for posters, labels and cards. A design is a Fabric.js canvas in 96-dpi pixels,
// saved as one JSON file (images embedded) in ~/Documents/KB Studio/ and printed through a 300-dpi PDF.
// Needs `invoke`, `$` and `mode` from app.js.
Object.assign(fabric.FabricObject.ownDefaults, { originX: 'left', originY: 'top' });

const PX = 96;                                         // design pixels per inch
const PAGES = { letter: [8.5, 11], 'letter-landscape': [11, 8.5], half: [5.5, 8.5], quarter: [4.25, 5.5] };
const PAGE_NAMES = { letter: 'Letter', 'letter-landscape': 'Letter, landscape', half: 'Half sheet card', quarter: 'Quarter sheet card' };
const FONTS = ['Lexend', 'Andika', 'Atkinson Hyperlegible', 'Comic Neue', 'Fredoka', 'Balsamiq Sans', 'Nunito', 'Lora', 'Patrick Hand', 'Caveat', 'Roboto Slab'];
// Generated offline from Unicode 15.0 emoji-test.txt; assets stay local.
let emojiEntries = [], emojiPage = 0;
const emojiReady = fetch('emoji-index.json').then(r => { if (!r.ok) throw Error('clip art index missing'); return r.json(); }).then(entries => { emojiEntries = entries; });
emojiReady.catch(error => { $('#create-saved').textContent = 'Could not load clip art: ' + error; });
const IMAGE_EDGE = 3300;                               // imported pictures are shrunk to this many pixels on the long edge
const MAX_HISTORY = 50, MAX_HISTORY_BYTES = 250e6;
const KEEP = ['kbName', 'kbLocked'];                   // our own fields, saved with every object
const TILES = { half: { sheet: 'letter-landscape', cols: 2, rows: 1 }, quarter: { sheet: 'letter', cols: 2, rows: 2 } };

const sizeIn = key => PAGES[key] || PAGES.letter;

// Where the cards go on the paper (inches), and the cut marks between them. `tile` is 'single' or 'sheet'.
function pageLayout(page, tile) {
  const [w, h] = sizeIn(page), t = TILES[page];
  if (tile !== 'sheet' || !t) return { sheet: [w, h], tiles: [{ x: 0, y: 0, w, h }], marks: [] };
  const [sw, sh] = sizeIn(t.sheet), tiles = [], marks = [], tick = 0.2;
  for (let r = 0; r < t.rows; r++) for (let c = 0; c < t.cols; c++) tiles.push({ x: c * w, y: r * h, w, h });
  for (let c = 1; c < t.cols; c++) marks.push([c * w, 0, c * w, tick], [c * w, sh - tick, c * w, sh]);
  for (let r = 1; r < t.rows; r++) marks.push([0, r * h, tick, r * h], [sw - tick, r * h, sw, r * h]);
  return { sheet: [sw, sh], tiles, marks };
}

let designClipboard = null;
const historyImages = new Map(), imageIds = new Map();
let nextImageId = 0, pageGuides = [];
let board = null;                                      // the Fabric canvas
let cropSession = null, guidelines;
let design = null;                                     // { title, page, tile, copies }
let settings = { colours: [], fonts: [] };
let history = [], here = 0, restoring = false, historyBytes = 0, saveTimer = null, saved = Promise.resolve(), diskName = null, dirty = false, edits = 0;

const pagePx = () => sizeIn(design.page).map(v => Math.round(v * PX));
const PAGE_LABEL = key => PAGE_NAMES[key] + ' (' + sizeIn(key).join(' × ') + ' in)';

function setMode(next) {
  mode = next;
  $('#home').hidden = next !== 'home';
  $('#create').hidden = next !== 'create';
  document.body.classList.toggle('away', next !== 'photos');
  if (next === 'home') paintHome();
  if (next === 'create') fitBoard();
}

// ---- Home ----
async function paintHome() {
  const recent = $('#home-recent'), starters = $('#home-templates');
  const [designs, mine] = await Promise.all([invoke('list_creations', { kind: 'designs' }).catch(() => []), invoke('list_creations', { kind: 'templates' }).catch(() => [])]);
  recent.replaceChildren(...designs.map(d => button(d.name, () => openDesign(d.name), new Date(d.modified * 1000).toLocaleDateString())));
  recent.previousElementSibling.hidden = !designs.length;
  starters.replaceChildren(...Object.keys(STARTERS).map(n => button(n, () => newDesign(n, 'starter'))), ...mine.map(t => button(t.name, () => newDesign(t.name, 'mine'))));
}
function button(text, onclick, small) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = text; b.onclick = onclick;
  if (small) { const s = document.createElement('small'); s.textContent = small; b.append(s); }
  return b;
}
$('#home-photos').onclick = () => setMode('photos');
$('#home-create').onclick = () => newDesign();
$('#create-home').onclick = () => navigateDesign(() => setMode('home')).catch(() => {});
$('#photos-home').onclick = () => setMode('home');

// ---- The page ----
function startBoard() {
  if (board) return;
  board = new fabric.Canvas($('#create-canvas'), { backgroundColor: '#ffffff', preserveObjectStacking: true, selection: true });
  for (const e of ['object:modified', 'text:editing:exited']) board.on(e, commitDesign);
  for (const e of ['selection:created', 'selection:updated', 'selection:cleared']) board.on(e, paintPanel);
  board.on('object:added', () => { if (!restoring) paintLayers(); });
  board.on('object:removed', () => { if (!restoring) paintLayers(); });
  addEventListener('resize', () => { if (mode === 'create') fitBoard(); });
  guidelines = new fabricExtensions.AligningGuidelines(board);
  board.on('object:moving', snapPage);
  board.on('after:render', drawPageOverlay);
  board.on('mouse:up', () => { pageGuides = []; board.requestRenderAll(); });
  board.on('path:created', e => { e.path.kbName = 'Drawing'; commitDesign(); });
  board.freeDrawingBrush = new fabric.PencilBrush(board);
  board.freeDrawingBrush.color = '#444444'; board.freeDrawingBrush.width = 3;
  board.on('mouse:wheel', ({ e }) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault(); e.stopPropagation(); zoomBoard(board.getZoom() * Math.exp(-e.deltaY * 0.002));
  });
  const stage = $('#create-stage');
  stage.ondragover = e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
  stage.ondrop = e => { e.preventDefault(); if ($('#create').inert || cropSession) return; importFiles([...e.dataTransfer.files].filter(f => f.type.startsWith('image/'))); };
  paintCreateTools();
}
function snapPage({ target: o }) {
  if (o.kbLocked || cropSession) return;
  pageGuides = [];
  const [w, h] = pagePx(), r = o.getBoundingRect(), tolerance = 4 / board.getZoom();
  for (const [axis, start, span, size, prop] of [['x', r.left, r.width, w, 'left'], ['y', r.top, r.height, h, 'top']]) {
    let best = tolerance + 1, delta = 0, line;
    for (const v of [0, size / 2, size]) for (const point of [start, start + span / 2, start + span]) {
      if (Math.abs(v - point) < best) { best = Math.abs(v - point); delta = v - point; line = v; }
    }
    if (best <= tolerance) { o.set(prop, o[prop] + delta); pageGuides.push([axis, line]); }
  }
  o.setCoords();
}
function drawPageOverlay() {
  if (!design) return;
  const ctx = board.contextTop, [w, h] = pagePx();
  ctx.save(); ctx.transform(...board.viewportTransform); ctx.lineWidth = 1 / board.getZoom();
  if ($('#create-margin').checked) {
    ctx.strokeStyle = '#777777'; ctx.setLineDash([4 / board.getZoom(), 4 / board.getZoom()]);
    ctx.strokeRect(PX / 4, PX / 4, w - PX / 2, h - PX / 2);
  }
  ctx.setLineDash([]); ctx.strokeStyle = '#d22';
  for (const [axis, v] of pageGuides) { ctx.beginPath(); ctx.moveTo(axis === 'x' ? v : 0, axis === 'y' ? v : 0); ctx.lineTo(axis === 'x' ? v : w, axis === 'y' ? v : h); ctx.stroke(); }
  ctx.restore();
}
function zoomBoard(zoom) {
  if (!board || !design) return;
  const [w, h] = pagePx(); zoom = Math.min(4, Math.max(0.1, zoom));
  board.setZoom(zoom); board.setDimensions({ width: Math.round(w * zoom), height: Math.round(h * zoom) });
  $('#create-zoom').textContent = Math.round(zoom * 100) + '%'; board.requestRenderAll();
}
$('#create-zoom-in').onclick = () => zoomBoard(board.getZoom() * 1.25);
$('#create-zoom-out').onclick = () => zoomBoard(board.getZoom() / 1.25);
$('#create-fit').onclick = fitBoard;
$('#create-margin').onchange = () => board?.requestRenderAll();

// Show the whole page, as large as fits.
function fitBoard() {
  if (!board || !design) return;
  const stage = $('#create-stage'), [w, h] = pagePx(), room = stage.getBoundingClientRect();
  const zoom = Math.max(0.1, Math.min((room.width - 32) / w, (room.height - 32) / h, 1.5));
  zoomBoard(zoom);
}
const blob = () => ({ format: 1, page: design.page, tile: design.tile, copies: design.copies, canvas: board.toObject(KEEP) });

async function fonts() {
  const loads = await Promise.allSettled(FONTS.flatMap(f => ['400', '700'].map(w => document.fonts.load(`${w} 16px "${f}"`))));
  const failed = loads.find(result => result.status === 'rejected'), warning = $('#create-font-warning');
  if (failed) { warning.hidden = false; throw failed.reason; }
}

async function open(doc, title, name) {
  startBoard();
  await fonts().catch(() => {}); // Editing can use fallback fonts; output remains strict.
  restoring = true;
  design = { title, page: PAGES[doc.page] ? doc.page : 'letter', tile: doc.tile === 'sheet' ? 'sheet' : 'single', copies: Math.min(20, Math.max(1, doc.copies | 0 || 1)) };
  diskName = name; dirty = false;
  await board.loadFromJSON(doc.canvas || { objects: [] });
  if (!doc.canvas) board.backgroundColor = '#ffffff';
  for (const o of board.getObjects()) applyLock(o);
  board.discardActiveObject();
  restoring = false;
  history = []; here = 0; historyBytes = 0; historyImages.clear(); imageIds.clear(); pageGuides = [];
  board.isDrawingMode = false; $('#create-draw').classList.remove('on');
  remember();
  setMode('create');
  paintAll();
}
// Freeze both screens until pending additions are saved and the destination has loaded.
let navigating = null;
async function navigateDesign(action) {
  if (navigating || $('#create').inert) throw Error('A design transition is already in progress');
  $('#create').inert = $('#home').inert = true;
  navigating = (async () => {
    do { await Promise.allSettled([...adding]); await flush(); } while (dirty || adding.size);
    return action();
  })();
  try { return await navigating; }
  finally { navigating = null; $('#create').inert = $('#home').inert = updating; }
}
function openDesign(name) {
  return navigateDesign(async () => {
    const doc = JSON.parse(await invoke('load_creation', { kind: 'designs', name }));
    await open(doc, name, name);
  });
}
async function uniqueTitle(base) {
  const taken = new Set((await invoke('list_creations', { kind: 'designs' }).catch(() => [])).map(d => d.name));
  let title = base, n = 2;
  while (taken.has(title)) title = `${base} ${n++}`;
  return title;
}
// A new design: blank, or from a starter or saved template.
function newDesign(template, source) {
  return navigateDesign(async () => {
    startBoard();
    let doc = { page: 'letter' };
    if (template && source === 'mine') doc = JSON.parse(await invoke('load_creation', { kind: 'templates', name: template }));
    const title = await uniqueTitle(template ? `My ${template}` : 'Untitled');
    await open(doc, title, null);
    if (template && source === 'starter') { await STARTERS[template](); remember(); }
    schedule();
  });
}
// A developed photo from Photos becomes the first thing on a new Letter page.
async function createFromPhoto(photoBlob, name) {
  await newDesign();
  await addImageBlob(photoBlob, name);
}

// ---- Saving ----
function schedule() { dirty = true; edits++; clearTimeout(saveTimer); saveTimer = setTimeout(() => { saveTimer = null; save().catch(() => {}); }, 1200); $('#create-saved').textContent = 'Saving…'; }
// Resolves when everything is on disk; rejects if the last save failed, so callers don't throw the work away.
function flush() { finishCrop(false); if (saveTimer || dirty) { clearTimeout(saveTimer); saveTimer = null; return save(); } return saved; }
function save() {
  if (!design) return saved;
  const doc = JSON.stringify(blob()), name = design.title, rev = edits;
  // The previous name is read when this save's turn comes, after earlier saves have updated it.
  const run = saved.then(async () => {
    const old = diskName;
    if (name !== old && (await invoke('list_creations', { kind: 'designs' })).some(d => d.name === name)) throw `a design called “${name}” already exists`;
    await invoke('save_creation', new TextEncoder().encode(doc), { headers: { kind: 'designs', name: encodeURIComponent(name) } });
    diskName = name;
    if (old && old !== name) await invoke('delete_creation', { kind: 'designs', name: old });
    if (rev === edits) dirty = false; // a newer edit stays dirty until its own save lands
    $('#create-saved').textContent = 'Saved';
  });
  saved = run.catch(error => { $('#create-saved').textContent = 'Not saved: ' + error; });
  return run;
}
$('#create-title').onchange = event => {
  const title = event.target.value.trim().replace(/[\/\\:*?"<>|\x00-\x1f]/g, '').replace(/^\.+/, '').slice(0, 80);
  event.target.value = design.title = title || design.title;
  schedule();
};
$('#create-save-template').onclick = async () => {
  await invoke('save_creation', new TextEncoder().encode(JSON.stringify(blob())), { headers: { kind: 'templates', name: encodeURIComponent(design.title) } })
    .then(() => { $('#create-saved').textContent = `Saved as template “${design.title}”`; }, error => { $('#create-saved').textContent = 'Not saved: ' + error; });
};

// ---- Undo and redo: whole-design snapshots, at most 50 and about 250 MB ----
function remember() {
  const text = JSON.stringify(blob(), (key, value) => {
    if (key !== 'src' || typeof value !== 'string') return value;
    if (!imageIds.has(value)) { const id = ++nextImageId; imageIds.set(value, id); historyImages.set(id, value); }
    return { kbImage: imageIds.get(value) };
  });
  history = history.slice(0, here + 1); history.push(text);
  const recount = () => {
    const used = new Set();
    for (const snapshot of history) JSON.parse(snapshot, (k, v) => { if (k === 'src' && v?.kbImage) used.add(v.kbImage); return v; });
    for (const [id, src] of historyImages) if (!used.has(id)) { historyImages.delete(id); imageIds.delete(src); }
    historyBytes = 2 * (history.reduce((n, v) => n + v.length, 0) + [...historyImages.values()].reduce((n, v) => n + v.length, 0));
  };
  recount();
  while (history.length > 1 && (history.length > MAX_HISTORY || historyBytes > MAX_HISTORY_BYTES)) { history.shift(); recount(); }
  here = history.length - 1; paintHistory();
}
function commitDesign() { if (restoring || cropSession) return; remember(); paintLayers(); paintPanel(); schedule(); }
async function stepHistory(by) {
  const to = here + by;
  if (to < 0 || to >= history.length || restoring) return;
  restoring = true;
  const doc = JSON.parse(history[to], (k, v) => k === 'src' && v?.kbImage ? historyImages.get(v.kbImage) : v);
  design.page = doc.page; design.tile = doc.tile; design.copies = doc.copies;
  await board.loadFromJSON(doc.canvas);
  for (const o of board.getObjects()) applyLock(o);
  restoring = false;
  here = to;
  paintAll(); fitBoard(); schedule();
}
const undoDesign = () => stepHistory(-1), redoDesign = () => stepHistory(1);
$('#create-undo').onclick = undoDesign;
$('#create-redo').onclick = redoDesign;
function paintHistory() { $('#create-undo').disabled = here < 1; $('#create-redo').disabled = here >= history.length - 1; }

// ---- Adding things ----
function place(object) {
  const [w, h] = pagePx();
  object.set({ left: Math.round((w - object.getScaledWidth()) / 2), top: Math.round((h - object.getScaledHeight()) / 2) });
  board.add(object); board.setActiveObject(object); object.setCoords();
  commitDesign();
  return object;
}
const textColour = () => '#222222';
function addText() {
  const t = new fabric.Textbox('Double-click to edit', { width: 420, fontSize: 40, fontFamily: settings.fonts[0] || FONTS[0], fill: textColour(), textAlign: 'center', kbName: 'Text' });
  place(t);
  t.enterEditing(); t.selectAll();
  return t;
}
const SHAPE = { fill: '#ffd966', stroke: '#444444', strokeWidth: 3 };
function addShape(kind) {
  const shapes = {
    rect: () => new fabric.Rect({ width: 260, height: 160, ...SHAPE, kbName: 'Rectangle' }),
    rounded: () => new fabric.Rect({ width: 260, height: 160, rx: 24, ry: 24, ...SHAPE, kbName: 'Rounded rectangle' }),
    triangle: () => new fabric.Triangle({ width: 200, height: 180, ...SHAPE, kbName: 'Triangle' }),
    star: () => new fabric.Polygon(Array.from({ length: 10 }, (_, i) => { const a = i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? 45 : 100; return { x: Math.cos(a) * r, y: Math.sin(a) * r }; }), { ...SHAPE, kbName: 'Star' }),
    handwriting: () => handwritingLines(Math.min(500, pagePx()[0] - 96)),
    bubble: () => new fabric.Path('M 20 0 L 240 0 Q 260 0 260 20 L 260 120 Q 260 140 240 140 L 90 140 L 40 180 L 50 140 L 20 140 Q 0 140 0 120 L 0 20 Q 0 0 20 0 Z', { ...SHAPE, kbName: 'Speech bubble' }),
    circle: () => new fabric.Circle({ radius: 90, ...SHAPE, kbName: 'Circle' }),
    line: () => new fabric.Line([0, 0, 300, 0], { stroke: '#444444', strokeWidth: 6, strokeLineCap: 'round', kbName: 'Line' }),
    arrow: () => new fabric.Group([
      new fabric.Line([0, 0, 280, 0], { stroke: '#444444', strokeWidth: 6, strokeLineCap: 'round' }),
      new fabric.Triangle({ width: 36, height: 36, fill: '#444444', left: 270, top: 18, angle: 90 })
    ], { kbName: 'Arrow' })
  };
  return place(shapes[kind]());
}
// Pictures are shrunk to 3300 px on the long edge (JPEGs stay JPEG) so a few of them fit in her memory.
async function shrink(file) {
  const bitmap = await createImageBitmap(file), long = Math.max(bitmap.width, bitmap.height), k = Math.min(1, IMAGE_EDGE / long);
  const out = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(bitmap.width * k)), height: Math.max(1, Math.round(bitmap.height * k)) });
  out.getContext('2d').drawImage(bitmap, 0, 0, out.width, out.height);
  bitmap.close?.();
  return out.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.9);
}
// Imports still decoding are awaited on close, so their picture lands in the design before it quits.
const adding = new Set();
const track = work => { adding.add(work); work.then(() => adding.delete(work), () => adding.delete(work)); return work; };
const addImageBlob = (file, name) => track(addingImage(file, name));
async function addingImage(file, name) {
  const image = await fabric.FabricImage.fromURL(await shrink(file));
  const [w, h] = pagePx(), k = Math.min(1, (w * 0.8) / image.width, (h * 0.8) / image.height);
  image.set({ scaleX: k, scaleY: k, kbName: name ? 'Photo ' + name : 'Picture' });
  return place(image);
}
// The whole batch is one tracked job, so closing mid-import still waits for the files not started yet.
const importFiles = files => track((async () => {
  for (const file of files) await addImageBlob(file, file.name.replace(/\.[^.]*$/, '')).catch(e => { $('#create-saved').textContent = `Could not add ${file.name}: ${e}`; });
})());
$('#create-file').onchange = async event => {
  await importFiles([...event.target.files]);
  event.target.value = '';
};
// Clip art is an SVG copied onto a canvas, so the design keeps its own picture.
const addEmoji = code => track(addingEmoji(code));
async function addingEmoji(code) {
  await emojiReady;
  const img = await new Promise((done, fail) => Object.assign(new Image(), { onload() { done(this); }, onerror: () => fail('clip art missing'), src: `emoji/${code}.svg` }));
  const out = Object.assign(document.createElement('canvas'), { width: 512, height: 512 });
  out.getContext('2d').drawImage(img, 0, 0, 512, 512);
  const image = await fabric.FabricImage.fromURL(out.toDataURL('image/png'));
  image.set({ scaleX: 150 / 512, scaleY: 150 / 512, kbName: emojiEntries.find(e => e.code === code)?.name || 'Clip art' });
  return place(image);
}

function paintCreateTools() {
  const bar = $('#create-tools');
  const add = (id, label, run) => { const b = button(label, run); b.id = id; bar.append(b); };
  add('add-text', 'Text', addText);
  add('add-image', 'Picture…', () => $('#create-file').click());
  add('add-rect', 'Rectangle', () => addShape('rect'));
  add('add-circle', 'Circle', () => addShape('circle'));
  add('add-line', 'Line', () => addShape('line'));
  add('add-arrow', 'Arrow', () => addShape('arrow'));
  for (const [kind, label] of [['triangle', 'Triangle'], ['star', 'Star'], ['rounded', 'Rounded rectangle'], ['bubble', 'Speech bubble']]) add('add-' + kind, label, () => addShape(kind));
  add('create-draw', 'Draw', () => { board.isDrawingMode = !board.isDrawingMode; $('#create-draw').classList.toggle('on', board.isDrawingMode); board.discardActiveObject(); board.requestRenderAll(); });
  add('add-handwriting', 'Handwriting lines', () => addShape('handwriting'));
  emojiReady.then(() => {
    $('#emoji-category').replaceChildren(Object.assign(document.createElement('option'), { value: '', textContent: 'All categories' }), ...[...new Set(emojiEntries.map(e => e.group))].map(group => Object.assign(document.createElement('option'), { value: group, textContent: group })));
    paintEmoji();
  }).catch(() => {}); // the index failure is reported beside the save status
  const font = $('#prop-font');
  font.replaceChildren(...FONTS.map(f => Object.assign(document.createElement('option'), { value: f, textContent: f })));
  const align = $('#align-tools');
  for (const [id, label, run] of [
    ['left', 'Left', (r, w) => -r.left], ['centre', 'Centre', (r, w) => (w - r.width) / 2 - r.left], ['right', 'Right', (r, w) => w - r.width - r.left],
    ['top', 'Top', (r, w, h) => -r.top], ['middle', 'Middle', (r, w, h) => (h - r.height) / 2 - r.top], ['bottom', 'Bottom', (r, w, h) => h - r.height - r.top]
  ]) {
    const vertical = ['top', 'middle', 'bottom'].includes(id);
    const b = button(label, () => alignTo(id, vertical, run)); b.dataset.align = id; align.append(b);
  }
}
function paintEmoji() {
  const query = $('#emoji-search').value.trim().toLowerCase(), category = $('#emoji-category').value;
  const matches = emojiEntries.filter(e => (!category || e.group === category) && e.name.toLowerCase().includes(query));
  const pages = Math.max(1, Math.ceil(matches.length / 60));
  emojiPage = Math.min(emojiPage, pages - 1);
  $('#emoji-list').replaceChildren(...matches.slice(emojiPage * 60, (emojiPage + 1) * 60).map(({ code, name }) => {
    const b = button('', () => addEmoji(code).catch(e => { $('#create-saved').textContent = String(e); }));
    b.title = name; b.dataset.code = code;
    const img = new Image(); img.loading = 'lazy'; img.src = `emoji/${code}.svg`; img.alt = name; b.append(img);
    return b;
  }));
  $('#emoji-results').textContent = matches.length ? `${matches.length} graphics · Page ${emojiPage + 1} of ${pages}` : 'No matching graphics';
  $('#emoji-prev').disabled = emojiPage === 0; $('#emoji-next').disabled = emojiPage === pages - 1;
}
$('#emoji-search').oninput = $('#emoji-category').onchange = () => { emojiPage = 0; paintEmoji(); };
$('#emoji-prev').onclick = () => { emojiPage--; paintEmoji(); };
$('#emoji-next').onclick = () => { emojiPage++; paintEmoji(); };

function handwritingLines(width) {
  return new fabric.Group([0, 24, 48].map((y, i) => new fabric.Line([0, y, width, y], { stroke: '#777777', strokeWidth: 1, strokeDashArray: i === 1 ? [6, 4] : null })), { kbName: 'Handwriting lines' });
}
function tableCells(rows, cols, top = 180, height = Math.min(rows * 72, pagePx()[1] - top - 48), text = 'Text') {
  if (![rows, cols].every(n => Number.isInteger(n) && n >= 1 && n <= 20)) throw Error('Use 1 to 20 rows and columns');
  const width = (pagePx()[0] - 96) / cols, cellHeight = height / rows, cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const left = 48 + c * width, y = top + r * cellHeight;
    cells.push(R(left, y, width, cellHeight, { kbName: 'Table cell' }), T(width < 72 ? '' : text, left + 6, y + 6, { width: width - 12, minWidth: 1, fontSize: Math.min(24, cellHeight / 3), kbName: 'Cell text' }));
  }
  return cells;
}
function addTable(rows, cols) {
  const cells = tableCells(rows, cols);
  board.discardActiveObject(); board.add(...cells); commitDesign();
}
$('#create-table').onsubmit = e => { e.preventDefault(); addTable(Number($('#table-rows').value), Number($('#table-cols').value)); };
function addQr(text) {
  if (!text.trim() || text.length > 1000) throw Error('Enter up to 1,000 characters');
  const qr = qrcode(0, 'M'); qr.addData(text, 'Byte'); qr.make();
  const count = qr.getModuleCount(), path = [];
  for (let row = 0; row < count; row++) for (let col = 0; col < count; col++) {
    if (qr.isDark(row, col)) path.push(`M ${col + 4} ${row + 4} h 1 v 1 h -1 z`);
  }
  // A white four-module quiet zone is part of the object, so coloured pages remain scannable.
  return place(new fabric.Group([
    new fabric.Rect({ width: count + 8, height: count + 8, fill: '#ffffff', strokeWidth: 0 }),
    new fabric.Path(path.join(' '), { fill: '#000000', strokeWidth: 0 })
  ], { scaleX: 200 / (count + 8), scaleY: 200 / (count + 8), kbName: 'QR code' }));
}
$('#create-qr').onsubmit = e => {
  e.preventDefault();
  try { addQr($('#qr-text').value); } catch (error) { $('#create-saved').textContent = 'Could not add QR: ' + error; }
};

// One object aligns to the page; a selection aligns its objects within their common bounds.
function alignTo(id, vertical, shift) {
  const active = board.getActiveObject(), targets = board.getActiveObjects();
  if (!active || targets.some(o => o.kbLocked)) return;
  const [w, h] = pagePx(), bounds = active.getBoundingRect();
  board.discardActiveObject();
  for (const o of targets) {
    const r = o.getBoundingRect();
    const local = targets.length > 1 ? { ...r, left: r.left - bounds.left, top: r.top - bounds.top } : r;
    const d = shift(local, targets.length > 1 ? bounds.width : w, targets.length > 1 ? bounds.height : h);
    o.set(vertical ? { top: o.top + d } : { left: o.left + d }); o.setCoords();
  }
  selectObjects(targets); commitDesign();
}
function selectObjects(objects) {
  board.discardActiveObject();
  if (objects.length) board.setActiveObject(objects.length === 1 ? objects[0] : new fabric.ActiveSelection(objects, { canvas: board }));
  board.requestRenderAll(); paintPanel();
}
function distribute(vertical) {
  const objects = board.getActiveObjects();
  if (objects.length < 3 || objects.some(o => o.kbLocked)) return;
  board.discardActiveObject();
  const pos = vertical ? 'top' : 'left', span = vertical ? 'height' : 'width';
  objects.sort((a, b) => a.getBoundingRect()[pos] - b.getBoundingRect()[pos]);
  const first = objects[0].getBoundingRect(), last = objects.at(-1).getBoundingRect();
  const gap = (last[pos] + last[span] - first[pos] - objects.reduce((n, o) => n + o.getBoundingRect()[span], 0)) / (objects.length - 1);
  let at = first[pos];
  for (const o of objects) { const r = o.getBoundingRect(); o.set(pos, o[pos] + at - r[pos]); o.setCoords(); at += r[span] + gap; }
  selectObjects(objects); commitDesign();
}
function groupSelected(ungroup = false) {
  const active = board.getActiveObject(), objects = board.getActiveObjects();
  if (!active || objects.some(o => o.kbLocked)) return;
  if (ungroup) {
    if (active.type !== 'group') return;
    const index = board.getObjects().indexOf(active), children = active.removeAll();
    board.discardActiveObject(); board.remove(active); board.insertAt(index, ...children);
    children.forEach(applyLock); selectObjects(children);
  } else {
    if (objects.length < 2) return;
    const index = Math.min(...objects.map(o => board.getObjects().indexOf(o)));
    board.discardActiveObject(); board.remove(...objects);
    const group = new fabric.Group(objects, { kbName: 'Group' });
    // Fabric keeps old child bounds unless nested hit testing is enabled; guides need local bounds.
    objects.forEach(o => o.setCoords()); board.insertAt(index, group); selectObjects([group]);
  }
  commitDesign();
}
$('#prop-distribute-x').onclick = () => distribute(false);
$('#prop-distribute-y').onclick = () => distribute(true);
$('#prop-group').onclick = () => groupSelected();
$('#prop-ungroup').onclick = () => groupSelected(true);

// ---- Layers and the selected thing ----
const kindOf = o => o.kbName || ({ textbox: 'Text', rect: 'Rectangle', circle: 'Circle', line: 'Line', image: 'Picture', group: 'Group' }[o.type] || o.type);
function applyLock(o) {
  if (o.type === 'group') o.getObjects().forEach(applyLock);
  const locked = !!o.kbLocked;
  o.set({ lockMovementX: locked, lockMovementY: locked, lockRotation: locked, lockScalingX: locked, lockScalingY: locked, hasControls: !locked, editable: !locked });
}
function paintLayers() {
  const list = $('#layers'), objects = board.getObjects(), active = board.getActiveObject();
  list.replaceChildren(...objects.map((o, i) => {
    const row = document.createElement('li');
    row.classList.toggle('active', o === active || board.getActiveObjects().includes(o));
    row.classList.toggle('off', o.visible === false);
    const name = button(o.type === 'textbox' && o.text ? `Text: ${o.text.slice(0, 18)}` : kindOf(o), () => { if (o.visible !== false) board.setActiveObject(o); board.requestRenderAll(); paintPanel(); });
    name.className = 'layer-name';
    const act = (label, title, run) => { const b = button(label, () => { run(); }); b.title = title; return b; };
    row.append(
      name,
      act('↑', 'Bring forward', () => { board.moveObjectTo(o, Math.min(objects.length - 1, i + 1)); commitDesign(); }),
      act('↓', 'Send backward', () => { board.moveObjectTo(o, Math.max(0, i - 1)); commitDesign(); }),
      act(o.visible === false ? 'Show' : 'Hide', 'Show or hide', () => { o.set({ visible: o.visible === false }); if (o.visible === false) board.discardActiveObject(); commitDesign(); }),
      act(o.kbLocked ? 'Unlock' : 'Lock', 'Lock or unlock', () => { o.kbLocked = !o.kbLocked; applyLock(o); commitDesign(); })
    );
    return row;
  }).reverse());
  list.dataset.count = objects.length;
}
function paintPanel() {
  const o = board?.getActiveObject(), text = o?.type === 'textbox';
  $('#prop-crop').disabled = o?.type !== 'image' || !!o.kbLocked;
  $('#props').classList.toggle('none', !o);
  for (const el of document.querySelectorAll('#props .text-only')) el.hidden = !text;
  if (o) {
    $('#prop-fill').value = hex(o.fill) || '#000000';
    $('#prop-stroke').value = hex(o.stroke) || '#000000';
    if (text) { $('#prop-font').value = o.fontFamily; $('#prop-size').value = Math.round(o.fontSize * (o.scaleY || 1)); $('#prop-bold').classList.toggle('on', o.fontWeight === 'bold' || o.fontWeight === 700); }
    $('#prop-opacity').value = Math.round(o.opacity * 100); $('#prop-width').value = o.strokeWidth;
    $('#prop-dash').value = o.strokeDashArray ? (o.strokeDashArray[0] === 1 ? 'dot' : 'dash') : 'solid';
    $('#prop-corners').value = o.rx || 0; $('#prop-shadow').checked = !!o.shadow;
    $('#prop-frame').disabled = o.type !== 'image';
    $('#prop-frame').value = !o.clipPath ? 'none' : o.clipPath.type === 'circle' ? 'circle' : o.clipPath.rx ? 'rounded' : 'rect';
    if (text) {
      $('#prop-italic').classList.toggle('on', o.fontStyle === 'italic'); $('#prop-underline').classList.toggle('on', !!o.underline);
      $('#prop-spacing').value = o.charSpacing; $('#prop-line-height').value = o.lineHeight;
      $('#prop-highlight-on').checked = !!o.textBackgroundColor; $('#prop-highlight').value = hex(o.textBackgroundColor) || '#fff2cc';
    }
    $('#prop-fav').classList.toggle('on', text && settings.fonts.includes(o.fontFamily));
  }
  paintLayers();
}
function hex(c) { return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : typeof c === 'string' && /^#[0-9a-f]{3}$/i.test(c) ? '#' + [...c.slice(1)].map(x => x + x).join('') : null; }
function change(props) {
  const targets = board.getActiveObjects();
  if (!targets.length) return;
  for (const o of targets) { o.set(typeof props === 'function' ? props(o) : props); o.setCoords(); }
  board.requestRenderAll(); commitDesign();
}
$('#prop-fill').oninput = e => change(o => o.type === 'line' ? { stroke: e.target.value } : { fill: e.target.value });
$('#prop-stroke').oninput = e => change({ stroke: e.target.value, paintFirst: 'stroke' });
$('#prop-fill').onchange = $('#prop-stroke').onchange = () => paintPanel();
$('#prop-font').onchange = e => change(o => o.type === 'textbox' ? { fontFamily: e.target.value } : {});
$('#prop-size').onchange = e => change(o => o.type === 'textbox' ? { fontSize: Math.min(400, Math.max(6, +e.target.value || 40)), scaleX: 1, scaleY: 1 } : {});
$('#prop-bold').onclick = () => change(o => o.type === 'textbox' ? { fontWeight: o.fontWeight === 'bold' ? 'normal' : 'bold' } : {});
for (const b of document.querySelectorAll('[data-text-align]')) b.onclick = () => change(o => o.type === 'textbox' ? { textAlign: b.dataset.textAlign } : {});
$('#prop-fav').onclick = () => {
  const o = board.getActiveObject();
  if (o?.type !== 'textbox') return;
  settings.fonts = settings.fonts.includes(o.fontFamily) ? settings.fonts.filter(f => f !== o.fontFamily) : [o.fontFamily, ...settings.fonts];
  saveSettings(); paintFonts(); paintPanel();
};
const bounded = (e, min, max, fallback = min) => Math.min(max, Math.max(min, Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : fallback));
$('#prop-opacity').onchange = e => change({ opacity: bounded(e, 0, 100, 100) / 100 });
$('#prop-width').onchange = e => change(o => ({ strokeWidth: bounded(e, 0, 100), stroke: o.stroke || $('#prop-stroke').value, paintFirst: 'stroke' }));
$('#prop-dash').onchange = e => change({ strokeDashArray: e.target.value === 'solid' ? null : e.target.value === 'dot' ? [1, 5] : [8, 5] });
$('#prop-corners').onchange = e => change(o => o.type === 'rect' ? { rx: bounded(e, 0, 200), ry: bounded(e, 0, 200) } : {});
$('#prop-shadow').onchange = e => change({ shadow: e.target.checked ? new fabric.Shadow({ color: '#00000055', blur: 10, offsetX: 6, offsetY: 6 }) : null });
$('#prop-flip-x').onclick = () => change(o => ({ flipX: !o.flipX }));
$('#prop-flip-y').onclick = () => change(o => ({ flipY: !o.flipY }));
$('#prop-italic').onclick = () => change(o => o.type === 'textbox' ? { fontStyle: o.fontStyle === 'italic' ? 'normal' : 'italic' } : {});
$('#prop-underline').onclick = () => change(o => o.type === 'textbox' ? { underline: !o.underline } : {});
$('#prop-spacing').onchange = e => change(o => o.type === 'textbox' ? { charSpacing: bounded(e, -100, 1000) } : {});
$('#prop-line-height').onchange = e => change(o => o.type === 'textbox' ? { lineHeight: bounded(e, 0.5, 5, 1.16) } : {});
const highlight = () => change(o => o.type === 'textbox' ? { textBackgroundColor: $('#prop-highlight-on').checked ? $('#prop-highlight').value : '' } : {});
$('#prop-highlight-on').onchange = $('#prop-highlight').oninput = highlight;
function pictureFrame(image, kind) {
  const options = { width: image.width, height: image.height, originX: 'center', originY: 'center' };
  return kind === 'none' ? null : kind === 'circle' ? new fabric.Circle({ originX: 'center', originY: 'center', radius: Math.min(image.width, image.height) / 2 }) : new fabric.Rect({ ...options, rx: kind === 'rounded' ? image.width / 8 : 0, ry: kind === 'rounded' ? image.height / 8 : 0 });
}
$('#prop-frame').onchange = e => change(o => o.type === 'image' ? { clipPath: pictureFrame(o, e.target.value) } : {});
// Fabric owns the crop controls and panning; this session only handles Apply/Cancel.
async function startPictureCrop() {
  const image = board.getActiveObject();
  if (cropSession || image?.type !== 'image' || image.kbLocked) return;
  await Promise.allSettled([...adding]); await flush();
  if (mode !== 'create' || cropSession || $('#create').inert || !board.getObjects().includes(image) || image.kbLocked) return;
  const stage = $('#create-stage'), dialog = $('#create-crop-dialog');
  const original = Object.fromEntries(['left', 'top', 'width', 'height', 'cropX', 'cropY', 'scaleX', 'scaleY', 'flipX', 'flipY', 'angle', 'skewX', 'skewY'].map(k => [k, image[k]]));
  cropSession = { image, original, zoom: board.getZoom(), scrollLeft: stage.scrollLeft, scrollTop: stage.scrollTop, parent: stage.parentNode, next: stage.nextSibling, selection: board.selection, drawing: board.isDrawingMode,
    targets: board.getObjects().filter(o => o !== image).map(o => [o, o.selectable, o.evented]) };
  for (const [o] of cropSession.targets) o.set({ selectable: false, evented: false });
  board.selection = board.isDrawingMode = false; board.setActiveObject(image);
  guidelines.dispose(); pageGuides = [];
  fabricExtensions.enterCropMode({ target: image });
  image.on('mousedblclick', cropDoubleClick);
  dialog.append(stage); dialog.showModal(); fitBoard(); board.calcOffset();
}
function cropDoubleClick() { finishCrop(true, true); }
function finishCrop(apply, exited = false) {
  if (!cropSession) return;
  const { image, original, parent, next, selection, drawing, targets, zoom, scrollLeft, scrollTop } = cropSession;
  image.off('mousedblclick', cropDoubleClick);
  if (!exited) image.fire('mousedblclick'); // Fabric's exit restores its controls and removes ghost/pan handlers.
  image.off('mousedblclick'); // The demo API rearms itself with once(); pictures have no other double-click handlers.
  if (!apply) image.set(original);
  else if (image.clipPath) image.set({ clipPath: pictureFrame(image, image.clipPath.type === 'circle' ? 'circle' : image.clipPath.rx ? 'rounded' : 'rect') });
  for (const [o, selectable, evented] of targets) o.set({ selectable, evented });
  board.selection = selection; board.isDrawingMode = drawing;
  parent.insertBefore($('#create-stage'), next); $('#create-crop-dialog').close();
  cropSession = null; guidelines = new fabricExtensions.AligningGuidelines(board);
  board.off('object:moving', snapPage); board.on('object:moving', snapPage); // Page snapping still runs after object guides.
  image.setCoords(); zoomBoard(zoom);
  $('#create-stage').scrollLeft = scrollLeft; $('#create-stage').scrollTop = scrollTop; board.calcOffset();
  if (apply) commitDesign();
}
$('#prop-crop').onclick = () => startPictureCrop().catch(error => { $('#create-saved').textContent = 'Could not crop: ' + error; });
$('#crop-apply').onclick = () => finishCrop(true);
$('#crop-cancel').onclick = () => finishCrop(false);
$('#create-crop-dialog').oncancel = event => { event.preventDefault(); finishCrop(false); };
$('#prop-cut').onclick = () => copySelected(true);
$('#prop-clipboard-copy').onclick = () => copySelected();
$('#prop-paste').onclick = () => pasteSelected();
function copySelected(cut = false) {
  const objects = board.getActiveObjects(); if (!objects.length) return;
  board.discardActiveObject(); designClipboard = objects.map(o => o.toObject(KEEP)); selectObjects(objects);
  if (cut) removeSelected();
}
function pasteSelected(source = designClipboard) {
  if (!source?.length) return Promise.resolve();
  return track((async () => {
    const copies = await fabric.util.enlivenObjects(source);
    for (const copy of copies) { copy.set({ left: copy.left + 24, top: copy.top + 24 }); applyLock(copy); }
    board.add(...copies); selectObjects(copies); commitDesign();
  })().catch(e => { $('#create-saved').textContent = 'Could not paste: ' + e; }));
}
document.addEventListener('paste', e => {
  if (mode !== 'create' || cropSession || $('#create').inert || e.target.matches?.('input, textarea, select') || board?.getActiveObject()?.isEditing) return;
  const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
  if (files.length) { e.preventDefault(); importFiles(files); }
  else if (designClipboard) { e.preventDefault(); pasteSelected(); }
});
$('#prop-delete').onclick = () => removeSelected();
$('#prop-copy').onclick = () => duplicateSelected();
function removeSelected() {
  const targets = board.getActiveObjects();
  if (!targets.length) return;
  board.discardActiveObject();
  board.remove(...targets);
  commitDesign();
}
function duplicateSelected() {
  if (!board.getActiveObjects().length) return Promise.resolve();
  const previous = designClipboard; copySelected(); const source = designClipboard; designClipboard = previous;
  return pasteSelected(source);
}

// ---- Page, background, saved colours and fonts ----
function paintAll() {
  $('#create-title').value = design.title;
  $('#create-page').value = design.page;
  $('#create-tile').value = design.tile;
  $('#create-copies').value = design.copies;
  $('#create-bg').value = hex(board.backgroundColor) || '#ffffff';
  $('#create-tile').disabled = !TILES[design.page];
  paintFonts(); paintColours(); paintLayers(); paintPanel(); paintHistory(); fitBoard(); paintBw();
}
$('#create-page').replaceChildren(...Object.keys(PAGES).map(k => Object.assign(document.createElement('option'), { value: k, textContent: PAGE_LABEL(k) })));
$('#create-page').onchange = e => { design.page = e.target.value; if (!TILES[design.page]) design.tile = 'single'; commitDesign(); paintAll(); };
$('#create-tile').onchange = e => { design.tile = e.target.value; remember(); schedule(); };
$('#create-copies').onchange = e => { design.copies = Math.min(20, Math.max(1, +e.target.value | 0 || 1)); e.target.value = design.copies; remember(); schedule(); };
$('#create-bg').oninput = e => { board.backgroundColor = e.target.value; board.requestRenderAll(); };
$('#create-bg').onchange = () => commitDesign();
$('#create-bw').onchange = paintBw;
function paintBw() { $('#create-stage').classList.toggle('bw', $('#create-bw').checked); }

async function loadSettings() {
  const s = await invoke('load_create_settings').catch(() => null);
  if (s && typeof s === 'object') settings = { colours: Array.isArray(s.colours) ? s.colours.filter(c => hex(c)).slice(0, 12) : [], fonts: Array.isArray(s.fonts) ? s.fonts.filter(f => FONTS.includes(f)) : [] };
}
const saveSettings = () => invoke('save_create_settings', { settings }).catch(() => {});
function paintFonts() {
  const sorted = [...settings.fonts, ...FONTS.filter(f => !settings.fonts.includes(f))];
  $('#prop-font').replaceChildren(...sorted.map(f => Object.assign(document.createElement('option'), { value: f, textContent: (settings.fonts.includes(f) ? '★ ' : '') + f })));
}
function paintColours() {
  const row = $('#colours');
  row.replaceChildren(...settings.colours.map(c => {
    const b = button('', () => { if (board.getActiveObject()) change(o => o.type === 'line' ? { stroke: c } : { fill: c }); else { board.backgroundColor = c; board.requestRenderAll(); $('#create-bg').value = c; commitDesign(); } });
    b.style.background = c; b.title = c; b.className = 'swatch'; b.dataset.colour = c;
    b.oncontextmenu = e => { e.preventDefault(); settings.colours = settings.colours.filter(x => x !== c); saveSettings(); paintColours(); };
    return b;
  }));
}
$('#colour-save').onclick = () => {
  const c = $('#prop-fill').value;
  if (!settings.colours.includes(c)) settings.colours = [c, ...settings.colours].slice(0, 12);
  saveSettings(); paintColours();
};

// ---- Output: PNG, JPEG and a 300-dpi PDF ----
// Draw the design on a fresh canvas so the screen's zoom and selection never get in.
async function render(multiplier, format, quality = 0.92) {
  await fonts();
  const [w, h] = pagePx(), sc = new fabric.StaticCanvas(document.createElement('canvas'), { width: w, height: h });
  try {
    await sc.loadFromJSON(board.toObject(KEEP));
    return sc.toDataURL({ format, quality, multiplier, enableRetinaScaling: false });
  } finally { sc.dispose(); }
}
const toBytes = url => Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), c => c.charCodeAt(0));
const DPI = 300;

// The PDF: one page per sheet of paper; a card tiled onto a Letter sheet repeats on it, with cut marks.
async function makePdf() {
  board.discardActiveObject();
  const layout = pageLayout(design.page, design.tile), [sw, sh] = layout.sheet;
  const image = await render(DPI / PX, 'jpeg', 0.92), [pw, ph] = sizeIn(design.page);
  const pdf = new window.jspdf.jsPDF({ unit: 'in', format: [sw, sh], orientation: sw > sh ? 'landscape' : 'portrait', compress: true });
  for (let page = 0; page < design.copies; page++) {
    if (page) pdf.addPage([sw, sh], sw > sh ? 'landscape' : 'portrait');
    for (const t of layout.tiles) pdf.addImage(image, 'JPEG', t.x, t.y, pw, ph, 'design', 'FAST');
    pdf.setDrawColor(110); pdf.setLineWidth(0.01);
    for (const [x1, y1, x2, y2] of layout.marks) pdf.line(x1, y1, x2, y2);
  }
  return new Uint8Array(pdf.output('arraybuffer'));
}
async function output(kind, open = false) {
  const status = $('#create-saved');
  try {
    await flush();
    status.textContent = 'Making ' + (kind === 'pdf' ? 'the PDF' : 'the picture') + '…';
    const bytes = kind === 'pdf' ? await makePdf() : toBytes(await render(DPI / PX, kind === 'png' ? 'png' : 'jpeg'));
    const file = await invoke('save_output', bytes, { headers: { name: encodeURIComponent(design.title), ext: kind === 'jpeg' ? 'jpg' : kind, open: String(open) } });
    status.textContent = (open ? 'Opened ' : 'Saved ') + file;
  } catch (error) { status.textContent = 'Could not make it: ' + error; }
}
$('#create-pdf').onclick = () => output('pdf');
$('#create-png').onclick = () => output('png');
$('#create-jpeg').onclick = () => output('jpeg');
$('#create-print').onclick = () => output('pdf', true);

function reorderSelected(by) {
  const objects = board.getActiveObjects().sort((a, b) => board.getObjects().indexOf(a) - board.getObjects().indexOf(b));
  if (by > 0) objects.reverse();
  for (const o of objects) {
    const stack = board.getObjects(), next = stack.indexOf(o) + by;
    if (stack[next] && !objects.includes(stack[next])) board.moveObjectTo(o, next);
  }
  board.requestRenderAll(); commitDesign();
}

// ---- Keys ----
document.addEventListener('keydown', event => {
  if (mode !== 'create' || !board || cropSession || $('#create').inert || event.target.matches?.('input, select, textarea')) return;
  const active = board.getActiveObject();
  if (active?.isEditing) return;
  const key = event.key.toLowerCase();
  if (event.ctrlKey || event.metaKey) {
    const run = {
      z: () => stepHistory(event.shiftKey ? 1 : -1), y: () => stepHistory(1), d: duplicateSelected,
      g: () => groupSelected(event.shiftKey), c: () => copySelected(), x: () => copySelected(true),
      a: () => selectObjects(board.getObjects().filter(o => o.visible !== false && !o.kbLocked)),
      '[': () => reorderSelected(-1), ']': () => reorderSelected(1)
    }[key];
    if (run) { event.preventDefault(); run(); }
  } else if (key === '+' || key === '=' || key === '-') { event.preventDefault(); zoomBoard(board.getZoom() * (key === '-' ? 0.8 : 1.25)); }
  else if (key === '0') { event.preventDefault(); fitBoard(); }
  else if (key === 'delete' || key === 'backspace') { event.preventDefault(); removeSelected(); }
  else if (key === 'escape') board.discardActiveObject().requestRenderAll();
  else if (key.startsWith('arrow') && active && !board.getActiveObjects().some(o => o.kbLocked)) {
    event.preventDefault();
    const d = event.shiftKey ? 10 : 1;
    active.set({ left: active.left + (key === 'arrowright' ? d : key === 'arrowleft' ? -d : 0), top: active.top + (key === 'arrowdown' ? d : key === 'arrowup' ? -d : 0) });
    active.setCoords(); board.requestRenderAll(); commitDesign();
  }
});

// ---- Starter templates: placeholder words only ----
const T = (text, left, top, o = {}) => new fabric.Textbox(text, { left, top, width: 300, fontSize: 28, fontFamily: 'Lexend', fill: '#222222', kbName: 'Text', ...o });
const R = (left, top, width, height, o = {}) => new fabric.Rect({ left, top, width, height, fill: 'transparent', stroke: '#444444', strokeWidth: 2, kbName: 'Box', ...o });
const STARTERS = {
  'Behaviour chart': async () => {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], x0 = 40, y0 = 190, cw = 100, rh = 100, label = 276;
    board.add(T('Behaviour Chart', 48, 40, { width: 720, fontSize: 60, textAlign: 'center', fontWeight: 'bold', kbName: 'Title' }), T('Name: ________________', 48, 125, { width: 720, fontSize: 30 }));
    board.add(R(x0, y0, label, 60, { fill: '#fff2cc' }));
    days.forEach((d, i) => board.add(R(x0 + label + i * cw, y0, cw, 60, { fill: '#fff2cc' }), T(d, x0 + label + i * cw, y0 + 14, { width: cw, textAlign: 'center', fontSize: 26 })));
    for (let r = 0; r < 8; r++) {
      board.add(R(x0, y0 + 60 + r * rh * 0.9, label, rh * 0.9), T('Goal ' + (r + 1), x0 + 12, y0 + 60 + r * rh * 0.9 + 28, { width: label - 24, fontSize: 26 }));
      for (let c = 0; c < 5; c++) board.add(R(x0 + label + c * cw, y0 + 60 + r * rh * 0.9, cw, rh * 0.9));
    }
  },
  'Labels': async () => {
    for (let r = 0; r < 5; r++) for (let c = 0; c < 2; c++) {
      const x = 16 + c * 392, y = 48 + r * 192;
      board.add(R(x, y, 384, 192, { stroke: '#bbbbbb', strokeDashArray: [6, 6] }), T('Name', x + 20, y + 70, { width: 344, fontSize: 48, textAlign: 'center', fontWeight: 'bold' }));
    }
  },
  'Word wall': async () => {
    board.add(T('Word Wall', 48, 28, { width: 720, fontSize: 64, textAlign: 'center', fontWeight: 'bold', kbName: 'Title' }));
    const w = 176, h = 124;
    for (let i = 0; i < 26; i++) {
      const x = 40 + (i % 4) * (w + 8), y = 130 + Math.floor(i / 4) * (h + 8);
      board.add(R(x, y, w, h, { fill: i % 2 ? '#dae8fc' : '#ffe6cc' }), T(String.fromCharCode(65 + i), x + 10, y + 6, { width: 60, fontSize: 40, fontWeight: 'bold' }), T('word', x + 14, y + 66, { width: w - 28, fontSize: 24 }));
    }
  },
  'Newsletter': async () => {
    board.add(R(0, 0, 816, 170, { fill: '#6aa84f', stroke: '#6aa84f' }), T('Our Class Newsletter', 40, 30, { width: 736, fontSize: 60, fill: '#ffffff', fontWeight: 'bold', textAlign: 'center', kbName: 'Title' }), T('Month Year', 40, 112, { width: 736, fontSize: 28, fill: '#ffffff', textAlign: 'center' }));
    const body = 'Write your news here. Tell families what the class has been learning and what is coming up.';
    [['This week', 40, 200], ['Coming up', 428, 200], ['Reminders', 40, 600], ['Thank you', 428, 600]].forEach(([h, x, y]) => board.add(T(h, x, y, { width: 348, fontSize: 34, fontWeight: 'bold', fill: '#38761d' }), T(body, x, y + 56, { width: 348, fontSize: 24 })));
  },
  'Certificate': async () => {
    board.add(R(32, 32, 752, 992, { stroke: '#b08a32', strokeWidth: 6 }), R(48, 48, 720, 960),
      T('Certificate', 80, 120, { width: 656, fontSize: 72, textAlign: 'center', fontFamily: 'Lora' }),
      T('of Achievement', 80, 220, { width: 656, fontSize: 40, textAlign: 'center' }),
      T('Presented to', 80, 360, { width: 656, textAlign: 'center' }),
      T('Student Name', 80, 440, { width: 656, fontSize: 56, textAlign: 'center', fontFamily: 'Caveat' }),
      T('For your wonderful work', 80, 570, { width: 656, textAlign: 'center' }),
      T('Date: __________', 90, 820), T('Signed: __________', 430, 820));
  },
  'Name tags': async () => {
    for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) {
      const x = 32 + c * 384, y = 48 + r * 240;
      board.add(R(x, y, 368, 216, { rx: 16, ry: 16, fill: '#e6f1ff' }), T('Hello, my name is', x + 16, y + 24, { width: 336, textAlign: 'center', fontSize: 26 }), T('Name', x + 16, y + 92, { width: 336, textAlign: 'center', fontSize: 54, fontFamily: 'Balsamiq Sans' }));
    }
  },
  'Flash cards': async () => {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) {
      const x = 32 + c * 384, y = 48 + r * 320;
      board.add(R(x, y, 368, 304, { strokeDashArray: [6, 6] }), T('Word', x + 20, y + 80, { width: 328, fontSize: 52, textAlign: 'center' }), T('Meaning or picture', x + 20, y + 200, { width: 328, fontSize: 24, textAlign: 'center' }));
    }
  },
  'Calendar': async () => {
    board.add(T('Month Year', 48, 48, { width: 720, fontSize: 56, textAlign: 'center', kbName: 'Title' }));
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((day, c) => board.add(T(day, 48 + c * 720 / 7, 162, { width: 720 / 7, fontSize: 24, textAlign: 'center' })));
    board.add(...tableCells(6, 7, 210, 780, 'Date'));
  },
  'Handwriting worksheet': async () => {
    board.add(T('Handwriting Practice', 48, 40, { width: 720, fontSize: 48 }), T('Name: __________   Date: __________', 48, 120, { width: 720, fontSize: 26 }));
    for (let r = 0; r < 8; r++) board.add(handwritingLines(720).set({ left: 48, top: 230 + r * 96 }), T(r === 0 ? 'Trace your words here' : ' ', 52, 216 + r * 96, { width: 700, fontSize: 42, fontFamily: 'Patrick Hand', fill: '#aaaaaa' }));
  },
};

loadSettings();

// The window is closing: save, then go. If saving fails, say so and let a second close go through anyway.
let closeTried = false;
window.kbClose = async () => {
  if (navigating) await navigating.catch(() => {}); // a transition may still be loading or saving its destination
  $('#create').inert = true; // no edits slip in while the save runs
  // Photos' saves land first; an import finishing meanwhile is still caught. Awaiting the imports is also what yields to the event loop so a decode in flight can finish.
  try { do { await saving; await Promise.allSettled([...adding]); await flush(); } while (dirty || adding.size); }
  catch { $('#create').inert = updating; if (!closeTried) { closeTried = true; $('#create-saved').textContent += ' — close again to quit anyway'; return; } }
  invoke('quit');
};
