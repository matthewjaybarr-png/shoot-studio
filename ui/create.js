// Create: a small Canva-style maker for posters, labels and cards. A design is a Fabric.js canvas in 96-dpi pixels,
// saved as one JSON file (images embedded) in ~/Documents/KB Studio/ and printed through a 300-dpi PDF.
// Needs `invoke`, `$` and `mode` from app.js.
Object.assign(fabric.FabricObject.ownDefaults, { originX: 'left', originY: 'top' });

const PX = 96;                                         // design pixels per inch
const PAGES = {
  letter: [8.5, 11], 'letter-landscape': [11, 8.5], half: [5.5, 8.5], quarter: [4.25, 5.5], poster: [11, 17],
  'photo-4x6': [4, 6], 'photo-6x4': [6, 4], 'photo-5x7': [5, 7], 'photo-7x5': [7, 5], 'photo-8x10': [8, 10],
  // Social posts are laid out at half their pixel size, 540 px wide like a small card, and saved at exactly the size the sites want.
  'social-portrait': [5.625, 7.03125], 'social-square': [5.625, 5.625], 'social-story': [5.625, 10]
};
const PAGE_NAMES = {
  letter: 'Letter', 'letter-landscape': 'Letter, landscape', half: 'Half sheet card', quarter: 'Quarter sheet card', poster: 'Poster',
  'photo-4x6': '4 × 6 photo', 'photo-6x4': '6 × 4 photo', 'photo-5x7': '5 × 7 photo', 'photo-7x5': '7 × 5 photo', 'photo-8x10': '8 × 10 photo',
  'social-portrait': 'Instagram post', 'social-square': 'Square post', 'social-story': 'Story'
};
const PAGE_GROUPS = [['Printing', ['letter', 'letter-landscape', 'half', 'quarter', 'poster']], ['Photo prints', ['photo-4x6', 'photo-6x4', 'photo-5x7', 'photo-7x5', 'photo-8x10']], ['Social media', ['social-portrait', 'social-square', 'social-story']]];
const SOCIAL_SCALE = 2;
const isSocial = key => key.startsWith('social-');
const FONTS = ['Lexend', 'Andika', 'Atkinson Hyperlegible', 'Comic Neue', 'Fredoka', 'Balsamiq Sans', 'Nunito', 'Lora', 'Patrick Hand', 'Caveat', 'Roboto Slab'];
// Generated offline from Unicode 15.0 emoji-test.txt; assets stay local.
let emojiEntries = [], emojiPage = 0;
const emojiReady = fetch('emoji-index.json').then(r => { if (!r.ok) throw Error('clip art index missing'); return r.json(); }).then(entries => { emojiEntries = entries; });
emojiReady.catch(error => { $('#create-saved').textContent = 'Could not load clip art: ' + error; });
const IMAGE_EDGE = 3300;                               // imported pictures are shrunk to this many pixels on the long edge
const MAX_HISTORY = 50, MAX_HISTORY_BYTES = 250e6;
const FORMAT = 2;                                      // the newest design file format this version reads
// Format 1 is one page in a named size; format 2 adds `pages` and a custom `size`. A one-page design in a named
// size is still written as format 1, so older KB Studio keeps opening everything it can show correctly.
const MAX_SIDE = 36, MAX_PAGES = 30;                   // custom sizes are 1–36 inches a side
const blankPage = () => ({ objects: [], background: '#ffffff' });
const validSize = s => Array.isArray(s) && s.length === 2 && s.every(v => Number.isFinite(v) && v >= 1 && v <= MAX_SIDE);
const docPage = doc => doc.page === 'custom' && validSize(doc.size) ? 'custom' : PAGES[doc.page] ? doc.page : 'letter';
const docSize = doc => docPage(doc) === 'custom' ? doc.size.map(Number) : sizeIn(docPage(doc));
const docPages = doc => Array.isArray(doc.pages) && doc.pages.length ? doc.pages.slice(0, MAX_PAGES) : [doc.canvas || blankPage()];
const KEEP = ['kbName', 'kbLocked', 'kbFrame', 'kbEffect', 'kbOriginal', 'kbFilter']; // our own fields, saved with every object
const TILES = { half: { sheet: 'letter-landscape', cols: 2, rows: 1 }, quarter: { sheet: 'letter', cols: 2, rows: 2 } };

const sizeIn = key => PAGES[key] || PAGES.letter;

// Where the cards go on the paper (inches), and the cut marks between them. `tile` is 'single' or 'sheet'.
function pageLayout(page, tile, size = sizeIn(page)) {
  const [w, h] = size, t = TILES[page];
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
let cropSession = null, guidelines, transforming = false, openPop = null, fitted = true, boardPan = null, spacePan = false, hovered = null;
const PASTEBOARD = '#ede5f2';
let design = null;                                     // { title, page, size (inches), tile, copies }
let designPages = [], pageAt = 0;                      // every page's canvas JSON; the one being edited lives on the board instead
let designFonts = [];                                  // fonts that came inside an imported design: [{ family, src }], saved with it
let settings = { colours: [], fonts: [], seen: 0, closed: ['frames', 'grids', 'graphics'], projects: { folders: [], placed: Object.create(null), trash: Object.create(null) } };
let history = [], here = 0, restoring = false, historyBytes = 0, saveTimer = null, saved = Promise.resolve(), diskName = null, dirty = false, edits = 0;

const pagePx = () => design.size.map(v => Math.round(v * PX));
const PAGE_LABEL = key => PAGE_NAMES[key] + (isSocial(key) ? ' (' + sizeIn(key).map(v => Math.round(v * PX * SOCIAL_SCALE)).join(' × ') + ' px)' : key.startsWith('photo-') ? '' : ' (' + sizeIn(key).join(' × ') + ' in)');
// PNG and JPEG: social posts at their exact pixel size, everything else at 300 dpi.
const pictureScale = () => isSocial(design.page) ? SOCIAL_SCALE : DPI / PX;

function setMode(next) {
  mode = next;
  $('#home').hidden = next !== 'home';
  $('#create').hidden = next !== 'create';
  document.body.classList.toggle('away', next !== 'photos');
  closeMenus(); paintFloat(); paintWhatsNew();
  if (next === 'home') paintHome();
  if (next === 'create') fitBoard();
}

// ---- Home ----
async function paintHome() {
  const recent = $('#home-recent'), starters = $('#home-templates'), status = $('#home-status');
  status.textContent = ''; // cleared first, so a message set just after this call stays
  const [all, mine] = await Promise.all([invoke('list_creations', { kind: 'designs' }).catch(() => []), invoke('list_creations', { kind: 'templates' }).catch(() => [])]);
  const tell = name => error => { status.textContent = `Could not open “${name}”: ${error.message || error}`; };
  paintFolders(all);
  const designs = all.filter(shownHere);
  const card = (d, i) => {
    const when = inTrash(d.name) ? 'In the trash' : new Date(d.modified * 1000).toLocaleDateString();
    const b = designCard(button(d.name, () => openDesign(d.name).catch(tell(d.name)), when), d.name);
    // The newest designs show their first page, drawn once per saved version.
    if (i < 24) {
      const img = new Image(); img.alt = ''; b.prepend(img); b.classList.add('template');
      cached(`design:${d.name}:${d.modified}`, async () => {
        const doc = JSON.parse(await invoke('load_creation', { kind: 'designs', name: d.name }));
        await addDesignFonts(doc.fonts);
        return drawThumb(docSize(doc), c => c.loadFromJSON(docPages(doc)[0]), 200);
      }).then(url => { img.src = url; }, () => img.remove());
    }
    return b;
  };
  recent.replaceChildren(...designs.map(card));
  // Her newest work first, above the templates, so it's there without scrolling.
  const latest = all.filter(d => !inTrash(d.name)).slice(0, 8);
  $('#home-latest-list').replaceChildren(...latest.map(card));
  $('#home-latest').hidden = !latest.length;
  $('#home-designs').hidden = !all.length && !projects().folders.length;
  starters.replaceChildren(...Object.keys(STARTERS).map(n => templateButton(n, 'starter', 0, () => newDesign(n, 'starter').catch(tell(n)))), ...mine.map(t => templateButton(t.name, 'mine', t.modified, () => newDesign(t.name, 'mine').catch(tell(t.name)))));
}
$('#home-see-all').onclick = () => $('#home-designs').scrollIntoView({ behavior: 'smooth', block: 'start' });
function button(text, onclick, small) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = text; b.onclick = onclick;
  if (small) { const s = document.createElement('small'); s.textContent = small; b.append(s); }
  return b;
}
$('#home-photos').onclick = () => setMode('photos');
// This shoot, with no shoot open: straight to Photos and its Open shoot.
$('#shoot-go').onclick = () => navigateDesign(() => { setMode('photos'); $('#open').click(); }).catch(() => {});
$('#home-create').onclick = () => newDesign();
$('#create-home').onclick = () => navigateDesign(() => setMode('home')).catch(() => {});
$('#photos-home').onclick = () => setMode('home');

