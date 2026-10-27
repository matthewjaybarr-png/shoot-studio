// Charts for Create: column, bar, line, pie and donut, drawn as a group that keeps its numbers in kbChart so it can be
// edited again from the toolbar. Canva charts arrive the same way (canva.js reads their numbers with chartFromXml).
// Needs create.js.
KEEP.push('kbChart');
const CHART_KINDS = [['column', 'Column'], ['bar', 'Bar'], ['line', 'Line'], ['pie', 'Pie'], ['donut', 'Donut']];
const CHART_COLOURS = ['#e8607e', '#9b6bd6', '#5aa6e6', '#f2b636', '#7fb069', '#f08a5d', '#4fb3a9', '#c9a0dc'];
const MAX_ROWS = 20;
const sampleChart = kind => ({ kind, title: '', w: 480, h: 340, values: true, rows: [['Mon', 4], ['Tue', 7], ['Wed', 5], ['Thu', 9], ['Fri', 6]].map(([l, v], i) => [l, v, CHART_COLOURS[i % CHART_COLOURS.length]]) });

// Anything read from a file or the panel becomes a chart that can be drawn.
function cleanChart(c) {
  const kind = CHART_KINDS.some(([k]) => k === c?.kind) ? c.kind : 'column';
  const rows = (Array.isArray(c?.rows) ? c.rows : []).slice(0, MAX_ROWS).map((r, i) => [String(r?.[0] ?? '').slice(0, 40), Number.isFinite(+r?.[1]) ? Math.max(0, +r[1]) : 0, hex(r?.[2]) || CHART_COLOURS[i % CHART_COLOURS.length]]);
  return { kind, title: String(c?.title ?? '').slice(0, 80), w: Math.min(4000, Math.max(120, +c?.w || 480)), h: Math.min(4000, Math.max(90, +c?.h || 340)), values: c?.values !== false, rows: rows.length ? rows : sampleChart(kind).rows };
}
// A round number at or above the largest value, for the top of the scale.
function niceMax(v) {
  if (!(v > 0)) return 1;
  const step = 10 ** Math.floor(Math.log10(v)), f = v / step;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * step;
}
const label = (n) => Math.abs(n) >= 1000 ? (n / 1000).toFixed(n % 1000 ? 1 : 0) + 'k' : String(Math.round(n * 100) / 100);
const INK_CHART = '#3d3a40', GRID = '#e3dde6';

