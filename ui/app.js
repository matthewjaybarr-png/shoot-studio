// KB Studio: open a shoot, cull it with the keyboard (ratings in <shoot>/.shootstudio/shoot.json),
// develop photos (recipes in .shootstudio/recipes/, their rendered look in .shootstudio/edited/).
const invoke = window.__TAURI__.core.invoke;
let mode = 'home'; // 'home', 'photos' or 'create'
const $ = selector => document.querySelector(selector);
const grid = $('#grid'), loupe = $('#loupe'), develop = $('#develop'), canvas = $('#canvas'), sliders = $('#sliders');
let dir = null, opening = false, updating = false, photos = [], ratings = {}, recipes = {}, visible = [], cursor = 0, view = 'grid', anchor = null, saving = Promise.resolve();
const selected = new Set(); // photo ids picked with Ctrl/Shift+click in the grid, for pasting settings onto
let clipboard = null;       // settings copied with Ctrl+C
let deliverSettings = null; // the shoot's last Deliver choices, saved in shoot.json
const thumbs = new Map();   // photo id -> blob URL, small, kept for the whole session
const previews = new Map(); // previewKey -> blob URL, full size, capped below

const CULL_KEYS = 'P pick · X reject · U unflag · 1–5 stars · 0 clear stars';
const COPY_KEYS = 'Ctrl+C copy settings · Ctrl+V paste';
const KEYS = {
  grid: `←→↑↓ move · Enter loupe · D develop · C compare · ${CULL_KEYS} · Ctrl/Shift+click select · Ctrl+A select all · ${COPY_KEYS} (onto the selection)`,
  loupe: `←→ move · Enter or Esc grid · D develop · C compare · ${CULL_KEYS} · ${COPY_KEYS}`,
  compare: `←→ change the right photo · C one photo · Esc grid · ${CULL_KEYS}`,
  develop: `←→ previous/next · hold \\ for before · Ctrl+Z undo · Ctrl+Shift+Z redo · double-click a slider to reset it · ${COPY_KEYS} · J spot heal · H heal · S clone · B soften · E red eye · [ ] brush size · Ctrl+click heal/clone source · R crop · wheel or + - zoom · 0 fit · 1 100% · Z toggle zoom · Space+drag pan · Esc drop tool, then grid`
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
  cell.className = 'cell' + (r.flag ? ' ' + r.flag : '') + (visible[cursor] === photo ? ' current' : '') + (selected.has(photo.id) ? ' selected' : '');
  cell.querySelector('figcaption').textContent = caption(photo);
}

const shown = photo => { const filter = $('#filter').value, r = rating(photo); return filter === 'all' || (filter === 'picks' ? r.flag === 'pick' : !r.flag && !r.stars); };

function renderGrid() {
  const current = visible[cursor];
  visible = photos.filter(shown);
  for (const id of selected) if (!visible.some(p => p.id === id)) selected.delete(id);
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
  $('#counts').textContent = `${photos.length} photos · ${all.filter(r => r.flag === 'pick').length} picks · ${all.filter(r => r.flag === 'reject').length} rejects` + (selected.size ? ` · ${selected.size} selected` : '');
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
const sameRecipe = (a, b) => SETTINGS.every(key => a[key] === b[key]) && a.retouch === b.retouch && sameCrop(a.crop, b.crop);

// Everything that touches the open photo's pixels runs in order, one step at a time: loading a photo,
// applying retouch strokes in Rust and patching them in, and reading the look to save. So the strokes
// land before the look is read, and before the next photo replaces the one Rust is holding.
// developer.owner is the editing session whose pixels the GPU holds.
let retouching = Promise.resolve();
const queue = step => { const run = retouching.then(step); retouching = run.catch(() => {}); return run; };

// Retouch brushes. Size is the brush radius over the photo's long edge, on a log slider.
let tool = null, brush = { size: 0.01 }, strengths = { soften: 0.5 }, aligned = true, stroke = null, panning = null, spaceHeld = false, pointer = null;
const COPIES = { heal: true, clone: true }; // tools that copy from a source you Alt+click or Ctrl+click
const strengthOf = t => strengths[t] ?? 1; // soften starts at half; the rest at all of it
const sizeToSlider = size => Math.round(100 * Math.log(size / STROKE_LIMITS.minSize) / Math.log(100));
const sliderToSize = v => STROKE_LIMITS.minSize * 100 ** (v / 100);
const round = v => Math.round(v * 1e5) / 1e5;
const overlay = $('#overlay'), stage = $('.stage');
const showValue = (s, v) => s.unit ? v + s.unit : (v > 0 && s.min < 0 ? '+' : '') + (s.step < 1 ? v.toFixed(2) : v);
const repaintCell = photo => { const cell = grid.children[visible.indexOf(photo)]; if (cell?.classList.contains('cell')) paintCell(cell, photo); };

// A hue slider's track shows the colours it tints with: OkLab at a mid lightness, as sRGB.
const hueTrack = () => 'linear-gradient(to right,' + Array.from({ length: 13 }, (_, i) => {
  const h = i * 30 * Math.PI / 180, [L, a, b] = [0.72, 0.12 * Math.cos(h), 0.12 * Math.sin(h)];
  const [l, m, q] = [L + 0.3963377774 * a + 0.2158037573 * b, L - 0.1055613458 * a - 0.0638541728 * b, L - 0.0894841775 * a - 1.291485548 * b].map(v => v ** 3);
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * q, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * q, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * q];
  return 'rgb(' + rgb.map(v => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)))) + ')';
}) + ')';
sliders.insertAdjacentHTML('beforeend', `<h3>Presets</h3><div class="presets"><select id="preset" aria-label="Presets"></select><button id="preset-save" type="button">Save</button><button id="preset-delete" type="button">Delete</button></div>
  <input id="preset-name" maxlength="60" placeholder="Preset name, then Enter" hidden>`);
for (const s of SLIDERS) {
  if (s.group) sliders.insertAdjacentHTML('beforeend', `<h3>${s.group}</h3>`);
  if (s.group === 'Look') sliders.insertAdjacentHTML('beforeend', `<select id="look" aria-label="Look"><option value="">None</option>${
    [...new Set(LOOKS.map(l => l.group).filter(Boolean))].map(group => `<optgroup label="${group}"></optgroup>`).join('')}</select>`);
  sliders.insertAdjacentHTML('beforeend', `<label><span>${s.label}</span><output></output><input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.default ?? 0}" data-key="${s.key}"${s.hue ? ` class="hue" style="background:${hueTrack()}"` : ''}></label>`);
}
{ // each look under the group named on it or the one before
  let group;
  for (const l of LOOKS) { group = l.group || group; $(`#look optgroup[label="${group}"]`).append(new Option(l.name, l.id)); }
}
const ASPECTS = ['Original', 'Free', '1:1', '4:5', '5:7', '2:3', '16:9'];
sliders.insertAdjacentHTML('beforeend', `<h3>Crop</h3><div class="crop"><button id="crop" type="button"></button>
  <select id="aspect" aria-label="Aspect ratio">${ASPECTS.map(a => `<option>${a}</option>`).join('')}</select><button id="aspect-swap" type="button" title="Swap width and height">Swap</button></div>
  <label><span>Straighten</span><output></output><input type="range" min="${-MAX_ANGLE}" max="${MAX_ANGLE}" step="0.1" value="0" data-crop="angle"></label>
  <p id="crop-hint"></p><button id="crop-reset" type="button">Reset crop</button>`);
