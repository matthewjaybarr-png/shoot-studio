// Photos for the mouse: a view switcher, a bar for rating and Develop's everyday actions, arrows over the photo,
// a filmstrip, and Develop's settings split into drawers behind a rail, like Create. Every key in app.js has a
// button here too. Needs app.js and develop.js.
let railSection = 'adjust';
const forView = el => (el.dataset.for || '').split(' ').includes(view);
// Buttons keep the keyboard on the photos: a click doesn't move focus to them.
for (const b of document.querySelectorAll('#views button, #photo-bar button, .photo-nav, #develop-rail button')) b.addEventListener('mousedown', e => e.preventDefault());

function setView(next) {
  if (!dir || opening || updating || !visible.length) return;
  if (next === 'compare' && view !== 'compare') { anchor = visible[cursor]; view = 'compare'; move(cursor + 1); return; }
  view = next; showViewer();
}
for (const b of document.querySelectorAll('#views button')) b.onclick = () => setView(b.dataset.view);

// ---- The bar: flags and stars, then Develop's before, undo, zoom, and copy and paste ----
const rateWith = b => b.dataset.flag !== undefined ? rate({ flag: b.dataset.flag || null })
  : rate({ stars: rating(visible[cursor]).stars === +b.dataset.stars ? null : +b.dataset.stars }); // the same star again clears
for (const b of document.querySelectorAll('#photo-bar [data-flag], #photo-bar [data-stars]')) b.onclick = () => rateWith(b);
const holdBefore = $('#pb-before');
holdBefore.onpointerdown = e => { if (!editing?.ready) return; try { holdBefore.setPointerCapture(e.pointerId); } catch {} before = true; holdBefore.classList.add('on'); draw(); };
holdBefore.onpointerup = holdBefore.onpointercancel = () => { holdBefore.classList.remove('on'); endBefore(); };
$('#pb-undo').onclick = () => undo(false);
$('#pb-redo').onclick = () => undo(true);
// The zoom buttons zoom on the middle of the photo, not where the pointer last was over it.
const zoomButton = by => () => { pointer = null; zoomKey(by); };
$('#pb-fit').onclick = zoomButton(null);
$('#pb-100').onclick = zoomButton(1);
$('#pb-out').onclick = zoomButton(1 / 1.25);
$('#pb-in').onclick = zoomButton(1.25);
$('#pb-copy').onclick = () => copySettings();
$('#pb-paste').onclick = () => pasteSettings();
$('#pb-all').onclick = () => { if (selected.size === visible.length) selected.clear(); else for (const p of visible) selected.add(p.id); paintSelection(); };

let barView = null;
function paintPhotoBar() {
  // Coming back to Develop, a crop or brush drawer left open from last time goes back to Adjust.
  if (view === 'develop' && barView !== 'develop' && !cropping && !tool && (railSection === 'crop' || railSection === 'retouch')) railSection = 'adjust';
  barView = view;
  const photo = visible[cursor], r = photo ? rating(photo) : {}, open = !!dir && !!photo;
  for (const b of document.querySelectorAll('#views button')) { b.classList.toggle('on', b.dataset.view === view); b.disabled = !open; }
  for (const el of document.querySelectorAll('#photo-bar [data-for]')) el.hidden = !forView(el);
  $('#photo-bar').hidden = !dir;
  for (const b of document.querySelectorAll('#photo-bar [data-flag]')) { b.classList.toggle('on', open && (r.flag || '') === b.dataset.flag && !!b.dataset.flag); b.disabled = !open; }
  for (const b of document.querySelectorAll('#photo-bar [data-stars]')) { b.classList.toggle('on', open && (r.stars || 0) >= +b.dataset.stars); b.disabled = !open; }
  $('#pb-undo').disabled = !!cropping || !editing?.history?.length; $('#pb-redo').disabled = !!cropping || !editing?.future?.length;
  for (const id of ['#pb-before', '#pb-fit', '#pb-100', '#pb-out', '#pb-in']) $(id).disabled = !editing?.ready;
  $('#pb-copy').disabled = !open;
  $('#pb-paste').disabled = !open || !clipboard;
  $('#pb-paste').textContent = view === 'grid' && selected.size > 1 ? `Paste settings onto ${selected.size}` : 'Paste settings';
  $('#pb-all').textContent = visible.length && selected.size === visible.length ? 'Select none' : 'Select all';
  for (const b of document.querySelectorAll('.photo-nav')) b.disabled = !photo || (b.classList.contains('prev') ? cursor <= 0 : cursor >= visible.length - 1);
  paintRail(); paintStrip();
}

// ---- Arrows over the photo (in Compare they change the right-hand photo) ----
for (const b of document.querySelectorAll('.photo-nav')) b.onclick = () => move(cursor + (b.classList.contains('prev') ? -1 : 1));