// ---- The page ----
function startBoard() {
  if (board) return;
  board = new fabric.Canvas($('#create-canvas'), { backgroundColor: '#ffffff', preserveObjectStacking: true, selection: true, fireRightClick: true, fireMiddleClick: true, stopContextMenu: true, controlsAboveOverlay: true });
  // The canvas fills the stage and the page sits on a grey pasteboard, so things can hang off the edge
  // like in Canva. backgroundColor stays the page colour (saved and exported as before); only here is it
  // drawn as the page instead of the whole canvas. Whatever is off the page is faded by the overlay.
  board._renderBackground = ctx => {
    ctx.fillStyle = PASTEBOARD; ctx.fillRect(0, 0, board.width, board.height);
    if (!design) return;
    const [w, h] = pagePx();
    ctx.save(); ctx.transform(...board.viewportTransform);
    ctx.shadowColor = 'rgba(90, 40, 100, 0.25)'; ctx.shadowBlur = 16; ctx.fillStyle = board.backgroundColor || '#ffffff'; ctx.fillRect(0, 0, w, h);
    ctx.restore();
  };
  board._renderOverlay = ctx => {
    if (!design) return;
    const [w, h] = pagePx();
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, board.width, board.height);
    ctx.transform(...board.viewportTransform); ctx.rect(0, 0, w, h);
    ctx.fillStyle = 'rgba(237, 229, 242, 0.78)'; ctx.fill('evenodd'); ctx.restore();
  };
  for (const e of ['object:modified', 'text:editing:exited']) board.on(e, commitDesign);
  if (typeof startTextTools === 'function') startTextTools();
  if (typeof startTables === 'function') startTables();
  for (const e of ['selection:created', 'selection:updated', 'selection:cleared']) board.on(e, paintPanel);
  board.on('object:added', () => { if (!restoring) paintLayers(); });
  board.on('object:removed', () => { if (!restoring) paintLayers(); });
  // The stage changes size with the window and when a drawer opens or closes.
  new ResizeObserver(() => { if (mode === 'create' && !cropSession && layoutBoard()) { if (fitted) fitBoard(); else clampView(); } }).observe($('#create-stage'));
  guidelines = new fabricExtensions.AligningGuidelines(board);
  board.on('object:moving', snapPage);
  board.on('after:render', drawPageOverlay);
  board.on('mouse:up', () => { pageGuides = []; transforming = false; boardPan = null; $('#create-readout').hidden = true; board.requestRenderAll(); });
  board.on('mouse:move', ({ e }) => {
    if (!boardPan) return;
    panBy(e.clientX - boardPan.x, e.clientY - boardPan.y); boardPan = { x: e.clientX, y: e.clientY };
  });
  board.on('object:scaling', ({ target, e }) => readout(`${(target.getScaledWidth() / PX).toFixed(2)} × ${(target.getScaledHeight() / PX).toFixed(2)} in`, e));
  // Rotation snaps to 45° when close, or to every 15° while Shift is held.
  board.on('object:rotating', ({ target, e }) => {
    target.set(e.shiftKey ? { snapAngle: 15, snapThreshold: undefined } : { snapAngle: 45, snapThreshold: 4 });
    readout(`${Math.round(((target.angle % 360) + 360) % 360)}°`, e);
  });
  board.on('mouse:over', ({ target }) => { hovered = target; board.requestRenderAll(); });
  board.on('mouse:out', () => { hovered = null; board.requestRenderAll(); });
  for (const e of ['object:moving', 'object:scaling', 'object:rotating']) board.on(e, () => { transforming = true; });
  board.on('after:render', paintFloat);
  board.on('mouse:down', ({ e, target }) => {
    closeMenus();
    if (e.button === 1 || (spacePan && e.button === 0)) { boardPan = { x: e.clientX, y: e.clientY }; return; }
    if (e.button !== 2) return;
    // Right-click picks what is under the pointer, unless it is already part of the selection.
    if (!target) board.discardActiveObject();
    else if (!board.getActiveObjects().includes(target)) board.setActiveObject(target);
    board.requestRenderAll(); paintPanel();
    openMenu(e.clientX, e.clientY);
  });
  board.on('path:created', e => { e.path.kbName = 'Drawing'; commitDesign(); });
  board.freeDrawingBrush = new fabric.PencilBrush(board);
  board.freeDrawingBrush.color = '#444444'; board.freeDrawingBrush.width = 3;
  // Ctrl+wheel zooms at the pointer; the wheel alone moves around (Shift for sideways).
  board.on('mouse:wheel', ({ e }) => {
    e.preventDefault(); e.stopPropagation();
    if (e.ctrlKey || e.metaKey) zoomBoard(board.getZoom() * Math.exp(-e.deltaY * 0.002), board.getViewportPoint(e));
    else if (e.shiftKey) panBy(-(e.deltaX || e.deltaY), 0);
    else panBy(-e.deltaX, -e.deltaY);
  });
  const stage = $('#create-stage');
  // A picture dragged over a frame or picture outlines it: letting go there swaps the picture in.
  stage.ondragover = e => {
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    const picture = e.dataTransfer.types.includes('Files') || dragItem?.[0] === 'photo';
    const target = picture && !cropSession && !$('#create').inert ? dropTarget(board.getScenePoint(e)) : null;
    if (target !== dropHover) { dropHover = target; board.requestRenderAll(); }
  };
  stage.ondragleave = e => { if (dropHover && !stage.contains(e.relatedTarget)) { dropHover = null; board.requestRenderAll(); } };
  // Right-clicks on the grey around the page; the page itself is handled by Fabric above.
  stage.oncontextmenu = e => { e.preventDefault(); if ($('#create').inert || cropSession) return; board.discardActiveObject(); board.requestRenderAll(); paintPanel(); openMenu(e.clientX, e.clientY); };
  // Things dragged from a drawer, or picture files, land where they are dropped.
  stage.ondrop = e => {
    e.preventDefault();
    if ($('#create').inert || cropSession) return;
    dropHover = null; board.requestRenderAll();
    const at = board.getScenePoint(e), item = e.dataTransfer.getData(DRAG_TYPE);
    const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/')), target = files.length === 1 && dropTarget(at);
    if (item) dropItem(JSON.parse(item), at);
    else if (target) fillFrame(target, files[0], files[0].name.replace(/\.[^.]*$/, '')).catch(error => { $('#create-saved').textContent = `Could not add ${files[0].name}: ${error}`; });
    else importFiles(files, at);
  };
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
  ctx.setLineDash([]);
  // A thin outline under the pointer shows what a click would pick, as in Canva.
  if (hovered && !transforming && !board.getActiveObjects().includes(hovered) && hovered.visible !== false && board.getObjects().includes(hovered)) {
    ctx.strokeStyle = '#d0489b'; ctx.lineWidth = 2 / board.getZoom(); ctx.beginPath();
    hovered.getCoords().forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.stroke();
    ctx.lineWidth = 1 / board.getZoom();
  }
  for (const o of board.getObjects()) if (emptyFrame(o) && o.visible !== false) drawFrameHint(ctx, o);
  if (dropHover && board.getObjects().includes(dropHover)) {
    ctx.strokeStyle = '#d0489b'; ctx.lineWidth = 4 / board.getZoom(); ctx.beginPath();
    dropHover.getCoords().forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.stroke();
    ctx.lineWidth = 1 / board.getZoom();
  }
  ctx.strokeStyle = '#d22';
  for (const [axis, v] of pageGuides) { ctx.beginPath(); ctx.moveTo(axis === 'x' ? v : 0, axis === 'y' ? v : 0); ctx.lineTo(axis === 'x' ? v : w, axis === 'y' ? v : h); ctx.stroke(); }
  ctx.restore();
}
// An empty frame shows a small picture sign and "Drop a photo" on screen only; exports keep the plain grey.
function drawFrameHint(ctx, o) {
  const c = o.getCenterPoint(), size = Math.min(o.getScaledWidth(), o.getScaledHeight()), s = Math.min(size / 6, 40);
  if (size * board.getZoom() < 36) return;
  ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(fabric.util.degreesToRadians(o.angle || 0));
  ctx.strokeStyle = ctx.fillStyle = '#7a8090'; ctx.lineWidth = s / 10; ctx.lineJoin = 'round';
  const top = size * board.getZoom() > 120 ? -s * 0.8 : 0;
  ctx.strokeRect(-s, top - s * 0.7, s * 2, s * 1.4);
  ctx.beginPath(); ctx.moveTo(-s * 0.8, top + s * 0.5); ctx.lineTo(-s * 0.2, top - s * 0.15); ctx.lineTo(s * 0.2, top + s * 0.25); ctx.lineTo(s * 0.45, top); ctx.lineTo(s * 0.8, top + s * 0.5); ctx.stroke();
  ctx.beginPath(); ctx.arc(s * 0.45, top - s * 0.35, s * 0.15, 0, Math.PI * 2); ctx.fill();
  if (top) { ctx.font = `600 ${s * 0.55}px Lexend, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText('Drop a photo', 0, top + s * 0.9); }
  ctx.restore();
}
// The view is Fabric's viewport transform: zoom, plus where the page sits on the stage.
function layoutBoard() {
  const r = $('#create-stage').getBoundingClientRect(), width = Math.floor(r.width), height = Math.floor(r.height);
  if (!board || width < 2 || height < 2) return false;
  if (width !== board.width || height !== board.height) board.setDimensions({ width, height });
  return true;
}
// Keep at least a corner of the page in view, so it can't be lost off the side.
function clampView() {
  if (!board || !design) return;
  const v = [...board.viewportTransform], [w, h] = pagePx(), keep = 80;
  v[4] = Math.min(board.width - keep, Math.max(keep - w * v[0], v[4]));
  v[5] = Math.min(board.height - keep, Math.max(keep - h * v[3], v[5]));
  board.setViewportTransform(v);
  $('#create-zoom').textContent = Math.round(board.getZoom() * 100) + '%';
}
function zoomBoard(zoom, at) {
  if (!board || !design) return;
  fitted = false;
  board.zoomToPoint(at || new fabric.Point(board.width / 2, board.height / 2), Math.min(4, Math.max(0.1, zoom)));
  clampView();
}
function panBy(dx, dy) {
  if (!board || !design || (!dx && !dy)) return;
  fitted = false; board.relativePan(new fabric.Point(dx, dy)); clampView(); closeMenus();
}
function setSpacePan(on) {
  if (spacePan === on || !board) return;
  spacePan = on; board.skipTargetFind = on; board.selection = on ? false : !cropSession;
  board.defaultCursor = on ? 'grab' : 'default'; board.setCursor(board.defaultCursor);
}
function readout(text, e) {
  const tag = $('#create-readout'), host = $('#create').getBoundingClientRect();
  tag.textContent = text; tag.hidden = false;
  tag.style.left = e.clientX - host.left + 18 + 'px'; tag.style.top = e.clientY - host.top + 18 + 'px';
}
$('#create-zoom-in').onclick = () => zoomBoard(board.getZoom() * 1.25);
$('#create-zoom-out').onclick = () => zoomBoard(board.getZoom() / 1.25);
$('#create-fit').onclick = fitBoard;
$('#create-margin').onchange = () => board?.requestRenderAll();

// Show the whole page, as large as fits, in the middle of the stage.
function fitBoard() {
  if (!board || !design || !layoutBoard()) return;
  const [w, h] = pagePx(), zoom = Math.max(0.1, Math.min((board.width - 64) / w, (board.height - 64) / h, 1.5));
  board.setViewportTransform([zoom, 0, 0, zoom, Math.round((board.width - w * zoom) / 2), Math.round((board.height - h * zoom) / 2)]);
  fitted = true; $('#create-zoom').textContent = Math.round(zoom * 100) + '%';
}
const pageJSON = i => i === pageAt ? board.toObject(KEEP) : designPages[i];
const allPages = () => designPages.map((_, i) => pageJSON(i));
function blob() {
  const list = allPages(), base = { page: design.page, tile: design.tile, copies: design.copies };
  const fonts = designFonts.length ? designFonts : undefined; // older versions ignore them and show a bundled font
  return list.length === 1 && design.page !== 'custom' ? { format: 1, ...base, fonts, canvas: list[0] } : { format: 2, ...base, fonts, size: design.page === 'custom' ? design.size : undefined, pages: list };
}

// Fonts carried in a design, such as the ones Canva embeds in its PowerPoint files. They are added from their
// bytes, which the page's content policy allows, unlike font URLs. Bundled names always win.
// Each is { family, src, weight: 'normal' | 'bold', style: 'normal' | 'italic' }.
const fontFaces = new Map();                           // family, weight and style → the src added for them
const faceKey = f => `${f.family}|${f.weight}|${f.style}`;
async function addDesignFonts(list) {
  const good = (Array.isArray(list) ? list : []).filter(f => typeof f?.family === 'string' && f.family.length <= 64 && !FONTS.includes(f.family) && typeof f.src === 'string' && /^data:font\/(otf|ttf);base64,/.test(f.src))
    .map(f => ({ family: f.family, src: f.src, weight: f.weight === 'bold' ? 'bold' : 'normal', style: f.style === 'italic' ? 'italic' : 'normal' }));
  await Promise.allSettled(good.filter(f => fontFaces.get(faceKey(f)) !== f.src).map(async f => {
    const face = await new FontFace(f.family, dataBytes(f.src).buffer, { weight: f.weight, style: f.style }).load();
    document.fonts.add(face); fontFaces.set(faceKey(f), f.src);
  }));
  return good.filter(f => fontFaces.get(faceKey(f)) === f.src);
}
const dataBytes = url => Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), c => c.charCodeAt(0));
const designFamilies = () => [...new Set(designFonts.map(f => f.family))];

async function fonts() {
  const loads = await Promise.allSettled([...FONTS, ...designFamilies()].flatMap(f => ['400', '700'].map(w => document.fonts.load(`${w} 16px "${f}"`))));
  const failed = loads.find(result => result.status === 'rejected'), warning = $('#create-font-warning');
  if (failed) { warning.hidden = false; throw failed.reason; }
}

async function open(doc, title, name) {
  if ((doc.format ?? 1) > FORMAT) throw Error('it was made by a newer KB Studio; update KB Studio to open it');
  startBoard();
  designFonts = await addDesignFonts(doc.fonts);
  await fonts().catch(() => {}); // Editing can use fallback fonts; output remains strict.
  restoring = true;
  design = { title, page: docPage(doc), size: docSize(doc), tile: doc.tile === 'sheet' ? 'sheet' : 'single', copies: Math.min(20, Math.max(1, doc.copies | 0 || 1)) };
  diskName = name; dirty = false;
  designPages = docPages(doc); pageAt = 0;
  await board.loadFromJSON(designPages[0]);
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
    let doc = { page: source === 'starter' ? starterPage(template) : 'letter' };
    if (template && source === 'mine') doc = JSON.parse(await invoke('load_creation', { kind: 'templates', name: template }));
    const title = await uniqueTitle(template ? `My ${template}` : 'Untitled');
    await open(doc, title, null);
    if (template && source === 'starter') { await STARTERS[template](board); remember(); }
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
    if (old && old !== name) { await invoke('delete_creation', { kind: 'designs', name: old }); designRenamed(old, name); }
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
  const text = JSON.stringify({ ...blob(), at: pageAt }, (key, value) => {
    if ((key !== 'src' && key !== 'kbOriginal') || typeof value !== 'string') return value; // pictures and their unfiltered originals are shared
    if (!imageIds.has(value)) { const id = ++nextImageId; imageIds.set(value, id); historyImages.set(id, value); }
    return { kbImage: imageIds.get(value) };
  });
  history = history.slice(0, here + 1); history.push(text);
  const recount = () => {
    const used = new Set();
    for (const snapshot of history) JSON.parse(snapshot, (k, v) => { if ((k === 'src' || k === 'kbOriginal') && v?.kbImage) used.add(v.kbImage); return v; });
    for (const [id, src] of historyImages) if (!used.has(id)) { historyImages.delete(id); imageIds.delete(src); }
    historyBytes = 2 * (history.reduce((n, v) => n + v.length, 0) + [...historyImages.values()].reduce((n, v) => n + v.length, 0));
  };
  recount();
  while (history.length > 1 && (history.length > MAX_HISTORY || historyBytes > MAX_HISTORY_BYTES)) { history.shift(); recount(); }
  here = history.length - 1; paintHistory();
}
function commitDesign() { if (restoring || cropSession) return; remember(); paintLayers(); paintPanel(); schedule(); paintPagesSoon(); }
async function stepHistory(by) {
  const to = here + by;
  if (to < 0 || to >= history.length || restoring) return;
  restoring = true;
  const doc = JSON.parse(history[to], (k, v) => (k === 'src' || k === 'kbOriginal') && v?.kbImage ? historyImages.get(v.kbImage) : v);
  design.page = docPage(doc); design.size = docSize(doc); design.tile = doc.tile; design.copies = doc.copies;
  designPages = docPages(doc); pageAt = Math.min(doc.at | 0, designPages.length - 1);
  await board.loadFromJSON(designPages[pageAt]);
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
// In the middle of the page, or centred on `at` (a page point) when it was dropped somewhere.
function place(object, at) {
  const [w, h] = pagePx(), x = at ? at.x : w / 2, y = at ? at.y : h / 2;
  object.set({ left: Math.round(x - object.getScaledWidth() / 2), top: Math.round(y - object.getScaledHeight() / 2) });
  board.add(object); board.setActiveObject(object); object.setCoords();
  commitDesign();
  return object;
}
const textColour = () => '#222222';
// Canva-style starting points; a plain text box is the fallback.
const TEXT_PRESETS = {
  heading: { text: 'Add a heading', width: 640, fontSize: 64, fontWeight: 'bold', kbName: 'Heading' },
  subheading: { text: 'Add a subheading', width: 560, fontSize: 40, fontWeight: 'bold', kbName: 'Subheading' },
  body: { text: 'Add a little bit of body text', width: 480, fontSize: 24, kbName: 'Body text' }
};
// Font combinations, as in Canva: a few lines in paired fonts, added together and selected as one so they move
// together, but each stays its own text box to edit. Sizes are for a Letter page; smaller pages scale them down.
// Each line: [text, font, size, extra style].
const COMBOS = [
  ['Thank you', [['Thank you', 'Caveat', 96], ['FOR BEING PART OF OUR CLASS', 'Lexend', 20, { charSpacing: 200 }]]],
  ['Mini sessions', [['Fall Mini Sessions', 'Lora', 60, { fontWeight: 'bold' }], ['20 minutes · 10 edited photos', 'Nunito', 24], ['Book your spot', 'Caveat', 40]]],
  ['Welcome back', [['Welcome back!', 'Fredoka', 72, { fontWeight: 'bold' }], ['Room 12 · Second grade', 'Nunito', 26]]],
  ['Student of the week', [['STUDENT OF THE WEEK', 'Roboto Slab', 40, { fontWeight: 'bold', charSpacing: 120 }], ['Student Name', 'Caveat', 64]]],
  ['Happy holidays', [['Happy Holidays', 'Caveat', 84], ['from our family to yours', 'Lora', 26, { fontStyle: 'italic' }]]],
  ['Field trip', [['Field Trip', 'Balsamiq Sans', 64, { fontWeight: 'bold' }], ['Friday, 9:00 am', 'Andika', 28], ['Please pack a lunch and a water bottle', 'Andika', 20]]],
  ['Save the date', [['SAVE THE DATE', 'Lora', 26, { charSpacing: 300 }], ['June 14', 'Caveat', 88], ['Spring concert', 'Lora', 26]]],
  ['Reading goals', [['Reading Goals', 'Comic Neue', 60, { fontWeight: 'bold' }], ['This week I will read…', 'Patrick Hand', 32]]],
  ['Family portraits', [['Family Portraits', 'Lora', 60], ['OUTDOOR SESSIONS ALL AUTUMN', 'Lexend', 18, { charSpacing: 250 }]]],
  ['New gallery', [['NEW GALLERY', 'Lexend', 52, { fontWeight: 'bold', charSpacing: 150 }], ['Tap the link to see your photos', 'Nunito', 22]]],
  ['Hello friends', [['Hello, friends!', 'Patrick Hand', 72], ['Notes from the classroom', 'Atkinson Hyperlegible', 24]]],
  ['Congratulations', [['Congratulations', 'Caveat', 80], ['CLASS OF 2027', 'Roboto Slab', 28, { fontWeight: 'bold', charSpacing: 200 }]]]
];
function addCombo(index, at) {
  const [name, lines] = COMBOS[index], [w, h] = pagePx(), k = Math.min(1, w / 816), gap = 10 * k;
  const texts = lines.map(([text, fontFamily, size, extra]) => new fabric.Textbox(text, { fontFamily, fontSize: Math.round(size * k), fill: textColour(), textAlign: 'center', width: Math.min(w - 48, 640 * k), ...extra, kbName: text.slice(0, 40) }));
  const total = texts.reduce((n, t) => n + t.height, 0) + gap * (texts.length - 1), x = at ? at.x : w / 2;
  let y = (at ? at.y : h / 2) - total / 2;
  for (const t of texts) { t.set({ left: Math.round(x - t.width / 2), top: Math.round(y) }); y += t.height + gap; }
  board.add(...texts); selectObjects(texts); for (const t of texts) t.setCoords();
  commitDesign();
  return texts;
}
// The drawer shows each combination in its own fonts.
function paintCombos() {
  $('#font-combos').replaceChildren(...COMBOS.map(([name, lines], i) => {
    const b = button('', () => addCombo(i)); b.title = name; b.className = 'combo'; draggable(b, ['combo', i]);
    for (const [text, fontFamily, size, extra = {}] of lines) {
      const line = Object.assign(document.createElement('span'), { textContent: text });
      const longest = Math.max(...text.split(' ').map(word => word.length)); // long words shrink rather than break
      Object.assign(line.style, { fontFamily: `"${fontFamily}"`, fontSize: Math.max(9, Math.min(Math.round(size * 0.3), Math.floor(230 / longest))) + 'px', fontWeight: extra.fontWeight || 'normal', fontStyle: extra.fontStyle || 'normal', letterSpacing: (extra.charSpacing || 0) / 1000 + 'em' });
      b.append(line);
    }
    return b;
  }));
}
function addText(preset, at) {
  const { text, ...style } = TEXT_PRESETS[preset] || { text: 'Double-click to edit', width: 420, fontSize: 40, kbName: 'Text' };
  const t = new fabric.Textbox(text, { fontFamily: settings.fonts[0] || FONTS[0], fill: textColour(), textAlign: 'center', ...style });
  place(t, at);
  t.enterEditing(); t.selectAll();
  return t;
}
const SHAPE = { fill: '#ffd966', stroke: '#444444', strokeWidth: 3 };
function addShape(kind, at) {
  const shapes = {
    rect: () => new fabric.Rect({ width: 260, height: 160, ...SHAPE, kbName: 'Rectangle' }),
    rounded: () => new fabric.Rect({ width: 260, height: 160, rx: 24, ry: 24, ...SHAPE, kbName: 'Rounded rectangle' }),
    triangle: () => new fabric.Triangle({ width: 200, height: 180, ...SHAPE, kbName: 'Triangle' }),
    star: () => new fabric.Polygon(Array.from({ length: 10 }, (_, i) => { const a = i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? 45 : 100; return { x: Math.cos(a) * r, y: Math.sin(a) * r }; }), { ...SHAPE, kbName: 'Star' }),
    handwriting: () => handwritingLines(Math.min(500, pagePx()[0] - 96)),
    bubble: () => new fabric.Path('M 20 0 L 240 0 Q 260 0 260 20 L 260 120 Q 260 140 240 140 L 90 140 L 40 180 L 50 140 L 20 140 Q 0 140 0 120 L 0 20 Q 0 0 20 0 Z', { ...SHAPE, kbName: 'Speech bubble' }),
    circle: () => new fabric.Circle({ radius: 90, ...SHAPE, kbName: 'Circle' }),
    line: () => new fabric.Line([0, 0, 300, 0], { stroke: '#444444', strokeWidth: 6, strokeLineCap: 'round', kbName: 'Line' }),
    ...Object.fromEntries(LINE_STYLES.map(([key, name, dash]) => [key, () => new fabric.Line([0, 0, 300, 0], { stroke: '#444444', strokeWidth: 6, strokeLineCap: 'round', strokeDashArray: dash, kbName: name })])),
    'double-line-arrow': () => new fabric.Group([
      new fabric.Line([10, 0, 290, 0], { stroke: '#444444', strokeWidth: 6, strokeLineCap: 'round' }),
      new fabric.Triangle({ width: 36, height: 36, fill: '#444444', left: 2, top: -18, angle: -90 }),
      new fabric.Triangle({ width: 36, height: 36, fill: '#444444', left: 298, top: 18, angle: 90 })
    ], { kbName: 'Two-way arrow' }),
    ...Object.fromEntries(NEW_SHAPES.map(([kind, name, w, h]) => [kind, () => new fabric.Path(SHAPE_PATHS[kind](w, h), { ...SHAPE, kbName: name })])),
    arrow: () => new fabric.Group([
      new fabric.Line([0, 0, 280, 0], { stroke: '#444444', strokeWidth: 6, strokeLineCap: 'round' }),
      new fabric.Triangle({ width: 36, height: 36, fill: '#444444', left: 270, top: 18, angle: 90 })
    ], { kbName: 'Arrow' })
  };
  return place(shapes[kind](), at);
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
const addImageBlob = (file, name, at) => track(addingImage(file, name, at));
async function addingImage(file, name, at) {
  const image = await fabric.FabricImage.fromURL(await shrink(file));
  const [w, h] = pagePx(), k = Math.min(1, (w * 0.8) / image.width, (h * 0.8) / image.height);
  image.set({ scaleX: k, scaleY: k, kbName: name ? 'Photo ' + name : 'Picture' });
  return place(image, at);
}
// The whole batch is one tracked job, so closing mid-import still waits for the files not started yet.
const importFiles = (files, at) => track((async () => {
  for (const [i, file] of files.entries()) await addImageBlob(file, file.name.replace(/\.[^.]*$/, ''), at && new fabric.Point(at.x + i * 24, at.y + i * 24)).catch(e => { $('#create-saved').textContent = `Could not add ${file.name}: ${e}`; });
})());
$('#create-file').onchange = async event => {
  const files = [...event.target.files], frame = board.getActiveObject();
  if (files.length === 1 && emptyFrame(frame)) await fillFrame(frame, files[0], files[0].name.replace(/\.[^.]*$/, '')).catch(e => { $('#create-saved').textContent = `Could not add ${files[0].name}: ${e}`; });
  else await importFiles(files);
  event.target.value = '';
};
// Clip art is an SVG copied onto a canvas, so the design keeps its own picture.
const addEmoji = (code, at) => track(addingEmoji(code, at));
async function addingEmoji(code, at) {
  await emojiReady;
  const img = await new Promise((done, fail) => Object.assign(new Image(), { onload() { done(this); }, onerror: () => fail('clip art missing'), src: `emoji/${code}.svg` }));
  const out = Object.assign(document.createElement('canvas'), { width: 512, height: 512 });
  out.getContext('2d').drawImage(img, 0, 0, 512, 512);
  const image = await fabric.FabricImage.fromURL(out.toDataURL('image/png'));
  image.set({ scaleX: 150 / 512, scaleY: 150 / 512, kbName: emojiEntries.find(e => e.code === code)?.name || 'Clip art' });
  return place(image, at);
}

// Frames are grey placeholders: drop or click a photo to fill one. Sizes are 1:1, 4:5 and 3:2.
// Outlines in a w × h box as SVG paths: shapes on the page, their drawer pictures and frame cut-outs all use these.
const pathPoly = pts => 'M ' + pts.map(([x, y]) => `${+x.toFixed(2)} ${+y.toFixed(2)}`).join(' L ') + ' Z';
const ring = (n, w, h, radius = () => 1, turn = -Math.PI / 2) => Array.from({ length: n }, (_, i) => { const a = turn + i * 2 * Math.PI / n, r = radius(i, a); return [w / 2 + Math.cos(a) * r * w / 2, h / 2 + Math.sin(a) * r * h / 2]; });
const SHAPE_PATHS = {
  ellipse: (w, h) => `M 0 ${h / 2} A ${w / 2} ${h / 2} 0 1 1 ${w} ${h / 2} A ${w / 2} ${h / 2} 0 1 1 0 ${h / 2} Z`,
  pentagon: (w, h) => pathPoly(ring(5, w, h)),
  hexagon: (w, h) => pathPoly([[w / 4, 0], [w * 3 / 4, 0], [w, h / 2], [w * 3 / 4, h], [w / 4, h], [0, h / 2]]),
  octagon: (w, h) => { const x = Math.min(w, h) * 0.29; return pathPoly([[x, 0], [w - x, 0], [w, x], [w, h - x], [w - x, h], [x, h], [0, h - x], [0, x]]); },
  diamond: (w, h) => pathPoly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]),
  parallelogram: (w, h) => pathPoly([[w * 0.25, 0], [w, 0], [w * 0.75, h], [0, h]]),
  'half-circle': (w, h) => `M 0 ${h} A ${w / 2} ${h} 0 0 1 ${w} ${h} Z`,
  star: (w, h) => pathPoly(ring(10, w, h, i => i % 2 ? 0.45 : 1)),
  star4: (w, h) => pathPoly(ring(8, w, h, i => i % 2 ? 0.38 : 1)),
  star6: (w, h) => pathPoly(ring(12, w, h, i => i % 2 ? 0.55 : 1)),
  heart: (w, h) => `M ${w / 2} ${h * 0.28} C ${w / 2} ${h * 0.05} ${w * 0.02} ${-h * 0.02} 0 ${h * 0.3} C 0 ${h * 0.58} ${w * 0.4} ${h * 0.8} ${w / 2} ${h} C ${w * 0.6} ${h * 0.8} ${w} ${h * 0.58} ${w} ${h * 0.3} C ${w * 0.98} ${-h * 0.02} ${w / 2} ${h * 0.05} ${w / 2} ${h * 0.28} Z`,
  arch: (w, h) => { const r = Math.min(w / 2, h); return `M 0 ${h} L 0 ${r} A ${w / 2} ${r} 0 0 1 ${w} ${r} L ${w} ${h} Z`; },
  plus: (w, h) => { const t = Math.min(w, h) / 3, x = (w - t) / 2, y = (h - t) / 2; return pathPoly([[x, 0], [x + t, 0], [x + t, y], [w, y], [w, y + t], [x + t, y + t], [x + t, h], [x, h], [x, y + t], [0, y + t], [0, y], [x, y]]); },
  'block-arrow': (w, h) => { const head = Math.min(w * 0.45, h * 0.8); return pathPoly([[0, h * 0.28], [w - head, h * 0.28], [w - head, 0], [w, h / 2], [w - head, h], [w - head, h * 0.72], [0, h * 0.72]]); },
  'double-arrow': (w, h) => { const head = Math.min(w * 0.3, h * 0.8); return pathPoly([[0, h / 2], [head, 0], [head, h * 0.28], [w - head, h * 0.28], [w - head, 0], [w, h / 2], [w - head, h], [w - head, h * 0.72], [head, h * 0.72], [head, h]]); },
  badge: (w, h) => pathPoly(ring(96, w, h, (i, a) => 0.9 + 0.1 * Math.cos(16 * (a + Math.PI / 2)))),
  banner: (w, h) => { const notch = Math.min(w * 0.12, h * 0.4); return pathPoly([[0, 0], [w, 0], [w - notch, h / 2], [w, h], [0, h], [notch, h / 2]]); },
  cloud: (w, h) => `M ${w * 0.22} ${h * 0.92} Q ${w * 0.01} ${h * 0.92} ${w * 0.04} ${h * 0.64} Q ${-w * 0.01} ${h * 0.34} ${w * 0.27} ${h * 0.37} Q ${w * 0.33} ${h * 0.02} ${w * 0.6} ${h * 0.14} Q ${w * 0.9} ${h * 0.04} ${w * 0.88} ${h * 0.42} Q ${w * 1.02} ${h * 0.56} ${w * 0.92} ${h * 0.8} Q ${w * 0.86} ${h * 0.95} ${w * 0.66} ${h * 0.92} Z`
};
const NEW_SHAPES = [['ellipse', 'Oval', 240, 160], ['half-circle', 'Half circle', 240, 120], ['diamond', 'Diamond', 200, 240], ['pentagon', 'Pentagon', 220, 210], ['hexagon', 'Hexagon', 240, 210],
  ['octagon', 'Octagon', 220, 220], ['parallelogram', 'Parallelogram', 260, 150], ['heart', 'Heart', 220, 200], ['star4', '4-point star', 200, 200], ['star6', '6-point star', 220, 220],
  ['plus', 'Plus', 200, 200], ['block-arrow', 'Block arrow', 260, 150], ['double-arrow', 'Double arrow', 300, 140], ['badge', 'Badge', 220, 220], ['banner', 'Banner', 340, 110], ['cloud', 'Cloud', 280, 190]];
const LINE_STYLES = [['dashed', 'Dashed line', [18, 12]], ['dotted', 'Dotted line', [0.1, 16]]];
// Frames cut to an outline: the shape's path, stretched to the frame or picture.
const FRAME_NAMES = { arch: 'Arch', oval: 'Oval', heart: 'Heart', star: 'Star', hexagon: 'Hexagon' };
const framePath = (kind, w, h) => SHAPE_PATHS[kind === 'oval' ? 'ellipse' : kind](w, h);
const FRAME_FILL = '#dfe3ea';
const FRAME_TILES = [
  ['square', 'Square', '<rect x="8" y="4" width="24" height="24"/>'],
  ['portrait', 'Portrait', '<rect x="10" y="2" width="20" height="28"/>'],
  ['landscape', 'Landscape', '<rect x="4" y="7" width="32" height="20"/>'],
  ['rounded', 'Rounded', '<rect x="8" y="4" width="24" height="24" rx="5"/>'],
  ['circle', 'Circle', '<circle cx="20" cy="16" r="13"/>'],
  ...['arch', 'oval', 'heart', 'star', 'hexagon'].map(kind => [kind, FRAME_NAMES[kind], `<path transform="translate(9 3)" d="${SHAPE_PATHS[kind === 'oval' ? 'ellipse' : kind](22, 26)}"/>`])
];
// `kind` is 'rect', 'rounded', 'circle' (a circle uses the smaller side) or one of FRAME_NAMES.
const makeFrame = (width, height, kind = 'rect', o = {}) => kind === 'circle'
  ? new fabric.Circle({ radius: Math.min(width, height) / 2, fill: FRAME_FILL, strokeWidth: 0, kbFrame: 'circle', kbName: 'Photo frame', ...o })
  : FRAME_NAMES[kind] ? new fabric.Path(framePath(kind, width, height), { fill: FRAME_FILL, strokeWidth: 0, kbFrame: kind, kbName: 'Photo frame', ...o })
  : new fabric.Rect({ width, height, rx: kind === 'rounded' ? width / 8 : 0, ry: kind === 'rounded' ? height / 8 : 0, fill: FRAME_FILL, strokeWidth: 0, kbFrame: kind, kbName: 'Photo frame', ...o });
// Photo grids, as in Canva: empty frames filling the page edge to edge with thin gaps, ready for photos.
// Each layout is a list of [x, y, width, height] as fractions of the page.
const GRIDS = [
  ['Two side by side', [[0, 0, 1 / 2, 1], [1 / 2, 0, 1 / 2, 1]]],
  ['Two stacked', [[0, 0, 1, 1 / 2], [0, 1 / 2, 1, 1 / 2]]],
  ['Three across', [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]]],
  ['One big, two small', [[0, 0, 2 / 3, 1], [2 / 3, 0, 1 / 3, 1 / 2], [2 / 3, 1 / 2, 1 / 3, 1 / 2]]],
  ['Big top, three below', [[0, 0, 1, 0.6], [0, 0.6, 1 / 3, 0.4], [1 / 3, 0.6, 1 / 3, 0.4], [2 / 3, 0.6, 1 / 3, 0.4]]],
  ['Four squares', [[0, 0, 1 / 2, 1 / 2], [1 / 2, 0, 1 / 2, 1 / 2], [0, 1 / 2, 1 / 2, 1 / 2], [1 / 2, 1 / 2, 1 / 2, 1 / 2]]],
  ['Nine squares', Array.from({ length: 9 }, (_, i) => [(i % 3) / 3, Math.floor(i / 3) / 3, 1 / 3, 1 / 3])]
];
const GRID_GAP = 6;
function addGrid(index) {
  const [w, h] = pagePx(), frames = GRIDS[index][1].map(([x, y, fw, fh]) => {
    // Gaps only between frames: a frame touching the page edge keeps that edge.
    const l = x * w + (x > 0 ? GRID_GAP / 2 : 0), t = y * h + (y > 0 ? GRID_GAP / 2 : 0);
    const r = (x + fw) * w - (x + fw < 0.999 ? GRID_GAP / 2 : 0), b = (y + fh) * h - (y + fh < 0.999 ? GRID_GAP / 2 : 0);
    return makeFrame(r - l, b - t, 'rect', { left: l, top: t, kbName: 'Grid frame' });
  });
  board.add(...frames); selectObjects(frames); for (const f of frames) f.setCoords();
  commitDesign();
  return frames;
}
const gridTile = cells => '<rect x="5" y="2" width="30" height="28" style="fill:none;stroke-width:1"/>' + cells.map(([x, y, fw, fh]) => `<rect x="${5 + x * 30 + 0.8}" y="${2 + y * 28 + 0.8}" width="${fw * 30 - 1.6}" height="${fh * 28 - 1.6}"/>`).join('');
function addFrame(kind, at) {
  const [width, height] = { portrait: [300, 375], landscape: [375, 250], arch: [280, 360], oval: [270, 340] }[kind] || [300, 300];
  return place(makeFrame(width, height, kind === 'circle' || kind === 'rounded' || FRAME_NAMES[kind] ? kind : 'rect'), at);
}
const emptyFrame = o => !!o?.kbFrame && o.type !== 'image';
// The frame or picture under a page point, topmost first; locked and hidden ones are passed over.
const dropTarget = at => board.getObjects().findLast(o => o.visible !== false && !o.kbLocked && (emptyFrame(o) || o.type === 'image') && o.containsPoint(at));
// A picture's frame shape, from its clip: outlines carry their kind; older designs have only rectangles and circles.
const clipKind = o => !o.clipPath ? 'rect' : o.clipPath.kbFrame || (o.clipPath.type === 'circle' ? 'circle' : o.clipPath.rx ? 'rounded' : 'rect');
const frameKind = o => o.kbFrame || clipKind(o);
// The picture takes the target's place, size, angle and frame shape, cropped from its middle to fill it, as in Canva.
const fillFrame = (target, file, name) => track(fillingFrame(target, file, name));
async function fillingFrame(target, file, name) {
  const image = await fabric.FabricImage.fromURL(await shrink(file));
  image.kbName = name ? 'Photo ' + name : 'Picture';
  if (!board.getObjects().includes(target)) return place(image, target.getCenterPoint()); // undone or deleted meanwhile
  const w = target.width * target.scaleX, h = target.height * target.scaleY, k = Math.max(w / image.width, h / image.height);
  const width = w / k, height = h / k, kind = frameKind(target);
  image.set({ cropX: (image.width - width) / 2, cropY: (image.height - height) / 2, width, height, scaleX: k, scaleY: k, angle: target.angle, opacity: target.opacity, shadow: target.shadow });
  if (kind !== 'rect') image.set({ clipPath: pictureFrame(image, kind) });
  image.setPositionByOrigin(target.getCenterPoint(), 'center', 'center');
  const at = board.getObjects().indexOf(target);
  board.remove(target); board.insertAt(at, image);
  board.setActiveObject(image); image.setCoords();
  commitDesign();
  return image;
}

// Previews for the Elements drawer, drawn in a 40 x 32 box.
const SHAPE_TILES = [
  ['rect', 'Rectangle', '<rect x="4" y="6" width="32" height="20"/>'],
  ['rounded', 'Rounded', '<rect x="4" y="6" width="32" height="20" rx="6"/>'],
  ['circle', 'Circle', '<circle cx="20" cy="16" r="12"/>'],
  ['triangle', 'Triangle', '<path d="M20 4 34 28H6z"/>'],
  ['star', 'Star', '<path d="M20 3l3.5 7.6 8.3.9-6.2 5.6 1.8 8.2L20 21l-7.4 4.3 1.8-8.2-6.2-5.6 8.3-.9z"/>'],
  ['bubble', 'Speech bubble', '<path d="M7 4h26a3 3 0 0 1 3 3v13a3 3 0 0 1-3 3H16l-6 6 1-6H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z"/>'],
  ['line', 'Line', '<path d="M4 16h32" style="stroke-width:3"/>'],
  ['arrow', 'Arrow', '<path d="M4 16h30M26 9l8 7-8 7" style="fill:none;stroke-width:3"/>'],
  ['handwriting', 'Handwriting lines', '<path d="M4 9h32M4 23h32" style="fill:none"/><path d="M4 16h32" style="fill:none;stroke-dasharray:3 2"/>'],
  ['dashed', 'Dashed line', '<path d="M4 16h32" style="stroke-width:3;stroke-dasharray:5 4"/>'],
  ['dotted', 'Dotted line', '<path d="M4 16h32" style="stroke-width:4;stroke-linecap:round;stroke-dasharray:0.1 7"/>'],
  ['double-line-arrow', 'Two-way arrow', '<path d="M7 16h26M12 9l-7 7 7 7M28 9l7 7-7 7" style="fill:none;stroke-width:3"/>'],
  ...NEW_SHAPES.map(([kind, label, w, h]) => { const k = Math.min(32 / w, 24 / h); return [kind, label, `<path transform="translate(${(40 - w * k) / 2} ${(32 - h * k) / 2}) scale(${k})" style="stroke-width:${2 / k}" d="${SHAPE_PATHS[kind](w, h)}"/>`]; })
];
// Drawer items can be dragged onto the page as well as clicked.
const DRAG_TYPE = 'application/x-kb-studio-item';
let dragItem = null, dropHover = null; // what is being dragged from a drawer (drag data can't be read until the drop), and the frame it would fill
function draggable(el, item) {
  el.draggable = true;
  el.ondragstart = e => { dragItem = item; e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(item)); e.dataTransfer.effectAllowed = 'copy'; };
  el.ondragend = () => { dragItem = null; if (dropHover) { dropHover = null; board?.requestRenderAll(); } };
}
function dropItem([kind, value], at) {
  if (kind === 'shape' && SHAPE_TILES.some(([k]) => k === value)) addShape(value, at);
  else if (kind === 'text') { const t = addText(value || undefined, at); t.exitEditing?.(); board.setActiveObject(t); }
  else if (kind === 'combo' && COMBOS[value]) addCombo(value, at);
  else if (kind === 'emoji') addEmoji(value, at).catch(e => { $('#create-saved').textContent = String(e); });
  else if (kind === 'frame' && FRAME_TILES.some(([k]) => k === value)) addFrame(value, at);
  else if (kind === 'grid' && GRIDS[value]) addGrid(value);
  else if (kind === 'chart' && typeof addChart === 'function') addChart(value, at);
  else if (kind === 'mine' && typeof addMine === 'function') addMine(value, at);
  else if (kind === 'decor' && typeof addDecor === 'function') addDecor(value, at).catch(e => { $('#create-saved').textContent = String(e); });
  else if (kind === 'photo') addShootPhoto(value, at, dropTarget(at));
}

// ---- This shoot: the open shoot's photos, developed with her edits ----
// Clicking one fills the selected empty frame, or adds it in the middle; dropping it on a frame or picture fills that.
const addShootPhoto = (id, at, target) => track((async () => {
  const photo = shootPhotos().find(p => p.id === id);
  if (!photo) return;
  $('#create-saved').textContent = `Adding ${id}…`;
  try {
    const jpeg = await developedJpeg(photo);
    await (target ? fillFrame(target, jpeg, id) : addImageBlob(jpeg, id, at));
  } catch (error) { $('#create-saved').textContent = `Could not add ${id}: ${error}`; }
})());
let shootShown = null;
const shootThumbs = new IntersectionObserver(entries => {
  for (const { target: img, isIntersecting } of entries) if (isIntersecting && !img.src) {
    shootThumbs.unobserve(img);
    shootThumb(img.photo).then(url => { img.src = url; }, () => img.classList.add('missing'));
  }
}, { root: $('#create-drawer'), rootMargin: '400px 0px' });
function paintShoot() {
  const list = shootPhotos(), key = dir && dir + '\n' + list.map(p => p.id + (ratings[p.id]?.flag || '') + (recipes[p.id] ? '*' : '')).join();
  $('#shoot-empty').hidden = list.length > 0;
  if (key === shootShown) return;
  shootShown = key; shootThumbs.disconnect();
  $('#shoot-list').replaceChildren(...list.map(photo => {
    const b = button('', () => addShootPhoto(photo.id, null, emptyFrame(board?.getActiveObject()) ? board.getActiveObject() : null));
    b.title = photo.id + (rating(photo).flag === 'pick' ? ' · pick' : ''); b.classList.toggle('pick', rating(photo).flag === 'pick');
    const img = Object.assign(document.createElement('img'), { alt: photo.id, draggable: false, photo });
    b.append(img); draggable(b, ['photo', photo.id]); shootThumbs.observe(img);
    return b;
  }));
}
function toggleDraw(on = !board.isDrawingMode) {
  board.isDrawingMode = on; $('#create-draw').classList.toggle('on', on);
  if (on) board.discardActiveObject();
  board.requestRenderAll(); paintFloat();
}
function paintCreateTools() {
  $('#create-tools').replaceChildren(...SHAPE_TILES.map(([kind, label, svg]) => {
    const b = button('', () => addShape(kind)); b.id = 'add-' + kind; b.title = label; draggable(b, ['shape', kind]);
    b.innerHTML = `<svg viewBox="0 0 40 32">${svg}</svg>`; b.append(label);
    return b;
  }));
  $('#create-frames').replaceChildren(...FRAME_TILES.map(([kind, label, svg]) => {
    const b = button('', () => addFrame(kind)); b.id = 'add-frame-' + kind; b.title = label + ' photo frame'; draggable(b, ['frame', kind]);
    b.innerHTML = `<svg viewBox="0 0 40 32">${svg}</svg>`; b.append(label);
    return b;
  }));
  $('#create-grids').replaceChildren(...GRIDS.map(([label, cells], i) => {
    const b = button('', () => addGrid(i)); b.id = 'add-grid-' + i; b.title = label + ' photo grid'; draggable(b, ['grid', i]);
    b.innerHTML = `<svg viewBox="0 0 40 32">${gridTile(cells)}</svg>`; b.append(label);
    return b;
  }));
  $('#add-text').onclick = () => addText(); draggable($('#add-text'), ['text', '']);
  paintCombos();
  for (const preset of Object.keys(TEXT_PRESETS)) { $('#add-' + preset).onclick = () => addText(preset); draggable($('#add-' + preset), ['text', preset]); }
  $('#add-image').onclick = () => $('#create-file').click();
  $('#create-draw').onclick = () => toggleDraw();
  $('#draw-colour').oninput = e => { board.freeDrawingBrush.color = e.target.value; };
  $('#draw-width').oninput = e => { board.freeDrawingBrush.width = +e.target.value; };
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
    b.title = name; b.dataset.code = code; draggable(b, ['emoji', code]);
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
function tableCells(rows, cols, top = 180, height = Math.min(rows * 72, pagePx()[1] - top - 48), text = 'Text', pageWidth = pagePx()[0]) {
  if (![rows, cols].every(n => Number.isInteger(n) && n >= 1 && n <= 20)) throw Error('Use 1 to 20 rows and columns');
  const width = (pageWidth - 96) / cols, cellHeight = height / rows, cells = [], kbTable = typeof newTableId === 'function' ? newTableId() : undefined;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const left = 48 + c * width, y = top + r * cellHeight;
    cells.push(R(left, y, width, cellHeight, { kbName: 'Table cell', kbTable }), T(width < 72 ? '' : text, left + 6, y + 6, { width: width - 12, minWidth: 1, fontSize: Math.min(24, cellHeight / 3), kbName: 'Cell text', kbTable }));
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
// Move the object at stack index `from` next to the one at `to`: in front of it when dropped above its row (the list is front-first).
function moveLayer(from, to, above) {
  const objects = board.getObjects(), o = objects[from];
  if (!o || from === to) return;
  let at = above ? to + 1 : to;
  if (from < at) at--;
  board.moveObjectTo(o, Math.max(0, Math.min(objects.length - 1, at)));
  board.requestRenderAll(); commitDesign();
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
    // Rows drag to reorder, like Canva's layers: drop above a row to put it in front of that one.
    row.draggable = true; row.dataset.index = i;
    row.ondragstart = e => { e.dataTransfer.setData('application/x-kb-layer', String(i)); e.dataTransfer.effectAllowed = 'move'; };
    row.ondragover = e => {
      if (!e.dataTransfer.types.includes('application/x-kb-layer')) return;
      e.preventDefault(); const above = e.offsetY < row.offsetHeight / 2;
      row.classList.toggle('drop-above', above); row.classList.toggle('drop-below', !above);
    };
    row.ondragleave = () => row.classList.remove('drop-above', 'drop-below');
    row.ondrop = e => {
      const from = +e.dataTransfer.getData('application/x-kb-layer'), above = row.classList.contains('drop-above');
      row.classList.remove('drop-above', 'drop-below');
      if (!e.dataTransfer.types.includes('application/x-kb-layer')) return;
      e.preventDefault(); moveLayer(from, i, above);
    };
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
// What the selection is, as the words used in the toolbar's data-for attributes.
function tagsOf(o) {
  if (!o) return ['none'];
  const objects = o.type === 'activeselection' ? o.getObjects() : [o];
  if (objects.some(x => x.kbLocked)) return ['locked'];
  if (o.type === 'activeselection') return ['object', 'multi'];
  const kind = { textbox: 'text', image: 'image', group: 'group', line: 'line' }[o.type] || (o.type === 'path' && !o.fill ? 'line' : 'shape');
  return ['object', kind, ...(o.type === 'rect' ? ['rect'] : []), ...(o.kbChart ? ['chart'] : []), ...(o.kbTable ? ['cell'] : [])];
}
// The toolbar along the top shows only what fits the selection, like Canva's.
function paintPanel() {
  const o = board?.getActiveObject(), text = o?.type === 'textbox', tags = tagsOf(o);
  for (const el of document.querySelectorAll('#create [data-for]')) el.hidden = !el.dataset.for.split(' ').some(t => tags.includes(t));
  $('#prop-crop').disabled = o?.type !== 'image' || !!o.kbLocked;
  if (openPop && openPop.anchor.hidden) closeMenus();
  paintFloat();
  if (o) {
    $('#prop-fill').value = hex(o.kbEffect === 'hollow' ? o.stroke : o.fill) || '#000000';
    $('#prop-stroke').value = hex(o.stroke) || '#000000';
    if (text) { $('#prop-font').value = o.fontFamily; $('#prop-size').value = Math.round(o.fontSize * (o.scaleY || 1)); $('#prop-bold').classList.toggle('on', o.fontWeight === 'bold' || o.fontWeight === 700); }
    $('#prop-opacity').value = Math.round(o.opacity * 100); $('#prop-width').value = o.strokeWidth;
    $('#prop-dash').value = o.strokeDashArray ? (o.strokeDashArray[0] === 1 ? 'dot' : 'dash') : 'solid';
    $('#prop-corners').value = o.rx || 0; $('#prop-shadow').checked = !!o.shadow;
    $('#prop-frame').disabled = o.type !== 'image';
    $('#prop-frame').value = o.clipPath ? clipKind(o) : 'none';
    if (text) {
      $('#prop-italic').classList.toggle('on', o.fontStyle === 'italic'); $('#prop-underline').classList.toggle('on', !!o.underline);
      $('#prop-spacing').value = o.charSpacing; $('#prop-line-height').value = o.lineHeight;
      $('#prop-highlight-on').checked = !!o.textBackgroundColor; $('#prop-highlight').value = hex(o.textBackgroundColor) || '#fff2cc';
      for (const b of $('#text-effects').children) b.classList.toggle('on', b.dataset.effect === (o.kbEffect || 'none'));
    }
    $('#prop-fav').classList.toggle('on', text && settings.fonts.includes(o.fontFamily));
    if (typeof paintTextTools === 'function') paintTextTools(o);
  }
  if (typeof paintGradient === 'function') paintGradient(o);
  paintLayers();
  fitToolbar();
}
// When the toolbar is wider than the window, its last buttons move into More ▾ (in order), and come back when there's room.
function fitToolbar() {
  const bar = $('#create-context'), more = $('#ctx-more'), list = $('#pop-more');
  for (const el of [...list.children]) el.kbMark ? el.kbMark.replaceWith(el) : el.remove();
  more.hidden = true;
  if (bar.scrollWidth <= bar.clientWidth + 1) { if (openPop?.el === list) closeMenus(); return; }
  more.hidden = false;
  const items = [...bar.children].filter(el => el !== more && !el.hidden && el.getClientRects().length);
  while (bar.scrollWidth > bar.clientWidth + 1 && items.length > 1) {
    const el = items.pop(), mark = document.createComment('more');
    el.replaceWith(mark); el.kbMark = mark; list.prepend(el);
  }
}
addEventListener('resize', () => { if (board) fitToolbar(); });
function hex(c) { return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : typeof c === 'string' && /^#[0-9a-f]{3}$/i.test(c) ? '#' + [...c.slice(1)].map(x => x + x).join('') : null; }
function change(props) {
  const targets = board.getActiveObjects();
  if (!targets.length) return;
  for (const o of targets) { o.set(typeof props === 'function' ? props(o) : props); o.setCoords(); }
  board.requestRenderAll(); commitDesign();
}
$('#prop-fill').oninput = e => change(o => o.type === 'line' || o.kbEffect === 'hollow' ? { stroke: e.target.value } : o.kbEffect === 'neon' ? { fill: e.target.value, shadow: new fabric.Shadow({ ...o.shadow, color: e.target.value }) } : { fill: e.target.value });
$('#prop-stroke').oninput = e => change({ stroke: e.target.value, paintFirst: 'stroke' });
$('#prop-fill').onchange = $('#prop-stroke').onchange = () => paintPanel();
$('#prop-font').onchange = e => change(o => o.type === 'textbox' ? { fontFamily: e.target.value } : {});
$('#prop-size').onchange = e => change(o => o.type === 'textbox' ? { fontSize: Math.min(400, Math.max(6, +e.target.value || 40)), scaleX: 1, scaleY: 1 } : {});
$('#prop-bold').onclick = () => change(o => o.type === 'textbox' ? { fontWeight: o.fontWeight === 'bold' ? 'normal' : 'bold' } : {});
// One alignment button, as in Canva: each click moves on to the next.
const ALIGNS = [['left', '⇤', 'Align left'], ['center', '↔', 'Centre'], ['right', '⇥', 'Align right'], ['justify', '☰', 'Justify']];
function paintAlign(o) {
  const i = Math.max(0, ALIGNS.findIndex(([a]) => a === o?.textAlign)), b = $('#prop-align');
  b.textContent = ALIGNS[i][1]; b.title = ALIGNS[i][2] + ' (click for ' + ALIGNS[(i + 1) % ALIGNS.length][2].toLowerCase() + ')';
}
$('#prop-align').onclick = () => {
  const o = board.getActiveObject(), next = ALIGNS[(Math.max(0, ALIGNS.findIndex(([a]) => a === o?.textAlign)) + 1) % ALIGNS.length][0];
  change(x => x.type === 'textbox' ? { textAlign: next } : {});
};
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
// Canva-style text effects. Each starts from plain text in the text's own colour (a hollow text's colour is its outline).
const TEXT_EFFECTS = [['none', 'None'], ['shadow', 'Shadow'], ['lift', 'Lift'], ['hollow', 'Hollow'], ['outline', 'Outline'], ['neon', 'Neon']];
function textEffect(o, kind) {
  const colour = (o.kbEffect === 'hollow' ? o.stroke : o.fill) || '#222222', size = o.fontSize || 40;
  const plain = { kbEffect: kind === 'none' ? undefined : kind, fill: colour, stroke: null, strokeWidth: 1, paintFirst: 'fill', shadow: null };
  return {
    none: plain,
    shadow: { ...plain, shadow: new fabric.Shadow({ color: '#00000066', blur: size / 10, offsetX: size / 14, offsetY: size / 14 }) },
    lift: { ...plain, shadow: new fabric.Shadow({ color: '#00000059', blur: size / 3, offsetX: 0, offsetY: size / 8 }) },
    hollow: { ...plain, fill: 'transparent', stroke: colour, strokeWidth: Math.max(1, size / 22) },
    outline: { ...plain, stroke: hex(colour) && parseInt(hex(colour).slice(1), 16) < 0x808080 ? '#ffffff' : '#222222', strokeWidth: Math.max(2, size / 9), paintFirst: 'stroke' },
    neon: { ...plain, shadow: new fabric.Shadow({ color: colour, blur: size / 2.5, offsetX: 0, offsetY: 0 }) }
  }[kind] || plain;
}
$('#text-effects').replaceChildren(...TEXT_EFFECTS.map(([kind, label]) => {
  const b = button('', () => { change(o => o.type === 'textbox' ? textEffect(o, kind) : {}); paintPanel(); });
  b.dataset.effect = kind; b.innerHTML = `<span class="effect-${kind}">Ag</span>`; b.append(label);
  return b;
}));
$('#prop-highlight-on').onchange = $('#prop-highlight').oninput = highlight;
function pictureFrame(image, kind) {
  const options = { width: image.width, height: image.height, originX: 'center', originY: 'center' };
  if (FRAME_NAMES[kind]) return new fabric.Path(framePath(kind, image.width, image.height), { originX: 'center', originY: 'center', kbFrame: kind });
  return kind === 'none' ? null : kind === 'circle' ? new fabric.Circle({ originX: 'center', originY: 'center', radius: Math.min(image.width, image.height) / 2 }) : new fabric.Rect({ ...options, rx: kind === 'rounded' ? image.width / 8 : 0, ry: kind === 'rounded' ? image.height / 8 : 0 });
}
$('#prop-frame').onchange = e => change(o => o.type === 'image' ? { clipPath: pictureFrame(o, e.target.value) } : {});

// ---- Filters: Develop's looks, her presets and a few adjustments, drawn by the same GPU code as Photos ----
// A filtered picture keeps its original in kbOriginal and its settings in kbFilter, so every change starts from the original.
const ADJUST = [['exposure', 'Brightness', -2, 2, 0.05], ['contrast', 'Contrast', -100, 100, 1], ['saturation', 'Saturation', -100, 100, 1], ['temp', 'Warmth', -100, 100, 1], ['vignette', 'Vignette', -100, 100, 1]];
// 8-bit sRGB to linear light as half floats: the Developer's input, which it turns back into sRGB, so no filter means no change.
const SRGB_HALF = (() => {
  const f = new Float32Array(1), u = new Uint32Array(f.buffer);
  return Uint16Array.from({ length: 256 }, (_, i) => {
    const c = i / 255; f[0] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    const e = ((u[0] >>> 23) & 0xff) - 112, m = u[0] & 0x7fffff;
    return e <= 0 ? (e < -10 ? 0 : (((m | 0x800000) >> (1 - e)) + 0x1000) >> 13) : (e << 10) + ((m + 0x1000) >> 13);
  });
})();
let filterer = null, filtering = Promise.resolve(), filterThumbs = { original: null, urls: new Map() };
async function filterPicture(src, filter, edge = Infinity) {
  const img = new Image(); img.src = src; await img.decode();
  const k = Math.min(1, edge / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
  const ctx = Object.assign(document.createElement('canvas'), { width: w, height: h }).getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const source = ctx.getImageData(0, 0, w, h).data, bytes = new ArrayBuffer(8 + w * h * 6), rgb = new Uint16Array(bytes, 8, w * h * 3);
  new Uint32Array(bytes, 0, 2).set([w, h]);
  let clear = false;
  for (let i = 0, j = 0; i < source.length; i += 4, j += 3) {
    rgb[j] = SRGB_HALF[source[i]]; rgb[j + 1] = SRGB_HALF[source[i + 1]]; rgb[j + 2] = SRGB_HALF[source[i + 2]];
    if (source[i + 3] < 255) clear = true;
  }
  try { filterer ||= new Developer(document.createElement('canvas')); } catch (error) { throw `this computer can't run filters (${error.message})`; }
  filterer.setRaw(bytes, false);
  const out = filterer.pixels(fullRecipe(filter), Math.max(w, h));
  if (clear) for (let i = 3; i < source.length; i += 4) out.data[i] = source[i]; // clip art keeps its transparency
  ctx.putImageData(out, 0, 0);
  return ctx.canvas.toDataURL(clear || src.startsWith('data:image/png') ? 'image/png' : 'image/jpeg', 0.92);
}
// Settings left at their defaults are dropped; nothing left means no filter.
function cleanFilter(f) {
  const out = {};
  for (const [k, v] of Object.entries(f || {})) if (k === 'look' || k === 'preset' ? v : k === 'lookAmount' ? f.look && v !== 100 : v !== 0) out[k] = v;
  return Object.keys(out).length ? out : null;
}
function setFilter(image, filter) {
  filter = cleanFilter(filter);
  const run = filtering.then(async () => {
    if (!board.getObjects().includes(image)) return;
    const original = image.kbOriginal || image.getSrc(), keep = { width: image.width, height: image.height, cropX: image.cropX, cropY: image.cropY };
    $('#create-saved').textContent = 'Applying the filter…';
    const src = filter ? await filterPicture(original, filter) : original;
    await image.setSrc(src); image.set(keep); // same pixel size, so a crop stays put
    image.kbOriginal = filter ? original : undefined; image.kbFilter = filter || undefined;
    image.setCoords(); board.requestRenderAll(); commitDesign(); paintFilters();
  });
  filtering = run.catch(error => { $('#create-saved').textContent = 'Could not apply the filter: ' + error; });
  return track(filtering);
}
const filterTarget = () => { const o = board?.getActiveObject(); return o?.type === 'image' && !o.kbLocked ? o : null; };
function paintFilters() {
  const image = filterTarget();
  if (!image) return;
  const current = image.kbFilter || {}, original = image.kbOriginal || image.getSrc();
  if (filterThumbs.original !== original) filterThumbs = { original, urls: new Map() };
  const thumb = (key, filter, img) => {
    if (!filterThumbs.urls.has(key)) filterThumbs.urls.set(key, filtering.then(() => filterPicture(original, filter, 120)).catch(() => ''));
    filterThumbs.urls.get(key).then(url => { if (url) img.src = url; });
  };
  const tile = (key, label, filter, on, pick) => {
    const b = button('', pick), img = new Image(); img.alt = '';
    b.append(img, label); b.dataset.filter = key; b.classList.toggle('on', on); b.title = label;
    thumb(key, filter, img);
    return b;
  };
  const strength = +$('#filter-strength').value;
  $('#filter-looks').replaceChildren(
    tile('none', 'None', {}, !current.look && !current.preset, () => setFilter(image, { ...current, look: '', preset: '' })),
    ...LOOKS.map(l => tile('look:' + l.id, l.name, { look: l.id }, !current.preset && current.look === l.id, () => { const { preset, ...rest } = current; setFilter(image, { ...(preset ? {} : rest), look: l.id, lookAmount: strength }); })));
  const mine = typeof presets === 'undefined' ? [] : presets;
  $('#filter-presets-title').hidden = $('#filter-presets').hidden = !mine.length;
  $('#filter-presets').replaceChildren(...mine.map(p => tile('preset:' + p.name, p.name, p.recipe, current.preset === p.name, () => setFilter(image, { ...p.recipe, preset: p.name }))));
  $('#filter-strength').value = current.look ? current.lookAmount ?? 100 : strength;
  $('#filter-strength').disabled = !current.look;
  $('#filter-adjust').replaceChildren(...ADJUST.map(([key, label, min, max, step]) => {
    const row = document.createElement('label'), input = Object.assign(document.createElement('input'), { type: 'range', min, max, step, value: current[key] || 0 });
    input.dataset.adjust = key;
    input.onchange = () => setFilter(image, { ...(image.kbFilter || {}), [key]: +input.value });
    row.append(label, input);
    return row;
  }));
  $('#filter-remove').disabled = !image.kbFilter;
}
$('#filters-open').addEventListener('click', paintFilters);
$('#filter-strength').onchange = e => { const image = filterTarget(); if (image?.kbFilter?.look) setFilter(image, { ...image.kbFilter, lookAmount: +e.target.value }); };
$('#filter-remove').onclick = () => { const image = filterTarget(); if (image) setFilter(image, null); };
// Fabric owns the crop controls and boardPan; this session only handles Apply/Cancel.
async function startPictureCrop() {
  const image = board.getActiveObject();
  if (cropSession || image?.type !== 'image' || image.kbLocked) return;
  closeMenus();
  await Promise.allSettled([...adding]); await flush();
  if (mode !== 'create' || cropSession || $('#create').inert || !board.getObjects().includes(image) || image.kbLocked) return;
  const stage = $('#create-stage'), dialog = $('#create-crop-dialog');
  const original = Object.fromEntries(['left', 'top', 'width', 'height', 'cropX', 'cropY', 'scaleX', 'scaleY', 'flipX', 'flipY', 'angle', 'skewX', 'skewY'].map(k => [k, image[k]]));
  cropSession = { image, original, view: [...board.viewportTransform], wasFitted: fitted, parent: stage.parentNode, next: stage.nextSibling, selection: board.selection, drawing: board.isDrawingMode,
    targets: board.getObjects().filter(o => o !== image).map(o => [o, o.selectable, o.evented]) };
  for (const [o] of cropSession.targets) o.set({ selectable: false, evented: false });
  board.selection = board.isDrawingMode = false; board.setActiveObject(image);
  guidelines.dispose(); pageGuides = [];
  fabricExtensions.enterCropMode({ target: image });
  image.on('mousedblclick', cropDoubleClick);
  dialog.append(stage); dialog.showModal(); fitBoard(); board.calcOffset(); board.requestRenderAll();
}
function cropDoubleClick() { finishCrop(true, true); }
function finishCrop(apply, exited = false) {
  if (!cropSession) return;
  const { image, original, parent, next, selection, drawing, targets, view, wasFitted } = cropSession;
  image.off('mousedblclick', cropDoubleClick);
  if (!exited) image.fire('mousedblclick'); // Fabric's exit restores its controls and removes ghost/pan handlers.
  image.off('mousedblclick'); // The demo API rearms itself with once(); pictures have no other double-click handlers.
  if (!apply) image.set(original);
  else if (image.clipPath) image.set({ clipPath: pictureFrame(image, clipKind(image)) });
  for (const [o, selectable, evented] of targets) o.set({ selectable, evented });
  board.selection = selection; board.isDrawingMode = drawing;
  parent.insertBefore($('#create-stage'), next); $('#create-crop-dialog').close();
  cropSession = null; guidelines = new fabricExtensions.AligningGuidelines(board);
  board.off('object:moving', snapPage); board.on('object:moving', snapPage); // Page snapping still runs after object guides.
  layoutBoard(); board.setViewportTransform(view); fitted = wasFitted; image.setCoords(); board.calcOffset();
  if (apply) commitDesign();
}
$('#prop-crop').onclick = () => startPictureCrop().catch(error => { $('#create-saved').textContent = 'Could not crop: ' + error; });
$('#crop-apply').onclick = () => finishCrop(true);
$('#crop-cancel').onclick = () => finishCrop(false);
$('#create-crop-dialog').oncancel = event => { event.preventDefault(); finishCrop(false); };
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

const selectAll = () => selectObjects(board.getObjects().filter(o => o.visible !== false && !o.kbLocked));
// Front and back move the whole selection past everything else, keeping its own order.
function arrangeSelected(where) {
  const objects = board.getActiveObjects().sort((a, b) => board.getObjects().indexOf(a) - board.getObjects().indexOf(b));
  if (!objects.length || objects.some(o => o.kbLocked)) return;
  if (where === 'front') for (const o of objects) board.moveObjectTo(o, board.getObjects().length - 1);
  else for (const o of objects.reverse()) board.moveObjectTo(o, 0);
  board.requestRenderAll(); commitDesign();
}
// If anything selected is locked, this unlocks the lot; otherwise it locks them.
function toggleLock() {
  const objects = board.getActiveObjects();
  if (!objects.length) return;
  const lock = !objects.some(o => o.kbLocked);
  for (const o of objects) { o.kbLocked = lock; applyLock(o); }
  selectObjects(objects); commitDesign();
}
function centreOnPage() {
  const active = board.getActiveObject();
  if (!active || board.getActiveObjects().some(o => o.kbLocked)) return;
  const [w, h] = pagePx(), r = active.getBoundingRect();
  active.set({ left: active.left + w / 2 - (r.left + r.width / 2), top: active.top + h / 2 - (r.top + r.height / 2) });
  active.setCoords(); board.requestRenderAll(); commitDesign();
}
const stepSize = by => change(o => {
  if (o.type !== 'textbox') return {};
  const now = Math.round(o.fontSize * (o.scaleY || 1)), step = now < 24 ? 1 : now < 72 ? 2 : 4;
  return { fontSize: Math.min(400, Math.max(6, now + by * step)), scaleX: 1, scaleY: 1 };
});
$('#prop-size-down').onclick = () => stepSize(-1);
$('#prop-size-up').onclick = () => stepSize(1);
$('#prop-front').onclick = () => arrangeSelected('front');
$('#prop-back').onclick = () => arrangeSelected('back');
$('#prop-forward').onclick = () => reorderSelected(1);
$('#prop-backward').onclick = () => reorderSelected(-1);
for (const b of document.querySelectorAll('#create [data-act=lock]')) b.onclick = toggleLock;

// ---- Pop-up panels, the right-click menu and the toolbar that floats above the selection ----
// Plain positioned elements inside #create, so the update and close freezes cover them too.
function closeMenus() {
  const was = !!openPop || !$('#create-menu').hidden;
  if (openPop) { openPop.el.hidden = true; openPop.anchor.classList.remove('open'); openPop = null; }
  $('#create-menu').hidden = true;
  return was;
}
function togglePop(anchor) {
  const el = $('#' + anchor.dataset.pop), same = openPop?.el === el;
  closeMenus();
  if (same) return;
  el.hidden = false; anchor.classList.add('open'); openPop = { el, anchor };
  const shownAt = anchor.getClientRects().length && !anchor.closest('[hidden]') ? anchor : $('#ctx-more'); // a button in More opens under More
  const a = shownAt.getBoundingClientRect(), host = $('#create').getBoundingClientRect();
  el.style.left = Math.max(8, Math.min(a.left - host.left, host.width - el.offsetWidth - 8)) + 'px';
  el.style.top = a.bottom - host.top + 6 + 'px';
}
for (const b of document.querySelectorAll('#create [data-pop]')) b.onclick = () => togglePop(b);
document.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  const menu = $('#create-menu');
  if (openPop && !openPop.el.contains(e.target) && !openPop.anchor.contains(e.target)) closeMenus();
  if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true;
});
addEventListener('resize', closeMenus);
function openMenu(x, y) {
  if (mode !== 'create' || $('#create').inert || cropSession) return;
  closeMenus();
  const objects = board.getActiveObjects(), active = board.getActiveObject(), locked = objects.some(o => o.kbLocked);
  const item = (label, keys, run, disabled = false) => {
    const b = button(label, () => { closeMenus(); run(); }); b.setAttribute('role', 'menuitem'); b.disabled = disabled;
    if (keys) b.append(Object.assign(document.createElement('kbd'), { textContent: keys }));
    return b;
  };
  const line = () => document.createElement('hr');
  const menu = $('#create-menu');
  menu.replaceChildren(...(objects.length ? [
    item('Copy', 'Ctrl+C', () => copySelected()), item('Paste', 'Ctrl+V', () => pasteSelected(), !designClipboard),
    item('Duplicate', 'Ctrl+D', duplicateSelected, locked), item('Delete', 'Delete', removeSelected, locked), line(),
    item('Bring to front', 'Ctrl+Shift+]', () => arrangeSelected('front'), locked), item('Bring forward', 'Ctrl+]', () => reorderSelected(1), locked),
    item('Send backward', 'Ctrl+[', () => reorderSelected(-1), locked), item('Send to back', 'Ctrl+Shift+[', () => arrangeSelected('back'), locked), line(),
    item(locked ? 'Unlock' : 'Lock', '', toggleLock),
    ...(objects.length > 1 ? [item('Group', 'Ctrl+G', () => groupSelected(), locked)] : active.type === 'group' ? [item('Ungroup', 'Ctrl+Shift+G', () => groupSelected(true), locked)] : []),
    item('Centre on the page', '', centreOnPage, locked),
    ...(typeof saveMine === 'function' ? [item('Save to My elements', '', () => saveMine())] : []),
    ...(objects.length === 1 && active.type === 'image' && typeof setAsBackground === 'function' ? [item('Set as background', '', () => setAsBackground(active), locked)] : [])
  ] : [item('Paste', 'Ctrl+V', () => pasteSelected(), !designClipboard), item('Select all', 'Ctrl+A', selectAll, !board.getObjects().length)]));
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
  menu.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
}
$('#float-more').onclick = () => { const r = $('#float-more').getBoundingClientRect(); openMenu(r.left, r.bottom + 4); };
// Above the selection, or below it when there is no room; hidden while dragging, drawing or cropping.
function paintFloat() {
  const bar = $('#create-float'), o = board?.getActiveObject();
  bar.hidden = !o || mode !== 'create' || transforming || !!cropSession || board.isDrawingMode;
  if (bar.hidden) return;
  const locked = board.getActiveObjects().some(x => x.kbLocked), lock = $('#float-lock');
  lock.classList.toggle('locked', locked); lock.title = locked ? 'Unlock' : 'Lock'; lock.setAttribute('aria-label', lock.title);
  $('#prop-copy').hidden = $('#prop-delete').hidden = locked;
  const r = o.getBoundingRect(), v = board.viewportTransform, canvas = board.upperCanvasEl.getBoundingClientRect();
  const host = $('#create').getBoundingClientRect(), stage = $('#create-stage').getBoundingClientRect();
  const x = canvas.left + (r.left + r.width / 2) * v[0] + v[4], top = canvas.top + r.top * v[3] + v[5], bottom = canvas.top + (r.top + r.height) * v[3] + v[5];
  const y = top - 46 >= stage.top + 4 ? top - 46 : Math.min(bottom + 10, stage.bottom - 44);
  bar.style.left = Math.min(Math.max(x, stage.left + 90), stage.right - 90) - host.left + 'px';
  bar.style.top = y - host.top + 'px';
}