sliders.insertAdjacentHTML('beforeend', `<h3>Retouch</h3><div class="tools">${Object.entries(TOOLS).map(([key, label]) =>
  `<button type="button" data-tool="${key}">${label} <kbd>${{ spot: 'J', heal: 'H', clone: 'S', soften: 'B', redeye: 'E' }[key]}</kbd></button>`).join('')}</div>
  <label><span>Brush size</span><output></output><input type="range" min="0" max="100" step="1" data-brush="size"></label>
  <label id="strength"><span>Strength</span><output></output><input type="range" min="0" max="100" step="1" data-brush="strength"></label>
  <label id="aligned"><span>Aligned (keep the source distance)</span><input type="checkbox" checked></label>
  <p id="tool-hint"></p>`);
sliders.insertAdjacentHTML('beforeend', '<button id="reset" type="button">Reset all</button>');

const HINTS = {
  spot: 'Paint over a spot; KB Studio finds clean skin nearby to blend in. Wrinkles: spot heal at 100% removes, 40-60% softens.',
  heal: 'Alt+click (or Ctrl+click) a clean area, then paint. The circle shows what is copied. Its texture is blended into the colour around the stroke.',
  clone: 'Alt+click (or Ctrl+click) a source, then paint. Exact copy, no blending. For skin, use Heal.',
  soften: 'Paint over skin to smooth blotches while keeping pores and fine detail. A small brush reaches wrinkles; 40-60% softens them.',
  redeye: 'Click a red pupil, or drag out a circle over the eye. Only strongly red pixels darken; the white catchlight stays.'
};
function paintTools() {
  for (const button of sliders.querySelectorAll('[data-tool]')) { button.classList.toggle('active', button.dataset.tool === tool); button.disabled = !!cropping; }
  const size = sliders.querySelector('[data-brush=size]'), strength = sliders.querySelector('[data-brush=strength]');
  size.value = sizeToSlider(brush.size);
  size.previousElementSibling.textContent = developer?.width ? Math.max(1, Math.round(brush.size * Math.max(developer.width, developer.height))) + ' px' : '';
  strength.value = Math.round(strengthOf(tool) * 100);
  strength.previousElementSibling.textContent = strength.value + '%';
  $('#strength').hidden = !tool;
  $('#aligned').hidden = !COPIES[tool];
  $('#tool-hint').textContent = tool ? HINTS[tool] : 'Pick a tool to paint fixes onto the photo.';
  stage.classList.toggle('brush', !!tool);
}

function paintSliders() {
  sliders.disabled = !editing?.ready || updating;
  paintTools();
  for (const input of sliders.querySelectorAll('input[data-key]')) {
    const s = SLIDERS.find(s => s.key === input.dataset.key), v = editing ? editing.recipe[s.key] : s.default ?? 0;
    input.value = v;
    input.previousElementSibling.textContent = showValue(s, v);
  }
  $('#look').value = editing?.recipe.look || '';
  sliders.querySelector('[data-key=lookAmount]').disabled = !editing?.recipe.look;
  const crop = cropping?.crop || editing?.recipe.crop || NO_CROP, angle = sliders.querySelector('[data-crop=angle]');
  angle.value = crop.angle;
  angle.previousElementSibling.textContent = (crop.angle > 0 ? '+' : '') + crop.angle.toFixed(1) + '°';
  $('#aspect').value = aspect;
  $('#crop').innerHTML = cropping ? 'Apply <kbd>Enter</kbd>' : 'Crop <kbd>R</kbd>';
  $('#crop-hint').textContent = cropping ? 'Drag a corner or edge to crop, inside to move. Enter or R applies, Esc cancels.' : 'Crop and straighten; the original file is never changed.';
  stage.classList.toggle('cropping', !!cropping);
}

// Presets: her own named settings, kept for every shoot in the app's settings folder.
let presets = [];
function paintPresets() {
  const chosen = $('#preset').value;
  $('#preset').replaceChildren(new Option(presets.length ? 'Apply a preset…' : 'No presets yet', ''), ...presets.map((p, i) => new Option(p.name, i)));
  $('#preset').value = presets[chosen] ? chosen : '';
  $('#preset-delete').disabled = !$('#preset').value;
  $('#preset-delete').textContent = 'Delete';
}
const savePresets = (next, done) => invoke('save_presets', { presets: next }).then(() => { presets = next; paintPresets(); status(done); }, error => status('Presets not saved: ' + error, true));
invoke('load_presets').then(list => { presets = list.filter(p => p && typeof p.name === 'string' && p.recipe); paintPresets(); }, error => { paintPresets(); status('Presets not loaded: ' + error, true); });
// A preset or a paste: the settings change together, as one undo step; the strokes stay.
function applySettings(settings) {
  if (!editing?.ready) return;
  const was = editing.recipe;
  editing.recipe = { ...was, ...settingsOf(settings) };
  commit(editing, was);
}
$('#preset').onchange = () => {
  const p = presets[$('#preset').value];
  paintPresets();
  if (p) { applySettings(p.recipe); status(`Applied ${p.name}`); }
};
$('#preset-save').onclick = () => { $('#preset-name').hidden = false; $('#preset-name').focus(); };
$('#preset-name').onkeydown = event => {
  const input = event.target, name = input.value.trim();
  if (event.key === 'Escape') { input.value = ''; input.hidden = true; return; }
  if (event.key !== 'Enter' || !name || !editing) return;
  // The same name replaces the older preset.
  const next = [...presets.filter(p => p.name !== name), { name, recipe: settingsOf(editing.recipe) }].sort((a, b) => a.name.localeCompare(b.name));
  input.value = ''; input.hidden = true;
  savePresets(next, `Saved preset ${name}`).then(() => { $('#preset').value = presets.findIndex(p => p.name === name); paintPresets(); });
};
// Delete asks once more: the first click turns the button into "Sure?".
$('#preset-delete').onclick = () => {
  const button = $('#preset-delete'), p = presets[$('#preset').value];
  if (!p) return;
  if (button.textContent !== 'Sure?') { button.textContent = 'Sure?'; return setTimeout(() => { button.textContent = 'Delete'; }, 3000); }
  savePresets(presets.filter(x => x !== p), `Deleted preset ${p.name}`);
};
$('#look').onchange = () => {
  if (!editing?.ready) return;
  const was = editing.recipe;
  editing.recipe = { ...was, look: $('#look').value };
  commit(editing, was);
};

function draw() {
  $('#develop-caption').textContent = editing ? caption(editing.photo) + (before ? ' · Before' : '') : '';
  // Cropping shows the whole straightened photo, with the crop drawn over it.
  if (developer) developer.crop = !editing ? NO_CROP : cropping ? { ...NO_CROP, angle: cropping.crop.angle } : editing.recipe.crop;
  if (developer && !frame) frame = requestAnimationFrame(() => { frame = 0; developer.show(before || !editing ? {} : editing.recipe); paintOverlay(); });
}
new ResizeObserver(draw).observe(canvas);

