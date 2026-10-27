// Links (clickable in the downloaded PDF) and Find and replace across every page. Needs create.js.
KEEP.push('kbLink');

// ---- Links: any text, picture or shape can open a web page or an email from the PDF ----
// What she types becomes a link: "www.school.org" gets https://, an email address gets mailto:. Anything else is refused.
function cleanLink(text) {
  const t = text.trim();
  if (!t) return '';
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(t) || /^https?:\/\/[^\s]+\.[^\s]+$/i.test(t)) return t;
  if (/^[^\s@/]+@[^\s@]+\.[^\s@]+$/.test(t)) return 'mailto:' + t;
  if (/^[^\s/:]+\.[^\s]{2,}$/.test(t)) return 'https://' + t;
  return null;
}
function paintLink(o) {
  if (!o || o.type === 'activeselection') return;
  $('#link-url').value = o.kbLink || ''; $('#link-note').textContent = '';
  $('#link-open').classList.toggle('on', !!o.kbLink);
  $('#link-open').textContent = o.kbLink ? '🔗 Linked' : '🔗 Link';
  $('#link-remove').disabled = !o.kbLink;
}
$('#link-form').onsubmit = e => {
  e.preventDefault();
  const url = cleanLink($('#link-url').value), o = board.getActiveObject();
  if (!o) return;
  if (url === null) { $('#link-note').textContent = 'That doesn\'t look like a web address or an email. Try www.example.com.'; return; }
  o.kbLink = url || undefined; commitDesign(); paintPanel();
  $('#link-note').textContent = url ? 'Linked. It opens from the downloaded PDF.' : '';
};
$('#link-remove').onclick = () => { const o = board.getActiveObject(); if (o) { o.kbLink = undefined; commitDesign(); paintPanel(); } };
// Where each linked thing sits on a page, in page pixels, for the PDF.
async function linksOf(page) {
  if (!JSON.stringify(page.objects || []).includes('"kbLink"')) return [];
  const [w, h] = pagePx(), sc = new fabric.StaticCanvas(document.createElement('canvas'), { width: w, height: h });
  try {
    await sc.loadFromJSON(page);
    return sc.getObjects().filter(o => o.kbLink).map(o => { const r = o.getBoundingRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, url: o.kbLink }; });
  } finally { sc.dispose(); }
}

// ---- Find and replace, in every text box on every page ----
const findState = { hits: [], at: -1 };
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const findRe = () => { const q = $('#find-text').value; return q ? new RegExp(escapeRe(q), $('#find-case').checked ? 'g' : 'gi') : null; };
// Every text box's words on a page, groups included, in drawing order.
function pageTexts(page) {
  const out = [], walk = (list, path) => (list || []).forEach((o, i) => {
    if (/^(i?text|textbox)$/i.test(o.type) && typeof o.text === 'string') out.push({ path: [...path, i], text: o.text });
    if (o.objects) walk(o.objects, [...path, i]);
  });
  walk(page.objects, []);
  return out;
}
// Every match: which page, which text box (by its place in the page) and where in its words.
function findAll() {
  const re = findRe(), hits = [];
  if (re) allPages().forEach((page, p) => pageTexts(page).forEach(({ path, text }) => { for (const m of text.matchAll(re)) hits.push({ p, path, start: m.index, end: m.index + m[0].length }); }));
  findState.hits = hits; findState.at = Math.min(findState.at, hits.length - 1);
  const pages = new Set(hits.map(h => h.p)).size;
  $('#find-count').textContent = !re ? '' : hits.length ? `${hits.length} found${designPages.length > 1 ? ` on ${pages} page${pages === 1 ? '' : 's'}` : ''}` : 'Not found';
  for (const id of ['#find-next', '#find-prev', '#find-replace-one', '#find-replace-all']) $(id).disabled = !hits.length;
  return hits;
}
const objectAt = path => path.reduce((list, i, n) => n === path.length - 1 ? list[i] : list[i].getObjects(), board.getObjects());
// Shows a match: its page, its text box selected and the words highlighted.
async function showHit(i) {
  const hits = findState.hits;
  if (!hits.length) return;
  findState.at = (i + hits.length) % hits.length;
  const hit = hits[findState.at];
  if (hit.p !== pageAt) await showPage(hit.p);
  const o = objectAt(hit.path);
  if (!o) return;
  const top = o.group ? o.group : o; // a text inside a group is shown by selecting the group
  board.setActiveObject(top);
  if (top === o && o.enterEditing) { o.enterEditing(); o.selectionStart = hit.start; o.selectionEnd = hit.end; o.hiddenTextarea?.blur(); }
  board.requestRenderAll(); paintPanel();
  $('#find-count').textContent = `${findState.at + 1} of ${hits.length}`;
}
// Replaces one match in a text box on this page, keeping the styles of the words around it.
function replaceIn(o, start, end, words) {
  if (o.isEditing) o.exitEditing();
  o.removeChars(start, end);
  if (words) o.insertChars(words, null, start);
  if (o.kbCaps != null) o.kbCaps = o.text; // capitals stay on for what's there now
  o.initDimensions(); o.setCoords(); o.dirty = true;
}
async function replaceOne() {
  const hit = findState.hits[findState.at] || findState.hits[0];
  if (!hit) return;
  if (hit.p !== pageAt) await showPage(hit.p);
  const o = objectAt(hit.path);
  if (o) { replaceIn(o, hit.start, hit.end, $('#find-with').value); o.group?.setDirty?.(true); }
  board.requestRenderAll(); commitDesign();
  findAll(); if (findState.hits.length) await showHit(Math.max(0, findState.at));
}
async function replaceAll() {
  const words = $('#find-with').value, done = findAll().length, back = pageAt;
  for (const p of [...new Set(findState.hits.map(h => h.p))]) {
    if (p !== pageAt) await showPage(p);
    // Last match first, so the places of the earlier ones in the same words stay right.
    for (const hit of findState.hits.filter(h => h.p === p).reverse()) { const o = objectAt(hit.path); if (o) replaceIn(o, hit.start, hit.end, words); }
    board.requestRenderAll(); commitDesign();
  }
  if (pageAt !== back) await showPage(back);
  findAll();
  $('#find-count').textContent = done ? `Replaced ${done}` : 'Not found';
}
$('#find-text').oninput = $('#find-case').onchange = () => { findState.at = -1; findAll(); };
$('#find-next').onclick = () => showHit(findState.at + 1);
$('#find-prev').onclick = () => showHit(findState.at - 1);
$('#find-replace-one').onclick = () => replaceOne();
$('#find-replace-all').onclick = () => replaceAll();
$('#find-form').onsubmit = e => { e.preventDefault(); showHit(findState.at + 1); };
$('#file-find').onclick = () => { togglePop($('#file-find')); $('#find-text').focus(); $('#find-text').select(); findAll(); };
document.addEventListener('keydown', e => {
  if (mode !== 'create' || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'f' || $('#create').inert) return;
  e.preventDefault(); if (openPop?.el !== $('#pop-find')) $('#file-find').click(); else $('#find-text').focus();
});
