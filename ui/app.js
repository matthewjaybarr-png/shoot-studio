// Shoot Studio, Step 1: open a shoot, cull it with the keyboard, save ratings to <shoot>/.shootstudio/shoot.json.
const invoke = window.__TAURI__.core.invoke;
const $ = selector => document.querySelector(selector);
const grid = $('#grid'), loupe = $('#loupe');
let dir = null, opening = false, updating = false, photos = [], ratings = {}, visible = [], cursor = 0, view = 'grid', anchor = null, saving = Promise.resolve();
const thumbs = new Map();   // photo id -> blob URL, small, kept for the whole session
const previews = new Map(); // file name -> blob URL, full size, capped below

const fileOf = photo => photo.jpg || photo.raw;
const rating = photo => ratings[photo.id] || {};
const status = (text, error = false) => { $('#status').textContent = text; $('#status').classList.toggle('error', error); };
const caption = photo => { const r = rating(photo); return photo.id + (r.stars ? ' ' + '★'.repeat(r.stars) : '') + (photo.jpg && photo.raw ? ' · RAW+JPEG' : photo.raw ? ' · RAW' : ''); };

// Every async step takes the shoot it started in and refuses to land in a different one.
const stale = shoot => { if (shoot !== dir) throw 'shoot changed'; };

async function preview(photo) {
  const name = fileOf(photo), shoot = dir;
  if (!previews.has(name)) {
    const bytes = await invoke('preview', { dir: shoot, name });
    stale(shoot);
    previews.set(name, URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })));
    // ponytail: keep 6 full-size previews (~24 MP each decoded); raise if loupe paging feels slow on a slower machine.
    for (const [old, url] of previews) if (previews.size > 6) { URL.revokeObjectURL(url); previews.delete(old); }
  }
  return previews.get(name);
}

async function makeThumb(photo, shoot) {
  const name = fileOf(photo);
  try { return new Blob([await invoke('thumb', { dir: shoot, name })], { type: 'image/jpeg' }); } catch {}
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([await invoke('preview', { dir: shoot, name })], { type: 'image/jpeg' }));
  try {
    await img.decode();
    const scale = Math.min(1, 480 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(img.naturalWidth * scale), height: Math.round(img.naturalHeight * scale) });
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(done => canvas.toBlob(done, 'image/jpeg', 0.8));
    await invoke('save_thumb', { dir: shoot, name, data: Array.from(new Uint8Array(await blob.arrayBuffer())) });
    return blob;
  } finally { URL.revokeObjectURL(img.src); }
}

// Thumbnails load only when their cell nears the viewport, three at a time.
const wanted = [];
let loading = 0;
function pump() {
  while (loading < 3 && wanted.length) {
    const photo = wanted.pop(), shoot = dir;
    if (thumbs.has(photo.id)) continue;
    loading++;
    makeThumb(photo, shoot).then(blob => {
      stale(shoot);
      thumbs.set(photo.id, URL.createObjectURL(blob));
      const img = grid.querySelector(`[data-id="${CSS.escape(photo.id)}"] img`);
      if (img) img.src = thumbs.get(photo.id);
    }).catch(error => { if (shoot === dir) status(`${fileOf(photo)}: ${error}`, true); }).finally(() => { loading--; pump(); });
  }
}
const watcher = new IntersectionObserver(entries => {
  for (const entry of entries) {
    const photo = visible[entry.target.dataset.i];
    if (!photo || thumbs.has(photo.id)) continue;
    const at = wanted.indexOf(photo);
    if (at >= 0) wanted.splice(at, 1);
    if (entry.isIntersecting) wanted.push(photo);
  }
  pump();
}, { root: grid, rootMargin: '600px 0px' });

function paintCell(cell, photo) {
  const r = rating(photo);
  cell.className = 'cell' + (r.flag ? ' ' + r.flag : '') + (visible[cursor] === photo ? ' current' : '');
  cell.querySelector('figcaption').textContent = caption(photo);
}