// The brush circle under the pointer, the stroke being painted, and a crosshair where it copies from
// (joined to the brush by a dashed line while painting).
function paintOverlay() {
  const dpr = window.devicePixelRatio || 1, w = Math.round(overlay.clientWidth * dpr), h = Math.round(overlay.clientHeight * dpr);
  if (overlay.width !== w || overlay.height !== h) Object.assign(overlay, { width: w, height: h });
  const g = overlay.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const e = editing, place = e?.ready && developer.placement();
  paintZoom();
  if (cropping && place) return paintCrop(g);
  if (!tool || !place) return;
  const ring = (x, y, r) => {
    for (const [colour, width] of [['rgba(0,0,0,.6)', 3], ['#fff', 1]]) { g.strokeStyle = colour; g.lineWidth = width; g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI); g.stroke(); }
  };
  // Red eye: the circle being dragged out from the pupil's centre.
  const long = Math.max(developer.width, developer.height) * place.scale; // the photo's long edge on screen
  if (stroke?.tool === 'redeye') { const [x, y] = developer.fromImage(stroke.points[0]); return ring(x, y, stroke.size * long); }
  const radius = brush.size * long;
  if (stroke?.points.length > 1) {
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 2 * radius; g.lineCap = g.lineJoin = 'round';
    g.beginPath();
    for (const p of stroke.points) g.lineTo(...developer.fromImage(p));
    g.stroke();
  }
  const at = pointer && developer.toImage(pointer.clientX, pointer.clientY);
  if (at) { const [x, y] = developer.fromImage(at); ring(x, y, radius); }
  if (COPIES[tool]) {
    const from = e.offset && at ? [at[0] + e.offset[0], at[1] + e.offset[1]] : e.from;
    if (from) {
      const [x, y] = developer.fromImage(from);
      // Inside the brush, show what it would copy (the canvas's own pixels at the source).
      if (!stroke && at) {
        const [bx, by] = developer.fromImage(at), k = dpr;
        g.save(); g.beginPath(); g.arc(bx, by, radius, 0, 2 * Math.PI); g.clip();
        try { g.drawImage(canvas, (x - radius) * k, (y - radius) * k, 2 * radius * k, 2 * radius * k, bx - radius, by - radius, 2 * radius, 2 * radius); } catch {}
        g.restore();
      }
      ring(x, y, radius);
      g.strokeStyle = '#fff'; g.lineWidth = 1; g.beginPath();
      g.moveTo(x - 6, y); g.lineTo(x + 6, y); g.moveTo(x, y - 6); g.lineTo(x, y + 6); g.stroke();
      if (stroke && at) {
        const [bx, by] = developer.fromImage(at);
        g.setLineDash([4, 4]); g.beginPath(); g.moveTo(bx, by); g.lineTo(x, y); g.stroke(); g.setLineDash([]);
      }
    }
  }
}

// The zoom readout and the navigator: a small picture with a box where the view is; drag it to move around.
const nav = $('#navigator'), navCanvas = nav.firstElementChild, navBox = nav.lastElementChild;
let navKey = null;
function paintZoom() {
  const box = editing?.ready && developer.viewBox();
  $('#zoom-readout').hidden = !editing?.ready;
  if (editing?.ready) $('#zoom-readout').textContent = developer.percent() + '%';
  nav.hidden = !box;
  if (!box) return;
  // ponytail: the thumbnail is re-rendered only when the pixels or crop change; one 160 px GPU pass.
  const key = [editing, editing.recipe, cropping, before, developer.revision].join();
  if (key !== navKey) {
    navKey = key;
    const image = developer.pixels(before || cropping ? {} : editing.recipe, 160, developer.crop);
    Object.assign(navCanvas, { width: image.width, height: image.height });
    navCanvas.getContext('2d').putImageData(image, 0, 0);
  }
  Object.assign(navBox.style, { left: box.x * navCanvas.width + 'px', top: box.y * navCanvas.height + 'px', width: box.w * navCanvas.width + 'px', height: box.h * navCanvas.height + 'px' });
}
const navigate = event => {
  const r = navCanvas.getBoundingClientRect();
  developer.centreOn((event.clientX - r.left) / r.width, (event.clientY - r.top) / r.height);
  draw();
};
nav.onpointerdown = event => { try { nav.setPointerCapture(event.pointerId); } catch {} navigate(event); };
nav.onpointermove = event => { if (event.buttons & 1) navigate(event); };
stage.addEventListener('wheel', event => {
  if (!editing?.ready) return;
  event.preventDefault();
  const dy = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
  developer.zoomBy(event.clientX, event.clientY, Math.exp(-dy * 0.002));
  draw();
}, { passive: false });

// Crop mode (R): the whole straightened photo, the crop over it. Nothing changes until Enter or R
// applies it as one undo step; Esc puts it back. `ratio` is width over height in pixels, null when free.
let cropping = null, aspect = 'Original';
const RATIOS = { '1:1': 1, '4:5': 4 / 5, '5:7': 5 / 7, '2:3': 2 / 3, '16:9': 16 / 9 };
const pixelRatio = c => c.w * developer.width / (c.h * developer.height);
// The aspect's ratio, turned the same way as the crop `like` (wide or tall).
function ratioOf(name, like) {
  if (name === 'Free') return null;
  const r = name === 'Original' ? developer.width / developer.height : RATIOS[name];
  return pixelRatio(like) >= 1 ? Math.max(r, 1 / r) : Math.min(r, 1 / r);
}
// The largest crop of `ratio` around the crop's centre that stays on the photo.
function reshape(c, ratio) {
  const W = developer.width, H = developer.height;
  let w = 1, h = W / (ratio * H);
  if (h > 1) { h = 1; w = ratio * H / W; }
  const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
  return fitCrop({ ...c, x: Math.min(1 - w, Math.max(0, cx - w / 2)), y: Math.min(1 - h, Math.max(0, cy - h / 2)), w, h }, W, H);
}
function startCrop() {
  const e = editing;
  if (cropping || !e?.ready || updating) return cropping;
  tool = stroke = null;
  cropping = { e, crop: e.recipe.crop, ratio: ratioOf(aspect, e.recipe.crop) };
  // A fresh crop takes the chosen shape; an existing one that doesn't match it is free.
  if (cropping.ratio && sameCrop(cropping.crop, NO_CROP)) cropping.crop = reshape(cropping.crop, cropping.ratio);
  else if (cropping.ratio && Math.abs(pixelRatio(cropping.crop) / cropping.ratio - 1) > 1e-3) { aspect = 'Free'; cropping.ratio = null; }
  developer.fit(); paintSliders(); draw();
  return cropping;
}
function endCrop(apply) {
  const c = cropping;
  if (!c) return;
  cropping = null;
  developer.fit();
  stage.style.cursor = '';
  if (apply && editing === c.e) {
    const was = c.e.recipe;
    c.e.recipe = { ...was, crop: c.crop };
    commit(c.e, was);
  }
  paintSliders(); draw();
}
const toggleCrop = () => cropping ? endCrop(true) : startCrop();
function setAspect(name) {
  if (!startCrop()) return;
  aspect = name;
  cropping.ratio = ratioOf(name, cropping.crop);
  if (cropping.ratio) cropping.crop = reshape(cropping.crop, cropping.ratio);
  paintSliders(); draw();
}
function setAngle(angle) {
  if (!startCrop()) return;
  cropping.base ||= cropping.crop; // a straighten drag fits from where it began, so it doesn't keep shrinking
  cropping.crop = fitCrop({ ...cropping.base, angle }, developer.width, developer.height);
  paintSliders(); draw();
}
$('#crop').onclick = () => { $('#crop').blur(); toggleCrop(); };
$('#aspect').onchange = () => { $('#aspect').blur(); setAspect($('#aspect').value); };
$('#aspect-swap').onclick = () => {
  $('#aspect-swap').blur();
  if (!startCrop()) return;
  const ratio = 1 / pixelRatio(cropping.crop);
  if (cropping.ratio) cropping.ratio = ratio;
  cropping.crop = reshape(cropping.crop, ratio);
  paintSliders(); draw();
};
$('#crop-reset').onclick = () => {
  $('#crop-reset').blur();
  if (!editing?.ready) return;
  if (aspect !== 'Free') aspect = 'Original';
  if (cropping) { cropping.crop = NO_CROP; cropping.ratio = ratioOf(aspect, NO_CROP); paintSliders(); return draw(); }
  const was = editing.recipe;
  editing.recipe = { ...was, crop: NO_CROP };
  commit(editing, was);
};
sliders.addEventListener('input', event => { if (event.target.dataset.crop) setAngle(+event.target.value); });
sliders.addEventListener('change', event => { if (event.target.dataset.crop && cropping) cropping.base = null; });
sliders.addEventListener('dblclick', event => { if (event.target.dataset.crop && editing?.ready) { setAngle(0); cropping.base = null; } });