// ---- The rail and its drawers ----
let drawer = 'elements';
function showDrawer(name) { drawer = drawer === name ? null : name; paintDrawer(); if (drawer === 'draw' && board) toggleDraw(true); }
function paintDrawer() {
  for (const b of document.querySelectorAll('#create-rail [data-drawer]')) { b.classList.toggle('on', b.dataset.drawer === drawer); b.setAttribute('aria-pressed', b.dataset.drawer === drawer); }
  for (const p of document.querySelectorAll('#create-drawer [data-panel]')) p.hidden = p.dataset.panel !== drawer;
  $('#create-drawer').hidden = !drawer;
  if (board?.isDrawingMode && drawer !== 'draw') toggleDraw(false);
  if (drawer === 'templates') paintTemplates();
  if (drawer === 'shoot') paintShoot();
}
for (const b of document.querySelectorAll('#create-rail [data-drawer]')) b.onclick = () => showDrawer(b.dataset.drawer);
paintDrawer();

// ---- Template pictures, drawn from the templates themselves ----
const templateThumbs = new Map();
const cached = (key, make) => { if (!templateThumbs.has(key)) templateThumbs.set(key, make().catch(error => { templateThumbs.delete(key); throw error; })); return templateThumbs.get(key); };
async function drawThumb(size, build, width = 280) {
  await fonts().catch(() => {});
  const [w, h] = size.map(v => Math.round(v * PX)), sc = new fabric.StaticCanvas(document.createElement('canvas'), { width: w, height: h, backgroundColor: '#ffffff' });
  try { await build(sc); sc.renderAll(); return sc.toDataURL({ format: 'png', multiplier: width / w }); } finally { sc.dispose(); }
}
function templateThumb(name, source, modified) {
  if (source === 'starter') return cached('starter:' + name, () => drawThumb(sizeIn(starterPage(name)), page => STARTERS[name](page)));
  return cached(`mine:${name}:${modified}`, async () => {
    const doc = JSON.parse(await invoke('load_creation', { kind: 'templates', name }));
    return drawThumb(docSize(doc), c => c.loadFromJSON(docPages(doc)[0]));
  });
}
function templateButton(name, source, modified, onclick) {
  const b = button(name, onclick), img = new Image();
  b.classList.add('template'); img.alt = ''; b.prepend(img);
  templateThumb(name, source, modified).then(url => { img.src = url; }, () => {});
  return b;
}
async function paintTemplates() {
  const mine = await invoke('list_creations', { kind: 'templates' }).catch(() => []);
  const pick = (name, source) => () => useTemplate(name, source).catch(error => { $('#create-saved').textContent = 'Could not use the template: ' + (error.message || error); });
  $('#drawer-templates').replaceChildren(...Object.keys(STARTERS).map(n => templateButton(n, 'starter', 0, pick(n, 'starter'))), ...mine.map(t => templateButton(t.name, 'mine', t.modified, pick(t.name, 'mine'))));
}
// A blank page takes the template in place, like Canva; a page with work on it keeps it and opens a new design.
async function useTemplate(name, source) {
  if ($('#create').inert || cropSession) return;
  if (board.getObjects().length || designPages.length > 1) return newDesign(name, source);
  if (source === 'starter') { design.page = starterPage(name); design.size = sizeIn(design.page); design.tile = 'single'; await STARTERS[name](board); }
  else {
    const doc = JSON.parse(await invoke('load_creation', { kind: 'templates', name }));
    if ((doc.format ?? 1) > FORMAT) throw Error('it was made by a newer KB Studio; update KB Studio to use it');
    restoring = true;
    try {
      designPages = docPages(doc); pageAt = 0;
      await board.loadFromJSON(designPages[0]);
      for (const o of board.getObjects()) applyLock(o);
      design.page = docPage(doc); design.size = docSize(doc);
      design.tile = doc.tile === 'sheet' && TILES[design.page] ? 'sheet' : 'single';
    } finally { restoring = false; }
  }
  if (/^Untitled( \d+)?$/.test(design.title)) design.title = await uniqueTitle(`My ${name}`);
  commitDesign(); paintAll();
}

