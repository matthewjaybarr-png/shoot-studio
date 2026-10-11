// Shoot Studio: open a shoot, cull it with the keyboard (ratings in <shoot>/.shootstudio/shoot.json),
// develop photos (recipes in .shootstudio/recipes/, their rendered look in .shootstudio/edited/).
const invoke = window.__TAURI__.core.invoke;
const $ = selector => document.querySelector(selector);
const grid = $('#grid'), loupe = $('#loupe'), develop = $('#develop'), canvas = $('#canvas'), sliders = $('#sliders');
let dir = null, opening = false, updating = false, photos = [], ratings = {}, recipes = {}, visible = [], cursor = 0, view = 'grid', anchor = null, saving = Promise.resolve();
const thumbs = new Map();   // photo id -> blob URL, small, kept for the whole session
const previews = new Map(); // previewKey -> blob URL, full size, capped below

const CULL_KEYS = 'P pick · X reject · U unflag · 1–5 stars · 0 clear stars';
const KEYS = {
  grid: `←→↑↓ move · Enter loupe · D develop · C compare · ${CULL_KEYS}`,
  loupe: `←→ move · Enter or Esc grid · D develop · C compare · ${CULL_KEYS}`,
  compare: `←→ change the right photo · C one photo · Esc grid · ${CULL_KEYS}`,
  develop: '←→ previous/next · hold \\ for before · Ctrl+Z undo · Ctrl+Shift+Z redo · double-click a slider to reset it · Esc grid'
};

const fileOf = photo => photo.jpg || photo.raw;
const rating = photo => ratings[photo.id] || {};
const status = (text, error = false) => { $('#status').textContent = text; $('#status').classList.toggle('error', error); };
const caption = photo => { const r = rating(photo); return photo.id + (r.stars ? ' ' + '★'.repeat(r.stars) : '') + (photo.jpg && photo.raw ? ' · RAW+JPEG' : photo.raw ? ' · RAW' : '') + (recipes[photo.id] ? ' · Edited' : ''); };
// An edited photo shows its saved rendered look; anything else shows the camera's own JPEG.
const previewKey = photo => recipes[photo.id] ? 'edited:' + photo.id : fileOf(photo);

// Every async step takes the shoot it started in and refuses to land in a different one.
const stale = shoot => { if (shoot !== dir) throw 'shoot changed'; };

async function preview(photo) {
  const name = fileOf(photo), shoot = dir, key = previewKey(photo);
  if (recipes[photo.id]) await saving; // a look being saved lands on disk first
  if (!previews.has(key)) {
    const camera = () => invoke('preview', { dir: shoot, name });
    const bytes = await (recipes[photo.id] ? invoke('edited', { dir: shoot, id: photo.id, thumb: false }).catch(camera) : camera());
    stale(shoot);
    if (previews.has(key)) URL.revokeObjectURL(previews.get(key));
    previews.set(key, URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })));
    // ponytail: keep 6 full-size previews (~24 MP each decoded); raise if loupe paging feels slow on a slower machine.
    for (const [old, url] of previews) if (previews.size > 6) { URL.revokeObjectURL(url); previews.delete(old); }
  }
  return previews.get(key);
}