// The crop's corners and edge midpoints on screen, and what a press at (x, y) on the canvas grabs.
function cropHandles() {
  const c = cropping.crop, [x0, y0] = developer.fromView([c.x, c.y]), [x1, y1] = developer.fromView([c.x + c.w, c.y + c.h]), mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  return { nw: [x0, y0], n: [mx, y0], ne: [x1, y0], e: [x1, my], se: [x1, y1], s: [mx, y1], sw: [x0, y1], w: [x0, my], box: [x0, y0, x1, y1] };
}
function cropGrab(clientX, clientY) {
  const box = canvas.getBoundingClientRect(), x = clientX - box.left, y = clientY - box.top, h = cropHandles(), [x0, y0, x1, y1] = h.box;
  const handle = Object.keys(h).find(k => k !== 'box' && Math.hypot(h[k][0] - x, h[k][1] - y) <= 12);
  return handle || (x > x0 && x < x1 && y > y0 && y < y1 ? 'move' : null);
}
const CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', move: 'move' };

// Where a drag of (dx, dy) across the straightened photo would put the crop, before keeping it on the photo.
function dragged(from, grab, dx, dy, ratio) {
  const MIN = 0.02, W = developer.width, H = developer.height;
  let x0 = from.x, y0 = from.y, x1 = from.x + from.w, y1 = from.y + from.h;
  if (grab.includes('w')) x0 = Math.min(x0 + dx, x1 - MIN);
  if (grab.includes('e')) x1 = Math.max(x1 + dx, x0 + MIN);
  if (grab.includes('n')) y0 = Math.min(y0 + dy, y1 - MIN);
  if (grab.includes('s')) y1 = Math.max(y1 + dy, y0 + MIN);
  let w = x1 - x0, h = y1 - y0;
  if (ratio) {
    const sideways = grab === 'e' || grab === 'w' || (grab.length === 2 && Math.abs(dx * W) >= Math.abs(dy * H));
    if (sideways) h = w * W / (ratio * H); else w = h * H * ratio / W;
    // An edge grows both ways from the middle; a corner grows away from the opposite corner.
    if (grab.length === 1) { if (sideways) y0 = from.y + from.h / 2 - h / 2; else x0 = from.x + from.w / 2 - w / 2; }
    else { if (grab.includes('w')) x0 = x1 - w; if (grab.includes('n')) y0 = y1 - h; }
  }
  return { ...from, x: x0, y: y0, w, h };
}
// As far as the drag can go toward `to` with the crop still on the photo.
function toward(from, to) {
  const W = developer.width, H = developer.height, at = t => ({ ...from, ...Object.fromEntries(['x', 'y', 'w', 'h'].map(k => [k, from[k] + (to[k] - from[k]) * t])) });
  if (cropFits(to, W, H)) return to;
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (cropFits(at(mid), W, H)) lo = mid; else hi = mid; }
  return at(lo);
}
function dragCrop(clientX, clientY) {
  const d = cropping.drag, v = developer.toView(clientX, clientY), dx = v[0] - d.start[0], dy = v[1] - d.start[1];
  // Moving slides along an edge it meets, so sideways and up-down are kept on the photo one at a time.
  if (d.grab !== 'move') return void (cropping.crop = toward(d.from, dragged(d.from, d.grab, dx, dy, cropping.ratio)));
  const across = toward(d.from, { ...d.from, x: d.from.x + dx });
  cropping.crop = toward(across, { ...across, y: d.from.y + dy });
}

function paintCrop(g) {
  const h = cropHandles(), [x0, y0, x1, y1] = h.box;
  g.fillStyle = 'rgba(0,0,0,.55)';
  g.beginPath(); g.rect(0, 0, overlay.clientWidth, overlay.clientHeight); g.rect(x0, y0, x1 - x0, y1 - y0); g.fill('evenodd');
  g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 1; g.beginPath();
  for (const k of [1, 2]) { const x = x0 + (x1 - x0) * k / 3, y = y0 + (y1 - y0) * k / 3; g.moveTo(x, y0); g.lineTo(x, y1); g.moveTo(x0, y); g.lineTo(x1, y); }
  g.stroke();
  g.strokeStyle = '#fff'; g.strokeRect(x0, y0, x1 - x0, y1 - y0);
  g.fillStyle = '#fff';
  for (const k of Object.keys(CURSORS)) if (h[k]) g.fillRect(h[k][0] - 4, h[k][1] - 4, 8, 8);
}