// ---- What's new, shown once ----
const WHATS_NEW = 14;
function paintWhatsNew() { $('#create-whatsnew').hidden = mode !== 'create' || settings.seen >= WHATS_NEW; }
$('#whatsnew-ok').onclick = () => { settings.seen = WHATS_NEW; saveSettings(); paintWhatsNew(); };

// ---- Page, background, saved colours and fonts ----
function paintAll() {
  $('#create-title').value = design.title;
  $('#create-page').value = design.page;
  $('#create-tile').value = design.tile;
  $('#create-copies').value = design.copies;
  $('#create-bg').value = hex(board.backgroundColor) || '#ffffff';
  $('#create-tile').disabled = !TILES[design.page];
  $('#custom-size').hidden = design.page !== 'custom';
  [$('#custom-w').value, $('#custom-h').value] = design.size;
  paintFonts(); paintColours(); paintLayers(); paintPanel(); paintHistory(); fitBoard(); paintBw(); paintPages();
}
$('#create-page').replaceChildren(...PAGE_GROUPS.map(([label, keys]) => {
  const group = Object.assign(document.createElement('optgroup'), { label });
  group.append(...keys.map(k => Object.assign(document.createElement('option'), { value: k, textContent: PAGE_LABEL(k) })));
  return group;
}), Object.assign(document.createElement('option'), { value: 'custom', textContent: 'Custom size…' }));
$('#create-page').onchange = e => resizeDesign(e.target.value, e.target.value === 'custom' ? design.size : sizeIn(e.target.value));
for (const id of ['#custom-w', '#custom-h']) $(id).onchange = () => {
  const side = el => Math.min(MAX_SIDE, Math.max(1, Math.round((el.valueAsNumber || 1) * 100) / 100));
  resizeDesign('custom', [side($('#custom-w')), side($('#custom-h'))]);
};
// Like Canva's Resize: every page is scaled about its middle to fit the new size, unless that is turned off.
async function resizeDesign(page, size) {
  if (cropSession || restoring || $('#create').inert) return paintAll();
  await Promise.allSettled([...adding]);
  const [ow, oh] = design.size, [nw, nh] = size;
  let list = allPages();
  if ($('#resize-scale').checked && (ow !== nw || oh !== nh)) {
    const k = Math.min(nw / ow, nh / oh), dx = (nw - ow * k) / 2 * PX, dy = (nh - oh * k) / 2 * PX;
    list = list.map(p => ({ ...p, objects: p.objects.map(o => ({ ...o, left: o.left * k + dx, top: o.top * k + dy, scaleX: (o.scaleX ?? 1) * k, scaleY: (o.scaleY ?? 1) * k })) }));
  }
  design.page = page; design.size = [...size];
  if (!TILES[page]) design.tile = 'single';
  designPages = list;
  await loadPage(pageAt);
  commitDesign(); paintAll();
}

