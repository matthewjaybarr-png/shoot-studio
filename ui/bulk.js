// Bulk create: one copy of the design for each line of a list, so a class list makes name tags, desk plates or
// certificates. It makes a new design with a page per line (every page of the design, per line). A one-page design
// with the same box several times (a sheet of eight name tags) instead fills each box with the next line, in reading
// order, and starts a new page when they're used up. Each column of the
// list goes into the text box chosen for it, or into {Column} wherever that is typed. Needs create.js and doctools.js.
const isTextJSON = o => /^(textbox|i-?text|text)$/i.test(o?.type || '');

// The list as columns and rows. Pasted from a spreadsheet, columns come tab-separated, and the first line can be
// their names; a plain list is one column called Name.
function bulkList() {
  const lines = $('#bulk-list').value.split(/\r?\n/).filter(line => line.trim());
  const tabbed = lines.some(line => line.includes('\t'));
  const cells = lines.map(line => (tabbed ? line.split('\t') : [line]).map(cell => cell.trim()));
  const width = Math.max(1, ...cells.map(row => row.length)), headed = tabbed && $('#bulk-headings').checked;
  const names = Array.from({ length: width }, (_, c) => (headed && cells[0]?.[c]) || (width === 1 ? 'Name' : `Column ${c + 1}`));
  return { tabbed, names, rows: headed ? cells.slice(1) : cells };
}
// Every text box in the design, as "page:index" with what it says.
const bulkTexts = () => allPages().flatMap((page, p) => page.objects.flatMap((o, i) => isTextJSON(o) && o.text ? [{ key: `${p}:${i}`, p, text: o.text }] : []));
const hasToken = (name, texts) => texts.some(t => new RegExp('\\{' + escapeRe(name) + '\\}', 'i').test(t.text));

// Fill every box: for a one-page design, each column's boxes (the chosen box and every box saying the same, plus every
// box with {Column} typed in it), in reading order: top to bottom, and left to right along a row.
function bulkSlots() {
  const { names } = bulkList(), template = allPages();
  if (template.length !== 1) return { per: 1, slots: [] };
  const objects = template[0].objects, texts = bulkTexts();
  const slots = names.map((name, c) => {
    const pick = $('#bulk-field-' + c)?.value, chosen = pick ? objects[+pick.split(':')[1]] : null;
    return texts.filter(t => (chosen && objects[+t.key.split(':')[1]].text.trim() === chosen.text.trim()) || hasToken(name, [t])).map(t => +t.key.split(':')[1]);
  });
  const box = i => { const o = objects[i]; return { top: o.top, left: o.left, h: (o.height || 0) * Math.abs(o.scaleY || 1) }; };
  for (const list of slots) list.sort((a, b) => { const A = box(a), B = box(b); return Math.abs(A.top - B.top) < Math.max(4, Math.min(A.h, B.h) / 2) ? A.left - B.left : A.top - B.top; });
  return { per: Math.max(1, ...slots.map(list => list.length)), slots };
}
const bulkFilling = () => { const fill = bulkSlots(); return fill.per > 1 && $('#bulk-fill').checked ? fill : null; };

// The column-to-text-box choices, guessed from the words: a box saying "Student Name" gets the Name column.
function paintBulk() {
  const { tabbed, names, rows } = bulkList(), texts = bulkTexts(), pages = allPages().length, box = $('#bulk-fields');
  $('#bulk-headings-row').hidden = !tabbed;
  const before = [...box.querySelectorAll('select')].map(s => [s.dataset.name, s.value]);
  box.replaceChildren(...names.map((name, c) => {
    const row = Object.assign(document.createElement('label'), { className: 'bulk-field' });
    const pick = Object.assign(document.createElement('select'), { id: 'bulk-field-' + c });
    pick.dataset.name = name;
    pick.append(new Option(hasToken(name, texts) ? `Fills in {${name}} where it's typed` : 'Not used', ''));
    for (const t of texts) pick.append(new Option(`${pages > 1 ? `Page ${t.p + 1}: ` : ''}“${t.text.replace(/\s+/g, ' ').slice(0, 40)}”`, t.key));
    const kept = before.find(([n]) => n === name)?.[1];
    const guess = texts.find(t => t.text.toLowerCase().includes(name.toLowerCase())) || (c === 0 && !hasToken(name, texts) ? texts.find(t => /name/i.test(t.text)) : null);
    pick.value = kept !== undefined && [...pick.options].some(o => o.value === kept) ? kept : hasToken(name, texts) ? '' : guess?.key || '';
    pick.onchange = paintBulkCount;
    row.append(Object.assign(document.createElement('span'), { textContent: name }), pick);
    return row;
  }));
  paintBulkCount();
}
function paintBulkCount() {
  const { names, rows } = bulkList(), texts = bulkTexts(), { per } = bulkSlots(), fill = bulkFilling();
  const pages = fill ? Math.ceil(rows.length / per) : rows.length * allPages().length;
  $('#bulk-fill-row').hidden = per < 2;
  $('#bulk-fill-label').textContent = `Fill all ${per} boxes on the page, a different name in each`;
  const used = names.some((name, c) => $('#bulk-field-' + c)?.value || hasToken(name, texts));
  const make = $('#bulk-make');
  make.disabled = !rows.length || !used || pages > MAX_PAGES;
  make.textContent = rows.length ? `Make ${pages} page${pages === 1 ? '' : 's'}` : 'Make the pages';
  $('#bulk-count').textContent = !rows.length ? 'Type or paste your list above, one name per line.'
    : pages > MAX_PAGES ? `That makes ${pages} pages; ${MAX_PAGES} is the most one design holds. Split the list in two.`
      : !used ? 'Choose the text box each column goes into, or type {Name} in a text box.'
        : fill ? `${rows.length} name${rows.length === 1 ? '' : 's'}, ${per} to a page → ${pages} page${pages === 1 ? '' : 's'} in a new design. This design stays as it is.`
          : `${rows.length} line${rows.length === 1 ? '' : 's'} → ${pages} page${pages === 1 ? '' : 's'} in a new design. This design stays as it is.`;
}