const shown = photo => { const filter = $('#filter').value, r = rating(photo); return filter === 'all' || (filter === 'picks' ? r.flag === 'pick' : !r.flag && !r.stars); };

function renderGrid() {
  const current = visible[cursor];
  visible = photos.filter(shown);
  cursor = Math.max(0, Math.min(visible.includes(current) ? visible.indexOf(current) : cursor, visible.length - 1));
  watcher.disconnect();
  wanted.length = 0;
  grid.replaceChildren(...visible.map((photo, i) => {
    const cell = document.createElement('figure');
    cell.dataset.i = i;
    cell.dataset.id = photo.id;
    cell.innerHTML = '<img alt="" loading="lazy" decoding="async"><figcaption></figcaption>';
    if (thumbs.has(photo.id)) cell.firstChild.src = thumbs.get(photo.id);
    paintCell(cell, photo);
    watcher.observe(cell);
    return cell;
  }));
  if (!visible.length) grid.innerHTML = `<p>${photos.length ? 'No photos match this filter.' : 'No JPEG or CR2 files in this folder.'}</p>`;
  counts();
}

function counts() {
  const all = Object.values(ratings);
  $('#counts').textContent = `${photos.length} photos · ${all.filter(r => r.flag === 'pick').length} picks · ${all.filter(r => r.flag === 'reject').length} rejects`;
}

let shownToken = 0;
async function showViewer() {
  const token = ++shownToken;
  loupe.classList.toggle('hidden', view === 'grid');
  grid.classList.toggle('hidden', view !== 'grid');
  loupe.classList.toggle('compare', view === 'compare');
  if (view === 'grid') return grid.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
  const frames = view === 'compare' ? [anchor, visible[cursor]] : [visible[cursor]];
  const figures = loupe.querySelectorAll('figure');
  // The image must always be the photo the caption names (and the keys rate): blank it until its own preview arrives.
  const loaded = frames.map((photo, i) => {
    const img = figures[i].querySelector('img'), same = photo && img.dataset.name === fileOf(photo);
    if (!same) { img.removeAttribute('src'); img.dataset.name = ''; }
    figures[i].querySelector('figcaption').textContent = photo ? caption(photo) : '';
    figures[i].className = (photo ? rating(photo).flag || '' : '') + (photo && !same ? ' loading' : '');
    return same;
  });
  await Promise.all(frames.map(async (photo, i) => {
    if (!photo || loaded[i]) return;
    try {
      const url = await preview(photo);
      if (token !== shownToken) return; // a later keypress wins
      Object.assign(figures[i].querySelector('img'), { src: url }).dataset.name = fileOf(photo);
      figures[i].classList.remove('loading');
    } catch (error) {
      if (token !== shownToken) return;
      figures[i].classList.replace('loading', 'failed');
      status(`${fileOf(photo)}: ${error}`, true);
    }
  }));
  if (token === shownToken && visible[cursor + 1]) preview(visible[cursor + 1]).catch(() => {});
}

function move(to) {
  if (!visible.length) return;
  const old = grid.querySelector('.current');
  cursor = Math.max(0, Math.min(to, visible.length - 1));
  old?.classList.remove('current');
  grid.children[cursor]?.classList.add('current');
  showViewer();
}

function rate(change) {
  const photo = visible[cursor];
  if (!photo) return;
  const next = { ...rating(photo), ...change };
  for (const key of Object.keys(next)) if (!next[key]) delete next[key];
  if (Object.keys(next).length) ratings[photo.id] = next; else delete ratings[photo.id];
  const data = { version: 1, ratings: { ...ratings } }, shoot = dir;
  // Saves are chained so the last change always lands last.
  saving = saving.then(() => invoke('save_shoot', { dir: shoot, data })).then(() => status('Saved'), error => status('Not saved: ' + error, true));
  if (shown(photo)) paintCell(grid.children[cursor], photo);
  else renderGrid(); // it left the filter; the next photo takes its place
  counts();
  showViewer();
}