// The chart as Fabric objects inside a w × h box at 0, 0.
function chartParts(c) {
  const { w, h } = c, fs = Math.max(10, Math.min(28, Math.min(w, h * 1.4) / 20)), pad = fs * 0.6, out = [];
  const text = (t, x, y, o = {}) => new fabric.FabricText(String(t), { left: x, top: y, fontSize: fs, fontFamily: 'Lexend', fill: INK_CHART, originX: 'center', originY: 'center', ...o });
  out.push(new fabric.Rect({ left: 0, top: 0, width: w, height: h, fill: 'rgba(255,255,255,0)', stroke: null, strokeWidth: 0, kbName: 'Chart area' }));
  let top = pad;
  if (c.title) { out.push(text(c.title, w / 2, pad + fs * 0.7, { fontSize: fs * 1.25, fontWeight: 'bold' })); top += fs * 1.8; }
  const rows = c.rows, max = niceMax(Math.max(...rows.map(r => r[1])));
  const short = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;
  if (c.kind === 'pie' || c.kind === 'donut') {
    const total = rows.reduce((a, r) => a + r[1], 0) || 1, side = w > h * 1.15;
    const legendW = side ? Math.min(w * 0.42, fs * 0.62 * Math.max(...rows.map(r => r[0].length)) + fs * 2.2) : 0, legendH = side ? 0 : Math.ceil(rows.length / 2) * fs * 1.5;
    const r = Math.max(10, Math.min((w - legendW - pad * 3) / 2, (h - top - legendH - pad * 2) / 2)), cx = side ? pad + r : w / 2, cy = top + r + pad / 2, inner = c.kind === 'donut' ? r * 0.56 : 0;
    let a = -Math.PI / 2;
    for (const [name, v, colour] of rows) {
      const span = v / total * Math.PI * 2;
      if (span <= 0) continue;
      const a1 = a + Math.min(span, Math.PI * 2 - 1e-4), big = span > Math.PI ? 1 : 0, pt = (rr, t) => `${cx + rr * Math.cos(t)} ${cy + rr * Math.sin(t)}`;
      const d = inner ? `M${pt(r, a)} A${r} ${r} 0 ${big} 1 ${pt(r, a1)} L${pt(inner, a1)} A${inner} ${inner} 0 ${big} 0 ${pt(inner, a)}Z` : `M${cx} ${cy} L${pt(r, a)} A${r} ${r} 0 ${big} 1 ${pt(r, a1)}Z`;
      out.push(new fabric.Path(d, { fill: colour, stroke: '#ffffff', strokeWidth: Math.max(1, fs / 8), kbName: name || 'Slice' }));
      if (c.values && span > 0.35) { const mid = a + span / 2, rr = inner ? (r + inner) / 2 : r * 0.62; out.push(text(Math.round(v / total * 100) + '%', cx + rr * Math.cos(mid), cy + rr * Math.sin(mid), { fill: '#ffffff', fontWeight: 'bold', fontSize: fs * 0.9 })); }
      a += span;
    }
    rows.forEach(([name, , colour], i) => {
      const x = side ? cx + r + pad * 2 : pad + (i % 2) * (w - pad * 2) / 2, y = side ? cy - rows.length * fs * 0.75 + i * fs * 1.5 + fs * 0.75 : cy + r + pad + Math.floor(i / 2) * fs * 1.5 + fs * 0.6;
      out.push(new fabric.Rect({ left: x, top: y - fs * 0.4, width: fs * 0.8, height: fs * 0.8, rx: fs * 0.15, ry: fs * 0.15, fill: colour, strokeWidth: 0 }));
      out.push(text(short(name, 22), x + fs * 1.2, y, { originX: 'left', fontSize: fs * 0.85 }));
    });
    return out;
  }
  const horizontal = c.kind === 'bar';
  const labelW = horizontal ? Math.min(w * 0.32, fs * 0.55 * Math.max(...rows.map(r => r[0].length)) + pad) : fs * 0.6 * label(max).length + pad;
  const plot = { x: pad + labelW, y: top + (horizontal ? 0 : fs), w: w - pad * 2 - labelW - (horizontal && c.values ? fs * 2 : 0), h: h - top - pad - (horizontal ? fs * 1.6 : fs * 1.8) - (horizontal ? 0 : fs) };
  for (let i = 0; i <= 4; i++) { // the scale: four steps from 0 to the top
    const v = max * i / 4;
    if (horizontal) { const x = plot.x + plot.w * i / 4; out.push(new fabric.Line([x, plot.y, x, plot.y + plot.h], { stroke: GRID, strokeWidth: 1 }), text(label(v), x, plot.y + plot.h + fs * 0.9, { fontSize: fs * 0.8, fill: '#8a8290' })); }
    else { const y = plot.y + plot.h - plot.h * i / 4; out.push(new fabric.Line([plot.x, y, plot.x + plot.w, y], { stroke: GRID, strokeWidth: 1 }), text(label(v), plot.x - pad * 0.6, y, { originX: 'right', fontSize: fs * 0.8, fill: '#8a8290' })); }
  }
  const slot = (horizontal ? plot.h : plot.w) / rows.length;
  if (c.kind === 'line') {
    const pts = rows.map(([, v], i) => ({ x: plot.x + slot * (i + 0.5), y: plot.y + plot.h - plot.h * v / max }));
    out.push(new fabric.Polyline(pts, { fill: '', stroke: rows[0][2], strokeWidth: Math.max(2, fs / 5), strokeLineJoin: 'round', strokeLineCap: 'round', kbName: 'Line' }));
    pts.forEach((p, i) => {
      out.push(new fabric.Circle({ left: p.x, top: p.y, radius: Math.max(3, fs / 4), originX: 'center', originY: 'center', fill: '#ffffff', stroke: rows[0][2], strokeWidth: Math.max(2, fs / 6) }));
      if (c.values) out.push(text(label(rows[i][1]), p.x, p.y - fs * 0.9, { fontSize: fs * 0.8 }));
    });
  }
  rows.forEach(([name, v, colour], i) => {
    if (horizontal) {
      const y = plot.y + slot * i, len = plot.w * v / max, thick = slot * 0.62;
      if (len > 0) out.push(new fabric.Rect({ left: plot.x, top: y + (slot - thick) / 2, width: len, height: thick, rx: Math.min(6, thick / 4), ry: Math.min(6, thick / 4), fill: colour, strokeWidth: 0, kbName: name || 'Bar' }));
      out.push(text(short(name, 24), plot.x - pad * 0.6, y + slot / 2, { originX: 'right', fontSize: fs * 0.85 }));
      if (c.values) out.push(text(label(v), plot.x + len + pad * 0.5, y + slot / 2, { originX: 'left', fontSize: fs * 0.85, fontWeight: 'bold' }));
    } else {
      const x = plot.x + slot * i;
      if (c.kind === 'column') {
        const tall = plot.h * v / max, thick = slot * 0.62;
        if (tall > 0) out.push(new fabric.Rect({ left: x + (slot - thick) / 2, top: plot.y + plot.h - tall, width: thick, height: tall, rx: Math.min(6, thick / 4), ry: Math.min(6, thick / 4), fill: colour, strokeWidth: 0, kbName: name || 'Column' }));
        if (c.values) out.push(text(label(v), x + slot / 2, plot.y + plot.h - tall - fs * 0.7, { fontSize: fs * 0.85, fontWeight: 'bold' }));
      }
      out.push(text(short(name, Math.max(3, Math.floor(slot / (fs * 0.55)))), x + slot / 2, plot.y + plot.h + fs * 0.9, { fontSize: fs * 0.85 }));
    }
  });
  out.push(horizontal ? new fabric.Line([plot.x, plot.y, plot.x, plot.y + plot.h], { stroke: '#b8b0bd', strokeWidth: 1.5 }) : new fabric.Line([plot.x, plot.y + plot.h, plot.x + plot.w, plot.y + plot.h], { stroke: '#b8b0bd', strokeWidth: 1.5 }));
  return out;
}
function makeChart(spec) {
  const c = cleanChart(spec), g = new fabric.Group(chartParts(c), { kbName: (CHART_KINDS.find(([k]) => k === c.kind)[1]) + ' chart', subTargetCheck: false });
  g.kbChart = c;
  return g;
}
function addChart(kind, at) {
  if (!board) return null;
  const g = makeChart(sampleChart(kind));
  place(g, at);
  return g;
}
// A changed chart is drawn again in the same place, size, turn and layer.
function redrawChart(old, spec) {
  const g = makeChart(spec), centre = old.getCenterPoint(), index = board.getObjects().indexOf(old);
  g.set({ scaleX: old.scaleX * old.width / g.width, scaleY: old.scaleY * old.height / g.height, angle: old.angle, flipX: old.flipX, flipY: old.flipY, opacity: old.opacity, shadow: old.shadow, visible: old.visible });
  g.setPositionByOrigin(centre, 'center', 'center'); g.setCoords();
  board.remove(old); board.insertAt(Math.max(0, index), g);
  board.setActiveObject(g); board.requestRenderAll();
  return g;
}

