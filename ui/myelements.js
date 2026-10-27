// My elements: anything on the page (a decoration from a Canva file, a styled heading, a few pieces together) saved to
// use again in any design, in My elements or at the top of another section she chooses (Shapes, Graphics, Text…), to
// keep them organised. Each is a small file in KB Studio/Elements. Needs create.js.
const myElements = new Map(); // name → { name, w, h, objects, thumb, place }
const MINE_PLACES = { mine: 'My elements', shapes: 'Shapes', frames: 'Frames', decor: 'Decorations', charts: 'Charts', graphics: 'Graphics', text: 'Text' };
const placeOf = el => MINE_PLACES[el.place] ? el.place : 'mine';

async function loadMine() {
  const entries = await invoke('list_creations', { kind: 'elements' }).catch(() => []);
  myElements.clear();
  for (const { name } of entries) {
    try { const el = JSON.parse(await invoke('load_creation', { kind: 'elements', name })); if (el?.format === 1 && Array.isArray(el.objects)) myElements.set(name, { ...el, name }); }
    catch { /* a damaged file is left out */ }
  }
  paintMine();
}
const writeMine = (name, el) => invoke('save_creation', new TextEncoder().encode(JSON.stringify({ ...el, name: undefined })), { headers: { kind: 'elements', name: encodeURIComponent(name) } });
function freeName(base) {
  const clean = base.replace(/[\/\\:*?"<>|]/g, ' ').trim().slice(0, 60) || 'My element';
  let name = clean;
  for (let n = 2; myElements.has(name); n++) name = `${clean} ${n}`;
  return name;
}

// The selection as it sits on the page, moved so its top left corner is 0, 0, with a small picture of it.
async function saveMine(place = $('#mine-place').value) {
  const objects = board?.getActiveObjects() || [];
  if (!objects.length) { $('#mine-hint').textContent = 'Select something on the page first, then click Save.'; $('#mine-hint').hidden = false; return null; }
  board.discardActiveObject(); // pieces of a selection only know where they are inside it until it's let go
  const boxes = objects.map(o => o.getBoundingRect());
  const left = Math.min(...boxes.map(b => b.left)), top = Math.min(...boxes.map(b => b.top));
  const w = Math.max(...boxes.map(b => b.left + b.width)) - left, h = Math.max(...boxes.map(b => b.top + b.height)) - top;
  const json = objects.map(o => { const j = o.toObject(KEEP); j.left -= left; j.top -= top; return j; });
  selectObjects(objects);
  const sc = new fabric.StaticCanvas(document.createElement('canvas'), { width: Math.ceil(w), height: Math.ceil(h) });
  let thumb = '';
  try { await sc.loadFromJSON({ version: fabric.version, objects: json }); sc.renderAll(); thumb = sc.toDataURL({ format: 'png', multiplier: Math.min(1, 160 / Math.max(w, h, 1)) }); } finally { sc.dispose(); }
  const name = freeName(objects.length === 1 ? objects[0].kbName || 'My element' : 'My element');
  const el = { format: 1, w, h, objects: json, thumb, place: MINE_PLACES[place] ? place : 'mine' };
  await writeMine(name, el);
  myElements.set(name, { ...el, name });
  $('#mine-hint').textContent = `Saved as “${name}”` + (el.place === 'mine' ? '' : ` at the top of ${MINE_PLACES[el.place]}` + (el.place === 'text' ? ' (in the Text drawer)' : '')) + '. Click it to add it to any design.';
  paintMine();
  const fold = mineSection(el.place)?.closest('details');
  if (fold) fold.open = true;
  return name;
}
// A copy of a saved element, dropped where it was let go (or in the middle of the page). Several pieces stay loose,
// as they were saved; a table among them gets a new id so it doesn't join another copy of itself.
async function addMine(name, at) {
  const el = myElements.get(name);
  if (!el || !board) return null;
  const ids = new Map(), objects = await fabric.util.enlivenObjects(el.objects);
  for (const o of objects) if (o.kbTable) { if (!ids.has(o.kbTable)) ids.set(o.kbTable, typeof newTableId === 'function' ? newTableId() : o.kbTable); o.kbTable = ids.get(o.kbTable); }
  if (objects.length === 1) return place(objects[0], at);
  place(new fabric.Group(objects, { kbName: name }), at);
  groupSelected(true);
  return board.getActiveObject();
}
async function removeMine(name) {
  await invoke('delete_creation', { kind: 'elements', name });
  myElements.delete(name); paintMine();
}
async function moveMine(name, place) {
  const el = myElements.get(name);
  if (!el || !MINE_PLACES[place] || placeOf(el) === place) return paintMine();
  const moved = { ...el, place };
  await writeMine(name, moved);
  myElements.set(name, moved); paintMine();
}
async function renameMine(name, wanted) {
  const el = myElements.get(name), next = wanted.trim() && wanted.trim() !== name ? freeName(wanted) : null;
  if (!el || !next) return paintMine();
  await writeMine(next, el); await invoke('delete_creation', { kind: 'elements', name });
  myElements.delete(name); myElements.set(next, { ...el, name: next }); paintMine();
}

// ---- The saved tiles: in My elements, and at the top of each other section something was saved to ----
// The grid for a section, made the first time something is saved there: after the section's title and first hint.
function mineSection(place) {
  if (place === 'mine') return $('#create-mine');
  let grid = $('#mine-in-' + place);
  if (grid) return grid;
  const host = place === 'text' ? document.querySelector('section[data-panel=text]') : document.querySelector(`details.fold[data-fold=${place}]`);
  if (!host) return null;
  const box = Object.assign(document.createElement('div'), { className: 'mine-saved' });
  box.append(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'Saved by you' }));
  grid = Object.assign(document.createElement('div'), { id: 'mine-in-' + place, className: 'mine-grid' });
  box.append(grid);
  const after = host.querySelector(':scope > p.hint') || host.querySelector(':scope > summary, :scope > h3');
  after.after(box);
  return grid;
}
function paintMine() {
  const names = [...myElements.keys()].sort((a, b) => a.localeCompare(b));
  for (const place of Object.keys(MINE_PLACES)) {
    const grid = mineSection(place);
    if (!grid) continue;
    grid.replaceChildren(...names.filter(name => placeOf(myElements.get(name)) === place).map(mineTile));
    if (place !== 'mine') grid.parentElement.hidden = !grid.children.length;
  }
  $('#mine-empty').hidden = names.length > 0;
  $('#mine-hint').hidden = !names.length; // with nothing saved, one line says it all
}
function mineTile(name) {
  const tile = document.createElement('div'); tile.className = 'mine-tile';
  const add = button('', () => addMine(name)); add.className = 'mine-add'; add.title = 'Add ' + name; draggable(add, ['mine', name]);
  const img = new Image(); img.src = myElements.get(name).thumb || ''; img.alt = '';
  const label = Object.assign(document.createElement('span'), { textContent: name });
  add.append(img, label);
  const rename = button('✎', () => {
    const input = Object.assign(document.createElement('input'), { type: 'text', value: name, maxLength: 60 });
    input.setAttribute('aria-label', 'New name');
    let done = false;
    const finish = keep => { if (done) return; done = true; keep ? renameMine(name, input.value) : paintMine(); };
    input.onkeydown = e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); };
    input.onblur = () => finish(true);
    label.replaceWith(input); input.focus(); input.select();
  });
  rename.title = 'Rename'; rename.setAttribute('aria-label', 'Rename ' + name);
  const del = button('×', () => { if (del.classList.contains('sure')) removeMine(name); else { del.classList.add('sure'); del.textContent = 'Delete?'; } });
  del.title = 'Delete'; del.setAttribute('aria-label', 'Delete ' + name);
  // Move: a list of the sections in place of the name; choosing one moves it there.
  const move = button('Move', () => {
    const pick = document.createElement('select');
    pick.setAttribute('aria-label', 'Move ' + name + ' to');
    for (const [key, text] of Object.entries(MINE_PLACES)) pick.append(new Option(text, key, false, key === placeOf(myElements.get(name))));
    pick.onchange = () => moveMine(name, pick.value).catch(e => { $('#mine-hint').textContent = 'Could not move it: ' + e; $('#mine-hint').hidden = false; });
    pick.onblur = () => { if (pick.isConnected) paintMine(); };
    label.replaceWith(pick); pick.focus();
  });
  move.className = 'mine-move'; move.title = 'Move to another section'; move.setAttribute('aria-label', 'Move ' + name + ' to another section');
  tile.append(add, rename, del, move);
  return tile;
}
const paintMineSave = () => { $('#mine-save').textContent = 'Save the selection to ' + MINE_PLACES[$('#mine-place').value]; };
$('#mine-place').onchange = paintMineSave;
$('#mine-save').onclick = () => saveMine().catch(e => { $('#mine-hint').textContent = 'Could not save it: ' + e; });
loadMine();