// ---- Pages: one on the board at a time, the rest kept as JSON; the strip along the bottom switches between them ----
async function loadPage(i) {
  restoring = true;
  try {
    board.discardActiveObject();
    await board.loadFromJSON(designPages[i]);
    for (const o of board.getObjects()) applyLock(o);
  } finally { restoring = false; }
  pageAt = i; hovered = null;
}
const pageReady = () => !cropSession && !restoring && !$('#create').inert;
async function showPage(i) {
  if (i === pageAt || i < 0 || i >= designPages.length || !pageReady()) return;
  await Promise.allSettled([...adding]);
  designPages[pageAt] = board.toObject(KEEP);
  await loadPage(i);
  paintAll();
}
async function addPage(page = blankPage()) {
  if (designPages.length >= MAX_PAGES || !pageReady()) return;
  await Promise.allSettled([...adding]);
  designPages[pageAt] = board.toObject(KEEP);
  designPages.splice(pageAt + 1, 0, page);
  await loadPage(pageAt + 1);
  commitDesign(); paintAll();
}
const duplicatePage = () => addPage(JSON.parse(JSON.stringify(board.toObject(KEEP))));
async function deletePage() {
  if (designPages.length < 2 || !pageReady()) return;
  await Promise.allSettled([...adding]);
  designPages.splice(pageAt, 1);
  await loadPage(Math.min(pageAt, designPages.length - 1));
  commitDesign(); paintAll();
}
function movePage(by) {
  const to = pageAt + by;
  if (to < 0 || to >= designPages.length || !pageReady()) return;
  designPages[pageAt] = board.toObject(KEEP);
  [designPages[pageAt], designPages[to]] = [designPages[to], designPages[pageAt]];
  pageAt = to;
  commitDesign(); paintPages();
}
$('#page-add').onclick = () => addPage();
$('#page-duplicate').onclick = duplicatePage;
$('#page-delete').onclick = deletePage;
$('#page-left').onclick = () => movePage(-1);
$('#page-right').onclick = () => movePage(1);
// Small pictures of the pages: the others are drawn once from their JSON, the one being edited shortly after each change.
const pageThumbs = new WeakMap();
let liveThumb = null, liveThumbTimer = null;
const pageThumb = page => { if (!pageThumbs.has(page)) pageThumbs.set(page, drawThumb(design.size, c => c.loadFromJSON(page), 96).catch(() => '')); return pageThumbs.get(page); };
function paintPagesSoon() { clearTimeout(liveThumbTimer); liveThumbTimer = setTimeout(() => { liveThumb = null; paintPages(); }, 700); }
function paintPages() {
  if (!design || !board) return;
  const n = designPages.length;
  if (!liveThumb) liveThumb = pageThumb(board.toObject(KEEP));
  $('#page-list').replaceChildren(...designPages.map((page, i) => {
    const b = button('', () => showPage(i)), img = new Image();
    img.alt = ''; b.append(img, String(i + 1)); b.title = 'Page ' + (i + 1); b.classList.toggle('on', i === pageAt);
    (i === pageAt ? liveThumb : pageThumb(page)).then(url => { if (url) img.src = url; });
    return b;
  }));
  $('#page-count').textContent = `Page ${pageAt + 1} of ${n}`;
  $('#page-left').disabled = pageAt === 0; $('#page-right').disabled = pageAt === n - 1;
  $('#page-delete').disabled = n < 2; $('#page-add').disabled = $('#page-duplicate').disabled = n >= MAX_PAGES;
}
$('#create-tile').onchange = e => { design.tile = e.target.value; remember(); schedule(); };
$('#create-copies').onchange = e => { design.copies = Math.min(20, Math.max(1, +e.target.value | 0 || 1)); e.target.value = design.copies; remember(); schedule(); };
$('#create-bg').oninput = e => { board.backgroundColor = e.target.value; board.requestRenderAll(); };
$('#create-bg').onchange = () => commitDesign();
$('#create-bw').onchange = paintBw;
function paintBw() { $('#create-stage').classList.toggle('bw', $('#create-bw').checked); }