// ---- The Edit chart panel: kind, title, and a row per value ----
let chartShown = '';
function paintChartPanel(o) {
  if (!o?.kbChart) return;
  const c = cleanChart(o.kbChart), key = JSON.stringify(c);
  if (key === chartShown) return; // the panel already shows this (it's what she just typed)
  chartShown = key;
  $('#chart-kind').value = c.kind; $('#chart-title').value = c.title; $('#chart-values').checked = c.values;
  $('#chart-rows').replaceChildren(...c.rows.map(([name, v, colour], i) => {
    const row = document.createElement('div'); row.className = 'chart-row';
    row.innerHTML = '<input type="color" aria-label="Colour"><input type="text" maxlength="40" aria-label="Label"><input type="number" min="0" step="any" aria-label="Value"><button type="button" title="Remove this row" aria-label="Remove">×</button>';
    const [col, lab, val, del] = row.children;
    col.value = colour; lab.value = name; val.value = v;
    del.onclick = () => editChart(s => { s.rows.splice(i, 1); }, true);
    return row;
  }));
  $('#chart-add').disabled = c.rows.length >= MAX_ROWS;
}
// Reads the panel into the chart (or applies `edit`), draws it again, and saves when `commit` is true.
function editChart(edit, commit) {
  const o = board.getActiveObject();
  if (!o?.kbChart) return;
  const spec = cleanChart(o.kbChart);
  spec.kind = $('#chart-kind').value; spec.title = $('#chart-title').value; spec.values = $('#chart-values').checked;
  spec.rows = [...$('#chart-rows').children].map(row => { const [col, lab, val] = row.children; return [lab.value, val.valueAsNumber || 0, col.value]; });
  if (edit) edit(spec);
  const clean = cleanChart(spec);
  if (!edit) chartShown = JSON.stringify(clean); // keep the panel (and the box being typed in) as it is
  redrawChart(o, clean);
  if (commit) commitDesign();
  paintPanel();
}
$('#pop-chart').addEventListener('input', e => { if (e.target.closest('.chart-row, #chart-title')) editChart(null, false); });
$('#pop-chart').addEventListener('change', e => { if (e.target.closest('.chart-row, #chart-title, #chart-kind, #chart-values')) editChart(null, true); });
$('#chart-add').onclick = () => editChart(s => { s.rows.push(['New', 1, CHART_COLOURS[s.rows.length % CHART_COLOURS.length]]); }, true);

