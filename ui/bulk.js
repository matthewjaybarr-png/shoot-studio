// Bulk create: one copy of the design for each line of a list, so a class list makes name tags, desk plates or
// certificates. It makes a new design with a page per line (every page of the design, per line). Each column of the
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
  const { names, rows } = bulkList(), texts = bulkTexts(), pages = rows.length * allPages().length;
  const used = names.some((name, c) => $('#bulk-field-' + c)?.value || hasToken(name, texts));
  const make = $('#bulk-make');
  make.disabled = !rows.length || !used || pages > MAX_PAGES;
  make.textContent = rows.length ? `Make ${pages} page${pages === 1 ? '' : 's'}` : 'Make the pages';
  $('#bulk-count').textContent = !rows.length ? 'Type or paste your list above, one name per line.'
    : pages > MAX_PAGES ? `That makes ${pages} pages; ${MAX_PAGES} is the most one design holds. Split the list in two.`
      : !used ? 'Choose the text box each column goes into, or type {Name} in a text box.'
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
  const pages = [];
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
    $('#create-saved').textContent = `Made ${pages.length} pages, one for each line of your list`;
  } catch (error) {
    $('#bulk-count').textContent = 'Could not make them: ' + error;
    $('#bulk-make').disabled = false;
  }
}

function openBulk() {
  if (!board || !design || $('#create').inert || cropSession) return;
  closeMenus();
  board.discardActiveObject(); board.requestRenderAll();
  $('#bulk').hidden = false;
  paintBulk();
  $('#bulk-list').focus();
}
function closeBulk() { $('#bulk').hidden = true; }
$('#bulk-list').oninput = paintBulk;
$('#bulk-headings').onchange = paintBulk;
$('#bulk-make').onclick = () => makeBulk();
$('#bulk-cancel').onclick = closeBulk;
$('#bulk').onkeydown = e => { if (e.key === 'Escape') { e.stopPropagation(); closeBulk(); } };
$('#bulk').onclick = e => { if (e.target === $('#bulk')) closeBulk(); };
for (const id of ['#file-bulk', '#text-bulk']) $(id).onclick = openBulk;