async function makeThumb(photo, shoot) {
  const name = fileOf(photo);
  if (recipes[photo.id]) try { return new Blob([await invoke('edited', { dir: shoot, id: photo.id, thumb: true })], { type: 'image/jpeg' }); } catch {}
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
  loupe.classList.toggle('hidden', view === 'grid' || view === 'develop');
  grid.classList.toggle('hidden', view !== 'grid');
  develop.classList.toggle('hidden', view !== 'develop');
  loupe.classList.toggle('compare', view === 'compare');
  $('#keys').textContent = KEYS[view];
  if (view === 'develop') return openDevelop(visible[cursor]);
  leaveDevelop();
  if (view === 'grid') return grid.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
  const frames = view === 'compare' ? [anchor, visible[cursor]] : [visible[cursor]];
  const figures = loupe.querySelectorAll('figure');
  // The image must always be the photo the caption names (and the keys rate): blank it until its own preview arrives.
  const loaded = frames.map((photo, i) => {
    const img = figures[i].querySelector('img'), same = photo && img.dataset.name === previewKey(photo);
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
      Object.assign(figures[i].querySelector('img'), { src: url }).dataset.name = previewKey(photo);
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

// Develop: the current photo on a WebGL canvas, its recipe in the sliders beside it. Each photo keeps
// its own undo history while it's open. Its look is saved for the grid and loupe 2 s after the last
// change and when you leave it, while its pixels are still on the GPU.
let developer = null, editing = null, before = false, dragStart = null, frame = 0;
const note = text => { $('#develop-note').textContent = text; $('#develop-note').hidden = !text; };
const sameRecipe = (a, b) => SLIDERS.every(s => a[s.key] === b[s.key]);
const showValue = (s, v) => (v > 0 ? '+' : '') + (s.step < 1 ? v.toFixed(2) : v);
const repaintCell = photo => { const cell = grid.children[visible.indexOf(photo)]; if (cell?.classList.contains('cell')) paintCell(cell, photo); };

for (const s of SLIDERS) {
  if (s.group) sliders.insertAdjacentHTML('beforeend', `<h3>${s.group}</h3>`);
  sliders.insertAdjacentHTML('beforeend', `<label><span>${s.label}</span><output></output><input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="0" data-key="${s.key}"></label>`);
}
sliders.insertAdjacentHTML('beforeend', '<button id="reset" type="button">Reset all</button>');

function paintSliders() {
  sliders.disabled = !editing?.ready || updating;
  for (const input of sliders.querySelectorAll('input')) {
    const s = SLIDERS.find(s => s.key === input.dataset.key), v = editing ? editing.recipe[s.key] : 0;
    input.value = v;
    input.previousElementSibling.textContent = showValue(s, v);
  }
}

function draw() {
  $('#develop-caption').textContent = editing ? caption(editing.photo) + (before ? ' · Before' : '') : '';
  if (developer && !frame) frame = requestAnimationFrame(() => { frame = 0; developer.show(before || !editing ? {} : editing.recipe); });
}
new ResizeObserver(draw).observe(canvas);

async function openDevelop(photo) {
  if (editing && editing.photo === photo && editing.shoot === dir) return draw();
  leaveDevelop();
  if (!photo) return note('');
  try { developer ||= new Developer(canvas); } catch (error) { return note(`Develop isn't available: ${error.message}. Culling still works.`); }
  const e = editing = { photo, shoot: dir, recipe: fullRecipe(recipes[photo.id]), history: [], future: [], ready: false, dirty: false };
  dragStart = null;
  developer.clear(); paintSliders(); draw();
  note(photo.raw ? 'Developing the RAW file…' : 'Loading…');
  try {
    if (photo.raw) {
      await new Promise(done => setTimeout(done, 150)); // paging quickly past a photo doesn't decode it
      if (editing !== e) return;
      const bytes = await invoke('develop_source', { dir: e.shoot, name: photo.raw });
      if (editing !== e) return;
      developer.setRaw(bytes);
    } else {
      let image = await createImageBitmap(new Blob([await invoke('preview', { dir: e.shoot, name: photo.jpg })]), { imageOrientation: 'from-image' });
      const scale = DEVELOP_EDGE / Math.max(image.width, image.height), full = image;
      if (scale < 1) { image = await createImageBitmap(full, { resizeWidth: Math.round(full.width * scale), resizeHeight: Math.round(full.height * scale), resizeQuality: 'high' }); full.close(); }
      if (editing !== e) return image.close();
      developer.setImage(image);
      image.close();
    }
    e.ready = true;
    note(''); paintSliders(); draw();
  } catch (error) { if (editing === e) note(`${fileOf(photo)} can't be developed: ${error}`); }
}

function leaveDevelop() {
  const e = editing;
  if (!e) return;
  editing = null; before = false; dragStart = null;
  saveLook(e);
  paintSliders();
}

// A change: remember the recipe before it for undo, then save.
function commit(e, was) {
  if (sameRecipe(was, e.recipe)) return paintSliders();
  e.history.push(was);
  e.future = [];
  store(e);
}

function undo(redo) {
  const e = editing, from = redo ? e?.future : e?.history;
  if (!from?.length) return;
  (redo ? e.history : e.future).push(e.recipe);
  e.recipe = from.pop();
  store(e);
}

// Saves are chained with ratings; a recipe back at the defaults is deleted, with its saved look.
function store(e) {
  const { photo, shoot } = e, recipe = isDefault(e.recipe) ? null : { version: RECIPE_VERSION, ...e.recipe };
  if (recipe) recipes[photo.id] = recipe; else delete recipes[photo.id];
  saving = saving.then(() => invoke('save_recipe', { dir: shoot, id: photo.id, recipe })).then(() => status('Saved'), error => status('Not saved: ' + error, true));
  e.dirty = true;
  clearTimeout(e.timer);
  e.timer = setTimeout(() => saveLook(e), 2000);
  paintSliders(); draw(); repaintCell(photo);
}

// Render the edited look (2048 px and a 480 px thumbnail) for the grid and loupe.
function saveLook(e) {
  clearTimeout(e.timer);
  if (!e.ready || !e.dirty || (editing && editing !== e)) return; // the GPU only holds the open photo
  e.dirty = false;
  const { photo, shoot } = e, id = photo.id, key = 'edited:' + id, recipe = recipes[id];
  if (previews.has(key)) { URL.revokeObjectURL(previews.get(key)); previews.delete(key); }
  for (const img of loupe.querySelectorAll('img')) if (img.dataset.name === key) img.dataset.name = '';
  const look = recipe && [developer.jpeg(recipe, 2048), developer.jpeg(recipe, 480, 0.8)]; // pixels are read now, encoded later
  saving = saving.then(async () => {
    const bytes = async blob => Array.from(new Uint8Array(await blob.arrayBuffer()));
    const [big, small] = look ? await Promise.all(look) : [];
    if (look) {
      await invoke('save_edited', { dir: shoot, id, thumb: false, data: await bytes(big) });
      await invoke('save_edited', { dir: shoot, id, thumb: true, data: await bytes(small) });
    }
    if (shoot !== dir) return;
    if (thumbs.has(id)) URL.revokeObjectURL(thumbs.get(id));
    thumbs.delete(id);
    const img = grid.querySelector(`[data-id="${CSS.escape(id)}"] img`);
    if (small) { thumbs.set(id, URL.createObjectURL(small)); if (img) img.src = thumbs.get(id); }
    else { wanted.push(photo); pump(); } // back to the camera's thumbnail
  }).catch(error => status('Edited look not saved: ' + error, true));
}

sliders.addEventListener('input', event => {
  const key = event.target.dataset.key;
  if (!editing || !key) return;
  dragStart ||= editing.recipe;
  editing.recipe = { ...editing.recipe, [key]: +event.target.value };
  paintSliders(); draw();
});
sliders.addEventListener('change', () => { if (editing && dragStart) commit(editing, dragStart); dragStart = null; });
sliders.addEventListener('dblclick', event => {
  const key = event.target.dataset.key;
  if (!editing || !key) return;
  const was = dragStart || editing.recipe;
  dragStart = null;
  editing.recipe = { ...editing.recipe, [key]: 0 };
  commit(editing, was);
});
$('#reset').onclick = () => {
  $('#reset').blur();
  if (!editing) return;
  const was = editing.recipe;
  editing.recipe = fullRecipe();
  commit(editing, was);
};
canvas.onpointerdown = () => document.activeElement?.blur();

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
  leaveDevelop();
  try {
    await saving; // otherwise a reopen reads ratings from before the last change landed
    status('Opening…');
    const [list, saved, edits] = await Promise.all([invoke('open_shoot', { dir: path }), invoke('load_shoot', { dir: path }), invoke('load_recipes', { dir: path })]);
    for (const url of [...thumbs.values(), ...previews.values()]) URL.revokeObjectURL(url);
    thumbs.clear(); previews.clear();
    for (const img of loupe.querySelectorAll('img')) { img.removeAttribute('src'); img.dataset.name = ''; }
    dir = path; photos = list; ratings = saved?.ratings || {}; recipes = edits; cursor = 0; view = 'grid'; visible = [];
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
  updating = true; // no new ratings or edits once the restart is coming
  if (editing) saveLook(editing);
  paintSliders();
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
    paintSliders();
  }
};
$('#keys').textContent = KEYS.grid;
invoke('app_version').then(version => { $('#version').textContent = 'Shoot Studio ' + version; }, () => {});
checkForUpdate();

$('#open').onclick = async () => { const path = await invoke('pick_shoot'); if (path) openShoot(path); };
invoke('startup_shoot').then(path => { if (path) openShoot(path); });
$('#filter').onchange = () => { renderGrid(); showViewer(); $('#filter').blur(); grid.focus(); };
grid.onclick = event => { const cell = event.target.closest('.cell'); if (cell) move(+cell.dataset.i); };
grid.ondblclick = event => { if (event.target.closest('.cell')) { view = 'loupe'; showViewer(); } };

document.addEventListener('keydown', event => {
  const target = event.target;
  if (target.matches('input[type=range]')) {
    if (event.key === 'Escape') { event.preventDefault(); return target.blur(); }
    if (/^(Arrow|Page|Home|End)/.test(event.key)) return; // a focused slider keeps its own keys
  } else if (target.matches('select, input, button')) return;
  if (event.altKey || !dir || opening || updating) return;
  if (event.ctrlKey || event.metaKey) {
    const letter = event.key.toLowerCase();
    if (view === 'develop' && (letter === 'z' || letter === 'y')) { event.preventDefault(); undo(letter === 'y' || event.shiftKey); }
    return;
  }
  const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const actions = {
    ArrowLeft: () => move(cursor - 1), ArrowRight: () => move(cursor + 1),
    ArrowUp: () => view === 'grid' ? move(cursor - columns) : move(cursor - 1),
    ArrowDown: () => view === 'grid' ? move(cursor + columns) : move(cursor + 1),
    Enter: () => { view = view === 'grid' ? 'loupe' : 'grid'; showViewer(); },
    ' ': () => { view = view === 'grid' ? 'loupe' : 'grid'; showViewer(); },
    Escape: () => { view = 'grid'; showViewer(); },
    d: () => { view = 'develop'; showViewer(); },
    '\\': () => { if (view === 'develop' && !before) { before = true; draw(); } },
    c: () => { if (view === 'compare') view = 'loupe'; else { view = 'compare'; anchor = visible[cursor]; move(cursor + 1); } showViewer(); },
    p: () => rate({ flag: 'pick' }), x: () => rate({ flag: 'reject' }), u: () => rate({ flag: null }),
    0: () => rate({ stars: null }), 1: () => rate({ stars: 1 }), 2: () => rate({ stars: 2 }), 3: () => rate({ stars: 3 }), 4: () => rate({ stars: 4 }), 5: () => rate({ stars: 5 })
  };
  if (!actions[key]) return;
  event.preventDefault();
  actions[key]();
});
const endBefore = () => { if (before) { before = false; draw(); } };
document.addEventListener('keyup', event => { if (event.key === '\\') endBefore(); });
window.addEventListener('blur', endBefore);