async function openDevelop(photo) {
  if (editing && editing.photo === photo && editing.shoot === dir) return draw();
  leaveDevelop();
  if (!photo) return note('');
  try { developer ||= new Developer(canvas); } catch (error) { return note(`Develop isn't available: ${error.message}. Culling still works.`); }
  // The RAW when there is one; retouch strokes are replayed onto the same file they were painted on.
  const e = editing = { photo, shoot: dir, source: photo.raw || photo.jpg, recipe: fullRecipe(recipes[photo.id]), history: [], future: [], ready: false, dirty: false, from: null, offset: null };
  dragStart = stroke = panning = null;
  developer.clear(); paintSliders(); draw();
  note(photo.raw ? 'Developing the RAW file…' : 'Loading…');
  try {
    await new Promise(done => setTimeout(done, 150)); // paging quickly past a photo doesn't decode it
    if (editing !== e) return;
    await queue(async () => {
      if (editing !== e) return;
      const strokes = e.recipe.retouch;
      const bytes = await invoke('develop_source', { dir: e.shoot, name: e.source, strokes });
      if (editing !== e) return;
      developer.setRaw(bytes, !!photo.raw);
      developer.owner = e; e.sent = strokes; e.ready = true;
    });
    if (!e.ready) return;
    note(''); paintSliders(); draw();
  } catch (error) { if (editing === e) note(`${fileOf(photo)} can't be developed: ${error}`); }
}

function leaveDevelop() {
  const e = editing;
  if (!e) return;
  endCrop(true); // leaving the photo keeps its crop
  editing = null; before = false; dragStart = stroke = panning = null;
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
  if (e.sent !== e.recipe.retouch) {
    const strokes = e.sent = e.recipe.retouch;
    queue(async () => {
      if (developer.owner !== e) return;
      const bytes = await invoke('retouch', { dir: e.shoot, name: e.source, strokes });
      if (developer.owner !== e) return;
      developer.patch(bytes); draw();
    }).catch(error => status('Retouch not applied: ' + error, true));
  }
  e.dirty = true;
  clearTimeout(e.timer);
  e.timer = setTimeout(() => saveLook(e), 2000);
  paintSliders(); draw(); repaintCell(photo);
}

// Render the edited look (2048 px and a 480 px thumbnail) for the grid and loupe.
function saveLook(e) {
  clearTimeout(e.timer);
  if (!e.ready || !e.dirty) return;
  e.dirty = false;
  writeLook(e.photo, e.shoot, () => {
    if (developer.owner !== e) throw 'the photo is no longer on the GPU'; // the GPU only holds the open photo
  });
}

// `load` puts the photo's pixels on the GPU (or checks they are there); then its look is read,
// once the strokes before this have landed, and encoded and saved later.
function writeLook(photo, shoot, load) {
  const id = photo.id, key = 'edited:' + id, recipe = recipes[id];
  if (previews.has(key)) { URL.revokeObjectURL(previews.get(key)); previews.delete(key); }
  for (const img of loupe.querySelectorAll('img')) if (img.dataset.name === key) img.dataset.name = '';
  const reading = queue(async () => {
    if (!recipe) return null;
    await load();
    return [developer.jpeg(recipe, 2048), developer.jpeg(recipe, 480, 0.8)];
  });
  saving = saving.then(async () => {
    const bytes = async blob => Array.from(new Uint8Array(await blob.arrayBuffer()));
    const look = await reading, [big, small] = look ? await Promise.all(look) : [];
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
  return reading;
}

// Copy and paste settings (everything but retouch strokes, which belong to one photo).
const current = () => view === 'develop' ? editing?.photo : visible[cursor];
function copySettings() {
  const photo = current();
  if (!photo) return;
  clipboard = settingsOf(view === 'develop' && editing ? editing.recipe : recipes[photo.id]);
  status(`Copied the settings of ${photo.id}`);
}
async function pasteSettings() {
  if (!clipboard) return status('Copy a photo\'s settings first (Ctrl+C).');
  if (view === 'develop') return applySettings(clipboard);
  const shoot = dir, list = selected.size ? visible.filter(p => selected.has(p.id)) : [visible[cursor]].filter(Boolean);
  try { developer ||= new Developer(canvas); } catch (error) { return status(`Can't paste: ${error.message}`, true); }
  // Each photo's look is rendered from its own pixels, one at a time, in the background.
  let done = 0;
  const looks = list.map(photo => {
    const next = fullRecipe({ ...recipes[photo.id], ...clipboard }), recipe = isDefault(next) ? null : { version: RECIPE_VERSION, ...next };
    if (recipe) recipes[photo.id] = recipe; else delete recipes[photo.id];
    saving = saving.then(() => invoke('save_recipe', { dir: shoot, id: photo.id, recipe })).catch(error => status('Not saved: ' + error, true));
    repaintCell(photo);
    return writeLook(photo, shoot, async () => {
      status(`Pasting… ${++done} of ${list.length}`);
      const bytes = await invoke('develop_source', { dir: shoot, name: photo.raw || photo.jpg, strokes: recipe.retouch });
      stale(shoot);
      developer.setRaw(bytes, !!photo.raw);
      developer.owner = null; // no Develop session owns these pixels
    }).catch(() => {});
  });
  await Promise.all(looks); await saving;
  if (shoot === dir) status(`Pasted onto ${list.length} photo${list.length === 1 ? '' : 's'}`);
}

sliders.addEventListener('click', event => {
  const button = event.target.closest('[data-tool]');
  if (button) { button.blur(); pickTool(button.dataset.tool); }
});
sliders.addEventListener('input', event => {
  const which = event.target.dataset.brush;
  if (which === 'size') brush.size = sliderToSize(+event.target.value);
  if (which === 'strength' && tool) strengths[tool] = +event.target.value / 100;
  if (which) { paintTools(); draw(); }
});
$('#aligned input').onchange = event => { aligned = event.target.checked; if (!aligned && editing) editing.offset = null; draw(); };
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
  editing.recipe = { ...editing.recipe, [key]: SLIDERS.find(s => s.key === key).default ?? 0 };
  commit(editing, was);
});
$('#reset').onclick = () => {
  $('#reset').blur();
  if (!editing) return;
  endCrop(false);
  const was = editing.recipe;
  editing.recipe = fullRecipe();
  commit(editing, was);
};
function pickTool(next) {
  if (cropping) return;
  tool = next;
  stroke = null;
  paintTools(); draw();
}

