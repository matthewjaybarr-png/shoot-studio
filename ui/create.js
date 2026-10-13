// Create: a small Canva-style maker for posters, labels and cards. A design is a Fabric.js canvas in 96-dpi pixels,
// saved as one JSON file (images embedded) in ~/Documents/KB Studio/ and printed through a 300-dpi PDF.
// Needs `invoke`, `$` and `mode` from app.js.

const PX = 96;                                         // design pixels per inch
const PAGES = { letter: [8.5, 11], 'letter-landscape': [11, 8.5], half: [5.5, 8.5], quarter: [4.25, 5.5] };
const PAGE_NAMES = { letter: 'Letter', 'letter-landscape': 'Letter, landscape', half: 'Half sheet card', quarter: 'Quarter sheet card' };
const FONTS = ['Lexend', 'Andika', 'Atkinson Hyperlegible', 'Comic Neue', 'Fredoka'];
const EMOJI = { '2b50': 'star', '1f31f': 'glowing star', '2764': 'heart', '1f34e': 'apple', '1f4da': 'books', '1f4d6': 'open book', '270f': 'pencil', '1f4dd': 'memo', '1f4cf': 'ruler', '1f308': 'rainbow', '2705': 'check', '1f3c6': 'trophy', '1f600': 'smile', '1f44d': 'thumbs up', '1f3a8': 'palette', '1f393': 'graduation cap', '1f3eb': 'school', '1f50d': 'magnifier', '1f33b': 'sunflower', '1f98b': 'butterfly', '1f40c': 'snail', '1f422': 'turtle', '1f43b': 'bear', '1f984': 'unicorn', '1f680': 'rocket', '1f30d': 'earth', '26bd': 'ball', '1f3b5': 'music', '1f382': 'cake', '1f388': 'balloon', '1f389': 'party', '1f381': 'gift', '1f9e9': 'puzzle', '1f9ee': 'abacus', '23f0': 'clock', '1f4a1': 'idea', '1f512': 'lock', '1f4cc': 'pin', '1f340': 'clover', '2600': 'sun' };
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

let board = null;                                      // the Fabric canvas
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
$('#create-home').onclick = () => flush().then(() => setMode('home'), () => {});
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
  paintCreateTools();
}
// Show the whole page, as large as fits.
function fitBoard() {
  if (!board || !design) return;
  const stage = $('#create-stage'), [w, h] = pagePx(), room = stage.getBoundingClientRect();
  const zoom = Math.max(0.1, Math.min((room.width - 32) / w, (room.height - 32) / h, 1.5));
  board.setZoom(zoom);
  board.setDimensions({ width: Math.round(w * zoom), height: Math.round(h * zoom) });
  board.requestRenderAll();
}
const blob = () => ({ format: 1, page: design.page, tile: design.tile, copies: design.copies, canvas: board.toObject(KEEP) });

async function fonts() {
  await Promise.all(FONTS.flatMap(f => ['400', '700'].map(w => document.fonts.load(`${w} 16px "${f}"`).catch(() => []))));
}

async function open(doc, title, name) {
  startBoard();
  await fonts();
  restoring = true;
  design = { title, page: PAGES[doc.page] ? doc.page : 'letter', tile: doc.tile === 'sheet' ? 'sheet' : 'single', copies: Math.min(20, Math.max(1, doc.copies | 0 || 1)) };
  diskName = name; dirty = false;
  await board.loadFromJSON(doc.canvas || { objects: [] });
  if (!doc.canvas) board.backgroundColor = '#ffffff';
  for (const o of board.getObjects()) applyLock(o);
  board.discardActiveObject();
  restoring = false;
  history = []; here = 0; historyBytes = 0;
  remember();
  setMode('create');
  paintAll();
}
async function openDesign(name) {
  await flush();
  const doc = JSON.parse(await invoke('load_creation', { kind: 'designs', name }));
  await open(doc, name, name);
}
async function uniqueTitle(base) {
  const taken = new Set((await invoke('list_creations', { kind: 'designs' }).catch(() => [])).map(d => d.name));
  let title = base, n = 2;
  while (taken.has(title)) title = `${base} ${n++}`;
  return title;
}
// A new design: blank, or from a starter or saved template.
async function newDesign(template, source) {
  await flush();
  startBoard();
  let doc = { page: 'letter' };
  if (template && source === 'mine') doc = JSON.parse(await invoke('load_creation', { kind: 'templates', name: template }));
  const title = await uniqueTitle(template ? `My ${template}` : 'Untitled');
  await open(doc, title, null);
  if (template && source === 'starter') { await STARTERS[template](); remember(); }
  schedule();
}
// A developed photo from Photos becomes the first thing on a new Letter page.
async function createFromPhoto(photoBlob, name) {
  await newDesign();
  await addImageBlob(photoBlob, name);
}

