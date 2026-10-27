// Tables you can change after adding them: rows and columns added or taken away, cell colours, borders, and rows that
// grow to fit their words. A table stays loose cells (a box and its words) so typing in one is a double-click, as before;
// the cells share a kbTable id, and the grid is read back from where the boxes sit. Needs create.js.
KEEP.push('kbTable');
const newTableId = () => 't' + Math.random().toString(36).slice(2, 10);

// The table's grid: the column and row edges, and each cell's box, words, place and span in it.
function readTable(id) {
  const members = board.getObjects().filter(o => o.kbTable === id), rects = members.filter(o => o.type === 'rect');
  for (const r of rects) if (r.scaleX !== 1 || r.scaleY !== 1) r.set({ width: r.width * r.scaleX, height: r.height * r.scaleY, scaleX: 1, scaleY: 1 }); // after the whole table was resized
  const edges = values => values.sort((a, b) => a - b).reduce((out, v) => (!out.length || v - out.at(-1) > 1 ? [...out, v] : out), []);
  const xs = edges(rects.flatMap(r => [r.left, r.left + r.width])), ys = edges(rects.flatMap(r => [r.top, r.top + r.height]));
  const at = (list, v) => list.findIndex(e => Math.abs(e - v) <= 1);
  const texts = new Set(members.filter(o => o.type === 'textbox'));
  const cells = rects.map(rect => {
    const text = [...texts].find(t => t.left >= rect.left - 1 && t.left < rect.left + rect.width && t.top >= rect.top - 1 && t.top < rect.top + rect.height);
    texts.delete(text);
    const c = at(xs, rect.left), r = at(ys, rect.top);
    return { rect, text, r, c, cs: at(xs, rect.left + rect.width) - c, rs: at(ys, rect.top + rect.height) - r,
      dx: text ? text.left - rect.left : 0, dy: text ? text.top - rect.top : 0, dw: text ? rect.width - text.width * (text.scaleX || 1) : 0 };
  });
  return { id, xs, ys, cells, members, turned: members.some(o => o.angle) };
}
const cellAt = (t, r, c) => t.cells.find(k => k.r <= r && r < k.r + k.rs && k.c <= c && c < k.c + k.cs);
// Puts every box and its words where the grid now says.
function writeTable(t) {
  for (const k of t.cells) {
    k.rect.set({ left: t.xs[k.c], top: t.ys[k.r], width: t.xs[k.c + k.cs] - t.xs[k.c], height: t.ys[k.r + k.rs] - t.ys[k.r] }); k.rect.setCoords();
    if (k.text) { k.text.set({ left: k.rect.left + k.dx, top: k.rect.top + k.dy, width: Math.max(1, (k.rect.width - k.dw) / (k.text.scaleX || 1)) }); k.text.initDimensions(); k.text.setCoords(); }
  }
}
// A new cell looks like the one it was copied from, with no words.
function cellLike(t, from, left, top, width, height) {
  const rect = new fabric.Rect({ left, top, width, height, fill: from.rect.fill, stroke: from.rect.stroke, strokeWidth: from.rect.strokeWidth, strokeDashArray: from.rect.strokeDashArray, opacity: from.rect.opacity, kbName: 'Table cell', kbTable: t.id });
  const k = { rect, r: 0, c: 0, rs: 1, cs: 1, dx: from.dx || 6, dy: from.dy || 6, dw: from.text ? from.dw : 12 };
  const style = from.text || t.cells.find(x => x.text)?.text;
  k.text = new fabric.Textbox('', { left: left + k.dx, top: top + k.dy, width: Math.max(1, width - k.dw), minWidth: 1, fontFamily: style?.fontFamily || 'Lexend', fontSize: (style?.fontSize || 20) * (style?.scaleY || 1),
    fontWeight: style?.fontWeight, fontStyle: style?.fontStyle, fill: style?.fill || '#222222', textAlign: style?.textAlign || 'left', lineHeight: style?.lineHeight || 1.16, kbName: 'Cell text', kbTable: t.id });
  return k;
}
// New cells go in just above the rest of the table, so it keeps its place among the layers.
function addCells(t, cells) {
  const index = Math.max(...t.members.map(o => board.getObjects().indexOf(o))) + 1;
  board.insertAt(index, ...cells.flatMap(k => [k.rect, k.text]));
  t.cells.push(...cells); t.members.push(...cells.flatMap(k => [k.rect, k.text]));
}