async function openShoot(path) {
  if (opening) return; // one open at a time, or a later one could clear the guard while an older snapshot is pending
  opening = true; // keys are ignored until the new ratings are in, so nothing rated now can be overwritten
  $('#open').disabled = true;
  try {
    await saving; // otherwise a reopen reads ratings from before the last change landed
    status('Opening…');
    const [list, saved] = await Promise.all([invoke('open_shoot', { dir: path }), invoke('load_shoot', { dir: path })]);
    for (const url of [...thumbs.values(), ...previews.values()]) URL.revokeObjectURL(url);
    thumbs.clear(); previews.clear();
    for (const img of loupe.querySelectorAll('img')) { img.removeAttribute('src'); img.dataset.name = ''; }
    dir = path; photos = list; ratings = saved?.ratings || {}; cursor = 0; view = 'grid'; visible = [];
    $('#shoot-name').textContent = path.split(/[\\/]/).filter(Boolean).pop();
    status('');
    renderGrid();
    showViewer();
    grid.focus();
  } catch (error) { status(String(error), true); } finally { opening = false; $('#open').disabled = false; }
}

// Updates: one check at launch; nothing shows offline. Installing waits for the last rating to save, then restarts.
async function checkForUpdate() {
  const version = await invoke('check_update').catch(() => null);
  $('#update').hidden = !version;
  if (version) { $('#update-text').textContent = `Shoot Studio ${version} is ready.`; $('#update-now').disabled = false; }
}
$('#update-now').onclick = async () => {
  $('#update-now').disabled = true;
  updating = true; // no new ratings once the restart is coming
  $('#update-text').textContent = 'Updating… Shoot Studio will restart by itself.';
  const progress = new window.__TAURI__.core.Channel();
  progress.onmessage = percent => { $('#update-text').textContent = `Downloading update… ${percent}%`; };
  try {
    await saving;
    await invoke('install_update', { progress });
  } catch (error) {
    $('#update-text').textContent = `The update didn't install (${error}). Your photos and ratings are fine; try again later.`;
    $('#update-now').disabled = false;
    updating = false;
  }
};
invoke('app_version').then(version => { $('#version').textContent = 'Shoot Studio ' + version; }, () => {});
checkForUpdate();

$('#open').onclick = async () => { const path = await invoke('pick_shoot'); if (path) openShoot(path); };
invoke('startup_shoot').then(path => { if (path) openShoot(path); });
$('#filter').onchange = () => { renderGrid(); showViewer(); $('#filter').blur(); grid.focus(); };
grid.onclick = event => { const cell = event.target.closest('.cell'); if (cell) move(+cell.dataset.i); };
grid.ondblclick = event => { if (event.target.closest('.cell')) { view = 'loupe'; showViewer(); } };

document.addEventListener('keydown', event => {
  if (event.target.matches('select, input, button') || event.ctrlKey || event.metaKey || event.altKey || !dir || opening || updating) return;
  const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const actions = {
    ArrowLeft: () => move(cursor - 1), ArrowRight: () => move(cursor + 1),
    ArrowUp: () => view === 'grid' ? move(cursor - columns) : move(cursor - 1),
    ArrowDown: () => view === 'grid' ? move(cursor + columns) : move(cursor + 1),
    Enter: () => { view = view === 'grid' ? 'loupe' : 'grid'; showViewer(); },
    ' ': () => { view = view === 'grid' ? 'loupe' : 'grid'; showViewer(); },
    Escape: () => { view = 'grid'; showViewer(); },
    c: () => { if (view === 'compare') view = 'loupe'; else { view = 'compare'; anchor = visible[cursor]; move(cursor + 1); } showViewer(); },
    p: () => rate({ flag: 'pick' }), x: () => rate({ flag: 'reject' }), u: () => rate({ flag: null }),
    0: () => rate({ stars: null }), 1: () => rate({ stars: 1 }), 2: () => rate({ stars: 2 }), 3: () => rate({ stars: 3 }), 4: () => rate({ stars: 4 }), 5: () => rate({ stars: 5 })
  };
  if (!actions[key]) return;
  event.preventDefault();
  actions[key]();
});