async function loadSettings() {
  const s = await invoke('load_create_settings').catch(() => null);
  if (s && typeof s === 'object') settings = { colours: Array.isArray(s.colours) ? s.colours.filter(c => hex(c)).slice(0, 12) : [], fonts: Array.isArray(s.fonts) ? s.fonts.filter(f => FONTS.includes(f)) : [], seen: Number.isInteger(s.seen) ? s.seen : 0, closed: Array.isArray(s.closed) ? s.closed.filter(x => typeof x === 'string').slice(0, 20) : ['frames', 'grids', 'graphics'], projects: cleanProjects(s.projects) };
  paintWhatsNew();
  if (typeof paintFolds === 'function') paintFolds();
}
const saveSettings = () => invoke('save_create_settings', { settings }).catch(() => {});
function paintFonts() {
  const sorted = [...settings.fonts, ...FONTS.filter(f => !settings.fonts.includes(f))];
  $('#prop-font').replaceChildren(...sorted.map(f => Object.assign(document.createElement('option'), { value: f, textContent: (settings.fonts.includes(f) ? '★ ' : '') + f })),
    ...designFamilies().map(f => Object.assign(document.createElement('option'), { value: f, textContent: f + ' (in this design)' })));
}
// One colour for the selection, or the background when nothing is selected. Lines and hollow text take it as their outline.
function applyColour(c) {
  if (board.getActiveObject()) change(o => o.type === 'line' || o.kbEffect === 'hollow' ? { stroke: c } : { fill: c });
  else { board.backgroundColor = c; board.requestRenderAll(); $('#create-bg').value = c; commitDesign(); }
  paintPanel();
}
const DEFAULT_COLOURS = ['#000000', '#545454', '#a6a6a6', '#ffffff', '#ff3131', '#ff5757', '#ff66c4', '#cb6ce6', '#8c52ff', '#5e17eb', '#0097b2', '#0cc0df',
  '#5ce1e6', '#38b6ff', '#004aad', '#00bf63', '#7ed957', '#c1ff72', '#ffde59', '#ffbd59', '#ff914d', '#b08a32', '#7a4f2a', '#f4e1c1'];