// A text box with new words: one look for all of it (the first letter's), and a single line stays a single line by
// getting smaller, so a long name still fits its name tag.
async function refillText(json, text) {
  const [box] = await fabric.util.enlivenObjects([json]);
  const lines = box.textLines?.length || 1, first = Array.isArray(json.styles) ? json.styles[0]?.style : json.styles?.[0]?.[0];
  box.set({ text, styles: {} });
  if (first) box.set(first);
  box.initDimensions?.();
  const wanted = Math.max(lines, text.split('\n').length), smallest = box.fontSize * 0.4;
  while (box.type === 'textbox' && box.textLines.length > wanted && box.fontSize > smallest) { box.set('fontSize', box.fontSize * 0.94); box.initDimensions(); }
  return box.toObject(KEEP);
}
async function bulkPages() {
  const { names, rows } = bulkList(), template = allPages(), picks = names.map((_, c) => $('#bulk-field-' + c)?.value || '');
  const pages = [], fill = bulkFilling();
  if (fill) { // each box takes the next line; boxes past the end of the list are left blank
    const page = template[0];
    for (let first = 0; first < rows.length; first += fill.per) {
      const objects = [];
      for (const [i, o] of page.objects.entries()) {
        if (!isTextJSON(o)) { objects.push(o); continue; }
        let text = o.text;
        for (const [c, name] of names.entries()) {
          const slot = fill.slots[c].indexOf(i);
          if (slot < 0) continue;
          const value = rows[first + slot]?.[c] ?? '';
          text = hasToken(name, [{ text: o.text }]) ? text.replace(new RegExp('\\{' + escapeRe(name) + '\\}', 'gi'), value) : value;
        }
        objects.push(text === o.text ? o : await refillText(o, text));
      }
      pages.push({ ...page, objects });
    }
    return pages;
  }
  for (const row of rows) for (const [p, page] of template.entries()) {
    const objects = [];
    for (const [i, o] of page.objects.entries()) {
      if (!isTextJSON(o)) { objects.push(o); continue; }
      let text = o.text;
      names.forEach((name, c) => { text = text.replace(new RegExp('\\{' + escapeRe(name) + '\\}', 'gi'), row[c] ?? ''); });
      const whole = picks.indexOf(`${p}:${i}`);
      if (whole >= 0) text = row[whole] ?? '';
      objects.push(text === o.text ? o : await refillText(o, text));
    }
    pages.push({ ...page, objects });
  }
  return pages;
}
async function makeBulk() {
  if ($('#bulk-make').disabled) return;
  $('#bulk-make').disabled = true;
  try {
    const pages = await bulkPages(), title = await uniqueTitle(design.title + ' for each name');
    const doc = { format: 2, page: design.page, size: design.size, tile: TILES[design.page] ? 'fill' : design.tile, copies: 1, fonts: designFonts.length ? designFonts : undefined, pages };
    closeBulk();
    await navigateDesign(async () => { await open(doc, title, null); schedule(); });
    $('#create-saved').textContent = bulkFilling() ? `Made ${pages.length} page${pages.length === 1 ? '' : 's'}, every box filled from your list` : `Made ${pages.length} pages, one for each line of your list`;
  } catch (error) {
    $('#bulk-count').textContent = 'Could not make them: ' + error;
    $('#bulk-make').disabled = false;
  }
}