// ---- Saving ----
function schedule() { dirty = true; edits++; clearTimeout(saveTimer); saveTimer = setTimeout(() => { saveTimer = null; save().catch(() => {}); }, 1200); $('#create-saved').textContent = 'Saving…'; }
// Resolves when everything is on disk; rejects if the last save failed, so callers don't throw the work away.
function flush() { if (saveTimer || dirty) { clearTimeout(saveTimer); saveTimer = null; return save(); } return saved; }
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
  const text = JSON.stringify(blob());
  history = history.slice(0, here + 1);
  history.push(text);
  here = history.length - 1;
  historyBytes = history.reduce((n, s) => n + s.length, 0);
  while (history.length > 1 && (history.length > MAX_HISTORY || historyBytes > MAX_HISTORY_BYTES)) { historyBytes -= history.shift().length; here--; }
  paintHistory();
}
function commitDesign() { if (restoring) return; remember(); paintLayers(); paintPanel(); schedule(); }
async function stepHistory(by) {
  const to = here + by;
  if (to < 0 || to >= history.length || restoring) return;
  restoring = true;
  const doc = JSON.parse(history[to]);
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
  const img = await new Promise((done, fail) => Object.assign(new Image(), { onload() { done(this); }, onerror: () => fail('clip art missing'), src: `emoji/${code}.svg` }));
  const out = Object.assign(document.createElement('canvas'), { width: 512, height: 512 });
  out.getContext('2d').drawImage(img, 0, 0, 512, 512);
  const image = await fabric.FabricImage.fromURL(out.toDataURL('image/png'));
  image.set({ scaleX: 150 / 512, scaleY: 150 / 512, kbName: EMOJI[code] || 'Clip art' });
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
  const picker = $('#emoji-list');
  for (const [code, label] of Object.entries(EMOJI)) {
    const b = button('', () => addEmoji(code).catch(e => { $('#create-saved').textContent = String(e); }));
    b.title = label; b.dataset.code = code;
    const i = document.createElement('img'); i.src = `emoji/${code}.svg`; i.alt = label; b.append(i);
    picker.append(b);
  }
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
// Move the selection (as one block) against the page edges or middle.
function alignTo(id, vertical, shift) {
  const o = board.getActiveObject();
  if (!o) return;
  const [w, h] = pagePx(), d = shift(o.getBoundingRect(), w, h);
  o.set(vertical ? { top: o.top + d } : { left: o.left + d });
  o.setCoords(); board.requestRenderAll(); commitDesign();
}

// ---- Layers and the selected thing ----
const kindOf = o => o.kbName || ({ textbox: 'Text', rect: 'Rectangle', circle: 'Circle', line: 'Line', image: 'Picture', group: 'Group' }[o.type] || o.type);
function applyLock(o) {
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
  $('#props').classList.toggle('none', !o);
  for (const el of document.querySelectorAll('#props .text-only')) el.hidden = !text;
  if (o) {
    $('#prop-fill').value = hex(o.fill) || '#000000';
    $('#prop-stroke').value = hex(o.stroke) || '#000000';
    if (text) { $('#prop-font').value = o.fontFamily; $('#prop-size').value = Math.round(o.fontSize * (o.scaleY || 1)); $('#prop-bold').classList.toggle('on', o.fontWeight === 'bold' || o.fontWeight === 700); }
    $('#prop-fav').classList.toggle('on', text && settings.fonts.includes(o.fontFamily));
  }
  paintLayers();
}
function hex(c) { return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : typeof c === 'string' && /^#[0-9a-f]{3}$/i.test(c) ? '#' + [...c.slice(1)].map(x => x + x).join('') : null; }
function change(props) {
  const targets = board.getActiveObjects();
  if (!targets.length) return;
  for (const o of targets) o.set(typeof props === 'function' ? props(o) : props);
  board.requestRenderAll(); commitDesign();
}
$('#prop-fill').oninput = e => change(o => o.type === 'line' ? { stroke: e.target.value } : { fill: e.target.value });
$('#prop-stroke').oninput = e => change({ stroke: e.target.value });
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
$('#prop-delete').onclick = () => removeSelected();
$('#prop-copy').onclick = () => duplicateSelected();
function removeSelected() {
  const targets = board.getActiveObjects();
  if (!targets.length) return;
  board.discardActiveObject();
  board.remove(...targets);
  commitDesign();
}
async function duplicateSelected() {
  const o = board.getActiveObject();
  if (!o || o.type === 'activeselection') return;
  const copy = await o.clone(KEEP);
  copy.set({ left: o.left + 24, top: o.top + 24 });
  board.add(copy); board.setActiveObject(copy);
  commitDesign();
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

// ---- Keys ----
document.addEventListener('keydown', event => {
  if (mode !== 'create' || !board || event.target.matches('input, select, textarea, button')) return;
  const active = board.getActiveObject();
  if (active?.isEditing) return;
  const key = event.key.toLowerCase();
  if (event.ctrlKey || event.metaKey) {
    const run = { z: () => stepHistory(event.shiftKey ? 1 : -1), y: () => stepHistory(1), d: duplicateSelected }[key];
    if (run) { event.preventDefault(); run(); }
  } else if (key === 'delete' || key === 'backspace') { event.preventDefault(); removeSelected(); }
  else if (key === 'escape') board.discardActiveObject().requestRenderAll();
  else if (key.startsWith('arrow') && active) {
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
  }
};

loadSettings();

// The window is closing: save, then go. If saving fails, say so and let a second close go through anyway.
let closeTried = false;
window.kbClose = async () => {
  $('#create').inert = true; // no edits slip in while the save runs
  // Photos' saves land first; an import finishing meanwhile is still caught. Awaiting the imports is also what yields to the event loop so a decode in flight can finish.
  try { do { await saving; await Promise.allSettled([...adding]); await flush(); } while (dirty || adding.size); }
  catch { $('#create').inert = false; if (!closeTried) { closeTried = true; $('#create-saved').textContent += ' — close again to quit anyway'; return; } }
  invoke('quit');
};