function swatch(c) {
  const b = button('', () => applyColour(c));
  b.style.background = c; b.title = c; b.className = 'swatch'; b.dataset.colour = c;
  return b;
}
// The colours already in this design, from every page, most used first, as Canva's "Document colours".
function documentColours() {
  const counts = new Map(), add = c => { if (c?.colorStops) return c.colorStops.forEach(s => add(s.color)); const h = hex(c); if (h) counts.set(h.toLowerCase(), (counts.get(h.toLowerCase()) || 0) + 1); };
  const walk = o => { add(o.fill); add(o.stroke); (o.objects || []).forEach(walk); };
  for (const page of allPages()) { add(page.background); (page.objects || []).forEach(walk); }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 18);
}
function paintColours() {
  $('#colours').replaceChildren(...settings.colours.map(c => {
    const b = swatch(c);
    b.oncontextmenu = e => { e.preventDefault(); settings.colours = settings.colours.filter(x => x !== c); saveSettings(); paintColours(); };
    return b;
  }));
  if (!$('#colours-default').children.length) $('#colours-default').replaceChildren(...DEFAULT_COLOURS.map(swatch));
  if (design && board) $('#colours-document').replaceChildren(...documentColours().map(swatch));
}
$('#colours-open').addEventListener('click', paintColours);
$('#colour-save').onclick = () => {
  const c = $('#prop-fill').value;
  if (!settings.colours.includes(c)) settings.colours = [c, ...settings.colours].slice(0, 12);
  saveSettings(); paintColours();
};

// ---- Output: PNG, JPEG and a 300-dpi PDF ----
// Draw the design on a fresh canvas so the screen's zoom and selection never get in.
async function render(multiplier, format, quality = 0.92, page = board.toObject(KEEP)) {
  await fonts();
  const [w, h] = pagePx(), sc = new fabric.StaticCanvas(document.createElement('canvas'), { width: w, height: h });
  try {
    await sc.loadFromJSON(page);
    return sc.toDataURL({ format, quality, multiplier, enableRetinaScaling: false });
  } finally { sc.dispose(); }
}
const toBytes = url => Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), c => c.charCodeAt(0));
const DPI = 300;