// ---- Elements: one tile per kind ----
const CHART_TILES = {
  column: '<rect x="6" y="16" width="6" height="12" rx="1"/><rect x="15" y="8" width="6" height="20" rx="1"/><rect x="24" y="12" width="6" height="16" rx="1"/><path d="M3 29 H37" fill="none"/>',
  bar: '<rect x="6" y="4" width="22" height="6" rx="1"/><rect x="6" y="13" width="30" height="6" rx="1"/><rect x="6" y="22" width="14" height="6" rx="1"/><path d="M5 2 V30" fill="none"/>',
  line: '<path d="M4 26 L13 16 L22 20 L34 6" fill="none"/><circle cx="13" cy="16" r="2"/><circle cx="22" cy="20" r="2"/><circle cx="34" cy="6" r="2"/>',
  pie: '<path d="M20 4 A12 12 0 1 1 8.6 20.6 L20 16Z"/><path d="M18 2 L18 14 L7 18 A12 12 0 0 1 18 2Z" opacity=".5"/>',
  donut: '<path d="M20 4 A12 12 0 1 1 8 16 L14 16 A6 6 0 1 0 20 10Z"/><path d="M19 3 L19 9 A6 6 0 0 0 13 15 L7 15 A12 12 0 0 1 19 3Z" opacity=".5"/>'
};
$('#create-charts').replaceChildren(...CHART_KINDS.map(([kind, name]) => {
  const b = button('', () => addChart(kind)); b.id = 'add-chart-' + kind; b.title = name + ' chart'; draggable(b, ['chart', kind]);
  b.innerHTML = `<svg viewBox="0 0 40 32" class="chart-tile">${CHART_TILES[kind]}</svg>`; b.append(name);
  return b;
}));

// ---- Charts in a Canva (PowerPoint) file: the numbers it keeps beside the chart ----
// Only the first series comes across; a chart with more says so in the import note.
function chartFromXml(root, theme, box) {
  const plot = kid(root, 'chart', 'plotArea');
  const type = KIDS(plot).find(e => /Chart$/.test(e.localName));
  if (!type) return null;
  const kind = { pieChart: 'pie', pie3DChart: 'pie', doughnutChart: 'donut', lineChart: 'line', line3DChart: 'line', areaChart: 'line' }[type.localName]
    || (kid(type, 'barDir')?.getAttribute('val') === 'bar' ? 'bar' : 'column');
  const series = KIDS(type).filter(e => e.localName === 'ser');
  if (!series.length) return null;
  const ser = series[0], points = el => { const cache = el && (kid(el, 'strRef', 'strCache') || kid(el, 'numRef', 'numCache') || kid(el, 'strLit') || kid(el, 'numLit')); const out = []; for (const p of KIDS(cache)) if (p.localName === 'pt') out[num(p, 'idx')] = kid(p, 'v')?.textContent ?? ''; return out; };
  const names = points(kid(ser, 'cat')), values = points(kid(ser, 'val'));
  const serFill = fillOf(kid(ser, 'spPr'), theme)?.fill, pointFill = new Map(KIDS(ser).filter(e => e.localName === 'dPt').map(d => [num(kid(d, 'idx'), 'val'), fillOf(kid(d, 'spPr'), theme)?.fill]));
  const varied = kind === 'pie' || kind === 'donut' || kid(type, 'varyColors')?.getAttribute('val') === '1';
  const rows = values.map((v, i) => [names[i] ?? String(i + 1), +v || 0, (typeof pointFill.get(i) === 'string' && pointFill.get(i)) || (!varied && typeof serFill === 'string' && serFill) || CHART_COLOURS[i % CHART_COLOURS.length]]).filter(Boolean);
  const title = [...(kid(root, 'chart', 'title')?.getElementsByTagNameNS('*', 't') || [])].map(t => t.textContent).join('');
  return { chart: cleanChart({ kind, title, rows, w: box.w, h: box.h, values: true }), more: series.length > 1 };
}
