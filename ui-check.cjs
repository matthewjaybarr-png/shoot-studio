// Drive the culling and develop UI in headless Chromium with a fake 500-photo shoot; no real photos are read.
// The real develop shader runs on known pixels (WebGL2 through SwiftShader).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'shoot-studio-check-'));
const ui = name => fs.readFileSync(path.join(__dirname, 'ui', name), 'utf8');
const mock = `<script>
window.calls = []; window.disk = {}; window.gates = {}; window.failing = null; window.failSave = false; window.offer = null; window.sourceSize = [4, 2]; window.exportSize = [8, 6]; window.delivered = {}; window.onerror = m => document.body.dataset.testResult = 'FAIL: page error ' + m;
// Half floats for develop_source's layout: width and height as u32s, then RGB.
const half = v => { const i = new Uint32Array(new Float32Array([v]).buffer)[0], e = ((i >>> 23) & 255) - 112; return ((i >>> 16) & 0x8000) | (e <= 0 ? 0 : e >= 31 ? 0x7c00 : (e << 10) | ((i & 0x7fffff) >>> 13)); };
// rgb: every value in order, or one value for them all.
const rawImage = (w, h, rgb) => { const b = new ArrayBuffer(8 + w * h * 6), px = new Uint16Array(b, 8); new Uint32Array(b, 0, 2).set([w, h]); if (Array.isArray(rgb)) px.set(rgb.map(half)); else px.fill(half(rgb)); return b; };
const jpeg = () => new Promise(done => { const c = document.createElement('canvas'); c.width = 60; c.height = 40; c.getContext('2d').fillRect(0, 0, 60, 40); c.toBlob(b => b.arrayBuffer().then(done), 'image/jpeg'); });
window.__TAURI__ = { core: { Channel: class { onmessage() {} }, invoke: async (command, args, options) => {
  calls.push({ command, args, options });
  const failNow = window.failSave; // decided when the call starts, so a held save keeps the outcome it started with
  if (gates[command]) await gates[command].promise; // a test holds this command until it calls release()
  if (command === 'list_creations') return Object.keys(disk).filter(k => k.startsWith('c:' + args.kind + ':')).map(k => ({ name: k.split(':').slice(2).join(':'), modified: 1760000000 }));
  if (command === 'load_creation') { const v = disk['c:' + args.kind + ':' + args.name]; if (v === undefined) throw 'not found'; return v; }
  if (command === 'save_creation' && failNow) throw 'disk full';
  if (command === 'quit') return null;
  if (command === 'save_creation') { disk['c:' + options.headers.kind + ':' + decodeURIComponent(options.headers.name)] = new TextDecoder().decode(args); return null; }
  if (command === 'delete_creation') { delete disk['c:' + args.kind + ':' + args.name]; return null; }
  if (command === 'save_output') { const h = options.headers, name = decodeURIComponent(h.name) + '.' + h.ext; (window.outputs ??= {})[name] = { bytes: args, open: h.open }; return '/out/' + name; }
  if (command === 'load_create_settings') return JSON.parse(disk.createSettings || 'null');
  if (command === 'save_create_settings') { disk.createSettings = JSON.stringify(args.settings); return null; }
  if (command === 'pick_shoot') return args?.title ? '/elsewhere/Out' : '/shoots/Smith Wedding';
  if (command === 'startup_shoot') return null;
  if (command === 'app_version') return '0.1.0';
  if (command === 'check_update') { if (offer instanceof Error) throw offer.message; return offer; }
  if (command === 'install_update') { args.progress.onmessage(42); throw 'signature mismatch'; }
  if (command === 'open_shoot') return Array.from({ length: 500 }, (_, i) => { const id = 'IMG_' + String(i).padStart(4, '0'); return { id, jpg: i % 3 ? id + '.JPG' : null, raw: i % 3 < 2 ? id + '.CR2' : null }; });
  if (command === 'load_shoot') return disk[args.dir] ? JSON.parse(disk[args.dir]) : null;
  if (command === 'save_shoot') { disk[args.dir] = JSON.stringify(args.data); return null; }
  if (command === 'load_presets') return JSON.parse(disk.presets || '[]');
  if (command === 'save_presets') { disk.presets = JSON.stringify(args.presets); return null; }
  if (command === 'load_recipes') return JSON.parse(disk['recipes:' + args.dir] || '{}');
  if (command === 'save_recipe') {
    const all = JSON.parse(disk['recipes:' + args.dir] || '{}');
    if (args.recipe) all[args.id] = args.recipe; else { delete all[args.id]; delete disk[args.dir + '/edited/' + args.id]; delete disk[args.dir + '/edited/' + args.id + '.thumb']; }
    disk['recipes:' + args.dir] = JSON.stringify(all); return null;
  }
  const edited = args.dir + '/edited/' + args.id + (args.thumb ? '.thumb' : '');
  if (command === 'save_edited') { disk[edited] = new Uint8Array(args.data); return null; }
  if (command === 'edited') { if (disk[edited]) return disk[edited].buffer; throw 'no edited preview'; }
  if (command === 'develop_source') return rawImage(...sourceSize, 0.18);
  // A 1×1 patch at the top left: x, y, width, height, then one pixel.
  if (command === 'retouch') { const b = new ArrayBuffer(22); new Uint32Array(b, 0, 4).set([0, 0, 1, 1]); new Uint16Array(b, 16).set([0.5, 0.5, 0.5].map(half)); return b; }
  if (command === 'spot_source') return [0.05, 0];
  if (command === 'export_source') return rawImage(...exportSize, 0.18);
  if (command === 'save_export') {
    const h = Object.fromEntries(Object.entries(options.headers).map(([k, v]) => [k, decodeURIComponent(v)])), file = h.folder + '/' + h.name;
    if (delivered[file] && h.replace !== 'true') throw h.name + ' already exists';
    delivered[file] = new Uint8Array(args); return null;
  }
  const key = args.dir + '/' + args.name;
  if (command === 'thumb') { if (disk[key]) return disk[key].buffer; throw 'no thumbnail yet'; }
  if (command === 'save_thumb') { disk[key] = new Uint8Array(args.data); return null; }
  if (command === 'preview') { if (args.name === failing) throw 'broken preview'; return jpeg(); }
  throw 'unknown command ' + command;
} } };
</script>`;
const test = `<script>
(async () => {
  const step = (ok, message) => { if (typeof message === 'function') message = message(); document.body.dataset.testStep = message; if (!ok) throw Error(message); };
  const until = async (ok, message) => { for (let i = 0; i < 4000 && !ok(); i++) await new Promise(r => setTimeout(r, 25)); step(ok(), typeof message === 'function' ? message() : message); };
  const press = key => grid.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  const count = command => calls.filter(c => c.command === command).length;
  const hold = command => { let release; const promise = new Promise(r => release = r); gates[command] = { promise }; return () => { delete gates[command]; release(); }; };
  const tick = () => new Promise(r => setTimeout(r, 50));
  const lastSave = () => calls.filter(c => c.command === 'save_shoot').at(-1)?.args.data.ratings;
  try {
    step(!$('#home').hidden && mode === 'home', 'the app starts on the home screen');
    await until(() => $('#home-templates').children.length === 4, 'the home screen is filled in at launch with no shoot');
    $('#home-photos').click();
    step($('#home').hidden && mode === 'photos', 'Photos leaves the home screen');
    $('#open').click();
    await until(() => grid.querySelectorAll('.cell').length === 500, 'shoot opens with 500 photos');
    step($('#shoot-name').textContent === 'Smith Wedding', 'shoot name shown');
    await until(() => count('save_thumb') > 0 && loading === 0 && !wanted.length, 'visible thumbnails generated ' + $('#status').textContent);
    step(count('preview') < 120, 'thumbnails load lazily, not all 500 at once (' + count('preview') + ')');
    step(calls.some(c => c.command === 'preview' && c.args.name === 'IMG_0000.CR2'), 'raw-only photo previews from its CR2');
    step(calls.some(c => c.command === 'preview' && c.args.name === 'IMG_0001.JPG'), 'paired photo previews from its JPEG');
    grid.lastElementChild.scrollIntoView();
    await until(() => grid.lastElementChild.querySelector('img').src.startsWith('blob:'), () => 'scrolling loads the last thumbnail (loading ' + loading + ', queued ' + wanted.length + ', status ' + $('#status').textContent + ', scrollTop ' + grid.scrollTop + ', asked ' + calls.filter(c => c.args?.name?.startsWith('IMG_0499')).length + ')');

    press('ArrowRight'); press('p'); press('4');
    await until(() => JSON.stringify(lastSave()?.IMG_0001) === '{"flag":"pick","stars":4}', 'P and 4 rate the RAW+JPEG pair under one id');
    step(grid.children[1].classList.contains('pick') && grid.children[1].textContent.includes('★★★★'), 'cell shows pick and stars');
    press('ArrowRight'); press('x'); press('ArrowRight'); press('p'); press('u'); press('3'); press('0');
    await until(() => lastSave()?.IMG_0002?.flag === 'reject' && !('IMG_0003' in lastSave()), 'X rejects; U and 0 clear a rating completely');
    const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    press('ArrowDown');
    step(cursor === 3 + columns && grid.children[cursor].classList.contains('current'), 'ArrowDown moves one row (' + columns + ' columns)');
    press('ArrowLeft'); press('ArrowLeft'); press('ArrowUp');
    step(cursor === 1, 'ArrowUp moves back a row');

    press('Enter');
    await until(() => !loupe.classList.contains('hidden') && loupe.querySelector('img').src.startsWith('blob:'), 'Enter opens the loupe with a full preview');
    step(grid.classList.contains('hidden') && loupe.textContent.includes('IMG_0001'), 'loupe shows the current photo');
    press('c');
    await until(() => loupe.classList.contains('compare') && loupe.querySelectorAll('img')[1].src.startsWith('blob:'), 'C compares two photos');
    step(loupe.querySelectorAll('figcaption')[0].textContent.startsWith('IMG_0001') && loupe.querySelectorAll('figcaption')[1].textContent.startsWith('IMG_0002'), 'anchor left, candidate right');
    press('ArrowRight'); press('p');
    await until(() => lastSave()?.IMG_0003?.flag === 'pick', 'rating in compare applies to the candidate');
    step(loupe.querySelectorAll('figcaption')[0].textContent.startsWith('IMG_0001'), 'anchor stays while browsing candidates');
    step(previews.size <= 6, 'full-size previews are capped');
    press('Escape');
    step(loupe.classList.contains('hidden') && !grid.classList.contains('hidden'), 'Escape returns to the grid');

    $('#filter').value = 'picks'; $('#filter').onchange();
    step(grid.querySelectorAll('.cell').length === 2, 'Picks filter');
    $('#filter').value = 'unrated'; $('#filter').onchange();
    step(grid.querySelectorAll('.cell').length === 497 && !grid.querySelector('[data-id="IMG_0001"]'), 'Unrated filter');
    $('#filter').value = 'all'; $('#filter').onchange();

    const thumbsMade = count('save_thumb');
    await openShoot('/shoots/Smith Wedding');
    await until(() => grid.children[1].classList.contains('pick') && $('#counts').textContent === '500 photos · 2 picks · 1 rejects', 'reopening restores ratings');
    await until(() => count('thumb') > thumbsMade && loading === 0 && !wanted.length, 'reopened thumbnails settle');
    step(count('save_thumb') === thumbsMade, 'reopening reuses cached thumbnails');

    // Regressions: filtered views, stale previews, shoot switching.
    $('#filter').value = 'unrated'; $('#filter').onchange(); move(0);
    press('p');
    step(!grid.querySelector('[data-id="IMG_0000"]') && grid.children[0].dataset.id === 'IMG_0004' && grid.children[0].classList.contains('current'), 'picking under Unrated drops the frame and selects the next');
    $('#filter').value = 'picks'; $('#filter').onchange(); move(0);
    press('x');
    step(!grid.querySelector('[data-id="IMG_0000"]') && grid.querySelectorAll('.cell').length === 2, 'rejecting under Picks drops the frame');
    $('#filter').value = 'all'; $('#filter').onchange();

    move(10); press('Enter');
    await until(() => loupe.querySelector('img').dataset.name === 'IMG_0010.JPG', 'loupe shows IMG_0010');
    let release = hold('preview');
    move(12);
    const fig = loupe.querySelector('figure');
    step(!fig.querySelector('img').hasAttribute('src') && fig.textContent.startsWith('IMG_0012') && fig.classList.contains('loading'), 'moving blanks the old image while the new one loads');
    press('x');
    await until(() => lastSave()?.IMG_0012?.flag === 'reject', 'the key rates the photo being loaded');
    failing = 'IMG_0012.CR2'; release();
    await until(() => fig.classList.contains('failed'), 'failed preview is shown as failed');
    step(!fig.querySelector('img').hasAttribute('src') && $('#status').classList.contains('error'), 'failed preview leaves no other photo on screen');
    failing = null; press('Escape');

    release = hold('preview');
    grid.children[300].scrollIntoView();
    await until(() => loading > 0, 'shoot A thumbnails pending');
    const pendingA = calls.filter(c => c.command === 'preview' && c.args.dir === '/shoots/Smith Wedding').slice(-3).map(c => c.args.name);
    const lateA = preview(visible[301]).then(() => 'landed', e => String(e));
    await openShoot('/shoots/Other');
    release();
    await until(() => count('save_thumb') > thumbsMade && loading === 0 && !wanted.length, 'shoot B thumbnails settle');
    step(await lateA === 'shoot changed' && !previews.has(fileOf(photos[301])), 'a late preview from shoot A is not cached in shoot B');
    step(!calls.some(c => c.command === 'save_thumb' && c.args.dir === '/shoots/Other' && pendingA.includes(c.args.name)), "shoot A's pending thumbnails are not saved into shoot B");
    step(!Object.keys(disk).some(k => k.startsWith('/shoots/Other/') && pendingA.includes(k.split('/').pop())), "shoot B's cache holds no shoot A thumbnails");

    move(0); release = hold('save_shoot');
    press('p');
    const reopening = openShoot('/shoots/Other');
    await tick(); release(); await reopening;
    press('3');
    await until(() => JSON.stringify(lastSave()?.IMG_0000) === '{"flag":"pick","stars":3}', 'reopening during a save keeps the pick');

    // Regressions: rating while a shoot opens or an open is refused.
    const savesBefore = count('save_shoot'), before = JSON.stringify(ratings);
    release = hold('load_shoot');
    const loadingShoot = openShoot('/shoots/Other');
    await tick(); move(5); press('p'); press('4');
    step(count('save_shoot') === savesBefore && JSON.stringify(ratings) === before, 'keys cannot rate while a shoot is loading');
    release(); await loadingShoot;
    press('p');
    await until(() => lastSave()?.IMG_0000?.flag === 'pick' && JSON.stringify(lastSave()) === JSON.stringify(ratings), 'keys work again after loading');

    const opens = count('open_shoot'), saves = count('save_shoot');
    release = hold('load_shoot');
    const firstOpen = openShoot('/shoots/Other');
    await tick();
    await Promise.race([openShoot('/shoots/Smith Wedding'), tick()]);
    step(count('open_shoot') === opens + 1 && $('#open').disabled && $('#status').textContent === 'Opening…', 'a second open is refused while one is loading (' + [count('open_shoot') - opens, $('#open').disabled, $('#status').textContent] + ')');
    press('p'); press('2');
    step(count('save_shoot') === saves, 'keys stay blocked after the refused open');
    release(); await firstOpen;
    step(dir === '/shoots/Other' && !$('#open').disabled && $('#status').textContent === '', 'the accepted open completes and re-enables Open');

    const agree = (i, id) => { const fig = loupe.querySelectorAll('figure')[i]; return fig.querySelector('figcaption').textContent.startsWith(id) && fig.querySelector('img').dataset.name === fileOf(photos[+id.slice(4)]); };
    move(5); press('Enter');
    await until(() => agree(0, 'IMG_0005'), 'loupe shows unpicked IMG_0005');
    $('#filter').value = 'picks'; $('#filter').onchange();
    await until(() => agree(0, 'IMG_0000') && visible[cursor].id === 'IMG_0000', 'changing filter in the loupe shows the new current photo');
    press('x');
    await until(() => lastSave()?.IMG_0000?.flag === 'reject', 'the key rates the photo now shown');
    step(!visible.length && loupe.querySelector('figcaption').textContent === '' && !loupe.querySelector('img').hasAttribute('src'), 'an empty filter leaves the loupe empty');
    $('#filter').value = 'all'; $('#filter').onchange();
    move(1); press('c');
    await until(() => agree(0, 'IMG_0001') && agree(1, 'IMG_0002'), 'compare IMG_0001 with IMG_0002');
    press('p');
    $('#filter').value = 'unrated'; $('#filter').onchange();
    await until(() => agree(0, 'IMG_0001') && agree(1, 'IMG_0004') && visible[cursor].id === 'IMG_0004', 'changing filter in compare shows the new candidate');
    press('5');
    await until(() => lastSave()?.IMG_0004?.stars === 5, 'the key rates the candidate shown');
    press('Escape'); $('#filter').value = 'all'; $('#filter').onchange();

    // Develop: the shader on known pixels.
    const dev = new Developer(document.createElement('canvas'));
    const src = document.createElement('canvas'); src.width = 16; src.height = 16;
    const ctx = src.getContext('2d');
    for (let i = 0; i < 256; i++) { ctx.fillStyle = 'rgb(' + i + ',' + (i * 7) % 256 + ',' + (255 - i) + ')'; ctx.fillRect(i % 16, i >> 4, 1, 1); }
    for (let x = 0; x < 16; x++) { ctx.fillStyle = 'rgb(' + [x * 17, x * 17, x * 17] + ')'; ctx.fillRect(x, 15, 1, 1); } // a grey row
    const want = ctx.getImageData(0, 0, 16, 16).data;
    const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    // A JPEG arrives from Rust already linearised, as half floats.
    dev.setRaw(rawImage(16, 16, Array.from(want).filter((_, i) => i % 4 !== 3).map(lin)), false);
    const out = recipe => dev.pixels(recipe, 16).data;
    const worst = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) if (i % 4 !== 3) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
    step(worst(out({}), want) <= 1, 'a JPEG at the default recipe renders as itself (off by ' + worst(out({}), want) + ')');
    const enc = v => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
    const bright = out({ exposure: 1 });
    let off = 0;
    for (let i = 0; i < want.length; i++) if (i % 4 !== 3 && lin(want[i]) <= 0.5) off = Math.max(off, Math.abs(bright[i] - enc(2 * lin(want[i]))));
    step(off <= 1.5, 'exposure +1 doubles linear light (off by ' + off.toFixed(2) + ')');
    // Look strength and the split-toning hues only matter with a look or split toning on.
    for (const s of SLIDERS) if (!['lookAmount', 'splitShadow', 'splitHighlight'].includes(s.key)) step(worst(out({ [s.key]: s.max / 2 }), want) > 2, s.label + ' changes the picture');
    for (const l of LOOKS) step(worst(out({ look: l.id }), want) > 2, l.name + ' changes the picture');
    const at = (data, x, y) => Array.from(data.slice((y * 16 + x) * 4, (y * 16 + x) * 4 + 3));
    const grey = out({ saturation: -100 });
    let spread = 0;
    for (let i = 0; i < 256; i++) { const p = at(grey, i % 16, i >> 4); spread = Math.max(spread, Math.max(...p) - Math.min(...p)); }
    step(spread <= 2, 'saturation -100 is grey (spread ' + spread + ')');
    const luma = p => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
    const pixel = (recipe, x, y) => at(out(recipe), x, y), dark = [3, 15], light = [12, 15];
    step(luma(pixel({ shadows: 100 }, ...dark)) > luma(pixel({}, ...dark)) && luma(pixel({ highlights: -100 }, ...light)) < luma(pixel({}, ...light)), 'shadows lift dark tones, highlights pull down bright ones');
    step(luma(pixel({ contrast: 100 }, ...dark)) < luma(pixel({}, ...dark)) && luma(pixel({ contrast: 100 }, ...light)) > luma(pixel({}, ...light)), 'contrast darkens darks and brightens lights');
    dev.setRaw(rawImage(2, 1, [0.18, 0.18, 0.18, 4, 2, 1]));
    const raw = dev.pixels({}, 2).data, warm = dev.pixels({ temp: 50 }, 2).data, cool = dev.pixels({ temp: -50 }, 2).data;
    step(raw[0] > 90 && raw[0] < 160 && Math.abs(raw[0] - raw[2]) <= 1, 'RAW mid grey lands mid-tone and neutral (' + Array.from(raw.slice(0, 3)) + ')');
    step(raw[4] >= raw[5] && raw[5] >= raw[6] && raw[6] > 200, 'a RAW highlight above white rolls off without changing hue (' + Array.from(raw.slice(4, 7)) + ')');
    step(warm[0] > warm[2] && cool[2] > cool[0], 'temperature warms and cools');
    dev.setRaw(rawImage(16, 16, Array.from(want).filter((_, i) => i % 4 !== 3).map(lin)), false);
    const spreadOf = recipe => { let m = 0; for (let i = 0; i < 256; i++) { const p = at(out(recipe), i % 16, i >> 4); m = Math.max(m, Math.max(...p) - Math.min(...p)); } return m; };
    step(spreadOf({ look: 'bw' }) <= 2, 'the black & white look is grey (spread ' + spreadOf({ look: 'bw' }) + ')');
    const half = spreadOf({ look: 'bw', lookAmount: 50 });
    step(half > 20 && half < spreadOf({}) - 20, 'at 50% strength it keeps half the colour (spread ' + half + ')');
    const sepia = pixel({ look: 'sepia' }, 8, 15);
    step(sepia[0] > sepia[2] + 10, 'sepia tones grey warm (' + sepia + ')');
    const split = [pixel({ split: 100 }, 3, 15), pixel({ split: 100 }, 12, 15)];
    step(split[0][2] > split[0][0] && split[1][0] > split[1][2], 'split toning: blue shadows, warm highlights by default (' + split + ')');
    step(luma(pixel({ vignette: -100 }, 0, 0)) < luma(pixel({}, 0, 0)) && worst(out({ vignette: -100 }).slice((7 * 16 + 7) * 4, (7 * 16 + 8) * 4), want.slice((7 * 16 + 7) * 4, (7 * 16 + 8) * 4)) <= 1, 'vignette darkens the corners, not the centre');
    step(luma(pixel({ fade: 100 }, 0, 15)) > luma(pixel({}, 0, 15)) + 10, 'fade lifts black');
    // Crop: a map from the cropped picture (0–1) to the photo, and the picture it renders.
    const close = (a, b, e = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < e);
    const quarter = dev.pixels({ crop: { x: 0.5, y: 0, w: 0.5, h: 0.5, angle: 0 } }, 16), corner = [];
    for (let y = 0; y < 8; y++) corner.push(...want.slice((y * 16 + 8) * 4, (y * 16 + 16) * 4));
    step(quarter.width === 8 && quarter.height === 8 && worst(quarter.data, corner) <= 1, 'a crop renders just that part of the photo, at its size (off by ' + worst(quarter.data, corner) + ')');
    const tilted = fitCrop({ ...NO_CROP, angle: 10 }, 3000, 2000), grow = (c, k) => ({ ...c, x: c.x + c.w * (1 - k) / 2, y: c.y + c.h * (1 - k) / 2, w: c.w * k, h: c.h * k });
    step(cropFits(tilted, 3000, 2000) && !cropFits(grow(tilted, 1.001), 3000, 2000) && Math.abs(tilted.w - tilted.h) < 1e-9 && close([tilted.x + tilted.w / 2, tilted.y + tilted.h / 2], [0.5, 0.5]),
      'straightening shrinks the crop about its centre to just fit the turned photo (' + JSON.stringify(tilted) + ')');
    const map = cropMap({ x: 0.1, y: 0.2, w: 0.5, h: 0.6, angle: 7 }, 3000, 2000), px = p => [p[0] * 3000, p[1] * 2000];
    const [o, right, down] = [[0, 0], [1, 0], [0, 1]].map(p => px(mapPoint(map, p))), along = [right[0] - o[0], right[1] - o[1]], across = [down[0] - o[0], down[1] - o[1]];
    step(close(unmapPoint(map, mapPoint(map, [0.3, 0.7])), [0.3, 0.7]) && Math.abs(Math.hypot(...along) - 1500) < 1e-6 && Math.abs(Math.hypot(...across) - 1200) < 1e-6 && Math.abs(along[0] * across[0] + along[1] * across[1]) < 1e-6 && along[1] < 0,
      'the crop map turns without shearing (positive turns the picture clockwise) and inverts');
    step(close(mapPoint(cropMap(NO_CROP, 3000, 2000), [0.25, 0.75]), [0.25, 0.75]) && fullRecipe({ crop: { x: 0.8, y: 0, w: 0.5, h: 1, angle: 0 } }).crop === NO_CROP && fullRecipe({ crop: { ...NO_CROP, angle: 50 } }).crop === NO_CROP
      && !isDefault(fullRecipe({ crop: tilted })) && settingsOf({ crop: tilted }).crop === undefined, 'no crop is the identity; a bad crop is dropped; a crop is an edit that copy leaves out');
    step(fullRecipe({ look: 'not-a-look' }).look === '' && settingsOf({ exposure: 1, retouch: [{}] }).retouch === undefined, 'an unknown look is dropped; settings leave out strokes');

    // Develop: the view.
    const ctrl = (key, shiftKey = false) => grid.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey, bubbles: true }));
    const slide = (key, value) => { const input = sliders.querySelector('[data-key="' + key + '"]'); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); return input; };
    const savedRecipe = id => JSON.parse(disk['recipes:' + dir] || '{}')[id];
    move(1); press('d');
    await until(() => editing?.ready && !sliders.disabled, 'D develops the photo');
    step(!develop.classList.contains('hidden') && grid.classList.contains('hidden') && calls.at(-1).command === 'develop_source' && calls.at(-1).args.name === 'IMG_0001.CR2', 'a RAW+JPEG pair develops from its RAW');
    slide('exposure', 1);
    await until(() => savedRecipe('IMG_0001')?.exposure === 1 && savedRecipe('IMG_0001').version === 4, 'a slider change saves the recipe');
    step($('#develop-caption').textContent.includes('Edited') && sliders.querySelector('[data-key="exposure"]').previousElementSibling.textContent === '+1.00', 'caption says Edited; the slider shows its value');
    ctrl('z');
    await until(() => !savedRecipe('IMG_0001') && sliders.querySelector('[data-key="exposure"]').value === '0', 'Ctrl+Z undoes back to the camera file');
    ctrl('Z', true);
    await until(() => savedRecipe('IMG_0001')?.exposure === 1 && sliders.querySelector('[data-key="exposure"]').value === '1', 'Ctrl+Shift+Z redoes');
    slide('contrast', 30).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await until(() => savedRecipe('IMG_0001')?.contrast === 0 || savedRecipe('IMG_0001')?.contrast === undefined, 'double-clicking a slider resets it');
    ctrl('z');
    await until(() => savedRecipe('IMG_0001')?.contrast === 30, 'and that reset can be undone');
    press('\\\\');
    step($('#develop-caption').textContent.includes('Before'), 'holding the backslash key shows before');
    document.dispatchEvent(new KeyboardEvent('keyup', { key: '\\\\', bubbles: true }));
    step(!$('#develop-caption').textContent.includes('Before'), 'releasing it shows after');
    const looks = count('save_edited');
    press('ArrowRight');
    await until(() => count('save_edited') === looks + 2 && disk[dir + '/edited/IMG_0001.thumb'], 'leaving a photo saves its edited look and thumbnail');
    await until(() => editing?.ready && editing.photo.id === 'IMG_0002', 'ArrowRight develops the next photo');
    step(calls.some(c => c.command === 'develop_source' && c.args.name === 'IMG_0002.JPG') && !editing.photo.raw && !developer.raw, 'a JPEG-only photo develops from its JPEG');
    step(grid.querySelector('[data-id="IMG_0001"] figcaption').textContent.includes('Edited'), 'the grid marks the photo Edited');
    press('Escape'); move(1); press('Enter');
    await until(() => loupe.querySelector('img').dataset.name === 'edited:IMG_0001', 'the loupe shows the edited look');
    step(calls.some(c => c.command === 'edited' && c.args.id === 'IMG_0001' && !c.args.thumb), 'from the saved edited preview');
    press('Escape');
    const camera = thumbs.get('IMG_0004');
    move(4); press('d');
    await until(() => editing?.ready && editing.photo.id === 'IMG_0004', 'develop IMG_0004');
    slide('saturation', -100); press('Escape');
    await until(() => disk[dir + '/edited/IMG_0004.thumb'] && thumbs.get('IMG_0004') !== camera, 'its grid thumbnail becomes the edited look');
    await openShoot(dir);
    step(recipes.IMG_0001?.exposure === 1 && recipes.IMG_0001.contrast === 30 && grid.children[1].textContent.includes('Edited'), 'recipes survive reopening the shoot');
    await until(() => calls.some(c => c.command === 'edited' && c.args.id === 'IMG_0001' && c.args.thumb) && loading === 0 && !wanted.length, 'reopened grid uses edited thumbnails');
    move(1); press('d');
    await until(() => editing?.ready && sliders.querySelector('[data-key="contrast"]').value === '30', 'the sliders show the saved recipe');
    $('#reset').click();
    await until(() => !savedRecipe('IMG_0001') && !disk[dir + '/edited/IMG_0001'] && !grid.children[1].textContent.includes('Edited'), 'Reset all goes back to the camera file');

    // Looks, presets, copy and paste.
    const choose = (id, value) => { $(id).value = value; $(id).dispatchEvent(new Event('change', { bubbles: true })); };
    const strength = sliders.querySelector('[data-key="lookAmount"]');
    step(strength.disabled && $('#look').querySelectorAll('optgroup').length === 3 && $('#look').options.length === LOOKS.length + 1, 'every look is in the list; strength is off without one');
    choose('#look', 'sepia');
    await until(() => savedRecipe('IMG_0001')?.look === 'sepia' && savedRecipe('IMG_0001').version === 4, 'choosing a look saves it');
    step(!strength.disabled && strength.previousElementSibling.textContent === '100%', 'its strength slider turns on at 100%');
    slide('lookAmount', 40); slide('grain', 20);
    await until(() => savedRecipe('IMG_0001')?.lookAmount === 40 && savedRecipe('IMG_0001').grain === 20, 'strength and grain save on top of the look');
    ctrl('c');
    step(clipboard?.look === 'sepia' && clipboard.lookAmount === 40 && !('retouch' in clipboard), 'Ctrl+C copies the settings, not strokes');
    $('#preset-save').click();
    step(!$('#preset-name').hidden, 'Save asks for a preset name');
    $('#preset-name').value = 'Soft sepia';
    $('#preset-name').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await until(() => presets.length === 1 && JSON.parse(disk.presets || '[]')[0]?.recipe.lookAmount === 40 && $('#preset-name').hidden, 'the preset saves to the settings folder');
    ctrl('z'); ctrl('z'); ctrl('z');
    await until(() => !savedRecipe('IMG_0001') && $('#look').value === '', 'undo back to the camera file');
    choose('#preset', '0');
    await until(() => savedRecipe('IMG_0001')?.look === 'sepia' && savedRecipe('IMG_0001').grain === 20 && $('#look').value === 'sepia', 'applying a preset sets its settings');
    ctrl('z');
    await until(() => !savedRecipe('IMG_0001'), 'a preset is one undo step');
    ctrl('v');
    await until(() => savedRecipe('IMG_0001')?.look === 'sepia', 'Ctrl+V in Develop pastes onto the open photo');
    choose('#preset', '0'); $('#preset-delete').click();
    step(presets.length === 1 && $('#preset-delete').textContent === 'Sure?', 'Delete asks once more');
    $('#preset-delete').click();
    await until(() => !presets.length && disk.presets === '[]', 'a second click deletes the preset');
    press('Escape');
    const click = (i, extra = {}) => grid.children[i].dispatchEvent(new MouseEvent('click', { bubbles: true, ...extra }));
    click(5); click(6, { ctrlKey: true }); click(8, { shiftKey: true });
    step(selected.size === 4 && ['5', '6', '7', '8'].every(i => grid.children[i].classList.contains('selected')) && $('#counts').textContent.includes('4 selected'), 'Ctrl+click and Shift+click select photos');
    ctrl('v');
    const pasted = ['IMG_0005', 'IMG_0006', 'IMG_0007', 'IMG_0008'];
    await until(() => pasted.every(id => savedRecipe(id)?.lookAmount === 40 && disk[dir + '/edited/' + id + '.thumb']) && $('#status').textContent === 'Pasted onto 4 photos', () => 'Ctrl+V pastes onto every selected photo and saves their looks: ' + $('#status').textContent);
    step(pasted.every(id => grid.querySelector('[data-id="' + id + '"] figcaption').textContent.includes('Edited')), 'the pasted photos show as Edited');
    click(3);
    step(!selected.size && !grid.querySelector('.selected'), 'a plain click clears the selection');
    ctrl('a');
    step(selected.size === visible.length, 'Ctrl+A selects them all');
    press('Escape');
    step(!selected.size && !grid.classList.contains('hidden'), 'Esc clears the selection');

    // Retouch: brush strokes land in the recipe as points across the photo (0–1), at fit and zoomed in.
    sourceSize = [1600, 1200];
    move(13); press('d');
    await until(() => editing?.ready && editing.photo.id === 'IMG_0013' && developer.width === 1600, 'develop a 1600×1200 photo');
    const box = canvas.getBoundingClientRect(), fit = Math.min(box.width / 1600, box.height / 1200);
    const fitted = (x, y) => [(x - box.left - (box.width - 1600 * fit) / 2) / (1600 * fit), (y - box.top - (box.height - 1200 * fit) / 2) / (1200 * fit)];
    const near = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 2e-4);
    const nearAll = (a, b) => a.length === b.length && a.every((p, i) => near(p, b[i]));
    const mouse = (type, x, y, extra = {}) => canvas.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, bubbles: true, ...extra }));
    const drag = (path, extra) => { mouse('pointerdown', ...path[0], extra); for (const p of path.slice(1)) mouse('pointermove', ...p, extra); mouse('pointerup', ...path.at(-1), extra); };
    const strokes = () => savedRecipe('IMG_0013')?.retouch || [];
    const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
    press('j');
    step(tool === 'spot' && sliders.querySelector('[data-tool="spot"]').classList.contains('active') && $('.stage').classList.contains('brush'), 'J picks spot heal');
    const spotPath = [[cx, cy], [cx + 15, cy], [cx + 30, cy + 5], [cx + 45, cy + 10]];
    drag(spotPath);
    await until(() => strokes().length === 1, 'a spot stroke is saved');
    let saved = strokes()[0];
    step(saved.tool === 'spot' && nearAll(saved.points, spotPath.map(p => fitted(...p))) && saved.size === 0.01 && near(saved.offset, [0.05, 0]) && saved.strength === undefined, 'at fit, the stroke is saved at the photo points it covered, with the source Rust picked (' + JSON.stringify(saved) + ')');
    step(calls.some(c => c.command === 'spot_source' && c.args.name === 'IMG_0013.CR2' && near(c.args.stroke.points[0], saved.points[0])), 'spot heal asks Rust for its source');
    await until(() => calls.some(c => c.command === 'retouch' && c.args.strokes.length === 1 && c.args.name === 'IMG_0013.CR2'), 'and Rust applies the stroke');
    step(savedRecipe('IMG_0013').version === 4 && $('#develop-caption').textContent.includes('Edited'), 'a retouch alone makes the photo Edited');

    press(']');
    step(Math.abs(brush.size - 0.0125) < 1e-9 && sliders.querySelector('[data-brush="size"]').previousElementSibling.textContent === '20 px', '] makes the brush bigger');
    press('['); press('[');
    step(Math.abs(brush.size - 0.008) < 1e-9, '[ makes it smaller');

    // Z zooms to 100% around the pointer; Space+drag pans. At 100%, one screen pixel is one photo pixel here.
    mouse('pointermove', cx, cy, { buttons: 0 });
    const centre = fitted(cx, cy);
    press('z');
    step(developer.view.zoom === 1 && near(developer.toImage(cx, cy), centre), 'Z zooms to 100% keeping the point under the pointer (' + JSON.stringify(developer.view) + ' ' + developer.toImage(cx, cy) + ' vs ' + centre + ')');
    press(' ');
    drag([[cx, cy], [cx - 60, cy - 20], [cx - 100, cy - 50]]);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
    step(strokes().length === 1, 'Space+drag pans without painting');
    const zoomed = (x, y) => [centre[0] + (x - cx + 100) / 1600, centre[1] + (y - cy + 50) / 1200];
    step(near(developer.toImage(cx, cy), zoomed(cx, cy)), 'the pan moved the photo by the drag (' + developer.toImage(cx, cy) + ' vs ' + zoomed(cx, cy) + ')');

    // Deep zoom: the wheel zooms at the pointer up to 1600%, a stroke at 800% lands on the pixel under it, the navigator and readout follow.
    const keep = { ...developer.view }, stage = $('.stage'), nav = $('#navigator');
    const wheel = (x, y, deltaY) => stage.dispatchEvent(new WheelEvent('wheel', { clientX: x, clientY: y, deltaY, bubbles: true, cancelable: true }));
    developer.fit(); draw();
    const under = developer.toImage(cx + 30, cy);
    wheel(cx + 30, cy, -1300);
    step(developer.percent() > 500 && developer.percent() < 1600 && near([developer.toImage(cx + 30, cy)[0]], [under[0]]) && Math.abs(developer.toImage(cx + 30, cy)[1] - under[1]) < 2e-3, 'the wheel zooms in keeping the point under the pointer (' + developer.percent() + '% ' + developer.toImage(cx + 30, cy) + ' vs ' + under + ' ' + JSON.stringify(developer.view) + ')');
    wheel(cx, cy, -9000);
    await until(() => $('#zoom-readout').textContent === '1600%' && !nav.hidden, 'zoom stops at 1600%, the readout says so and the navigator shows');
    wheel(cx, cy, 9000);
    await until(() => $('#zoom-readout').textContent !== '1600%' && developer.view.zoom === null && nav.hidden, 'wheeling out fits the photo and hides the navigator');
    developer.zoomTo(8, cx, cy); draw();
    await until(() => $('#zoom-readout').textContent === '800%', 'the readout follows to 800%');
    const hit = developer.toImage(cx + 13, cy - 7);
    press('e');
    mouse('pointerdown', cx + 13, cy - 7); mouse('pointerup', cx + 13, cy - 7);
    await until(() => strokes().length === 2, 'a click at 800% saves a red-eye stroke');
    step(near(strokes()[1].points[0], hit) && developer.percent() === 800, 'it hit the photo pixel under the pointer at 800% (' + strokes()[1].points[0] + ' vs ' + hit + ')');
    ctrl('z');
    await until(() => strokes().length === 1, 'and it undoes');
    press('+');
    step(developer.percent() === 1000, '+ zooms in by a quarter step (800 → 1000)');
    press('0');
    step(developer.view.zoom === null, '0 fits');
    press('1');
    step(developer.percent() === 100, '1 shows 100%');
    developer.zoomTo(4, cx, cy); draw();
    const r = nav.querySelector('canvas').getBoundingClientRect();
    nav.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + 1, clientY: r.top + 1, button: 0, buttons: 1, pointerId: 7, bubbles: true }));
    const edge = developer.placement();
    step(Math.abs(edge.x) < 1e-6 && Math.abs(edge.y) < 1e-6, 'the navigator moves the view, and panning stops at the photo edge (' + edge.x + ',' + edge.y + ')');
    // The navigator redraws when the look or the crop changes, not only when the pixels do.
    const keyWas = navKey, recipeWas = editing.recipe, cropWas = developer.crop;
    editing.recipe = { ...recipeWas, exposure: 1 }; paintZoom();
    step(navKey !== keyWas && !navKey.includes('[object Object]'), () => 'an exposure change refreshes the navigator: ' + navKey);
    editing.recipe = recipeWas; paintZoom();
    const keyFull = navKey;
    developer.crop = { ...cropWas, w: cropWas.w * 0.9 }; paintZoom();
    step(navKey !== keyFull, 'a crop change refreshes the navigator');
    developer.crop = cropWas; paintZoom();
    // The source preview comes from the photo, so a source far from the view still has pixels.
    const far = developer.around(editing.recipe, [0.02, 0.98], 40);
    step(far && far.width >= 1 && far.height >= 1 && far.data.some(v => v), 'a source off screen still renders its patch');
    developer.view = keep; draw();
    await until(() => nav.hidden === (developer.view.zoom === null) && $('#zoom-readout').textContent === '100%', 'back to 100%');

    press('h');
    drag([[cx, cy], [cx + 20, cy]]);
    step(strokes().length === 1 && $('#status').textContent.includes('Alt+click'), 'heal waits for a source');
    mouse('pointermove', cx, cy, { buttons: 0 });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const overlayAlpha = () => $('#overlay').getContext('2d').getImageData(Math.round(cx - box.left), Math.round(cy - box.top), 1, 1).data[3];
    step(overlayAlpha() === 0, 'with no source there is no preview inside the brush');
    mouse('pointerdown', cx - 80, cy - 40, { altKey: true }); mouse('pointerup', cx - 80, cy - 40, { altKey: true });
    mouse('pointermove', cx, cy, { buttons: 0 });
    await until(() => overlayAlpha() === 255, 'Alt+click sets the source and the brush shows what it would copy');
    const healPath = [[cx, cy], [cx + 10, cy], [cx + 20, cy + 10]];
    drag(healPath);
    await until(() => strokes().length === 2, 'Ctrl+click then a drag saves a heal stroke');
    saved = strokes()[1];
    const from = zoomed(cx - 80, cy - 40), first = zoomed(...healPath[0]);
    step(saved.tool === 'heal' && saved.size === 0.008 && nearAll(saved.points, healPath.map(p => zoomed(...p))) && near(saved.offset, [from[0] - first[0], from[1] - first[1]]), 'at 100% after a pan, the heal points and source offset are right (' + JSON.stringify(saved) + ')');
    drag([[cx + 50, cy], [cx + 60, cy]]);
    await until(() => strokes().length === 3, 'a second heal stroke');
    const second = zoomed(cx + 50, cy);
    step(near(strokes()[2].offset, saved.offset) && !('strength' in saved), 'Aligned is on: the next stroke keeps the same distance to the source (' + JSON.stringify(strokes()[2].offset) + ')');
    await until(() => calls.filter(c => c.command === 'retouch').at(-1)?.args.strokes.length === 3, 'Rust gets all three strokes');
    $('#aligned input').click();
    drag([[cx + 50, cy + 20], [cx + 60, cy + 20]]);
    await until(() => strokes().length === 4, 'a stroke with Aligned off');
    const third = zoomed(cx + 50, cy + 20);
    step(near(strokes()[3].offset, [from[0] - third[0], from[1] - third[1]]), 'with Aligned off it restarts from the clicked source (' + JSON.stringify(strokes()[3].offset) + ')');
    $('#aligned input').click();
    ctrl('z');
    await until(() => strokes().length === 3, 'it undoes');
    // Strength is on every brush: heal at 50% saves it, soften always does and marks its bands as scaled.
    sliders.querySelector('[data-brush="strength"]').value = 50;
    sliders.querySelector('[data-brush="strength"]').dispatchEvent(new Event('input', { bubbles: true }));
    drag([[cx + 70, cy], [cx + 80, cy]]);
    await until(() => strokes().length === 4, 'a heal at 50%');
    step(strokes()[3].strength === 0.5 && strengthOf('spot') === 1, 'strength is saved when under 100% and is kept per tool (' + JSON.stringify(strokes()[3]) + ')');
    press('b');
    step(sliders.querySelector('[data-brush="strength"]').value === '50' && !$('#strength').hidden, 'soften has its own strength slider, at 50% to start');
    drag([[cx + 90, cy], [cx + 100, cy]]);
    await until(() => strokes().length === 5, 'a soften stroke');
    step(strokes()[4].tool === 'soften' && strokes()[4].strength === 0.5 && strokes()[4].scaled === true, 'soften saves its strength and scaled bands (' + JSON.stringify(strokes()[4]) + ')');
    ctrl('z'); ctrl('z');
    await until(() => strokes().length === 3, 'both undo');
    press('h');

    ctrl('z');
    await until(() => strokes().length === 2 && calls.filter(c => c.command === 'retouch').at(-1)?.args.strokes.length === 2, 'Ctrl+Z removes the last stroke and Rust replays the rest');
    press('e');
    drag([[cx, cy], [cx + 4, cy], [cx + 8, cy]]);
    await until(() => strokes().length === 3, 'E then a drag saves a red-eye circle');
    saved = strokes()[2];
    step(saved.tool === 'redeye' && Math.abs(saved.size - 8 / 1600) < 1e-4 && saved.points.length === 1 && near(saved.points[0], zoomed(cx, cy)) && !('offset' in saved) && !('strength' in saved), 'its centre and radius are where it was dragged, with no source (' + JSON.stringify(saved) + ')');
    await until(() => calls.filter(c => c.command === 'retouch').at(-1)?.args.strokes.at(-1)?.tool === 'redeye', 'Rust applies it');
    ctrl('z');
    await until(() => strokes().length === 2, 'and it undoes');
    press('Escape');
    step(tool === null && !develop.classList.contains('hidden') && !$('.stage').classList.contains('brush'), 'Esc drops the tool and stays in Develop');

    // Crop: R shows the whole photo with the crop over it; Enter applies it as one undo step, Esc cancels.
    const crop = () => savedRecipe('IMG_0013')?.crop || NO_CROP;
    const screen = view => { const [x, y] = developer.fromView(view); return [box.left + x, box.top + y]; };
    press('r');
    step(cropping && developer.view.zoom === null && $('.stage').classList.contains('cropping') && sliders.querySelector('[data-tool="heal"]').disabled && $('#crop').textContent.includes('Apply'), 'R starts cropping at fit, with the brushes off');
    press('j');
    step(tool === null, 'brush keys do nothing while cropping');
    step(sameCrop(cropping.crop, NO_CROP), 'the crop starts as the whole photo');
    drag([screen([1, 1]), [screen([1, 1])[0] - 100, screen([1, 1])[1] - 10]]);
    const shrunk = 1 - 100 / (1600 * fit);
    step(close([cropping.crop.x, cropping.crop.y, cropping.crop.w, cropping.crop.h], [0, 0, shrunk, shrunk], 1e-4), 'dragging a corner resizes from the opposite corner at the photo shape (' + JSON.stringify(cropping.crop) + ')');
    press('Escape');
    step(!cropping && sameCrop(editing.recipe.crop, NO_CROP) && sameCrop(crop(), NO_CROP) && !develop.classList.contains('hidden'), 'Esc cancels the crop and stays in Develop');

    press('r');
    $('#aspect').value = '1:1'; $('#aspect').dispatchEvent(new Event('change'));
    let c = cropping.crop;
    step(Math.abs(c.w * 1600 - c.h * 1200) < 1e-6 && c.h === 1 && Math.abs(c.x - 0.125) < 1e-9, '1:1 makes the largest square in the middle (' + JSON.stringify(c) + ')');
    drag([screen([0.5, 0.5]), [screen([0.5, 0.5])[0] + 1000, screen([0.5, 0.5])[1] + 1000]]);
    c = cropping.crop;
    step(Math.abs(c.x + c.w - 1) < 1e-6 && c.y === 0 && Math.abs(c.w * 1600 - c.h * 1200) < 1e-6, 'moving it stops at the edge of the photo (' + JSON.stringify(c) + ')');
    drag([screen([c.x + c.w, 1]), screen([c.x + c.w / 2, 1])]);
    c = cropping.crop;
    step(Math.abs(c.w * 1600 - c.h * 1200) < 1e-6 && c.h < 0.6 && c.h > 0.4, 'a locked corner keeps the square (' + JSON.stringify(c) + ')');
    const angle = sliders.querySelector('[data-crop="angle"]');
    angle.value = 5; angle.dispatchEvent(new Event('input', { bubbles: true }));
    step(cropping.crop.angle === 5 && cropFits(cropping.crop, 1600, 1200) && developer.crop.angle === 5 && sameCrop({ ...developer.crop, angle: 0 }, NO_CROP) && angle.previousElementSibling.textContent === '+5.0°', 'Straighten turns the photo and keeps the crop on it');
    angle.dispatchEvent(new Event('change', { bubbles: true }));
    const applied = cropping.crop;
    press('Enter');
    await until(() => sameCrop(crop(), applied), 'Enter applies the crop and saves it');
    step(!cropping && developer.view.zoom === null && sameCrop(developer.crop, applied) && savedRecipe('IMG_0013').version === 4 && strokes().length === 2, 'the view shows the cropped picture; the strokes are kept');
    const [px0, py0] = developer.fromImage([0.6, 0.4]);
    step(close(developer.toImage(box.left + px0, box.top + py0), [0.6, 0.4], 1e-6), 'screen and photo points still match through the crop');
    ctrl('z');
    await until(() => sameCrop(editing.recipe.crop, NO_CROP) && sameCrop(crop(), NO_CROP), 'one Ctrl+Z takes the whole crop back');
    ctrl('z', true);
    await until(() => sameCrop(crop(), applied), 'and redo puts it back');
    $('#crop-reset').click();
    await until(() => sameCrop(crop(), NO_CROP), 'Reset crop clears it');
    press('Escape');
    step(develop.classList.contains('hidden') && !grid.classList.contains('hidden'), 'a second Esc goes to the grid');
    await until(() => disk[dir + '/edited/IMG_0013.thumb'], 'leaving saves the retouched look');
    sourceSize = [4, 2];

    { // Deliver.
    const box = $('#deliver'), which = v => box.querySelector('[value=' + v + ']');
    const set = (el, value) => { if (el.type === 'checkbox' || el.type === 'radio') el.checked = value; else el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
    const picks = () => photos.filter(p => ratings[p.id]?.flag === 'pick');
    if (picks().length < 2) { move(20); press('p'); move(21); press('p'); }
    while (selected.size) { press('Escape'); if (selected.size) selected.clear(); }
    step(!$('#deliver-open').disabled, 'Deliver is ready once a shoot is open');
    ctrl('e');
    await until(() => box.open, 'Ctrl+E opens Deliver');
    step(which('picks').checked && which('selected').disabled, 'Picks is the default when there are picks');
    const want = picks().length;
    step($('#deliver-count').textContent === want + ' photos', () => 'count shows the picks: ' + $('#deliver-count').textContent);
    const savesBefore = count('save_shoot'); press('x');
    step(count('save_shoot') === savesBefore, 'keys do not rate behind the dialog');
    set($('#deliver-client'), '');
    step($('#deliver-go').disabled, 'no delivering without a client name');
    set($('#deliver-client'), ' Smith & Wedding! ');
    step($('#deliver-preview').textContent.startsWith('Smith-Wedding-0001.jpg, Smith-Wedding-0002.jpg'), () => 'names are filename safe: ' + $('#deliver-preview').textContent);
    step($('#deliver-folder').textContent.replaceAll('\u200e', '') === dir + '/Delivered/Smith-Wedding', () => 'default folder: ' + $('#deliver-folder').textContent);
    set($('#deliver-size'), 'web'); set($('#deliver-quality'), '80'); set($('#deliver-watermark'), true); set($('#deliver-mark'), 'PROOF');
    step($('#deliver-quality-value').textContent === '80', 'quality shows its value');
    delivered[dir + '/Delivered/Smith-Wedding/Smith-Wedding-0002.jpg'] = new Uint8Array(1);
    $('#deliver-go').click();
    await until(() => !$('#deliver-ask').hidden, 'a file already there asks once');
    step($('#deliver-form').disabled && $('#deliver-cancel').textContent === 'Stop', 'the form is locked while delivering');
    $('#deliver-skip').click();
    await until(() => $('#deliver-progress').textContent.startsWith((want - 1) + ' photo'), () => 'finishes: ' + $('#deliver-progress').textContent);
    step($('#deliver-progress').textContent.includes('1 already there, skipped'), 'and says what it skipped');
    const exports = calls.filter(c => c.command === 'save_export');
    step(exports.length === want && exports.every(c => decodeURIComponent(c.options.headers.folder) === dir + '/Delivered/Smith-Wedding'), 'one save per photo, into the client folder');
    step(calls.filter(c => c.command === 'export_source').every(c => c.args.full === false), 'web size asks for a smaller source');
    const first = delivered[dir + '/Delivered/Smith-Wedding/Smith-Wedding-0001.jpg'];
    step(first && first[0] === 0xff && first[1] === 0xd8, 'the files are JPEGs');
    step(delivered[dir + '/Delivered/Smith-Wedding/Smith-Wedding-0002.jpg'].length === 1, 'skipped files are left alone');
    const saved = JSON.parse(disk[dir]).deliver;
    step(saved && saved.client === 'Smith & Wedding!' && saved.size === 'web' && saved.quality === 80 && saved.watermark && saved.folder === null, () => 'choices saved in the shoot: ' + JSON.stringify(saved));
    step(JSON.parse(disk[dir]).ratings && localStorage.getItem('deliver-mark') === 'PROOF', 'ratings and the mark are kept too');
    // The proof mark lands at the bottom right and nowhere else.
    exporter.setRaw(new Uint8Array(rawImage(200, 100, 0)).buffer, false);
    const plain = exporter.pixels(fullRecipe(), 2048);
    const marked = await createImageBitmap(await deliverJpeg(plain, { watermark: true, mark: 'PROOF', quality: 100 }));
    const look = Object.assign(document.createElement('canvas'), { width: 200, height: 100 }).getContext('2d');
    look.drawImage(marked, 0, 0);
    const bright = (x, y, w, h) => Math.max(...look.getImageData(x, y, w, h).data.filter((_, i) => i % 4 === 0));
    step(bright(120, 80, 74, 14) > 40 && bright(0, 0, 100, 50) < 20, 'the proof mark is at the bottom right');
    // Change the folder; Esc closes; it opens with the saved choices.
    $('#deliver-change').click();
    await until(() => $('#deliver-folder').textContent.replaceAll('\u200e', '') === '/elsewhere/Out', 'Change picks another folder');
    step(calls.filter(c => c.command === 'pick_shoot').at(-1).args.title, 'the folder picker has a title');
    box.dispatchEvent(new Event('cancel')); box.close();
    ctrl('e');
    await until(() => box.open, 'opens again');
    step($('#deliver-client').value === 'Smith & Wedding!' && $('#deliver-size').value === 'web' && $('#deliver-watermark').checked && $('#deliver-folder').textContent.replaceAll('\u200e', '') === dir + '/Delivered/Smith-Wedding', 'it remembers the last delivery, not an unused folder');
    // Stop stops after the current photo.
    set($('#deliver-names'), 'original'); set($('#deliver-client'), '');
    step($('#deliver-preview').textContent.startsWith(picks()[0].id + '.jpg') && !$('#deliver-go').disabled, 'original names need no client');
    release = hold('export_source');
    const before = count('export_source');
    $('#deliver-go').click();
    await until(() => count('export_source') === before + 1, 'delivering again');
    step($('#deliver-progress').textContent === 'Delivering 1 of ' + want + '…', () => 'progress: ' + $('#deliver-progress').textContent);
    box.dispatchEvent(new Event('cancel', { cancelable: true }));
    step(box.open, 'Esc does not close while delivering');
    release();
    await until(() => $('#deliver-progress').textContent.endsWith('stopped'), () => 'Stop finishes the current photo: ' + $('#deliver-progress').textContent);
    step(count('export_source') === before + 1 && $('#deliver-cancel').textContent === 'Close', 'and no more');
    // A photo too big for the graphics card stops with advice.
    set($('#deliver-size'), 'full'); exportSize = [exporter.maxEdge() + 1, 1];
    $('#deliver-go').click();
    await until(() => $('#deliver-progress').classList.contains('error'), 'a photo too big stops');
    step($('#deliver-progress').textContent.includes('Choose Web size'), () => 'with advice: ' + $('#deliver-progress').textContent);
    exportSize = [8, 6];
    $('#deliver-cancel').click();
    step(!box.open, 'Close closes');
    }

    // Updates.
    step($('#update').hidden && $('#version').textContent === 'KB Studio 0.1.0', 'no banner without an update; version shown');
    offer = '0.1.1'; await checkForUpdate();
    step(!$('#update').hidden && $('#update-text').textContent.includes('0.1.1'), 'banner offers the newer version');
    move(7); release = hold('save_shoot');
    press('p');
    $('#update-now').click();
    await tick();
    step(count('install_update') === 0 && $('#update-now').disabled, 'install waits for the last rating to save');
    const savesDuring = count('save_shoot');
    press('x');
    step(count('save_shoot') === savesDuring, 'keys cannot rate while updating');
    release();
    await until(() => count('install_update') === 1 && lastSave()?.IMG_0007?.flag === 'pick', 'install starts after the save lands');
    await until(() => $('#update-text').textContent.includes('signature mismatch') && !$('#update-now').disabled, 'a failed install says so and can be retried');
    press('u');
    await until(() => !lastSave()?.IMG_0007, 'keys work again after a failed install');
    offer = new Error('offline'); await checkForUpdate();
    step($('#update').hidden, 'offline shows nothing');
    // Create.
    const settle = async (promise, what = 'something finishes') => { let done = false, value, error; promise.then(v => { value = v; done = true; }, e => { error = e; done = true; }); await until(() => done, what); if (error) throw error; return value; };
    const put = (el, value, type) => { el.value = value; el.dispatchEvent(new Event(type, { bubbles: true })); };
    $('#photos-home').click();
    step(mode === 'home' && !$('#home').hidden, 'Start returns to the home screen');
    $('#home-create').click();
    await until(() => mode === 'create' && board && design && $('#create-title').value === 'Untitled', 'Create opens a new design');
    step(design.page === 'letter' && pagePx().join() === '816,1056' && board.getObjects().length === 0 && board.backgroundColor === '#ffffff', 'it is a blank Letter page');
    step(board.getWidth() <= 816 && board.getWidth() / board.getHeight() > 0.76 && board.getWidth() / board.getHeight() < 0.78, 'the page fits the window in the right shape');
    const types = () => board.getObjects().map(o => o.kbName).join();
    $('#add-text').click(); board.getActiveObject().exitEditing?.();
    $('#add-rect').click(); $('#add-circle').click(); $('#add-line').click(); $('#add-arrow').click();
    const png = await new Promise(r => { const c = document.createElement('canvas'); c.width = 4000; c.height = 1000; c.getContext('2d').fillRect(0, 0, 4000, 1000); c.toBlob(r, 'image/png'); });
    await settle(addImageBlob(png, 'test'), 'a picture is added');
    await settle(addEmoji('2b50'), 'clip art is added');
    step(types() === 'Text,Rectangle,Circle,Line,Arrow,Photo test,star', () => 'every kind of item can be added: ' + types());
    const pic = board.getObjects()[5];
    step(pic.width === 3300 && pic.height === 825, () => 'a big picture is shrunk to 3300 px: ' + pic.width + 'x' + pic.height);
    step($('#layers').children.length === 7 && $('#layers').firstChild.textContent.startsWith('star'), 'the layers list shows the top layer first');
    // Layers: reorder, hide, lock.
    const row = n => $('#layers').children[n];
    const layerButton = (n, title) => [...row(n).querySelectorAll('button')].find(b => b.title.startsWith(title));
    layerButton(0, 'Send backward').click();
    step(types().endsWith('Photo test,star') === false && types().endsWith('star,Photo test'), 'Send backward moves a layer down');
    layerButton(1, 'Bring forward').click();
    step(types().endsWith('Photo test,star'), 'Bring forward moves it back');
    layerButton(0, 'Show or hide').click();
    step(board.getObjects()[6].visible === false && row(0).classList.contains('off'), 'Hide hides a layer');
    layerButton(0, 'Lock').click();
    step(board.getObjects()[6].kbLocked && board.getObjects()[6].lockMovementX, 'Lock stops it moving');
    layerButton(0, 'Show or hide').click(); layerButton(0, 'Lock').click();
    step(board.getObjects()[6].visible !== false && !board.getObjects()[6].lockMovementX, 'Show and Unlock undo those');
    // Align.
    const rect = board.getObjects()[1];
    board.setActiveObject(rect);
    document.querySelector('[data-align=left]').click();
    step(Math.abs(rect.getBoundingRect().left) < 1, 'Align left puts the box at the page edge');
    document.querySelector('[data-align=centre]').click();
    step(Math.abs(rect.getBoundingRect().left + rect.getBoundingRect().width / 2 - 408) < 1, 'Align centre puts it in the middle');
    document.querySelector('[data-align=bottom]').click();
    step(Math.abs(rect.getBoundingRect().top + rect.getBoundingRect().height - 1056) < 1, 'Align bottom');
    // Colour and the background.
    put($('#prop-fill'), '#ff0000', 'input');
    step(rect.fill === '#ff0000', 'the colour box recolours the selection');
    // Undo and redo.
    const base = history.length;
    $('#create-undo').click();
    await until(() => board.getObjects()[1].fill === '#ffd966' || board.getObjects()[1].fill !== '#ff0000', 'Undo goes back a step');
    $('#create-redo').click();
    await until(() => board.getObjects()[1].fill === '#ff0000', 'Redo goes forward again');
    while (here > 0) await settle(stepHistory(-1), 'undo finishes');
    step(board.getObjects().length === 0 && $('#create-undo').disabled && !$('#create-redo').disabled, () => 'undo walks back to the blank page: ' + board.getObjects().length + ' items, at ' + at + ', undo disabled ' + $('#create-undo').disabled);
    while (here < history.length - 1) await settle(stepHistory(1), 'redo finishes');
    step(board.getObjects().length === 7 && $('#create-redo').disabled, 'redo walks forward to the end');
    for (let i = 0; i < 70; i++) { board.getObjects()[0].set({ left: i }); commitDesign(); }
    step(history.length === 50 && here === 49, () => 'undo keeps at most 50 snapshots: ' + history.length);
    // Saving.
    await until(() => disk['c:designs:Untitled'] && JSON.parse(disk['c:designs:Untitled']).canvas.objects.length === 7, 'autosave writes the design');
    step(JSON.parse(disk['c:designs:Untitled']).canvas.objects.length === 7 && JSON.parse(disk['c:designs:Untitled']).page === 'letter', 'the saved file holds the design');
    put($('#create-title'), 'Poster', 'change');
    await until(() => disk['c:designs:Poster'] && !disk['c:designs:Untitled'], 'renaming moves the file');
    // Page sizes and tiling.
    put($('#create-page'), 'quarter', 'change');
    step(pagePx().join() === '408,528' && !$('#create-tile').disabled, 'quarter sheet is 4.25 x 5.5 in');
    const q = pageLayout('quarter', 'sheet');
    step(q.sheet.join() === '8.5,11' && q.tiles.map(t => t.x + ',' + t.y).join(' ') === '0,0 4.25,0 0,5.5 4.25,5.5' && q.marks.length === 4, 'four quarter cards tile onto a Letter with cut marks');
    const h = pageLayout('half', 'sheet');
    step(h.sheet.join() === '11,8.5' && h.tiles.map(t => t.x + ',' + t.y).join(' ') === '0,0 5.5,0', 'two half sheets sit side by side on landscape Letter');
    step(pageLayout('letter', 'sheet').tiles.length === 1, 'a Letter page is never tiled');
    put($('#create-tile'), 'sheet', 'change'); put($('#create-copies'), '2', 'change');
    $('#create-pdf').click();
    await until(() => window.outputs?.['Poster.pdf'], () => 'the PDF is made: ' + $('#create-saved').textContent);
    const outputs = window.outputs, pdf = new TextDecoder('latin1').decode(outputs['Poster.pdf'].bytes);
    step(pdf.startsWith('%PDF') && (pdf.match(/\\/Type\\s*\\/Page\\b/g) || []).length === 2, () => 'the PDF has one page per copy: ' + (pdf.match(/\\/Type\\s*\\/Page\\b/g) || []).length);
    step(/MediaBox\\s*\\[\\s*0\\s+0\\s+612\\.?0*\\s+792\\.?0*\\s*\\]/.test(pdf) && outputs['Poster.pdf'].open === 'false', () => 'on Letter paper: ' + pdf.slice(pdf.indexOf('MediaBox') - 5, pdf.indexOf('MediaBox') + 40) + ' open=' + outputs['Poster.pdf'].open);
    $('#create-print').click();
    await until(() => window.outputs['Poster.pdf'].open === 'true', 'Print opens the PDF');
    $('#create-png').click();
    await until(() => window.outputs['Poster.png'], 'PNG export');
    const img = await settle(createImageBitmap(new Blob([window.outputs['Poster.png'].bytes], { type: 'image/png' })), 'the PNG decodes');
    step(img.width === 1275 && img.height === 1650, () => 'PNG is 300 dpi: ' + img.width + 'x' + img.height);
    $('#create-jpeg').click();
    await until(() => window.window.outputs['Poster.jpg'] && window.outputs['Poster.jpg'].bytes[0] === 255, 'JPEG export');
    $('#create-bw').click();
    step($('#create-stage').classList.contains('bw'), 'Preview in B&W greys the page');
    $('#create-bw').click();
    put($('#create-page'), 'letter', 'change');
    // Home lists recent designs; opening one brings it back.
    await settle($('#create-home').onclick(), 'Start saves and leaves');
    await until(() => $('#home-recent').children.length === 1 && $('#home-recent').textContent.startsWith('Poster'), 'home lists the recent design');
    $('#home-recent').firstChild.click();
    await until(() => mode === 'create' && board.getObjects().length === 7 && design.title === 'Poster', 'a recent design reopens');
    // Starter templates, saved templates, fonts, colours and clip art.
    await settle($('#create-home').onclick(), 'Start saves and leaves');
    const names = [...$('#home-templates').children].map(b => b.textContent);
    step(names.join() === 'Behaviour chart,Labels,Word wall,Newsletter', () => 'four starter templates: ' + names);
    for (const name of names) {
      await settle(Promise.resolve($('#home-templates').children[names.indexOf(name)].click()));
      await until(() => mode === 'create' && design.title === 'My ' + name && board.getObjects().length > 5, 'the ' + name + ' template opens');
      step(board.getObjects().some(o => o.type === 'textbox' && o.text) && board.getObjects().every(o => !o.text || o.text.length < 120), 'the ' + name + ' has placeholder text');
      await settle($('#create-home').onclick(), 'Start saves and leaves');
      await until(() => $('#home-templates').children.length >= 4, 'home again');
    }
    await settle(Promise.resolve($('#home-templates').children[0].click()));
    await until(() => mode === 'create' && design.title === 'My Behaviour chart 2', 'a template opens');
    $('#create-save-template').click();
    await until(() => disk['c:templates:My Behaviour chart 2'], 'Save as template stores it');
    await settle($('#create-home').onclick(), 'Start saves and leaves');
    await until(() => [...$('#home-templates').children].some(b => b.textContent === 'My Behaviour chart 2'), 'a saved template is offered on the home screen');
    [...$('#home-templates').children].find(b => b.textContent === 'My Behaviour chart 2').click();
    await until(() => mode === 'create' && design.title === 'My My Behaviour chart 2' && board.getObjects().length > 5, 'a saved template makes a new design');
    // Fonts.
    step([...$('#prop-font').options].map(o => o.value).join() === 'Lexend,Andika,Atkinson Hyperlegible,Comic Neue,Fredoka', 'five fonts are offered');
    step(FONTS.every(f => document.fonts.check('16px "' + f + '"')), 'all five fonts are loaded');
    $('#add-text').click(); board.getActiveObject().exitEditing?.();
    const words = board.getActiveObject();
    put($('#prop-font'), 'Fredoka', 'change');
    step(words.fontFamily === 'Fredoka', 'the font menu changes the text');
    $('#prop-fav').click();
    step(settings.fonts.join() === 'Fredoka' && JSON.parse(disk.createSettings).fonts.join() === 'Fredoka' && $('#prop-font').options[0].value === 'Fredoka', 'a favourite font is saved and listed first');
    // Saved colours.
    put($('#prop-fill'), '#12ab34', 'input');
    $('#colour-save').click();
    step(JSON.parse(disk.createSettings).colours.join() === '#12ab34' && $('#colours').children.length === 1, 'a colour is saved');
    board.discardActiveObject(); board.requestRenderAll();
    $('#colours').firstChild.click();
    step(board.backgroundColor === '#12ab34', 'a saved colour fills the page when nothing is selected');
    // Clip art.
    const countBefore = board.getObjects().length;
    $('#emoji-list').querySelector('[data-code="2764"]').click();
    await until(() => board.getObjects().length === countBefore + 1 && board.getObjects().at(-1).kbName === 'heart', 'a clip-art button adds it');
    step($('#emoji-list').children.length === 40 && document.body.textContent.includes('CC-BY 4.0'), 'clip art is credited in the app');
    // Photos sends a developed photo to Create.
    await settle($('#create-home').onclick(), 'Start saves and leaves');

    // Review fixes: a rename never overwrites another design, a failed save keeps the work, queued renames, closing.
    setMode('create');
    await flush();
    disk['c:designs:Taken'] = '{"keep":"me"}';
    const mine = design.title;
    put($('#create-title'), 'Taken', 'change');
    step(await flush().then(() => 'saved', e => String(e)).then(r => r.includes('already exists')), 'renaming onto another design is refused');
    step(disk['c:designs:Taken'] === '{"keep":"me"}' && disk['c:designs:' + mine], 'both designs are still on disk');
    put($('#create-title'), 'Renamed A', 'change');
    await flush();
    step(disk['c:designs:Renamed A'] && !disk['c:designs:' + mine] && disk['c:designs:Taken'] === '{"keep":"me"}', 'a free name renames the file');
    window.failSave = true;
    board.getObjects()[0].set({ left: 7 }); commitDesign();
    step(await flush().then(() => 'saved', e => String(e)) === 'disk full', 'a failed save is reported to the caller');
    await $('#create-home').onclick();
    step(mode === 'create', () => 'Start stays put when the save failed: ' + mode + ' ' + dirty + ' ' + $('#create-saved').textContent);
    step(await newDesign().then(() => 'opened', () => 'refused') === 'refused' && design.title === 'Renamed A', 'a new design is refused too, so the work stays on the page');
    window.failSave = false;
    await flush();
    step(JSON.parse(disk['c:designs:Renamed A']).canvas.objects[0].left === 7, 'retrying saves it');
    const release2 = hold('save_creation');
    put($('#create-title'), 'Q1', 'change'); const firstSave = flush();
    await tick();
    put($('#create-title'), 'Q2', 'change'); const second2 = flush();
    release2(); await Promise.all([firstSave, second2]);
    step(disk['c:designs:Q2'] && !disk['c:designs:Q1'] && !disk['c:designs:Renamed A'], () => 'queued renames leave only the last name: ' + Object.keys(disk).filter(k => k.startsWith('c:designs')));
    // An older save finishing must not mark a newer edit saved.
    {
      const rel = hold('save_creation');
      board.getObjects()[0].set({ left: 11 }); commitDesign();
      const a = flush().catch(() => {}); await tick();
      window.failSave = true; board.getObjects()[0].set({ left: 12 }); commitDesign();
      const b = flush().then(() => 'saved', e => String(e));
      rel(); await a; // A started while saves worked, so it succeeds; only B fails
      step(await b === 'disk full' && dirty && JSON.parse(disk['c:designs:' + design.title]).canvas.objects[0].left === 11, () => 'a newer failed save stays dirty after an older success: ' + dirty);
      await $('#create-home').onclick();
      step(mode === 'create', 'and navigation is blocked');
      window.failSave = false; await flush();
    }
    // Edits during a delayed close are saved before quitting.
    {
      const rel = hold('save_creation'), q0 = count('quit');
      board.getObjects()[0].set({ left: 21 }); commitDesign();
      const closing = kbClose(); await tick();
      step($('#create').inert, 'editing is frozen while closing');
      board.getObjects()[0].set({ left: 22 }); commitDesign();
      rel(); await closing;
      step(count('quit') === q0 + 1 && !dirty && JSON.parse(disk['c:designs:' + design.title]).canvas.objects[0].left === 22, 'a late edit is saved before quitting');
      $('#create').inert = false;
    }
    // An import still decoding when the window closes is waited for and saved.
    {
      let land; const q0 = count('quit');
      track(new Promise(r => land = r).then(() => { board.getObjects()[0].set({ left: 41 }); commitDesign(); }));
      const closing = kbClose(); await tick();
      step(count('quit') === q0, 'close waits for an import in flight');
      land(); await closing;
      step(count('quit') === q0 + 1 && !dirty && JSON.parse(disk['c:designs:' + design.title]).canvas.objects[0].left === 41, 'the late import is saved before quitting');
      $('#create').inert = false;
    }
    // A batch of pictures closing mid-way: the files not started yet are still added.
    {
      const q0 = count('quit'), n0 = board.getObjects().length, jpegBytes = await jpeg(), files = [0, 1, 2].map(i => new File([jpegBytes], 'batch' + i + '.jpg', { type: 'image/jpeg' }));
      importFiles(files);
      step(adding.size === 2, () => 'the batch is one job on top of the file decoding now: ' + adding.size); // decoding is too quick in the mock to catch the gap by timing
      const closing = kbClose(); await closing;
      step(count('quit') === q0 + 1 && board.getObjects().length === n0 + 3 && !dirty, () => 'a multi-file import completes before quitting: ' + (board.getObjects().length - n0) + ' added, dirty ' + dirty);
      $('#create').inert = false;
    }
    // An import finishing while Photos' saves drain is still saved before quitting.
    {
      let open; saving = new Promise(r => open = r);
      const q0 = count('quit'), closing = kbClose(); await tick();
      board.getObjects()[0].set({ left: 31 }); commitDesign();
      open(); await closing;
      step(count('quit') === q0 + 1 && !dirty && JSON.parse(disk['c:designs:' + design.title]).canvas.objects[0].left === 31, 'a late import is saved before quitting');
      $('#create').inert = false;
    }
    put($('#create-title'), 'Closing', 'change');
    const quits = count('quit');
    await kbClose();
    step(disk['c:designs:Closing'] && count('quit') === quits + 1, 'closing saves first, then quits');
    window.failSave = true;
    put($('#create-title'), 'Closing 2', 'change');
    await kbClose();
    step(count('quit') === quits + 1 && $('#create-saved').textContent.includes('close again'), 'closing with a failed save waits and says so');
    await kbClose();
    step(count('quit') === quits + 2, 'a second close goes through');
    window.failSave = false;
    put($('#create-title'), 'Closing', 'change');
    await flush();
    $('#home-photos').click();
    move(2);
    const sends = count('export_source');
    $('#use-in-design').click();
    await until(() => mode === 'create' && board.getObjects().length === 1 && board.getObjects()[0].kbName === 'Photo IMG_0002', () => 'Use in a design opens it in Create: ' + mode + ' ' + types());
    step(count('export_source') === sends + 1 && calls.filter(c => c.command === 'export_source').at(-1).args.full === false && Math.max(board.getObjects()[0].width, board.getObjects()[0].height) <= 2048, 'it was rendered at web size');
    document.body.dataset.testResult = 'PASS';
  } catch (e) { document.body.dataset.testResult = 'FAIL: ' + e.message; }
})();
</script>`;
const html = ui('index.html')
  .replace('<link rel="stylesheet" href="style.css">', '<style>' + ui('style.css') + '</style>')
  .replace('<script src="develop.js"></script>', mock + '<script>' + ui('develop.js') + '</script>')
  .replace('<head>', '<head><base href="file://' + path.join(__dirname, 'ui') + '/">')
  .replace('<script src="app.js"></script>', '<script>' + ui('app.js') + '</script>')
  .replace('<script src="vendor/fabric.min.js"></script>', () => '<script>' + ui('vendor/fabric.min.js') + '</script>')
  .replace('<script src="vendor/jspdf.umd.min.js"></script>', () => '<script>' + ui('vendor/jspdf.umd.min.js') + '</script>')
  .replace('<script src="create.js"></script>', () => '<script>' + ui('create.js') + '</script>' + test);
const file = path.join(temp, 'check.html');
fs.writeFileSync(file, html);
const result = cp.spawnSync(process.env.CHROMIUM || '/usr/bin/chromium', ['--headless', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-first-run', '--no-sandbox', '--allow-file-access-from-files', '--window-size=1300,850', '--user-data-dir=' + path.join(temp, 'profile'), '--virtual-time-budget=600000', '--dump-dom', 'file://' + file], { encoding: 'utf8', timeout: 180000, maxBuffer: 2e7 });
const outcome = result.stdout?.match(/data-test-result="([^"]*)"/)?.[1];
if (outcome === 'PASS') { fs.rmSync(temp, { recursive: true, force: true }); console.log('PASS: culling and develop UI'); process.exit(0); }
console.error('UI check failed: ' + (outcome || 'no result after ' + (result.stdout?.match(/data-test-step="([^"]*)"/)?.[1] || result.stderr || result.error)) + '\nCheck file: ' + file);
process.exit(1);