// The PDF: one sheet of paper per page, all pages once per copy; a card tiled onto a Letter sheet repeats on it, with cut marks.
async function makePdf() {
  board.discardActiveObject();
  const layout = pageLayout(design.page, design.tile, design.size), [sw, sh] = layout.sheet, [pw, ph] = design.size;
  const images = [];
  for (const page of allPages()) images.push(await render(DPI / PX, 'jpeg', 0.92, page));
  const pdf = new window.jspdf.jsPDF({ unit: 'in', format: [sw, sh], orientation: sw > sh ? 'landscape' : 'portrait', compress: true });
  for (let copy = 0, sheet = 0; copy < design.copies; copy++) images.forEach((image, i) => {
    if (sheet++) pdf.addPage([sw, sh], sw > sh ? 'landscape' : 'portrait');
    for (const t of layout.tiles) pdf.addImage(image, 'JPEG', t.x, t.y, pw, ph, 'page' + i, 'FAST');
    pdf.setDrawColor(110); pdf.setLineWidth(0.01);
    for (const [x1, y1, x2, y2] of layout.marks) pdf.line(x1, y1, x2, y2);
  });
  return new Uint8Array(pdf.output('arraybuffer'));
}
async function output(kind, open = false) {
  const status = $('#create-saved');
  try {
    await flush();
    const many = kind !== 'pdf' && designPages.length > 1;
    status.textContent = 'Making ' + (kind === 'pdf' ? 'the PDF' : many ? 'the pictures' : 'the picture') + '…';
    const save = (bytes, name) => invoke('save_output', bytes, { headers: { name: encodeURIComponent(name), ext: kind === 'jpeg' ? 'jpg' : kind, open: String(open) } });
    if (kind === 'pdf') { const file = await save(await makePdf(), design.title); status.textContent = (open ? 'Opened ' : 'Saved ') + file; return; }
    // A picture per page, numbered when there are several (an Instagram carousel, for one).
    const pages = allPages();
    let file;
    for (const [i, page] of pages.entries()) file = await save(toBytes(await render(pictureScale(), kind === 'png' ? 'png' : 'jpeg', 0.92, kind === 'png' && typeof seeThrough === 'function' ? seeThrough(page) : page)), many ? `${design.title} page ${i + 1}` : design.title);
    status.textContent = many ? `Saved ${pages.length} pictures in the Exports folder` : 'Saved ' + file;
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
  if (mode === 'create' && event.key === 'Escape' && closeMenus()) { event.preventDefault(); return; }
  if (mode !== 'create' || !board || cropSession || $('#create').inert || event.target.matches?.('input, select, textarea')) return;
  const active = board.getActiveObject();
  if (active?.isEditing) return;
  const key = event.key.toLowerCase();
  if (event.ctrlKey || event.metaKey) {
    const run = {
      z: () => stepHistory(event.shiftKey ? 1 : -1), y: () => stepHistory(1), d: duplicateSelected,
      g: () => groupSelected(event.shiftKey), c: () => copySelected(), x: () => copySelected(true),
      a: selectAll,
      '[': () => reorderSelected(-1), ']': () => reorderSelected(1),
      '{': () => arrangeSelected('back'), '}': () => arrangeSelected('front') // Shift+[ and Shift+]
    }[key];
    if (run) { event.preventDefault(); run(); }
  } else if (key === '+' || key === '=' || key === '-') { event.preventDefault(); zoomBoard(board.getZoom() * (key === '-' ? 0.8 : 1.25)); }
  else if (key === '0') { event.preventDefault(); fitBoard(); }
  else if (key === ' ') { event.preventDefault(); setSpacePan(true); }
  else if (key === 'delete' || key === 'backspace') { event.preventDefault(); removeSelected(); }
  else if (key === 'escape') board.discardActiveObject().requestRenderAll();
  else if (key.startsWith('arrow') && active && !board.getActiveObjects().some(o => o.kbLocked)) {
    event.preventDefault();
    const d = event.shiftKey ? 10 : 1;
    active.set({ left: active.left + (key === 'arrowright' ? d : key === 'arrowleft' ? -d : 0), top: active.top + (key === 'arrowdown' ? d : key === 'arrowup' ? -d : 0) });
    active.setCoords(); board.requestRenderAll(); commitDesign();
  }
});

document.addEventListener('keyup', event => { if (event.key === ' ') setSpacePan(false); });
addEventListener('blur', () => setSpacePan(false));

// ---- Starter templates: placeholder words only. Each fills the canvas it is given (the page, or a thumbnail) ----
const T = (text, left, top, o = {}) => new fabric.Textbox(text, { left, top, width: 300, fontSize: 28, fontFamily: 'Lexend', fill: '#222222', kbName: 'Text', ...o });
const R = (left, top, width, height, o = {}) => new fabric.Rect({ left, top, width, height, fill: 'transparent', stroke: '#444444', strokeWidth: 2, kbName: 'Box', ...o });
const STARTERS = {
  'Behaviour chart': async page => {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], x0 = 40, y0 = 190, cw = 100, rh = 100, label = 276;
    page.add(T('Behaviour Chart', 48, 40, { width: 720, fontSize: 60, textAlign: 'center', fontWeight: 'bold', kbName: 'Title' }), T('Name: ________________', 48, 125, { width: 720, fontSize: 30 }));
    page.add(R(x0, y0, label, 60, { fill: '#fff2cc' }));
    days.forEach((d, i) => page.add(R(x0 + label + i * cw, y0, cw, 60, { fill: '#fff2cc' }), T(d, x0 + label + i * cw, y0 + 14, { width: cw, textAlign: 'center', fontSize: 26 })));
    for (let r = 0; r < 8; r++) {
      page.add(R(x0, y0 + 60 + r * rh * 0.9, label, rh * 0.9), T('Goal ' + (r + 1), x0 + 12, y0 + 60 + r * rh * 0.9 + 28, { width: label - 24, fontSize: 26 }));
      for (let c = 0; c < 5; c++) page.add(R(x0 + label + c * cw, y0 + 60 + r * rh * 0.9, cw, rh * 0.9));
    }
  },
  'Labels': async page => {
    for (let r = 0; r < 5; r++) for (let c = 0; c < 2; c++) {
      const x = 16 + c * 392, y = 48 + r * 192;
      page.add(R(x, y, 384, 192, { stroke: '#bbbbbb', strokeDashArray: [6, 6] }), T('Name', x + 20, y + 70, { width: 344, fontSize: 48, textAlign: 'center', fontWeight: 'bold' }));
    }
  },
  'Word wall': async page => {
    page.add(T('Word Wall', 48, 28, { width: 720, fontSize: 64, textAlign: 'center', fontWeight: 'bold', kbName: 'Title' }));
    const w = 176, h = 124;
    for (let i = 0; i < 26; i++) {
      const x = 40 + (i % 4) * (w + 8), y = 130 + Math.floor(i / 4) * (h + 8);
      page.add(R(x, y, w, h, { fill: i % 2 ? '#dae8fc' : '#ffe6cc' }), T(String.fromCharCode(65 + i), x + 10, y + 6, { width: 60, fontSize: 40, fontWeight: 'bold' }), T('word', x + 14, y + 66, { width: w - 28, fontSize: 24 }));
    }
  },
  'Newsletter': async page => {
    page.add(R(0, 0, 816, 170, { fill: '#6aa84f', stroke: '#6aa84f' }), T('Our Class Newsletter', 40, 30, { width: 736, fontSize: 60, fill: '#ffffff', fontWeight: 'bold', textAlign: 'center', kbName: 'Title' }), T('Month Year', 40, 112, { width: 736, fontSize: 28, fill: '#ffffff', textAlign: 'center' }));
    const body = 'Write your news here. Tell families what the class has been learning and what is coming up.';
    [['This week', 40, 200], ['Coming up', 428, 200], ['Reminders', 40, 600], ['Thank you', 428, 600]].forEach(([h, x, y]) => page.add(T(h, x, y, { width: 348, fontSize: 34, fontWeight: 'bold', fill: '#38761d' }), T(body, x, y + 56, { width: 348, fontSize: 24 })));
  },
  'Certificate': async page => {
    page.add(R(32, 32, 752, 992, { stroke: '#b08a32', strokeWidth: 6 }), R(48, 48, 720, 960),
      T('Certificate', 80, 120, { width: 656, fontSize: 72, textAlign: 'center', fontFamily: 'Lora' }),
      T('of Achievement', 80, 220, { width: 656, fontSize: 40, textAlign: 'center' }),
      T('Presented to', 80, 360, { width: 656, textAlign: 'center' }),
      T('Student Name', 80, 440, { width: 656, fontSize: 56, textAlign: 'center', fontFamily: 'Caveat' }),
      T('For your wonderful work', 80, 570, { width: 656, textAlign: 'center' }),
      T('Date: __________', 90, 820), T('Signed: __________', 430, 820));
  },
  'Name tags': async page => {
    for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) {
      const x = 32 + c * 384, y = 48 + r * 240;
      page.add(R(x, y, 368, 216, { rx: 16, ry: 16, fill: '#e6f1ff' }), T('Hello, my name is', x + 16, y + 24, { width: 336, textAlign: 'center', fontSize: 26 }), T('Name', x + 16, y + 92, { width: 336, textAlign: 'center', fontSize: 54, fontFamily: 'Balsamiq Sans' }));
    }
  },
  'Flash cards': async page => {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) {
      const x = 32 + c * 384, y = 48 + r * 320;
      page.add(R(x, y, 368, 304, { strokeDashArray: [6, 6] }), T('Word', x + 20, y + 80, { width: 328, fontSize: 52, textAlign: 'center' }), T('Meaning or picture', x + 20, y + 200, { width: 328, fontSize: 24, textAlign: 'center' }));
    }
  },
  'Calendar': async page => {
    page.add(T('Month Year', 48, 48, { width: 720, fontSize: 56, textAlign: 'center', kbName: 'Title' }));
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((day, c) => page.add(T(day, 48 + c * 720 / 7, 162, { width: 720 / 7, fontSize: 24, textAlign: 'center' })));
    page.add(...tableCells(6, 7, 210, 780, 'Date', 816));
  },
  'Handwriting worksheet': async page => {
    page.add(T('Handwriting Practice', 48, 40, { width: 720, fontSize: 48 }), T('Name: __________   Date: __________', 48, 120, { width: 720, fontSize: 26 }));
    for (let r = 0; r < 8; r++) page.add(handwritingLines(720).set({ left: 48, top: 230 + r * 96 }), T(r === 0 ? 'Trace your words here' : ' ', 52, 216 + r * 96, { width: 700, fontSize: 42, fontFamily: 'Patrick Hand', fill: '#aaaaaa' }));
  },
  // Photography: frames to drop photos into. Social pages are 540 px wide (saved at 1080).
  'Student of the week': async page => {
    page.add(R(0, 0, 816, 1056, { fill: '#fff6e0', stroke: '#fff6e0', kbName: 'Background' }),
      T('Student of the Week', 48, 56, { width: 720, fontSize: 64, textAlign: 'center', fontFamily: 'Fredoka', fontWeight: 'bold', fill: '#c0392b', kbName: 'Title' }),
      makeFrame(380, 380, 'circle', { left: 218, top: 180 }),
      T('Student Name', 48, 590, { width: 720, fontSize: 56, textAlign: 'center', fontFamily: 'Caveat', kbName: 'Name' }));
    [['My favourite book', 700], ['When I grow up', 790], ['Something I love', 880]].forEach(([q, y]) => page.add(T(q + ': ____________________', 96, y, { width: 624, fontSize: 28 })));
  },
  'Mini session flyer': async page => {
    page.add(makeFrame(816, 520, 'rect', { left: 0, top: 0 }),
      T('Fall Mini Sessions', 48, 556, { width: 720, fontSize: 64, textAlign: 'center', fontFamily: 'Lora', kbName: 'Title' }),
      T('20 minutes · 10 edited photos', 48, 650, { width: 720, fontSize: 30, textAlign: 'center', fill: '#8a5a1a' }),
      makeFrame(228, 228, 'rounded', { left: 48, top: 720 }), makeFrame(228, 228, 'rounded', { left: 294, top: 720 }), makeFrame(228, 228, 'rounded', { left: 540, top: 720 }),
      T('Date · Place · Price — book at your-site', 48, 980, { width: 720, fontSize: 24, textAlign: 'center' }));
  },
  'Photo card': async page => {
    page.add(makeFrame(420, 480, 'rect', { left: 0, top: 0 }),
      T('Happy Holidays', 440, 150, { width: 212, fontSize: 44, textAlign: 'center', fontFamily: 'Caveat', fill: '#a33', kbName: 'Greeting' }),
      T('from our family', 440, 260, { width: 212, fontSize: 22, textAlign: 'center', fontFamily: 'Lora' }),
      T('2026', 440, 310, { width: 212, fontSize: 20, textAlign: 'center', fill: '#777777' }));
  },
  'Instagram post': async page => {
    page.add(makeFrame(540, 540, 'rect', { left: 0, top: 0 }), R(0, 540, 540, 135, { fill: '#2f2a26', stroke: '#2f2a26', kbName: 'Band' }),
      T('Booking now', 24, 556, { width: 492, fontSize: 40, textAlign: 'center', fontFamily: 'Lora', fill: '#ffffff', kbName: 'Title' }),
      T('Link in bio', 24, 618, { width: 492, fontSize: 20, textAlign: 'center', fill: '#e8c27a' }));
  },
  'Square collage': async page => {
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) page.add(makeFrame(267, 267, 'rect', { left: c * 273, top: r * 273 }));
  },
  'Story': async page => {
    page.add(makeFrame(540, 960, 'rect', { left: 0, top: 0 }), R(32, 760, 476, 150, { fill: '#ffffffdd', stroke: '#ffffff00', rx: 16, ry: 16, kbName: 'Card' }),
      T('New gallery!', 48, 778, { width: 444, fontSize: 44, textAlign: 'center', fontFamily: 'Fredoka', fontWeight: 'bold', kbName: 'Title' }),
      T('Tap the link to see your photos', 48, 848, { width: 444, fontSize: 22, textAlign: 'center' }));
  }
};
const STARTER_PAGE = { 'Photo card': 'photo-7x5', 'Instagram post': 'social-portrait', 'Square collage': 'social-square', 'Story': 'social-story' };
const starterPage = name => STARTER_PAGE[name] || 'letter';

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