// Painting: points are kept every quarter brush width; Rust fills the dabs in between.
const capture = event => { try { stage.setPointerCapture(event.pointerId); } catch {} }; // keeps the drag when the pointer leaves the photo
const inside = p => p && p.every(v => v >= 0 && v <= 1);
stage.addEventListener('pointerdown', event => {
  document.activeElement?.blur();
  const e = editing;
  if (!e?.ready || updating || stroke || panning) return;
  if (event.button === 1 || (event.button === 0 && spaceHeld)) {
    event.preventDefault();
    panning = { x: event.clientX, y: event.clientY };
    return capture(event);
  }
  if (cropping) {
    const grab = event.button === 0 && cropGrab(event.clientX, event.clientY);
    if (grab) { cropping.drag = { grab, start: developer.toView(event.clientX, event.clientY), from: cropping.crop }; capture(event); }
    return;
  }
  const at = developer.toImage(event.clientX, event.clientY);
  if (event.button !== 0 || !tool || !inside(at) || !inside(developer.toView(event.clientX, event.clientY))) return;
  if (tool === 'redeye') { stroke = { e, tool, size: brush.size, strength: strengthOf(tool), points: [at.map(round)] }; capture(event); return draw(); }
  if (COPIES[tool] && (event.altKey || event.ctrlKey || event.metaKey)) { e.from = at; e.offset = null; return draw(); }
  if (COPIES[tool] && !e.from) return status('Alt+click where to copy from first.');
  // The stroke copies from the source at that distance from the brush; Aligned keeps the distance for the next stroke too.
  if (COPIES[tool] && !e.offset) e.offset = [round(e.from[0] - at[0]), round(e.from[1] - at[1])];
  stroke = { e, tool, size: brush.size, strength: strengthOf(tool), points: [at.map(round)] };
  capture(event);
  draw();
});
stage.addEventListener('pointermove', event => {
  pointer = { clientX: event.clientX, clientY: event.clientY };
  if (panning) {
    developer.pan(event.clientX - panning.x, event.clientY - panning.y);
    panning = { x: event.clientX, y: event.clientY };
  } else if (cropping?.drag) dragCrop(event.clientX, event.clientY);
  else if (cropping) stage.style.cursor = editing?.ready ? CURSORS[cropGrab(event.clientX, event.clientY)] || '' : '';
  else if (stroke?.tool === 'redeye') {
    // Dragging sets the circle's radius; a plain click keeps the brush size.
    const at = developer.toImage(event.clientX, event.clientY), [x, y] = stroke.points[0];
    const r = Math.hypot((at[0] - x) * developer.width, (at[1] - y) * developer.height) / Math.max(developer.width, developer.height);
    if (r * Math.max(developer.width, developer.height) >= 3) stroke.size = Math.min(STROKE_LIMITS.maxSize, Math.max(STROKE_LIMITS.minSize, r));
  } else if (stroke && stroke.points.length < STROKE_LIMITS.points) {
    const at = developer.toImage(event.clientX, event.clientY).map(v => round(Math.min(1, Math.max(0, v))));
    const last = stroke.points.at(-1), long = Math.max(developer.width, developer.height);
    const gap = Math.hypot((at[0] - last[0]) * developer.width, (at[1] - last[1]) * developer.height);
    if (gap >= Math.max(1, stroke.size * long / 4)) stroke.points.push(at);
  }
  draw();
});
stage.addEventListener('mousedown', event => { if (event.button === 1) event.preventDefault(); }); // no autoscroll on middle-drag
stage.addEventListener('pointerleave', () => { pointer = null; draw(); });
stage.addEventListener('pointerup', finishStroke);
stage.addEventListener('pointercancel', () => { stroke = panning = null; if (cropping) cropping.drag = null; draw(); });

async function finishStroke() {
  panning = null;
  if (cropping) { cropping.drag = null; return; }
  const s = stroke;
  stroke = null;
  draw();
  if (!s || editing !== s.e) return;
  const e = s.e, done = { tool: s.tool, size: round(s.size), points: s.points };
  // Strength is left out at 100%, so such strokes save as they always did.
  if (s.tool === 'soften') Object.assign(done, { strength: round(s.strength), scaled: true });
  else if (s.strength < 1) done.strength = round(s.strength);
  if (s.tool === 'redeye') { brush.size = s.size; paintTools(); }
  else if (COPIES[s.tool]) { done.offset = e.offset; if (!aligned) e.offset = null; } // not aligned: the next stroke starts from the clicked source again
  else if (s.tool !== 'soften') {
    // Spot heal: Rust picks the best nearby source before the stroke is saved, so it replays the same way.
    try {
      done.offset = await queue(() => developer.owner === e ? invoke('spot_source', { dir: e.shoot, name: e.source, stroke: { ...done, offset: [0, 0] } }) : null);
    } catch (error) { return status('Spot heal failed: ' + error, true); }
    if (!done.offset || editing !== e) return;
  }
  if (!validStroke(done) || e.recipe.retouch.length >= STROKE_LIMITS.strokes) return status("That stroke can't be saved.", true);
  const was = e.recipe;
  e.recipe = { ...was, retouch: [...was.retouch, done] };
  commit(e, was);
}

// shoot.json: ratings and the Deliver choices. Saves are chained so the last change always lands last.
function saveShoot() {
  const data = { version: 1, ratings: { ...ratings }, ...deliverSettings && { deliver: deliverSettings } }, shoot = dir;
  saving = saving.then(() => invoke('save_shoot', { dir: shoot, data })).then(() => status('Saved'), error => status('Not saved: ' + error, true));
}

function rate(change) {
  const photo = visible[cursor];
  if (!photo) return;
  const next = { ...rating(photo), ...change };
  for (const key of Object.keys(next)) if (!next[key]) delete next[key];
  if (Object.keys(next).length) ratings[photo.id] = next; else delete ratings[photo.id];
  saveShoot();
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
    selected.clear();
    dir = path; photos = list; ratings = saved?.ratings || {}; deliverSettings = saved?.deliver && typeof saved.deliver === 'object' ? saved.deliver : null; recipes = edits; cursor = 0; view = 'grid'; visible = [];
    $('#shoot-name').textContent = path.split(/[\\/]/).filter(Boolean).pop();
    status('');
    $('#deliver-open').disabled = false;
    $('#use-in-design').disabled = false;
    renderGrid();
    showViewer();
    grid.focus();
  } catch (error) { status(String(error), true); } finally { opening = false; $('#open').disabled = false; }
}

