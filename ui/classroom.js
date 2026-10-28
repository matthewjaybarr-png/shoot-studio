// My classroom, a drawer in Create for what a teacher uses again and again: her class's details (put on the page with
// one click, and filled into {Teacher}, {School}, {Class}, {Room} and {Year} when a design starts from her template),
// the school logo, her saved lists (class lists, spelling words, classroom jobs: the same files Bulk create keeps in
// KB Studio/Classes) in a table she edits by clicking, and the birthdays coming up from any list with a Birthday
// column. Details and logo live in the Create settings, so backups carry them. Needs create.js and bulk.js.

const CLASS_DETAILS = [['teacher', 'Teacher', 'Teacher', 'Mrs. Brown'], ['school', 'School', 'School', 'Maple Street Elementary'], ['klass', 'Class', 'Class', '2nd Grade'], ['room', 'Room', 'Room', 'Room 12'], ['year', 'School year', 'Year', '2026–27']];
const cleanClassroom = c => Object.fromEntries([...CLASS_DETAILS.map(([key]) => [key, typeof c?.[key] === 'string' ? c[key].slice(0, 120) : '']), ['logo', typeof c?.logo === 'string' && c.logo.startsWith('data:image/') ? c.logo : '']]);
const classroom = () => (settings.classroom = cleanClassroom(settings.classroom));
// {Teacher} and friends in some text, filled from her details (left as they are when a detail is empty).
function fillClassDetails(text) {
  const c = classroom();
  return CLASS_DETAILS.reduce((t, [key, , token]) => c[key] ? t.split(`{${token}}`).join(c[key]) : t, text);
}
// The same through every string inside a saved design or template (its pages' text boxes), before it opens.
const fillClassDoc = doc => typeof doc === 'string' ? fillClassDetails(doc) : Array.isArray(doc) ? doc.map(fillClassDoc) : doc && typeof doc === 'object' ? Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, fillClassDoc(v)])) : doc;

function paintClassroom() {
  const c = classroom(), rows = $('#class-details');
  if (!rows.children.length) rows.append(...CLASS_DETAILS.map(([key, label, , example]) => {
    const row = document.createElement('div'); row.className = 'class-detail';
    const input = Object.assign(document.createElement('input'), { type: 'text', maxLength: 120, placeholder: example, id: 'class-' + key });
    input.setAttribute('aria-label', label);
    input.onchange = () => { classroom()[key] = input.value.trim(); saveSettings(); paintClassroom(); };
    const add = button('+', () => addClassDetail(key, label)); add.title = `Put ${label.toLowerCase()} on the page`; add.setAttribute('aria-label', add.title); add.dataset.detail = key;
    row.append(Object.assign(document.createElement('label'), { htmlFor: input.id, textContent: label }), input, add);
    return row;
  }));
  for (const [key] of CLASS_DETAILS) { const input = $('#class-' + key); if (document.activeElement !== input) input.value = c[key]; $(`#class-details [data-detail=${key}]`).disabled = !c[key]; }
  $('#class-logo-img').hidden = !c.logo; if (c.logo) $('#class-logo-img').src = c.logo;
  $('#class-logo-add').disabled = $('#class-logo-remove').hidden = !c.logo;
  $('#class-logo-pick').textContent = c.logo ? 'Change the logo…' : 'Choose a logo…';
  paintLists().then(paintBirthdays); // the saved lists load from disk the first time
}
function addClassDetail(key, label) {
  const text = classroom()[key];
  if (!text || !board) return;
  place(new fabric.Textbox(text, { fontFamily: settings.fonts[0] || FONTS[0], fill: textColour(), textAlign: 'center', width: 520, fontSize: 40, kbName: label }));
}
// Fill in my details on the design that's open, on every page.
$('#class-fill').onclick = () => {
  if (!board || !design) return;
  let n = 0;
  for (const o of board.getObjects()) if (typeof o.text === 'string') { const t = fillClassDetails(o.text); if (t !== o.text) { o.set({ text: t }); n++; } }
  designPages = designPages.map((p, i) => { if (i === pageAt) return p; const t = fillClassDoc(p); if (JSON.stringify(t) !== JSON.stringify(p)) n++; return t; });
  $('#class-fill-note').textContent = n ? 'Filled in.' : 'Nothing to fill: type {Teacher}, {School}, {Class}, {Room} or {Year} in a text box first.';
  if (n) { board.requestRenderAll(); commitDesign(); }
};