// ---- Rows (the table grows taller) and columns (the columns share the same width) ----
function insertRow(t, at, like) {
  const h = t.ys[like + 1] - t.ys[like], cols = t.xs.length - 1;
  t.ys = [...t.ys.slice(0, at + 1), t.ys[at] + h, ...t.ys.slice(at + 1).map(v => v + h)];
  for (const k of t.cells) if (k.r >= at) k.r++; else if (k.r + k.rs > at) k.rs++;
  const source = like >= at ? like + 1 : like, made = [];
  for (let c = 0; c < cols; c++) if (!cellAt(t, at, c)) { const k = cellLike(t, cellAt(t, source, c), t.xs[c], t.ys[at], t.xs[c + 1] - t.xs[c], h); k.r = at; k.c = c; made.push(k); }
  addCells(t, made);
}
function insertColumn(t, at, like) {
  const w = t.xs[like + 1] - t.xs[like], rows = t.ys.length - 1, left = t.xs[0], width = t.xs.at(-1) - left;
  t.xs = [...t.xs.slice(0, at + 1), t.xs[at] + w, ...t.xs.slice(at + 1).map(v => v + w)].map(v => left + (v - left) * width / (width + w));
  for (const k of t.cells) if (k.c >= at) k.c++; else if (k.c + k.cs > at) k.cs++;
  const source = like >= at ? like + 1 : like, made = [];
  for (let r = 0; r < rows; r++) if (!cellAt(t, r, at)) { const k = cellLike(t, cellAt(t, r, source), t.xs[at], t.ys[r], t.xs[at + 1] - t.xs[at], t.ys[r + 1] - t.ys[r]); k.r = r; k.c = at; made.push(k); }
  addCells(t, made);
}
function removeLine(t, axis, at) {
  const list = axis === 'r' ? t.ys : t.xs, size = list[at + 1] - list[at], span = axis + 's';
  for (const k of [...t.cells]) {
    if (k[axis] === at && k[span] === 1) { board.remove(k.rect, ...(k.text ? [k.text] : [])); t.cells.splice(t.cells.indexOf(k), 1); }
    else if (k[axis] <= at && at < k[axis] + k[span]) k[span]--;
    else if (k[axis] > at) k[axis]--;
  }
  const next = [...list.slice(0, at + 1), ...list.slice(at + 2).map(v => v - size)];
  if (axis === 'r') t.ys = next;
  else { const left = list[0], width = list.at(-1) - left; t.xs = next.map(v => left + (v - left) * width / (width - size)); }
}

// ---- The Table panel, for the cell that's selected ----
function selectedCell() {
  const o = board?.getActiveObject();
  if (!o?.kbTable || o.type === 'activeselection') return null;
  const t = readTable(o.kbTable), k = t.cells.find(x => x.rect === o || x.text === o);
  return k ? { t, k } : null;
}
function tableEdit(run) {
  const sel = selectedCell();
  if (!sel || sel.t.turned) return;
  run(sel.t, sel.k);
  writeTable(sel.t);
  const keep = sel.t.cells.includes(sel.k) ? sel.k.text || sel.k.rect : sel.t.cells[0]?.rect;
  if (keep) board.setActiveObject(keep); else board.discardActiveObject();
  board.requestRenderAll(); commitDesign(); paintPanel();
}
$('#table-row-above').onclick = () => tableEdit((t, k) => insertRow(t, k.r, k.r));
$('#table-row-below').onclick = () => tableEdit((t, k) => insertRow(t, k.r + k.rs, k.r + k.rs - 1));
$('#table-col-left').onclick = () => tableEdit((t, k) => insertColumn(t, k.c, k.c));
$('#table-col-right').onclick = () => tableEdit((t, k) => insertColumn(t, k.c + k.cs, k.c + k.cs - 1));
$('#table-row-delete').onclick = () => tableEdit((t, k) => t.ys.length > 2 ? removeLine(t, 'r', k.r) : null);
$('#table-col-delete').onclick = () => tableEdit((t, k) => t.xs.length > 2 ? removeLine(t, 'c', k.c) : null);
$('#table-cell-colour').oninput = e => { const sel = selectedCell(); if (sel) { sel.k.rect.set('fill', e.target.value); board.requestRenderAll(); } };
$('#table-cell-clear').onclick = () => { const sel = selectedCell(); if (sel) { sel.k.rect.set('fill', 'transparent'); board.requestRenderAll(); commitDesign(); } };
const allBorders = props => { const sel = selectedCell(); if (!sel) return; for (const k of sel.t.cells) k.rect.set(props); board.requestRenderAll(); };
$('#table-border-colour').oninput = e => allBorders({ stroke: e.target.value });
$('#table-border-width').oninput = e => allBorders({ strokeWidth: Math.max(0, Math.min(20, e.target.valueAsNumber || 0)) });
for (const id of ['#table-cell-colour', '#table-border-colour', '#table-border-width']) $(id).onchange = () => commitDesign();
$('#table-select').onclick = () => { const sel = selectedCell(); if (sel) { closeMenus(); selectObjects(sel.t.members); paintPanel(); } };
$('#table-delete').onclick = () => { const sel = selectedCell(); if (sel) { closeMenus(); board.discardActiveObject(); board.remove(...sel.t.members); board.requestRenderAll(); commitDesign(); paintPanel(); } };
// Called by paintPanel.
function paintTablePanel() {
  const sel = selectedCell();
  if (!sel) return;
  const { t, k } = sel;
  $('#table-cell-colour').value = hex(k.rect.fill) || '#ffffff';
  $('#table-border-colour').value = hex(k.rect.stroke) || '#444444'; $('#table-border-width').value = k.rect.strokeWidth || 0;
  $('#table-size').textContent = `${t.ys.length - 1} rows × ${t.xs.length - 1} columns`;
  $('#table-row-delete').disabled = t.ys.length <= 2; $('#table-col-delete').disabled = t.xs.length <= 2;
  for (const b of $('#pop-table').querySelectorAll('button')) if (t.turned) b.disabled = true;
  $('#table-turned').hidden = !t.turned;
}
// A row grows when its words no longer fit, as Canva's do.
function fitRow(text) {
  if (!text?.kbTable) return;
  const t = readTable(text.kbTable), k = t.cells.find(x => x.text === text);
  if (!k || t.turned) return;
  const need = k.dy * 2 + text.getScaledHeight(), have = t.ys[k.r + k.rs] - t.ys[k.r];
  if (need <= have + 0.5) return;
  const grow = need - have, last = k.r + k.rs;
  t.ys = t.ys.map((v, i) => i >= last ? v + grow : v);
  writeTable(t); board.requestRenderAll();
}
function startTables() {
  board.on('text:changed', ({ target }) => fitRow(target));
  board.on('text:editing:exited', ({ target }) => fitRow(target));
}