// Deliver (Ctrl+E): finished JPEGs for the client, rendered from the recipes at full size or for the web,
// into a folder outside the shoot's own. One photo at a time; Cancel stops after the current one.
const WEB_EDGE = 2048;
const deliverBox = $('#deliver');
let delivering = null, exporter = null;
const fileSafe = text => text.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
const markText = () => $('#deliver-mark').value.trim() || 'PROOF';
const deliverForm = () => ({
  which: deliverBox.querySelector('[name=deliver-which]:checked')?.value || 'all',
  size: $('#deliver-size').value, quality: +$('#deliver-quality').value, names: $('#deliver-names').value,
  client: $('#deliver-client').value.trim(), folder: deliverBox.dataset.folder || null,
  watermark: $('#deliver-watermark').checked, mark: markText()
});
// The photos to deliver, in shoot order.
function deliverList(which) {
  if (which === 'picks') return photos.filter(p => rating(p).flag === 'pick');
  if (which === 'selected') return photos.filter(p => selected.has(p.id));
  return photos.filter(p => rating(p).flag !== 'reject');
}
const deliverName = (s, photo, i) => (s.names === 'client' ? fileSafe(s.client) + '-' + String(i + 1).padStart(4, '0') : photo.id) + '.jpg';
const deliverFolder = s => s.folder || dir.replace(/[\\/]+$/, '') + '/Delivered' + (s.names === 'client' && fileSafe(s.client) ? '/' + fileSafe(s.client) : '');
function paintDeliver() {
  const s = deliverForm(), list = deliverList(s.which), busy = !!delivering;
  deliverBox.querySelector('[value=selected]').disabled = !selected.size;
  $('#deliver-count').textContent = `${list.length} photo${list.length === 1 ? '' : 's'}`;
  $('#deliver-quality-value').textContent = s.quality;
  $('#deliver-client-row').hidden = s.names !== 'client';
  $('#deliver-mark').disabled = !s.watermark;
  $('#deliver-preview').textContent = list.length && (s.names !== 'client' || fileSafe(s.client)) ? list.slice(0, 2).map((p, i) => deliverName(s, p, i)).join(', ') + (list.length > 2 ? ' …' : '') : '';
  $('#deliver-folder').textContent = '\u200e' + deliverFolder(s) + '\u200e'; // keeps the slashes in place in the right-aligned ellipsis
  $('#deliver-folder').title = deliverFolder(s);
  $('#deliver-form').disabled = busy;
  $('#deliver-go').disabled = busy || !list.length || (s.names === 'client' && !fileSafe(s.client));
  $('#deliver-cancel').textContent = busy ? 'Stop' : 'Close';
}
function openDeliver() {
  if (!dir || opening || updating || delivering) return;
  endCrop(true);
  const s = deliverSettings || {}, has = which => deliverList(which).length;
  const which = selected.size ? 'selected' : has('picks') ? 'picks' : 'all';
  deliverBox.querySelector(`[value=${which}]`).checked = true;
  $('#deliver-size').value = s.size === 'web' ? 'web' : 'full';
  $('#deliver-quality').value = Number.isFinite(s.quality) ? s.quality : 90;
  $('#deliver-names').value = s.names === 'original' ? 'original' : 'client';
  $('#deliver-client').value = typeof s.client === 'string' ? s.client : '';
  deliverBox.dataset.folder = typeof s.folder === 'string' ? s.folder : '';
  $('#deliver-watermark').checked = !!s.watermark;
  $('#deliver-mark').value = typeof s.mark === 'string' ? s.mark : localStorage.getItem('deliver-mark') || 'PROOF';
  $('#deliver-progress').textContent = ''; $('#deliver-progress').classList.remove('error');
  $('#deliver-ask').hidden = true;
  paintDeliver();
  deliverBox.showModal();
}
deliverBox.addEventListener('input', paintDeliver);
deliverBox.addEventListener('change', paintDeliver);
deliverBox.addEventListener('cancel', event => { if (delivering) { event.preventDefault(); delivering.stop = true; } }); // Esc
deliverBox.addEventListener('close', () => grid.focus());
$('#deliver-open').onclick = () => { $('#deliver-open').blur(); openDeliver(); };
$('#deliver-cancel').onclick = () => { if (delivering) { delivering.stop = true; $('#deliver-progress').textContent = 'Stopping after this photo…'; } else deliverBox.close(); };
$('#deliver-change').onclick = async () => {
  const path = await invoke('pick_shoot', { title: 'Deliver to folder' });
  if (path) { deliverBox.dataset.folder = path; paintDeliver(); }
};
// One question for the whole run: replace files already there, or skip them.
function askReplace() {
  const ask = $('#deliver-ask');
  ask.querySelector('span').textContent = 'Some of these photos are already in that folder.';
  ask.hidden = false;
  $('#deliver-skip').focus();
  return new Promise(done => { $('#deliver-replace').onclick = () => done(true); $('#deliver-skip').onclick = () => done(false); })
    .finally(() => { ask.hidden = true; });
}
// The rendered photo as a JPEG, with the proof watermark at the bottom right if asked for.
function deliverJpeg(image, s) {
  const out = Object.assign(document.createElement('canvas'), { width: image.width, height: image.height }), g = out.getContext('2d');
  g.putImageData(image, 0, 0);
  if (s.watermark) {
    const size = Math.max(10, Math.round(0.03 * Math.max(image.width, image.height)));
    g.font = `600 ${size}px sans-serif`; g.fillStyle = 'rgba(255,255,255,.4)'; g.textAlign = 'right'; g.textBaseline = 'bottom';
    g.fillText(s.mark, image.width - size, image.height - size);
  }
  return new Promise((done, fail) => out.toBlob(blob => blob ? done(blob) : fail('could not make the JPEG'), 'image/jpeg', s.quality / 100));
}
$('#deliver-go').onclick = async () => {
  const s = deliverForm(), list = deliverList(s.which), shoot = dir, folder = deliverFolder(s), full = s.size === 'full';
  if (!list.length || delivering) return;
  deliverSettings = { size: s.size, quality: s.quality, names: s.names, client: s.client, folder: s.folder, watermark: s.watermark, mark: s.mark };
  localStorage.setItem('deliver-mark', s.mark);
  saveShoot();
  const progress = $('#deliver-progress'), run = delivering = { stop: false };
  progress.classList.remove('error');
  paintDeliver();
  let done = 0, skipped = 0, replace = null;
  try {
    try { exporter ||= new Developer(document.createElement('canvas')); } catch (error) { throw `this computer can't render photos (${error.message})`; }
    const limit = exporter.maxEdge();
    for (const [i, photo] of list.entries()) {
      if (run.stop) break;
      progress.textContent = `Delivering ${i + 1} of ${list.length}…`;
      const recipe = fullRecipe(recipes[photo.id]), name = deliverName(s, photo, i);
      const bytes = await invoke('export_source', { dir: shoot, name: photo.raw || photo.jpg, strokes: recipe.retouch, full });
      stale(shoot);
      const [w, h] = new Uint32Array(bytes, 0, 2);
      if (Math.max(w, h) > limit) throw `${photo.id} is ${w}×${h}; this computer's graphics can make photos up to ${limit} pixels across. Choose Web size`;
      exporter.setRaw(bytes, !!photo.raw);
      const jpeg = new Uint8Array(await (await deliverJpeg(exporter.pixels(recipe, full ? Infinity : WEB_EDGE), s)).arrayBuffer());
      const save = replace => invoke('save_export', jpeg, { headers: { dir: encodeURIComponent(shoot), folder: encodeURIComponent(folder), name: encodeURIComponent(name), replace: String(replace) } });
      try { await save(!!replace); done++; } catch (error) {
        if (!String(error).endsWith('already exists')) throw error;
        if (replace === null) replace = await askReplace();
        if (replace) { await save(true); done++; } else skipped++;
      }
    }
    const message = `${done} photo${done === 1 ? '' : 's'} in ${folder}` + (skipped ? ` · ${skipped} already there, skipped` : '') + (run.stop && done + skipped < list.length ? ' · stopped' : '');
    progress.textContent = message;
    if (shoot === dir) status(message);
  } catch (error) {
    progress.textContent = `Stopped after ${done} photo${done === 1 ? '' : 's'}: ${error}`;
    progress.classList.add('error');
  } finally {
    delivering = null;
    paintDeliver();
    $('#deliver-cancel').focus(); // the locked form dropped the focus
  }
};

