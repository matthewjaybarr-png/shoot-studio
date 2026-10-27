// My elements: anything on the page (a decoration from a Canva file, a styled heading, a few pieces together) saved to
// the Elements drawer to use again in any design. Each is a small file in KB Studio/Elements. Needs create.js.
const myElements = new Map(); // name → { name, w, h, objects, thumb }

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
async function saveMine() {
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
  const el = { format: 1, w, h, objects: json, thumb };
  await writeMine(name, el);
  myElements.set(name, { ...el, name });
  $('#mine-hint').textContent = `Saved as “${name}”. Click it to add it to any design.`;
  paintMine();
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
async function renameMine(name, wanted) {
  const el = myElements.get(name), next = wanted.trim() && wanted.trim() !== name ? freeName(wanted) : null;
  if (!el || !next) return paintMine();
  await writeMine(next, el); await invoke('delete_creation', { kind: 'elements', name });
  myElements.delete(name); myElements.set(next, { ...el, name: next }); paintMine();
}

// ---- The My elements section of the Elements drawer ----
function paintMine() {
  const grid = $('#create-mine'), names = [...myElements.keys()].sort((a, b) => a.localeCompare(b));
  grid.replaceChildren(...names.map(name => {
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
    tile.append(add, rename, del);
    return tile;
  }));
  $('#mine-empty').hidden = names.length > 0;
  $('#mine-hint').hidden = !names.length; // with nothing saved, one line says it all
}
$('#mine-save').onclick = () => saveMine().catch(e => { $('#mine-hint').textContent = 'Could not save it: ' + e; });
loadMine();