// ---- Saved class lists: a list kept by name in KB Studio/Classes, to pick again for the next thing she makes ----
const classLists = new Map(); // name → { text, headings }
async function loadClasses() {
  classLists.clear();
  for (const { name } of await invoke('list_creations', { kind: 'classes' }).catch(() => [])) {
    try { const c = JSON.parse(await invoke('load_creation', { kind: 'classes', name })); if (c?.format === 1 && typeof c.text === 'string') classLists.set(name, { text: c.text, headings: c.headings !== false }); }
    catch { /* a damaged file is left out */ }
  }
}
const chosenClass = () => $('#bulk-class').value;
const listChanged = () => { const c = classLists.get(chosenClass()); return !c || c.text !== $('#bulk-list').value || c.headings !== $('#bulk-headings').checked; };
function paintClasses() {
  const pick = $('#bulk-class'), keep = pick.value, names = [...classLists.keys()].sort((a, b) => a.localeCompare(b));
  pick.replaceChildren(new Option('A new list', ''), ...names.map(n => new Option(n, n)));
  pick.value = classLists.has(keep) ? keep : '';
  paintClassSave();
}
function paintClassSave() {
  const name = chosenClass(), changed = listChanged(), has = $('#bulk-list').value.trim() !== '', del = $('#bulk-class-delete');
  del.hidden = !name; del.classList.remove('sure'); del.textContent = 'Delete';
  const save = $('#bulk-class-save');
  save.textContent = name ? (changed ? `💾 Save changes to ${name}` : `✓ Saved as ${name}`) : '💾 Save this list';
  save.disabled = !has || (name && !changed);
  if (name && changed) $('#bulk-class-note').textContent = '';
}
function showClass(name) {
  const c = classLists.get(name);
  $('#bulk-class').value = c ? name : '';
  if (c) { $('#bulk-list').value = c.text; $('#bulk-headings').checked = c.headings; }
  settings.lastClass = c ? name : ''; saveSettings();
  $('#bulk-class-name-row').hidden = true; $('#bulk-class-note').textContent = '';
  paintBulk(); paintClassSave();
}
async function saveClass(name) {
  name = name.replace(/[\/\\:*?"<>|]/g, ' ').trim().slice(0, 60);
  if (!name) { $('#bulk-class-note').textContent = 'Give the list a name first.'; return; }
  const c = { text: $('#bulk-list').value, headings: $('#bulk-headings').checked };
  await invoke('save_creation', new TextEncoder().encode(JSON.stringify({ format: 1, ...c })), { headers: { kind: 'classes', name: encodeURIComponent(name) } });
  classLists.set(name, c); paintClasses();
  $('#bulk-class').value = name; settings.lastClass = name; saveSettings();
  $('#bulk-class-name-row').hidden = true;
  paintClassSave();
  $('#bulk-class-note').textContent = `Saved. Pick ${name} here next time.`;
}
$('#bulk-class').onchange = () => showClass(chosenClass());
$('#bulk-class-save').onclick = () => {
  if (chosenClass()) return saveClass(chosenClass()).catch(e => { $('#bulk-class-note').textContent = 'Could not save it: ' + e; });
  $('#bulk-class-name-row').hidden = false; $('#bulk-class-name').value = ''; $('#bulk-class-name').focus();
};
const nameAndSave = () => saveClass($('#bulk-class-name').value).catch(e => { $('#bulk-class-note').textContent = 'Could not save it: ' + e; });
$('#bulk-class-name-ok').onclick = nameAndSave;
$('#bulk-class-name').onkeydown = e => { if (e.key === 'Enter') nameAndSave(); if (e.key === 'Escape') { e.stopPropagation(); $('#bulk-class-name-row').hidden = true; } };
$('#bulk-class-delete').onclick = async () => {
  const del = $('#bulk-class-delete'), name = chosenClass();
  if (!del.classList.contains('sure')) { del.classList.add('sure'); del.textContent = 'Delete this list?'; return; }
  await invoke('delete_creation', { kind: 'classes', name }).catch(e => { $('#bulk-class-note').textContent = 'Could not delete it: ' + e; });
  classLists.delete(name); paintClasses(); showClass('');
  $('#bulk-class-note').textContent = `Deleted ${name}. The names are still here until you close this.`;
};

async function openBulk() {
  if (!board || !design || $('#create').inert || cropSession) return;
  closeMenus();
  board.discardActiveObject(); board.requestRenderAll();
  $('#bulk').hidden = false;
  paintBulk();
  await loadClasses(); paintClasses();
  // The class used last comes back, so a second thing for the same class is one click.
  if (!$('#bulk-list').value.trim() && classLists.has(settings.lastClass)) showClass(settings.lastClass);
  paintBulk(); paintClassSave();
  $('#bulk-list').focus();
}
function closeBulk() { $('#bulk').hidden = true; }
$('#bulk-list').oninput = () => { paintBulk(); paintClassSave(); };
$('#bulk-headings').onchange = () => { paintBulk(); paintClassSave(); };
$('#bulk-make').onclick = () => makeBulk();
$('#bulk-fill').onchange = paintBulkCount;
$('#bulk-cancel').onclick = closeBulk;
$('#bulk').onkeydown = e => { if (e.key === 'Escape') { e.stopPropagation(); closeBulk(); } };
$('#bulk').onclick = e => { if (e.target === $('#bulk')) closeBulk(); };
for (const id of ['#file-bulk', '#text-bulk']) $(id).onclick = () => openBulk().catch(e => { $('#create-saved').textContent = 'Could not open Bulk create: ' + e; });