// Send the current photo, developed, to Create at web size (2048 px).
let sending = false;
async function useInDesign() {
  const photo = visible[cursor];
  if (!photo || !dir || sending || delivering) return;
  sending = true;
  const shoot = dir;
  status('Sending ' + photo.id + ' to Create…');
  try {
    try { exporter ||= new Developer(document.createElement('canvas')); } catch (error) { throw `this computer can't render photos (${error.message})`; }
    const recipe = fullRecipe(recipes[photo.id]);
    const bytes = await invoke('export_source', { dir: shoot, name: photo.raw || photo.jpg, strokes: recipe.retouch, full: false });
    stale(shoot);
    exporter.setRaw(bytes, !!photo.raw);
    const jpeg = await deliverJpeg(exporter.pixels(recipe, WEB_EDGE), { quality: 92, watermark: false });
    await createFromPhoto(jpeg, photo.id);
    setMode('create');
  } catch (error) { status('Could not send the photo: ' + error, true); } finally { sending = false; }
}
$('#use-in-design').onclick = () => { $('#use-in-design').blur(); useInDesign(); };

// Updates: one check at launch; nothing shows offline. Installing waits for the last rating to save, then restarts.
async function checkForUpdate() {
  const version = await invoke('check_update').catch(() => null);
  $('#update').hidden = !version;
  if (version) { $('#update-text').textContent = `KB Studio ${version} is ready.`; $('#update-now').disabled = false; }
}
$('#update-now').onclick = async () => {
  $('#update-now').disabled = true;
  updating = true; // no new ratings or edits once the restart is coming
  if (editing) saveLook(editing);
  paintSliders();
  $('#update-text').textContent = 'Updating… KB Studio will restart by itself.';
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
invoke('app_version').then(version => { $('#version').textContent = 'KB Studio ' + version; }, () => {});
checkForUpdate();

$('#open').onclick = async () => { const path = await invoke('pick_shoot'); if (path) openShoot(path); };
invoke('startup_shoot').then(path => { if (path) { setMode('photos'); openShoot(path); } });
$('#filter').onchange = () => { renderGrid(); showViewer(); $('#filter').blur(); grid.focus(); };
// Ctrl+click adds or removes a photo from the selection, Shift+click adds the run from the current photo.
grid.onclick = event => {
  const cell = event.target.closest('.cell');
  if (!cell) return;
  const i = +cell.dataset.i, id = visible[i].id;
  if (event.shiftKey) for (let j = Math.min(i, cursor); j <= Math.max(i, cursor); j++) selected.add(visible[j].id);
  else if (event.ctrlKey || event.metaKey) {
    if (!selected.size && visible[cursor]) selected.add(visible[cursor].id);
    if (selected.has(id) && i !== cursor) selected.delete(id); else selected.add(id);
  } else selected.clear();
  move(i);
  paintSelection();
};
function paintSelection() {
  for (const cell of grid.querySelectorAll('.cell')) cell.classList.toggle('selected', selected.has(cell.dataset.id));
  counts();
}
grid.ondblclick = event => { if (event.target.closest('.cell')) { view = 'loupe'; showViewer(); } };

document.addEventListener('keydown', event => {
  if (mode !== 'photos') return;
  const target = event.target;
  if ($('#deliver').open) return; // the dialog has its own keys
  if (target.matches('input[type=range]')) {
    if (event.key === 'Escape') { event.preventDefault(); return target.blur(); }
    if (/^(Arrow|Page|Home|End)/.test(event.key)) return; // a focused slider keeps its own keys
  } else if (target.matches('select, input, button')) return;
  if (event.altKey || !dir || opening || updating) return;
  if (view === 'develop' && event.key === ' ') { event.preventDefault(); spaceHeld = true; return; } // hold to pan
  if (event.ctrlKey || event.metaKey) {
    const letter = event.key.toLowerCase();
    const ctrl = {
      ...view === 'develop' && !cropping && { z: () => undo(letter === 'y' || event.shiftKey), y: () => undo(true) },
      c: copySettings, v: pasteSettings, e: openDeliver,
      ...view === 'grid' && { a: () => { for (const p of visible) selected.add(p.id); paintSelection(); } }
    };
    if (ctrl[letter]) { event.preventDefault(); ctrl[letter](); }
    return;
  }
  const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const actions = {
    ArrowLeft: () => move(cursor - 1), ArrowRight: () => move(cursor + 1),
    ArrowUp: () => view === 'grid' ? move(cursor - columns) : move(cursor - 1),
    ArrowDown: () => view === 'grid' ? move(cursor + columns) : move(cursor + 1),
    Enter: () => { if (cropping) return endCrop(true); view = view === 'grid' ? 'loupe' : 'grid'; showViewer(); },
    ' ': () => { view = view === 'grid' ? 'loupe' : 'grid'; showViewer(); },
    Escape: () => { if (cropping) return endCrop(false); if (view === 'develop' && tool) return pickTool(null); if (view === 'grid' && selected.size) { selected.clear(); return paintSelection(); } view = 'grid'; showViewer(); },
    d: () => { view = 'develop'; showViewer(); },
    '\\': () => { if (view === 'develop' && !before) { before = true; draw(); } },
    ...view === 'develop' && {
      r: toggleCrop, j: () => pickTool('spot'), h: () => pickTool('heal'), s: () => pickTool('clone'), b: () => pickTool('soften'), e: () => pickTool('redeye'),
      '[': () => resize(1 / 1.25), ']': () => resize(1.25),
      z: () => { const box = canvas.getBoundingClientRect(); developer?.toggleZoom(pointer?.clientX ?? box.left + box.width / 2, pointer?.clientY ?? box.top + box.height / 2); draw(); }
    },
    c: () => { if (view === 'compare') view = 'loupe'; else { view = 'compare'; anchor = visible[cursor]; move(cursor + 1); } showViewer(); },
    p: () => rate({ flag: 'pick' }), x: () => rate({ flag: 'reject' }), u: () => rate({ flag: null }),
    0: () => rate({ stars: null }), 1: () => rate({ stars: 1 }), 2: () => rate({ stars: 2 }), 3: () => rate({ stars: 3 }), 4: () => rate({ stars: 4 }), 5: () => rate({ stars: 5 }),
    // In Develop, 0 fits and 1 shows 100% (the stars are for the grid and loupe).
    ...view === 'develop' && { 0: () => zoomKey(null), 1: () => zoomKey(1), '+': () => zoomKey(1.25), '=': () => zoomKey(1.25), '-': () => zoomKey(1 / 1.25) }
  };
  if (!actions[key]) return;
  event.preventDefault();
  actions[key]();
});
// Zoom keys act on the pointer, or the middle of the stage when it isn't over it. null fits, 1 is 100%, others multiply.
function zoomKey(by) {
  if (!developer) return;
  const box = canvas.getBoundingClientRect(), x = pointer?.clientX ?? box.left + box.width / 2, y = pointer?.clientY ?? box.top + box.height / 2;
  if (by === null) developer.fit(); else if (by === 1) developer.zoomTo(1, x, y); else developer.zoomBy(x, y, by);
  draw();
}
const resize = by => { brush.size = Math.min(STROKE_LIMITS.maxSize, Math.max(STROKE_LIMITS.minSize, brush.size * by)); paintTools(); draw(); };
const endBefore = () => { if (before) { before = false; draw(); } };
document.addEventListener('keyup', event => { if (event.key === '\\') endBefore(); if (event.key === ' ') spaceHeld = false; });
window.addEventListener('blur', () => { endBefore(); spaceHeld = false; });