// ---- The school logo: shrunk to 800 px and kept as a picture in the settings ----
$('#class-logo-pick').onclick = () => $('#class-logo-file').click();
$('#class-logo-file').onchange = async e => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  try {
    const img = new Image(); img.src = URL.createObjectURL(file); await img.decode();
    const k = Math.min(1, 800 / Math.max(img.naturalWidth, img.naturalHeight)), canvas = pictureCanvas(Math.round(img.naturalWidth * k), Math.round(img.naturalHeight * k));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height); URL.revokeObjectURL(img.src);
    classroom().logo = canvas.toDataURL('image/png'); saveSettings(); paintClassroom();
  } catch (error) { $('#class-fill-note').textContent = `Couldn't use that picture: ${error.message || error}`; }
};
$('#class-logo-add').onclick = async () => { const logo = classroom().logo; if (logo && board) await addImageBlob(await (await fetch(logo)).blob(), 'School logo'); };
$('#class-logo-remove').onclick = () => { classroom().logo = ''; saveSettings(); paintClassroom(); };

// ---- My lists: a table to click in. Saved in Bulk create's format (tab-separated text, first row the headings) ----
const listEdit = { name: '', typed: '', rows: [['Name']], dirty: false }; // typed: the name for a list not saved yet
const toRows = c => { const rows = c.text.split(/\r?\n/).filter(l => l.trim()).map(l => l.split('\t')); if (!c.headings) rows.unshift(rows[0]?.map((_, i) => i ? `Column ${i + 1}` : 'Name') || ['Name']); return rows.length ? rows : [['Name']]; };
const fromRows = rows => { const w = Math.max(...rows.map(r => r.length)); return rows.filter((r, i) => !i || r.some(v => v.trim())).map(r => Array.from({ length: w }, (_, i) => (r[i] || '').replace(/[\t\n]/g, ' ').trim()).join('\t')).join('\n'); };
async function paintLists() {
  if (!paintLists.loaded) { paintLists.loaded = true; await loadClasses(); }
  const pick = $('#list-pick'), names = [...classLists.keys()].sort((a, b) => a.localeCompare(b));
  pick.replaceChildren(new Option('A new list', ''), ...names.map(n => new Option(n, n)));
  pick.value = classLists.has(listEdit.name) ? listEdit.name : '';
  $('#list-name').value = listEdit.typed; $('#list-name').hidden = !!pick.value;
  const grid = $('#list-grid'), w = Math.max(...listEdit.rows.map(r => r.length));
  grid.replaceChildren(...listEdit.rows.map((r, y) => {
    const tr = document.createElement('tr');
    for (let x = 0; x < w; x++) {
      const cell = document.createElement(y ? 'td' : 'th'), input = Object.assign(document.createElement('input'), { type: 'text', value: r[x] || '', placeholder: y ? '' : x ? 'Column' : 'Name' });
      input.setAttribute('aria-label', y ? `${listEdit.rows[0][x] || 'Column ' + (x + 1)}, row ${y}` : `Heading ${x + 1}`);
      input.oninput = () => { listEdit.rows[y][x] = input.value; listEdit.dirty = true; paintListButtons(); };
      input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); if (y === listEdit.rows.length - 1) $('#list-add-row').click(); else grid.rows[y + 1].cells[x].firstChild.focus(); } };
      cell.append(input); tr.append(cell);
    }
    const del = button('×', () => { if (y) listEdit.rows.splice(y, 1); else if (w > 1) listEdit.rows.forEach(row => row.splice(w - 1, 1)); listEdit.dirty = true; paintLists(); });
    del.title = y ? 'Take this row out' : 'Take the last column out'; del.setAttribute('aria-label', del.title); del.className = 'list-x'; del.disabled = !y && w < 2;
    const end = document.createElement(y ? 'td' : 'th'); end.append(del); tr.append(end);
    return tr;
  }));
  $('#list-count').textContent = `${listEdit.rows.length - 1} ${listEdit.rows.length === 2 ? 'row' : 'rows'}`;
  paintListButtons();
}
function paintListButtons() {
  const saved = classLists.has(listEdit.name), named = !!(saved || listEdit.typed.trim()), has = listEdit.rows.length > 1;
  $('#list-save').disabled = !has || !named || (saved && !listEdit.dirty);
  $('#list-save').textContent = saved ? (listEdit.dirty ? '💾 Save changes' : '✓ Saved') : '💾 Save this list';
  $('#list-delete').hidden = !saved;
  $('#list-bulk').disabled = !has;
}
$('#list-pick').onchange = e => {
  const c = classLists.get(e.target.value);
  Object.assign(listEdit, c ? { name: e.target.value, typed: '', rows: toRows(c), dirty: false } : { name: '', typed: '', rows: [['Name']], dirty: false });
  $('#list-note').textContent = ''; paintLists();
};
$('#list-name').oninput = e => { listEdit.typed = e.target.value; paintListButtons(); };
$('#list-add-row').onclick = () => { listEdit.rows.push(listEdit.rows[0].map(() => '')); listEdit.dirty = true; paintLists().then(() => $('#list-grid').rows[listEdit.rows.length - 1].cells[0].firstChild.focus()); };
$('#list-add-col').onclick = () => { listEdit.rows.forEach((r, i) => r.push(i ? '' : '')); listEdit.dirty = true; paintLists().then(() => { const head = $('#list-grid').rows[0].cells; head[head.length - 2].firstChild.focus(); }); };
$('#list-save').onclick = async () => {
  const name = listEdit.name || listEdit.typed.trim();
  try {
    const c = { text: fromRows(listEdit.rows), headings: true };
    await invoke('save_creation', new TextEncoder().encode(JSON.stringify({ format: 1, ...c })), { headers: { kind: 'classes', name: encodeURIComponent(name) } });
    classLists.set(name, c); Object.assign(listEdit, { name, typed: '', rows: toRows(c), dirty: false });
    $('#list-note').textContent = `Saved. It's in Bulk create's Class list too.`;
  } catch (error) { $('#list-note').textContent = `Couldn't save it: ${error}`; }
  paintLists(); paintBirthdays();
};
$('#list-delete').onclick = async () => {
  const del = $('#list-delete');
  if (!del.classList.contains('sure')) { del.classList.add('sure'); del.textContent = `Really delete ${listEdit.name}?`; return; }
  try { await invoke('delete_creation', { kind: 'classes', name: listEdit.name }); classLists.delete(listEdit.name); $('#list-note').textContent = `Deleted ${listEdit.name}.`; Object.assign(listEdit, { name: '', typed: '', rows: [['Name']], dirty: false }); }
  catch (error) { $('#list-note').textContent = `Couldn't delete it: ${error}`; }
  del.classList.remove('sure'); del.textContent = 'Delete this list'; paintLists(); paintBirthdays();
};
// One of whatever's on the page for each row, through Bulk create.
async function bulkFromRows(rows, name) {
  await openBulk();
  if (name && classLists.has(name) && !listEdit.dirty) return showClass(name);
  $('#bulk-class').value = ''; $('#bulk-list').value = fromRows(rows); $('#bulk-headings').checked = true;
  paintBulk(); paintClassSave();
}
$('#list-bulk').onclick = () => bulkFromRows(listEdit.rows, listEdit.name);