// ---- Filmstrip: every photo in the filter, under the photo, Develop and Compare ----
let stripShown = '';
const stripThumbs = new IntersectionObserver(entries => {
  for (const entry of entries) {
    const photo = visible.find(p => p.id === entry.target.dataset.id);
    if (!photo || thumbs.has(photo.id) || !entry.isIntersecting) continue;
    if (!wanted.includes(photo)) wanted.push(photo);
  }
  pump();
}, { root: $('#filmstrip'), rootMargin: '0px 400px' });
function paintStrip() {
  const strip = $('#filmstrip');
  strip.hidden = !dir || view === 'grid' || !visible.length;
  if (strip.hidden) return;
  const key = dir + '\n' + visible.map(p => p.id).join();
  if (key !== stripShown) {
    stripShown = key; stripThumbs.disconnect();
    strip.replaceChildren(...visible.map((photo, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.id = photo.id; b.dataset.i = i; b.title = photo.id;
      b.innerHTML = '<img alt="" draggable="false">';
      if (thumbs.has(photo.id)) b.firstChild.src = thumbs.get(photo.id);
      b.onmousedown = e => e.preventDefault();
      b.onclick = () => move(i);
      stripThumbs.observe(b);
      return b;
    }));
  }
  for (const b of strip.children) {
    const photo = visible[b.dataset.i], r = rating(photo);
    b.className = (+b.dataset.i === cursor ? 'current ' : '') + (photo === anchor && view === 'compare' ? 'anchor ' : '') + (r.flag || '');
  }
  strip.children[cursor]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// ---- Develop's drawers: the settings panel shows one section at a time, chosen on the rail ----
const SECTION_OF = { Presets: 'looks', Look: 'looks', 'Split toning': 'looks', 'White balance': 'adjust', Light: 'adjust', Colour: 'adjust', Detail: 'adjust', Finishing: 'adjust', Crop: 'crop', Retouch: 'retouch' };
{
  let section = 'adjust';
  for (const el of sliders.children) {
    if (el.tagName === 'H3') section = SECTION_OF[el.textContent] || section;
    el.dataset.section = el.id === 'reset' ? 'all' : section;
  }
  // Looks as pictures of this photo, above the list, as in Create's filters.
  [...sliders.querySelectorAll('h3')].find(e => e.textContent === 'Look').insertAdjacentHTML('afterend', '<div id="look-tiles" data-section="looks"></div>');
}
for (const b of document.querySelectorAll('#develop-rail button')) b.onclick = () => {
  if (cropping && b.dataset.section !== 'crop') endCrop(true);
  if (tool && b.dataset.section !== 'retouch') pickTool(null);
  railSection = b.dataset.section; paintRail();
};
function paintRail() {
  if (cropping) railSection = 'crop'; else if (tool) railSection = 'retouch'; // R and the brush keys open their drawer
  sliders.dataset.section = railSection;
  for (const b of document.querySelectorAll('#develop-rail button')) b.classList.toggle('on', b.dataset.section === railSection);
  if (railSection === 'looks') paintLookTiles();
}
// One small GPU render per look, made when the Looks drawer opens and kept until the photo or its settings change.
let lookTilesKey = '', lookTilesJob = 0;
function paintLookTiles() {
  const box = $('#look-tiles');
  if (!editing?.ready || view !== 'develop') { box.replaceChildren(); lookTilesKey = ''; return; }
  const base = { ...editing.recipe, look: '', lookAmount: 100 };
  const key = editing.photo.id + JSON.stringify(base) + JSON.stringify(developer.crop) + developer.revision;
  for (const t of box.children) t.classList.toggle('on', (editing.recipe.look || '') === t.dataset.look);
  if (key === lookTilesKey) return;
  lookTilesKey = key;
  const job = ++lookTilesJob, e = editing;
  box.replaceChildren(...[{ id: '', name: 'None' }, ...LOOKS].map(l => {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.look = l.id; b.title = l.name;
    b.innerHTML = '<canvas width="1" height="1"></canvas>'; b.append(l.name);
    b.classList.toggle('on', (editing.recipe.look || '') === l.id);
    b.onmousedown = ev => ev.preventDefault();
    b.onclick = () => { $('#look').value = l.id; $('#look').onchange(); paintLookTiles(); };
    return b;
  }));
  // A few at a time, so the drawer opens at once and the photo stays responsive.
  const tiles = [...box.children];
  const next = () => {
    if (job !== lookTilesJob || editing !== e || !e.ready) return;
    for (const t of tiles.splice(0, 3)) {
      const image = developer.pixels({ ...base, look: t.dataset.look }, 96, developer.crop), c = t.firstChild;
      Object.assign(c, { width: image.width, height: image.height });
      c.getContext('2d').putImageData(image, 0, 0);
    }
    if (tiles.length) setTimeout(next, 0);
  };
  setTimeout(next, 0);
}

// ---- Rating on the grid: a small bar on each photo when the pointer is over it ----
function cellRating(cell, photo) {
  const r = rating(photo);
  for (const b of cell.querySelectorAll('.cell-rate [data-flag]')) b.classList.toggle('on', r.flag === b.dataset.flag);
  for (const b of cell.querySelectorAll('.cell-rate [data-stars]')) b.classList.toggle('on', (r.stars || 0) >= +b.dataset.stars);
}
const CELL_RATE = '<div class="cell-rate"><button type="button" data-flag="pick" title="Pick">⚑</button><button type="button" data-flag="reject" title="Reject">✕</button>'
  + [1, 2, 3, 4, 5].map(n => `<button type="button" data-stars="${n}" title="${n} star${n > 1 ? 's' : ''}">★</button>`).join('') + '</div>';
// Rates the photo under the bar: it becomes the current photo first, as clicking it would.
function rateCell(button) {
  const cell = button.closest('.cell'), i = +cell.dataset.i, photo = visible[i];
  if (!photo) return;
  if (i !== cursor) move(i);
  if (button.dataset.flag) rate({ flag: rating(photo).flag === button.dataset.flag ? null : button.dataset.flag });
  else rate({ stars: rating(photo).stars === +button.dataset.stars ? null : +button.dataset.stars });
}