// A birthday card for one child: a new design from the Birthday card starter, their name already on it.
async function birthdayCard(name) {
  await newDesign('Birthday card', 'starter');
  const teacher = classroom().teacher;
  for (const o of board.getObjects()) {
    if (o.kbName === 'Name') o.set({ text: name });
    if (o.kbName === 'From' && teacher) o.set({ text: `From ${teacher}` });
  }
  design.title = $('#create-title').value = await uniqueTitle(`${name}'s birthday card`);
  board.requestRenderAll(); commitDesign();
}

// ---- Birthdays in the next 30 days, from any saved list with a Birthday column ----
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// Month and day from "March 4", "4 March", "3/4" (month first), "2019-03-04" or "3/4/2019"; null when it isn't a date.
function birthday(text) {
  const t = text.trim().toLowerCase();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); if (m) return [+m[2], +m[3]];
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-]\d{2,4})?$/); if (m) return [+m[1], +m[2]];
  m = t.match(/^([a-z]{3})[a-z]*\.? (\d{1,2})(?:st|nd|rd|th)?(?:,? \d{4})?$/); if (m && MONTHS.includes(m[1])) return [MONTHS.indexOf(m[1]) + 1, +m[2]];
  m = t.match(/^(\d{1,2})(?:st|nd|rd|th)? (?:of )?([a-z]{3})[a-z]*(?: \d{4})?$/); if (m && MONTHS.includes(m[2])) return [MONTHS.indexOf(m[2]) + 1, +m[1]];
  return null;
}
function upcomingBirthdays(today = new Date()) {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()), found = [];
  for (const [list, c] of classLists) {
    const rows = toRows(c), col = rows[0].findIndex(h => /birth/i.test(h));
    if (col < 0) continue;
    for (const row of rows.slice(1)) {
      const md = birthday(row[col] || '');
      if (!md || md[0] > 12 || md[1] > 31) continue;
      let next = new Date(start.getFullYear(), md[0] - 1, md[1]);
      if (next < start) next = new Date(start.getFullYear() + 1, md[0] - 1, md[1]);
      const days = Math.round((next - start) / 864e5);
      if (days <= 30) found.push({ name: row[0], list, days, next, row, heads: rows[0] });
    }
  }
  return found.sort((a, b) => a.days - b.days);
}
function paintBirthdays() {
  const soon = upcomingBirthdays(), out = $('#class-birthdays');
  $('#class-birthdays-none').hidden = soon.length > 0;
  out.replaceChildren(...soon.map(b => {
    const li = document.createElement('li'), when = b.days === 0 ? 'today! 🎉' : b.days === 1 ? 'tomorrow' : `${b.next.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} (in ${b.days} days)`;
    li.append(Object.assign(document.createElement('span'), { textContent: `${b.name}: ${when}` }), button('🎂 Make a card', () => birthdayCard(b.name).catch(() => {})));
    return li;
  }));
}
