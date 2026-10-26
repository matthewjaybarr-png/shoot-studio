// Drive the culling and develop UI in headless Chromium with a fake 500-photo shoot; no real photos are read.
// The real develop shader runs on known pixels (WebGL2 through SwiftShader).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'shoot-studio-check-'));
const appConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'src-tauri/tauri.conf.json'), 'utf8')).app;
if (appConfig.windows.some(w => w.dragDropEnabled !== false)) throw Error('HTML file drops require native interception disabled');
const ui = name => fs.readFileSync(path.join(__dirname, 'ui', name), 'utf8');
// Literal relative fetches use connect-src, not script-src or img-src.
const connectPolicy = appConfig.security.csp.split(';').map(s => s.trim()).find(s => s.startsWith('connect-src ')) || appConfig.security.csp.split(';').map(s => s.trim()).find(s => s.startsWith('default-src ')) || '';
for (const file of fs.readdirSync(path.join(__dirname, 'ui')).filter(f => f.endsWith('.js'))) {
  for (const [, url] of ui(file).matchAll(/\bfetch\s*\(\s*['"]([^'"]+)['"]/g)) {
    if (!/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url) && !connectPolicy.split(/\s+/).includes("'self'")) throw Error(file + ': local fetch requires connect-src self: ' + url);
  }
}
const emojiIndex = JSON.parse(ui('emoji-index.json'));
// Saved and rendered by Fabric 6.9.1: images, text, transformed group and clipPath frame.
const fabric6Fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'test-data/create-fabric6.json'), 'utf8'));
if (new Set(emojiIndex.map(e => e.code)).size !== emojiIndex.length || emojiIndex.some(e => !fs.existsSync(path.join(__dirname, 'ui/emoji', e.code + '.svg')))) throw Error('Clip art index must reference unique existing SVGs');
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
    await until(() => $('#home-templates').children.length === Object.keys(STARTERS).length, 'the home screen is filled in at launch with no shoot');
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
    // Look strength, the split-toning hues and Masking only matter with a look or split toning on.
    for (const s of SLIDERS) if (!['lookAmount', 'splitShadow', 'splitHighlight', 'sharpenMask'].includes(s.key)) step(worst(out({ [s.key]: s.max / 2 }), want) > 2, s.label + ' changes the picture');
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
    // Detail: sharpen, masking and noise reduction on small made-up sources.
    {
      const lumaOf = (f, w = 16) => dev.setRaw(rawImage(w, 16, Array.from({ length: w * 16 }, (_, i) => f(i % w, i >> 4)).flat()), false);
      const view = recipe => dev.pixels(recipe, 16).data, G = (data, x, y) => data[(y * 16 + x) * 4 + 1];
      let seed = 7; const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5;
      const variance = a => { const m = a.reduce((x, y) => x + y) / a.length; return a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length; };
      const inner = f => { const v = []; for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) v.push(f(x, y)); return v; };
      lumaOf(() => [0.2, 0.2, 0.2]);
      step(worst(view({ sharpen: 100 }), view({})) === 0, 'sharpen leaves a flat photo alone');
      const edge = (lo, hi) => lumaOf(x => { const v = x < 8 ? lo : hi; return [v, v, v]; });
      edge(0.1, 0.4);
      const base = view({}), sharp = view({ sharpen: 100, sharpenMask: 0 });
      step(G(sharp, 7, 8) < G(base, 7, 8) - 3 && G(sharp, 8, 8) > G(base, 8, 8) + 3, 'sharpen overshoots on both sides of an edge (' + [G(base, 7, 8), G(sharp, 7, 8), G(base, 8, 8), G(sharp, 8, 8)] + ')');
      edge(0.2, 0.23);
      const lowBase = G(view({}), 8, 8), over = mask => G(view({ sharpen: 100, sharpenMask: mask }), 8, 8) - lowBase;
      step(over(0) > 2 && over(100) < over(0) / 2, 'masking spares a low-contrast edge (overshoot ' + over(0) + ' at 0, ' + over(25) + ' at 25, ' + over(100) + ' at 100)');
      // Colour noise: chroma jitter at constant luma (the offset (0.7152, -0.2126, 0) has none).
      lumaOf(() => { const n = rand() * 0.2; return [0.3 + 0.7152 * n, 0.3 - 0.2126 * n, 0.3]; });
      const chroma = d => variance(inner((x, y) => d[(y * 16 + x) * 4] - d[(y * 16 + x) * 4 + 1])), mean = d => inner((x, y) => luma(at(d, x, y))).reduce((a, b) => a + b) / 64;
      const noisy = view({}), clean = view({ nrColour: 100 });
      step(chroma(clean) < chroma(noisy) / 4 && Math.abs(mean(clean) - mean(noisy)) <= 1, 'colour noise reduction flattens chroma and keeps luma (variance ' + chroma(noisy).toFixed(1) + ' to ' + chroma(clean).toFixed(1) + ', mean luma ' + mean(noisy).toFixed(2) + ' to ' + mean(clean).toFixed(2) + ')');
      // Luminance noise.
      lumaOf(() => { const v = 0.3 + rand() * 0.06; return [v, v, v]; });
      const grainy = view({}), smooth = view({ nrLuma: 100 }), spreadG = d => variance(inner((x, y) => G(d, x, y)));
      step(spreadG(smooth) < spreadG(grainy) / 2, 'luminance noise reduction smooths a noisy patch (variance ' + spreadG(grainy).toFixed(1) + ' to ' + spreadG(smooth).toFixed(1) + ')');
      edge(0.1, 0.5);
      step([6, 7, 8, 9].every(x => Math.abs(G(view({ nrLuma: 100 }), x, 8) - G(view({}), x, 8)) <= 2), 'luminance noise reduction keeps a hard edge a step');
      // Noise reduction first, then sharpen: alternating columns must not come out noisier than they went in.
      lumaOf(x => { const v = x % 2 ? 0.33 : 0.27; return [v, v, v]; });
      const swing = d => Math.abs(G(d, 8, 8) - G(d, 9, 8));
      step(swing(view({ nrLuma: 100, sharpen: 100, sharpenMask: 0 })) <= swing(view({})), 'sharpen after luminance noise reduction does not bring the noise back (swing ' + swing(view({})) + ' to ' + swing(view({ nrLuma: 100 })) + ' to ' + swing(view({ nrLuma: 100, sharpen: 100, sharpenMask: 0 })) + ')');
      // The same photo at Develop's size and at twice that (full-size Deliver) gets the same Detail.
      const wide = (w, x0) => dev.setRaw(rawImage(w, 16, Array.from({ length: w * 16 }, (_, i) => { const v = i % w < x0 ? 0.1 : 0.4; return [v, v, v]; }).flat()), false);
      const rowAt = (recipe, x) => { const img = dev.pixels(recipe, 3072); return [x - 1, x, x + 1].map(i => img.data[((img.height >> 1) * 3072 + i) * 4 + 1]); };
      // Rust shrinks by a whole factor, ceil(long side / 3072): 6144 by 2, and 3200 by 2 too (to 1600).
      const edgeRow = (w, x0, out) => { wide(w, x0); const img = dev.pixels({ sharpen: 100, sharpenMask: 0, nrLuma: 50 }, out); return [x0 * out / w - 1, x0 * out / w, x0 * out / w + 1].map(i => img.data[((img.height >> 1) * img.width + i) * 4 + 1]); };
      const proxy = edgeRow(3072, 1536, 3072), full = edgeRow(6144, 3072, 3072);
      const proxy2 = edgeRow(1600, 800, 1600), full2 = edgeRow(3200, 1600, 1600);
      step([[3072, 1], [3073, 2], [3200, 2], [6144, 2], [6145, 3], [12288, 4], [12289, 5], [12800, 5]].every(([long, factor]) => detailScale(long, 100) === factor && detailScale(100, long) === factor), 'Detail scale is the whole shrink factor Rust uses, with no cap past 12288 px');
      step(proxy2.every((v, i) => Math.abs(v - full2[i]) <= 4), 'Detail looks the same at 3200 px and its 1600 px proxy (' + proxy2 + ' against ' + full2 + ')');
      step(proxy.every((v, i) => Math.abs(v - full[i]) <= 4), 'Detail looks the same on the proxy and the full-size source (' + proxy + ' against ' + full + ')');
      // Noise at the source's own pitch, in a full-size (scale 2) source: the taps must average, not skip, columns.
      dev.setRaw(rawImage(6144, 16, Array.from({ length: 6144 * 16 }, (_, i) => { const v = i % 2 ? 0.33 : 0.27; return [v, v, v]; }).flat()), false);
      const wideSwing = recipe => { const img = dev.pixels(recipe, 6144); return Math.abs(img.data[(8 * 6144 + 3000) * 4 + 1] - img.data[(8 * 6144 + 3001) * 4 + 1]); };
      step(wideSwing({ nrLuma: 100 }) <= wideSwing({}) / 4 && wideSwing({ nrLuma: 100, sharpen: 100, sharpenMask: 0 }) <= wideSwing({}) / 4, 'luminance noise reduction clears alternating columns in a full-size source (swing ' + wideSwing({}) + ' to ' + wideSwing({ nrLuma: 100 }) + ', with sharpen ' + wideSwing({ nrLuma: 100, sharpen: 100, sharpenMask: 0 }) + ')');
      // Odd scales too: a periodic pattern that averages to a flat proxy must come out flat at scale 3 and 5.
      for (const [w, period] of [[7200, [0.1, 0.4, 0.1]], [15360, [0.1, 0.4, 0.1, 0.25, 0.1]]]) {
        if (w > dev.maxEdge()) { document.body.dataset.skipped = (document.body.dataset.skipped || '') + ' ' + w + 'px(maxEdge ' + dev.maxEdge() + ')'; continue; }
        dev.setRaw(rawImage(w, 16, Array.from({ length: w * 16 }, (_, i) => { const v = period[i % period.length]; return [v, v, v]; }).flat()), false);
        const range = recipe => { const img = dev.pixels(recipe, w), at = x => img.data[(8 * w + x) * 4 + 1], xs = period.map((_, i) => at(w / 2 + i)); return Math.max(...xs) - Math.min(...xs); };
        step(range({ nrLuma: 100 }) <= range({}) / 8 && range({ nrLuma: 100, sharpen: 100, sharpenMask: 0 }) <= range({}) / 8, 'luminance noise reduction flattens a period-' + period.length + ' pattern at scale ' + detailScale(w, 16) + ' (range ' + range({}) + ' to ' + range({ nrLuma: 100 }) + ')');
      }
      lumaOf(x => [x / 16, 0.3, 0.6]);
      step(worst(view({ sharpenMask: 100, sharpen: 0 }), view({})) === 0 && worst(view({ sharpen: 0, nrColour: 0, nrLuma: 0 }), view({})) === 0, 'with every Detail slider at 0 the picture is unchanged');
      dev.setRaw(rawImage(16, 16, Array.from(want).filter((_, i) => i % 4 !== 3).map(lin)), false);
    }
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
    await until(() => savedRecipe('IMG_0001')?.exposure === 1 && savedRecipe('IMG_0001').version === 6, 'a slider change saves the recipe');
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
    await until(() => savedRecipe('IMG_0001')?.look === 'sepia' && savedRecipe('IMG_0001').version === 6, 'choosing a look saves it');
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
    step(savedRecipe('IMG_0013').version === 6 && $('#develop-caption').textContent.includes('Edited'), 'a retouch alone makes the photo Edited');

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
    const spotCalls = calls.filter(c => c.command === 'spot_source').length;
    for (const [key, name, start] of [['l', 'blur', 100], ['o', 'dodge', 25], ['i', 'burn', 25]]) {
      press(key);
      step(tool === name && sliders.querySelector('[data-brush="strength"]').value === String(start), key.toUpperCase() + ' picks ' + name + ' at ' + start + '%');
      drag([[cx, cy], [cx + 10, cy]]);
      await until(() => strokes().length === 3, 'a ' + name + ' stroke');
      saved = strokes()[2];
      step(saved.tool === name && !('offset' in saved) && !('scaled' in saved) && (start === 100 ? !('strength' in saved) : saved.strength === 0.25), name + ' saves with no source (' + JSON.stringify(saved) + ')');
      await until(() => calls.filter(c => c.command === 'retouch').at(-1)?.args.strokes.at(-1)?.tool === name, 'Rust applies ' + name);
      ctrl('z');
      await until(() => strokes().length === 2, name + ' undoes');
    }
    step(calls.filter(c => c.command === 'spot_source').length === spotCalls, 'blur, dodge and burn never ask for a heal source');
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
    step(!cropping && developer.view.zoom === null && sameCrop(developer.crop, applied) && savedRecipe('IMG_0013').version === 6 && strokes().length === 2, 'the view shows the cropped picture; the strokes are kept');
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
    step(816 * board.getZoom() <= board.getWidth() && 1056 * board.getZoom() <= board.getHeight() && Math.abs(2 * board.viewportTransform[4] + 816 * board.getZoom() - board.getWidth()) < 2 && board.getWidth() === Math.floor($('#create-stage').getBoundingClientRect().width), 'the canvas fills the stage and the whole page fits, centred');
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
    await until(() => pagePx().join() === '408,528' && !$('#create-tile').disabled, 'quarter sheet is 4.25 x 5.5 in');
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
    await until(() => pagePx().join() === '816,1056', 'back to Letter');
    // Home lists recent designs; opening one brings it back.
    await settle($('#create-home').onclick(), 'Start saves and leaves');
    await until(() => $('#home-recent').children.length === 1 && $('#home-recent').textContent.startsWith('Poster'), 'home lists the recent design');
    $('#home-recent').firstChild.click();
    await until(() => mode === 'create' && board.getObjects().length === 7 && design.title === 'Poster', 'a recent design reopens');
    // Starter templates, saved templates, fonts, colours and clip art.
    await settle($('#create-home').onclick(), 'Start saves and leaves');
    const names = [...$('#home-templates').children].map(b => b.textContent);
    step(names.join() === 'Behaviour chart,Labels,Word wall,Newsletter,Certificate,Name tags,Flash cards,Calendar,Handwriting worksheet,Student of the week,Mini session flyer,Photo card,Instagram post,Square collage,Story', () => 'fifteen starter templates: ' + names);
    for (const name of names) {
      await settle(Promise.resolve($('#home-templates').children[names.indexOf(name)].click()));
      await until(() => !navigating && mode === 'create' && design.title === 'My ' + name && board.getObjects().length >= 4, 'the ' + name + ' template opens');
      step(board.getObjects().some(o => (o.type === 'textbox' && o.text) || emptyFrame(o)) && board.getObjects().every(o => !o.text || o.text.length < 120), 'the ' + name + ' has placeholder text or photo frames');
      step(history.length === 2, 'the ' + name + ' template is one undo step');
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
    step([...$('#prop-font').options].map(o => o.value).join() === FONTS.join() && FONTS.length === 11, 'eleven fonts are offered');
    step(FONTS.every(f => document.fonts.check('16px "' + f + '"')), 'all eleven fonts are loaded');
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
    await settle(emojiReady, 'clip art index loads');
    put($('#emoji-search'), 'red heart', 'input');
    $('#emoji-list').querySelector('[data-code="2764"]').click();
    await until(() => board.getObjects().length === countBefore + 1 && board.getObjects().at(-1).kbName === 'red heart', 'a clip-art button adds it');
    step(emojiEntries.length > 3600 && $('#emoji-list').children.length <= 60 && document.body.textContent.includes('CC-BY 4.0'), 'full clip art is indexed and credited with bounded results');
    put($('#emoji-search'), 'cat', 'input');
    step([...$('#emoji-list').children].some(b => b.dataset.code === '1f408'), 'search cat finds the cat');
    put($('#emoji-category'), 'Animals & Nature', 'change');
    step([...$('#emoji-list').children].every(b => emojiEntries.find(e => e.code === b.dataset.code).group === 'Animals & Nature'), 'category filters search results');
    put($('#emoji-search'), 'no such graphic xyz', 'input');
    step(!$('#emoji-list').children.length && $('#emoji-next').disabled && $('#emoji-prev').disabled, 'empty search has no pages');
    put($('#emoji-search'), '', 'input'); put($('#emoji-category'), '', 'change');
    const firstCode = $('#emoji-list').firstChild.dataset.code;
    $('#emoji-next').click();
    step($('#emoji-list').children.length === 60 && $('#emoji-list').firstChild.dataset.code !== firstCode, 'clip art advances a page');
    step([...$('#emoji-list').querySelectorAll('img')].every(i => i.loading === 'lazy'), 'clip art images load lazily');
    $('#emoji-prev').click();
    step($('#emoji-list').firstChild.dataset.code === firstCode, 'clip art returns to the first page');
    { // B2: real Fabric objects, save/reopen and output font waits.
      await settle(newDesign(), 'B2 blank design');
      $('#create-table').requestSubmit();
      step(board.getObjects().filter(o => o.kbName === 'Table cell').length === 12 && board.getObjects().filter(o => o.kbName === 'Cell text').length === 12 && board.getObjects().every(o => !o.group), 'a 3x4 table has twelve editable cells');
      let rejected = 0;
      for (const args of [[0, 4], [3, 21], [1.5, 2], [NaN, 2]]) { try { addTable(...args); } catch { rejected++; } }
      step(rejected === 4 && board.getObjects().length === 24, 'table dimensions reject invalid values before adding objects');
      const previousPage = design.page; design.page = 'quarter';
      const narrow = tableCells(20, 20);
      step(narrow.filter(o => o.kbName === 'Cell text').every(o => o.text === '' && o.width <= (pagePx()[0] - 96) / 20 - 12), 'narrow quarter-sheet cells start blank without expanding their textboxes');
      design.page = previousPage;
      $('#add-handwriting').click();
      step(board.getActiveObject().getObjects().length === 3 && board.getActiveObject().getObjects()[1].strokeDashArray.join() === '6,4', 'handwriting lines have a dashed middle');
      $('#qr-text').value = 'HELLO WORLD'; $('#create-qr').requestSubmit();
      const qrObject = board.getActiveObject(), modules = qrObject.getObjects();
      step(modules[0].width === 29 && modules[0].fill === '#ffffff' && modules[1].type === 'path' && modules[1].width === 21 && modules[1].left - modules[0].left === 4, 'known QR has 21 modules and a four-module white quiet zone');
      const savedPath = JSON.stringify(modules[1].path), title = design.title;
      step(qrcode.stringToBytes('Café 📚').join() === [...new TextEncoder().encode('Café 📚')].join(), 'QR text uses UTF-8 bytes');
      let badQr = 0;
      for (const text of ['', ' ', 'x'.repeat(1001)]) { try { addQr(text); } catch { badQr++; } }
      step(badQr === 3, 'QR rejects empty or overlong input');
      await flush(); await settle(openDesign(title), 'B2 objects reopen');
      step(board.getObjects().filter(o => o.kbName === 'Table cell').length === 12 && board.getObjects().find(o => o.kbName === 'Handwriting lines').getObjects()[1].strokeDashArray.join() === '6,4' && JSON.stringify(board.getObjects().at(-1).getObjects()[1].path) === savedPath, 'table, handwriting and vector QR survive saving');
      const loadFont = document.fonts.load.bind(document.fonts); let releaseFont, fontFinished = false, rendered = false;
      const fontGate = new Promise(r => releaseFont = r);
      document.fonts.load = async (...args) => { await fontGate; fontFinished = true; return loadFont(...args); };
      const rendering = render(0.2, 'png').then(value => { rendered = true; return value; });
      await tick(); step(!rendered && !fontFinished, 'export waits for pending font loads');
      releaseFont(); await settle(rendering, 'export resumes after fonts');
      // One unused font fails while the others are still loading.
      board.add(T('Requested typeface', 40, 40, { fontFamily: 'Lora' })); commitDesign(); await flush();
      const originalDisk = disk['c:designs:' + title], savesBeforeOpen = count('save_creation');
      let releaseOthers, opened = false, settledFonts = 0;
      const othersGate = new Promise(r => releaseOthers = r);
      document.fonts.load = async (...args) => {
        if (args[0].includes('Roboto Slab')) throw Error('missing font');
        await othersGate; const value = await loadFont(...args); settledFonts++; return value;
      };
      const opening = openDesign(title).then(() => { opened = true; });
      await tick(); step(!opened, 'opening waits for the other font requests after a rejection');
      releaseOthers(); await settle(opening, 'existing design opens with a failed unused font');
      step(settledFonts === FONTS.length * 2 - 2 && !$('#create-font-warning').hidden && $('#create-font-warning').textContent.includes('text layout') && $('#create-font-warning').textContent.includes('restart KB Studio') && $('#create-font-warning').textContent.includes('reinstall'), 'font attempts all settle and fallback layout warning is visible');
      step(!dirty && count('save_creation') === savesBeforeOpen && disk['c:designs:' + title] === originalDisk, 'failed font loading alone neither dirties nor rewrites an opened design');
      const requestedText = board.getObjects().at(-1);
      selectObjects([requestedText]); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await flush();
      step(requestedText.left === 41 && requestedText.fontFamily === 'Lora' && JSON.parse(disk['c:designs:' + title]).canvas.objects.at(-1).fontFamily === 'Lora' && !$('#create-font-warning').hidden, 'opened design remains editable and saving retains its font and warning');
      await settle(newDesign('Certificate', 'starter'), 'starter opens despite a font failure');
      const starterText = board.getObjects().find(o => o.fontFamily === 'Lora'), starterLeft = starterText.left;
      selectObjects([starterText]); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await flush();
      step(starterText.left === starterLeft + 1 && JSON.parse(disk['c:designs:' + design.title]).canvas.objects.some(o => o.fontFamily === 'Lora') && !$('#create-font-warning').hidden, 'starter remains editable and saves requested fonts without erasing the warning');
      const fontError = await settle(render(0.2, 'png').then(() => null, e => e), 'font failure reaches export');
      step(fontError?.message === 'missing font', 'font failures prevent exporting with a silent fallback');
      const outputCalls = count('save_output');
      for (const [kind, print] of [['png', false], ['jpeg', false], ['pdf', false], ['pdf', true]]) {
        await settle(output(kind, print), 'failed fonts block ' + kind + (print ? ' print' : ''));
        step(count('save_output') === outputCalls && $('#create-saved').textContent.includes('missing font') && !$('#create-font-warning').hidden, 'unused broken font prevents output publication and preserves warning');
      }
      document.fonts.load = loadFont;
      // Restore the injected loader and warning for later tests; this is not browser font recovery.
      $('#create-font-warning').hidden = true;
    }

    { // B3: compatibility with a real Fabric 6.9.1 save, including rendered pixels.
      const fixture = ${JSON.stringify(fabric6Fixture)};
      await open(fixture.doc, 'Fabric 6 compatibility', null);
      const coords = o => ({ type: o.type, corners: o.getCoords().map(p => [p.x, p.y]), width: o.width, height: o.height, children: o.getObjects?.().map(coords) });
      const rounded = v => JSON.stringify(v, (k, x) => typeof x === 'number' ? Math.round(x * 10000) / 10000 : x);
      step(rounded(board.getObjects().map(coords)) === rounded(fixture.geometry), 'Fabric 6 images, text, transformed group and frame retain geometry and stacking');
      const decoded = async url => {
        const image = new Image(); image.src = url; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
        return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
      };
      const before = await decoded(fixture.png), after = await decoded(await render(0.4, 'png'));
      let difference = 0, changed = 0;
      for (let i = 0; i < before.data.length; i++) {
        const delta = Math.abs(before.data[i] - after.data[i]); difference += delta; if (delta > 32) changed++;
      }
      // Allow small rasterizer/antialiasing differences; geometry above is checked independently.
      step(before.width === after.width && before.height === after.height && difference / before.data.length < 1 && changed / before.data.length < 0.005, 'Fabric 6 rendered pixels stay within rasterizer tolerance');
      step(blob().format === 1 && new fabric.Rect().originX === 'left' && new fabric.Rect().originY === 'top', 'New objects keep left/top origins and designs keep format 1');
    }

    {
      await newDesign();
      const source = document.createElement('canvas'); source.width = 160; source.height = 120;
      const ctx = source.getContext('2d'); ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 80, 120); ctx.fillStyle = '#0000ff'; ctx.fillRect(80, 0, 80, 120);
      const image = await fabric.FabricImage.fromURL(source.toDataURL()); image.set({ left: 120, top: 100, scaleX: 2, scaleY: 2 }); place(image);
      const original = JSON.stringify(image.toObject(KEEP)), initialHistory = here;
      zoomBoard(2); panBy(-70, -90);
      const view = JSON.stringify(board.viewportTransform);
      const sameView = () => JSON.stringify(board.viewportTransform) === view;
      await startPictureCrop();
      step($('#create-crop-dialog').open && image.controls.mlc && !dirty, 'Crop opens with Fabric crop controls and saves earlier edits');
      const dragLeft = () => {
        image.setCoords();
        const p = image.oCoords.mlc, rect = board.upperCanvasEl.getBoundingClientRect();
        const x = rect.left + p.x, y = rect.top + p.y, dx = 190 * board.getZoom();
        board.upperCanvasEl.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, bubbles: true, button: 0, buttons: 1 }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: x + dx, clientY: y, bubbles: true, buttons: 1 }));
        document.dispatchEvent(new MouseEvent('mouseup', { clientX: x + dx, clientY: y, bubbles: true, button: 0 }));
      };
      dragLeft();
      step(image.cropX > 80 && image.width < 80 && !dirty && here === initialHistory, () => 'Native crop handles change pixels without saving a preview: ' + image.cropX + ' ' + image.width);
      const cropBeforePan = image.cropX, leftBeforePan = image.left, topBeforePan = image.top;
      const centre = image.getCenterPoint().transform(board.viewportTransform), canvasRect = board.upperCanvasEl.getBoundingClientRect();
      const panX = canvasRect.left + centre.x, panY = canvasRect.top + centre.y;
      board.upperCanvasEl.dispatchEvent(new MouseEvent('mousedown', { clientX: panX, clientY: panY, bubbles: true, button: 0, buttons: 1 }));
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: panX + 8, clientY: panY, bubbles: true, buttons: 1 }));
      document.dispatchEvent(new MouseEvent('mouseup', { clientX: panX + 8, clientY: panY, bubbles: true, button: 0 }));
      step(image.cropX < cropBeforePan && image.left === leftBeforePan && image.top === topBeforePan, 'Dragging pans source pixels within a fixed crop');
      $('#crop-cancel').click();
      step(JSON.stringify(image.toObject(KEEP)) === original && here === initialHistory && !dirty, 'Cancel restores the complete image without an undo edit');
      step(sameView(), 'Cancel restores the zoom and view');
      await startPictureCrop(); dragLeft(); $('#crop-apply').click();
      step(sameView(), 'Apply restores the zoom and view');
      step(here === initialHistory + 1 && dirty && !cropSession && !$('#create-crop-dialog').open, 'Apply creates one undoable crop');
      const cropped = JSON.stringify(image.toObject(KEEP));
      await undoDesign(); step(JSON.stringify(board.getObjects()[0].toObject(KEEP)) === original, 'Undo restores the uncropped image');
      await redoDesign(); step(JSON.stringify(board.getObjects()[0].toObject(KEEP)) === cropped, 'Redo restores the crop');
      await flush(); await openDesign(design.title);
      step(JSON.stringify(board.getObjects()[0].toObject(KEEP)) === cropped, 'Crop survives format-1 save and reopen');
      selectObjects([board.getObjects()[0]]); await duplicateSelected();
      step(board.getObjects()[1].cropX === image.cropX && historyImages.size === 1 && blob().canvas.objects.every(o => o.src.startsWith('data:')), 'Duplicate retains crop and shares history image data; disk sources remain embedded');
      const outputsBefore = count('save_output'); await output('png'); await output('pdf');
      step(count('save_output') === outputsBefore + 2, 'Cropped picture exports PNG and PDF');
      const png = await createImageBitmap(new Blob([outputs[design.title + '.png'].bytes], { type: 'image/png' }));
      const sample = document.createElement('canvas'); sample.width = png.width; sample.height = png.height; const pixels = sample.getContext('2d'); pixels.drawImage(png, 0, 0);
      const o = board.getObjects()[0], pixel = pixels.getImageData(Math.round((o.left + 8) * DPI / PX), Math.round((o.top + 8) * DPI / PX), 1, 1).data;
      step(pixel[2] > 240 && pixel[0] < 15, 'PNG contains the cropped blue region, excluding the red source'); png.close();
      selectObjects([board.getObjects()[0]]); await startPictureCrop(); board.getActiveObject().set({ cropX: 0 }); await flush();
      step(!cropSession && board.getObjects()[0].cropX > 80, 'A save/close/navigation flush cancels an unfinished crop');
      await startPictureCrop(); $('#create-crop-dialog').dispatchEvent(new Event('cancel', { cancelable: true }));
      step(!cropSession && !$('#create-crop-dialog').open, 'Escape cancellation closes the crop session');
      const activeImage = board.getActiveObject(), normalControls = activeImage.controls, beforeDoubleClick = here;
      await startPictureCrop(); activeImage.fire('mousedblclick', { target: activeImage });
      step(!cropSession && here === beforeDoubleClick + 1 && activeImage.controls === normalControls, 'Double-click completes one crop and restores normal controls');
      activeImage.fire('mousedblclick', { target: activeImage });
      step(!cropSession && activeImage.controls === normalControls, 'Fabric cannot silently reenter crop mode outside a session');
      for (const kind of ['circle', 'rounded', 'rect']) {
        put($('#prop-frame'), kind, 'change');
        const framedOriginal = JSON.stringify(activeImage.toObject(KEEP));
        await startPictureCrop(); activeImage.set({ width: 50 }); finishCrop(false);
        step(JSON.stringify(activeImage.toObject(KEEP)) === framedOriginal, kind + ' frame survives Cancel unchanged');
        for (const width of [50, 140]) {
          await startPictureCrop(); activeImage.set({ width, cropX: 0 }); finishCrop(true);
          const frame = activeImage.clipPath;
          step(kind === 'circle' ? frame.radius === Math.min(width, activeImage.height) / 2 : frame.width === width && frame.height === activeImage.height && frame.rx === (kind === 'rounded' ? width / 8 : 0), kind + ' frame fits a narrowed or widened crop');
        }
      }
      const framedCrop = JSON.stringify(activeImage.toObject(KEEP));
      await flush(); await openDesign(design.title);
      step(JSON.stringify(board.getObjects()[0].toObject(KEEP)) === framedCrop, 'Resized frame and crop survive save/reopen');
      selectObjects([board.getObjects()[0]]);
      board.getObjects()[0].set({ left: 121 }); commitDesign();
      const releaseCropSave = hold('save_creation'), waitingCrop = startPictureCrop();
      await tick(); setMode('home'); releaseCropSave(); await waitingCrop;
      step(!cropSession && !$('#create-crop-dialog').open && $('#create-stage').parentNode.id !== 'create-crop-dialog', 'A crop waiting for a save cannot open after leaving Create');
      setMode('create');
    }

    { // B1: editing, using the real Fabric canvas and save format.
    await settle(newDesign(), 'B1 blank design');
    const boxes = [0, 1, 2].map(i => new fabric.Rect({ left: 40 + i * 150, top: 60 + i * 40, width: 60 + i * 10, height: 50, strokeWidth: 0, fill: '#ffd966' }));
    board.add(...boxes); selectObjects(boxes); commitDesign();
    const positions = () => boxes.map(o => o.getCoords().map(p => [p.x, p.y]));
    const beforeGroup = JSON.stringify(positions());
    $('#prop-group').click(); $('#prop-ungroup').click();
    step(JSON.stringify(positions()) === beforeGroup && board.getObjects().length === 3, 'group and ungroup preserve scene positions');
    // Rotated and scaled groups also preserve their children when ungrouped.
    groupSelected(); board.getActiveObject().set({ angle: 23, scaleX: 1.4, scaleY: 0.8 }); board.getActiveObject().setCoords();
    const transformed = positions(); groupSelected(true);
    step(positions().every((coords, i) => coords.every((p, j) => p.every((v, k) => Math.abs(v - transformed[i][j][k]) < 0.001))), () => 'ungroup preserves a rotated and scaled group: ' + JSON.stringify(transformed) + ' -> ' + JSON.stringify(positions()));
    // Return to simple rectangles for measurable bounds.
    board.discardActiveObject(); boxes.forEach((o, i) => { o.set({ angle: 0, skewX: 0, skewY: 0, scaleX: 1, scaleY: 1, left: 40 + i * 150, top: 60 + i * 40 }); o.setCoords(); });
    selectObjects(boxes); $('#prop-distribute-x').click();
    const bounds = boxes.map(o => o.getBoundingRect());
    step(Math.abs(bounds[1].left - bounds[0].left - bounds[0].width - (bounds[2].left - bounds[1].left - bounds[1].width)) < 0.001, 'distribute gives three different widths equal gaps');
    document.querySelector('[data-align=top]').click();
    step(boxes.every(o => Math.abs(o.getBoundingRect().top - 60) < 0.001), 'multi-selection aligns its objects to their shared top');
    selectObjects([boxes[0]]); boxes[0].set({ left: 380, top: 400 }); boxes[0].setCoords();
    board.fire('object:moving', { target: boxes[0] });
    step(Math.abs(boxes[0].getBoundingRect().left + boxes[0].getBoundingRect().width / 2 - 408) < 0.001, 'moving near the page centre snaps to it');
    board.fire('mouse:up');
    boxes[0].set({ left: 2 }); boxes[0].setCoords(); board.fire('object:moving', { target: boxes[0] });
    step(Math.abs(boxes[0].getBoundingRect().left) < 0.001, 'moving near a page edge snaps to it'); board.fire('mouse:up');
    // Fabric's bundled guides snap against another object as well.
    boxes[1].set({ left: 100, top: 200 }); boxes[0].set({ left: 103, top: 300 }); boxes.forEach(o => o.setCoords());
    board.fire('object:moving', { target: boxes[0] });
    step(Math.abs(boxes[0].getBoundingRect().left + boxes[0].width / 2 - boxes[1].getBoundingRect().left - boxes[1].width / 2) < 0.001, 'Fabric guidelines snap neighbouring object centres'); board.fire('mouse:up');
    selectObjects(boxes.slice(0, 2)); copySelected();
    await settle(newDesign(), 'clipboard survives a new design'); await settle(pasteSelected(), 'multi-object paste');
    step(board.getObjects().length === 2 && board.getActiveObjects().length === 2 && Math.abs(board.getObjects()[0].getBoundingRect().left - designClipboard[0].left - 24) < 0.001, 'clipboard pastes a multi-selection across designs in scene coordinates');
    await settle(duplicateSelected(), 'multi-object duplicate');
    step(board.getObjects().length === 4 && board.getActiveObjects().length === 2, 'duplicate accepts a multi-selection');
    const duplicateTargets = board.getActiveObjects(); board.discardActiveObject(); await settle(duplicateSelected(), 'empty duplicate');
    step(board.getObjects().length === 4, 'duplicate with no selection leaves the clipboard alone'); selectObjects(duplicateTargets);
    const cutCount = board.getObjects().length; copySelected(true); await settle(pasteSelected(), 'cut then paste');
    step(board.getObjects().length === cutCount, 'cut and paste move selected objects');
    const lockedCopy = board.getObjects()[0]; lockedCopy.kbLocked = true; applyLock(lockedCopy); selectObjects([lockedCopy]); copySelected();
    await settle(pasteSelected(), 'locked paste');
    step(board.getActiveObject().kbLocked && board.getActiveObject().lockMovementX && !board.getActiveObject().hasControls, 'paste reapplies saved locks');
    const zoomBefore = board.getZoom(); $('#create-zoom-in').click();
    step(board.getZoom() > zoomBefore && $('#create-zoom').textContent === Math.round(board.getZoom() * 100) + '%', 'zoom in makes the page bigger');
    const wheel = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, cancelable: true }); board.fire('mouse:wheel', { e: wheel });
    step(wheel.defaultPrevented && board.getZoom() > zoomBefore * 1.25, 'Ctrl wheel zoom prevents the browser zoom'); $('#create-fit').click();
    step(board.getZoom() < 1, 'Fit restores the whole page');
    const pasteDestination = design.title;
    for (const destination of ['new', 'open', 'home']) {
      await settle(newDesign(), 'pending paste source');
      const sourceTitle = design.title, original = addShape('rect'); copySelected(true);
      const fromObject = fabric.Rect.fromObject;
      let releaseDecode;
      const decodeGate = new Promise(r => releaseDecode = r);
      fabric.Rect.fromObject = async (...args) => { await decodeGate; return fromObject.call(fabric.Rect, ...args); };
      try {
        const pasting = pasteSelected();
        const leaving = destination === 'new' ? newDesign() : destination === 'open' ? openDesign(pasteDestination) : $('#create-home').onclick();
        await tick();
        step(design.title === sourceTitle && board.getObjects().length === 0 && $('#create').inert && $('#home').inert, destination + ' waits for decoding and freezes navigation and editing');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }));
        document.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true }));
        step(adding.size === 1, 'transition refuses another paste');
        releaseDecode(); await settle(pasting, 'pending paste lands'); await settle(leaving, 'navigation after paste');
        const stored = JSON.parse(disk['c:designs:' + sourceTitle]).canvas.objects;
        step(stored.length === 1 && stored[0].left === original.left + 24, destination + ' saves the pending cut/paste to its source design');
        step(!$('#create').inert && !$('#home').inert && (destination === 'home' ? mode === 'home' : design.title !== sourceTitle), 'transition finishes and unfreezes');
        if (destination === 'new') step(board.getObjects().length === 0, 'pending paste never lands in the new design');
      } finally { releaseDecode(); fabric.Rect.fromObject = fromObject; }
    }
    await settle(newDesign(), 'pending image batch source');
    const batchTitle = design.title, bitmap = window.createImageBitmap;
    let releaseBitmap;
    const bitmapGate = new Promise(r => releaseBitmap = r);
    window.createImageBitmap = async (...args) => { await bitmapGate; return bitmap(...args); };
    try {
      const batch = importFiles([new File([png], 'one.png', { type: 'image/png' }), new File([png], 'two.png', { type: 'image/png' })]);
      const leaving = newDesign(); await tick();
      step(design.title === batchTitle && $('#create').inert, 'navigation waits for the whole image batch');
      releaseBitmap(); await settle(batch, 'pending batch finishes'); await settle(leaving, 'navigation after batch');
      step(JSON.parse(disk['c:designs:' + batchTitle]).canvas.objects.length === 2 && board.getObjects().length === 0, 'both imported images save to their source design');
    } finally { releaseBitmap(); window.createImageBitmap = bitmap; }
    await settle(newDesign(), 'new properties design');
    const styledRect = addShape('rounded'), styledText = addText(); styledText.exitEditing();
    selectObjects([styledRect]);
    put($('#prop-opacity'), '55', 'change'); put($('#prop-width'), '7', 'change'); put($('#prop-dash'), 'dash', 'change'); put($('#prop-corners'), '30', 'change');
    $('#prop-shadow').checked = true; $('#prop-shadow').dispatchEvent(new Event('change')); $('#prop-flip-x').click(); $('#prop-flip-y').click();
    selectObjects([styledText]); $('#prop-italic').click(); $('#prop-underline').click();
    put($('#prop-spacing'), '120', 'change'); put($('#prop-line-height'), '1.8', 'change'); put($('#prop-width'), '2', 'change');
    $('#prop-highlight-on').checked = true; $('#prop-highlight-on').dispatchEvent(new Event('change'));
    await settle(flush(), 'properties save'); const propertiesTitle = design.title; await settle(openDesign(propertiesTitle), 'properties reopen');
    const [savedRect, savedText] = board.getObjects();
    step(savedRect.opacity === 0.55 && savedRect.strokeWidth === 7 && savedRect.strokeDashArray.join() === '8,5' && savedRect.rx === 30 && savedRect.ry === 30 && savedRect.shadow.blur === 10 && savedRect.flipX && savedRect.flipY && savedText.fontStyle === 'italic' && savedText.underline && savedText.charSpacing === 120 && savedText.lineHeight === 1.8 && savedText.strokeWidth === 2 && savedText.stroke === '#000000' && savedText.paintFirst === 'stroke' && savedText.textBackgroundColor === '#fff2cc', 'all new shape and text properties survive save/reopen');
    const dropFile = new File([png], 'dropped.png', { type: 'image/png' }), transfer = new DataTransfer(); transfer.items.add(dropFile);
    $('#create-stage').dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    step(adding.size >= 1, 'drop registers tracked import work');
    await until(() => adding.size === 0 && board.getObjects().length === 3, 'drop finishes and drains');
    const framed = board.getObjects().at(-1); selectObjects([framed]); put($('#prop-frame'), 'rounded', 'change');
    await settle(flush(), 'frame saved'); await settle(openDesign(propertiesTitle), 'frame reopened');
    step(board.getObjects().at(-1).clipPath?.rx === board.getObjects().at(-1).width / 8, 'picture clipPath survives reopening');
    $('#create').inert = true;
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
    step(adding.size === 0 && board.getObjects().length === 3, 'paste respects the closing freeze'); $('#create').inert = false;
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
    await until(() => adding.size === 0 && board.getObjects().length === 4, 'clipboard image imports and drains');
    const keyEvent = key => document.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true }));
    keyEvent('a'); step(board.getActiveObjects().length === 4, 'Ctrl+A selects unlocked visible objects');
    selectObjects([board.getObjects()[0]]); const firstLayer = board.getActiveObject(); keyEvent(']');
    step(board.getObjects().indexOf(firstLayer) === 1, 'Ctrl+] brings a layer forward'); keyEvent('[');
    step(board.getObjects().indexOf(firstLayer) === 0, 'Ctrl+[ sends a layer backward');
    const stack = board.getObjects();
    selectObjects(stack.slice(-2)); keyEvent(']');
    step(board.getObjects().every((o, i) => o === stack[i]), 'forward at the top preserves selected layer order');
    selectObjects(stack.slice(0, 2)); keyEvent('[');
    step(board.getObjects().every((o, i) => o === stack[i]), 'backward at the bottom preserves selected layer order');
    selectObjects([stack[1], stack[3]]); keyEvent(']');
    step(board.getObjects().every((o, i) => o === [stack[0], stack[2], stack[1], stack[3]][i]), 'noncontiguous selection advances without crossing selected layers');
    keyEvent('[');
    step(board.getObjects().every((o, i) => o === [stack[0], stack[1], stack[3], stack[2]][i]), 'selected block moves backward with its order intact');
    await settle(newDesign(), 'shapes and draw design');
    for (const kind of ['triangle', 'star', 'rounded', 'bubble']) $('#add-' + kind).click();
    $('#create-draw').click(); step(board.isDrawingMode && board.freeDrawingBrush instanceof fabric.PencilBrush, 'Draw enables Fabric PencilBrush');
    const brush = board.freeDrawingBrush;
    brush.onMouseDown(new fabric.Point(40, 40), { e: new MouseEvent('mousedown', { button: 0 }) });
    brush.onMouseMove(new fabric.Point(100, 80), { e: new MouseEvent('mousemove', { buttons: 1 }) });
    brush.onMouseUp({ e: new MouseEvent('mouseup', { button: 0 }) }); $('#create-draw').click();
    step(board.getObjects().length === 5 && board.getObjects().at(-1).kbName === 'Drawing' && !board.isDrawingMode, 'new shapes and free drawing create saved objects');
    await settle(newDesign(), 'blank margin export');
    $('#create-margin').checked = true; board.renderAll();
    step(board.contextTop.getImageData(0, 0, board.upperCanvasEl.width, board.upperCanvasEl.height).data.some((v, i) => i % 4 === 3 && v > 0), 'print-safe margin is visible on the top context');
    const marginPNG = await settle(render(1, 'png'), 'margin export');
    const marginBitmap = await createImageBitmap(new Blob([toBytes(marginPNG)], { type: 'image/png' }));
    const marginCanvas = document.createElement('canvas'); marginCanvas.width = 816; marginCanvas.height = 1056;
    const marginCtx = marginCanvas.getContext('2d'); marginCtx.drawImage(marginBitmap, 0, 0); marginBitmap.close();
    step(marginCtx.getImageData(0, 0, 816, 1056).data.every(v => v === 255), 'print-safe overlay never enters exported pixels');
    const sharedImage = await settle(addImageBlob(png, 'history'), 'history image');
    for (let i = 0; i < 5; i++) { selectObjects([sharedImage]); await settle(duplicateSelected(), 'history image duplicate'); }
    const srcLength = sharedImage.getSrc().length;
    step(historyImages.size === 1 && historyBytes < srcLength * 3 + 100000, 'five image copies share one history source instead of five per snapshot');
    await settle(stepHistory(-1), 'interned history undo'); await settle(stepHistory(1), 'interned history redo');
    step(board.getObjects().length === 6 && board.getObjects().every(o => o.getSrc() === sharedImage.getSrc()), 'interned image sources restore through undo and redo');
    await settle(flush(), 'interned design save');
    step(JSON.parse(disk['c:designs:' + design.title]).canvas.objects.every(o => typeof o.src === 'string' && o.src.startsWith('data:')), 'disk format retains real image sources, no history tokens');
    // The 0.11 layout: rail and drawers, the selection toolbar, pop-ups, floating toolbar, right-click menu, templates in place.
    await settle(newDesign(), 'layout design');
    const shown = sel => !$(sel).closest('[hidden]');
    step(!$('#create-drawer').hidden && shown('[data-panel=elements]') && !shown('[data-panel=text]'), 'Create opens with the Elements drawer');
    document.querySelector('[data-drawer=text]').click();
    step(shown('[data-panel=text]') && !shown('[data-panel=elements]') && document.querySelector('[data-drawer=text]').classList.contains('on'), 'the rail switches drawers');
    document.querySelector('[data-drawer=text]').click();
    step($('#create-drawer').hidden, 'clicking the open tab closes the drawer');
    document.querySelector('[data-drawer=draw]').click();
    step(board.isDrawingMode && $('#create-float').hidden, 'the Draw tab picks up the pen');
    document.querySelector('[data-drawer=elements]').click();
    step(!board.isDrawingMode, 'leaving Draw puts the pen down');
    step(shown('#create-bg') && !shown('#prop-font') && !shown('#prop-crop') && $('#create-float').hidden, 'with nothing selected the toolbar offers the background');
    $('#add-heading').click(); const heading = board.getActiveObject(); heading.exitEditing?.();
    step(heading.kbName === 'Heading' && heading.fontSize === 64 && heading.fontWeight === 'bold', 'Add a heading makes a big bold heading');
    step(shown('#prop-font') && shown('#prop-bold') && !shown('#prop-crop') && !shown('#create-bg') && !shown('#prop-corners'), 'a text selection shows text tools only');
    $('#prop-size-up').click(); step(heading.fontSize === 66, () => 'the size + button steps the text size: ' + heading.fontSize);
    $('#prop-size-down').click(); step(heading.fontSize === 64, 'the size − button steps it back');
    step(!$('#create-float').hidden && $('#create').contains($('#create-float')), 'the floating toolbar shows for the selection, inside Create');
    $('#add-rect').click(); const box = board.getActiveObject();
    step(shown('#prop-corners') && shown('#prop-fill') && !shown('#prop-font'), 'a rectangle shows shape tools and corners');
    document.querySelector('[data-pop=pop-outline]').click();
    step(!$('#pop-outline').hidden && shown('#prop-stroke') && $('#create').contains($('#pop-outline')), 'Border opens its panel');
    selectObjects([heading]);
    step($('#pop-outline').hidden, 'a pop-up closes when its button goes away');
    $('#prop-front').click(); step(board.getObjects().at(-1) === heading, 'To front puts the selection on top');
    $('#prop-back').click(); step(board.getObjects()[0] === heading, 'To back puts it underneath');
    $('#float-lock').click();
    step(heading.kbLocked && heading.lockMovementX && shown('#create-context [data-act=lock]') && !shown('#prop-font') && $('#prop-delete').hidden, 'Lock in the floating toolbar locks it and hides its tools');
    $('#create-context [data-act=lock]').click();
    step(!heading.kbLocked && shown('#prop-font') && !$('#prop-delete').hidden, 'Unlock in the toolbar unlocks it');
    selectObjects([box]); centreOnPage();
    step(Math.abs(box.getBoundingRect().left + box.getBoundingRect().width / 2 - 408) < 1 && Math.abs(box.getBoundingRect().top + box.getBoundingRect().height / 2 - 528) < 1, 'Centre on the page centres it both ways');
    openMenu(100, 100);
    const menuItems = () => [...$('#create-menu').querySelectorAll('button')].map(b => b.firstChild.textContent);
    step(!$('#create-menu').hidden && ['Copy', 'Duplicate', 'Bring to front', 'Send to back', 'Lock'].every(i => menuItems().includes(i)), () => 'the right-click menu offers copy, layer and lock actions: ' + menuItems());
    [...$('#create-menu').querySelectorAll('button')].find(b => b.firstChild.textContent === 'Duplicate').click();
    await until(() => board.getObjects().length === 3 && $('#create-menu').hidden, 'Duplicate from the menu copies the selection and closes it');
    openMenu(100, 100); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    step($('#create-menu').hidden && board.getActiveObject(), 'Escape closes the menu before it clears the selection');
    $('#create-stage').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    step(!$('#create-menu').hidden && menuItems().join() === 'Paste,Select all' && !board.getActiveObject(), () => 'right-clicking beside the page offers paste and select all: ' + menuItems());
    closeMenus(); $('#create').inert = true; openMenu(100, 100);
    step($('#create-menu').hidden, 'the menu stays shut while editing is frozen'); $('#create').inert = false;
    // Templates fill a blank page in place, and open a new design when the page has work on it.
    await settle(newDesign(), 'template in place');
    document.querySelector('[data-drawer=templates]').click();
    await until(() => $('#drawer-templates img')?.src.startsWith('data:image/png'), 'template pictures are drawn from the templates');
    await settle(useTemplate('Labels', 'starter'), 'a template fills the blank page');
    const inPlace = design.title;
    step(inPlace.startsWith('My Labels') && board.getObjects().length > 5 && history.length === 2, () => 'a template fills a blank page in place as one undo step: ' + inPlace + ' ' + history.length);
    await settle(useTemplate('Certificate', 'starter'), 'a template on a used page');
    step(design.title.startsWith('My Certificate') && disk['c:designs:' + inPlace], 'a used page keeps its work and the template opens as a new design');
    document.querySelector('[data-drawer=elements]').click();
    // A design from a newer KB Studio is refused instead of opened wrongly.
    disk['c:designs:From the future'] = JSON.stringify({ format: FORMAT + 1, page: 'letter', pages: [] });
    const refusal = await openDesign('From the future').then(() => null, e => String(e));
    step(refusal?.includes('newer KB Studio') && design.title !== 'From the future' && !$('#create').inert, () => 'a newer design format is refused: ' + refusal);
    delete disk['c:designs:From the future'];
    // What's new shows once.
    settings.seen = WHATS_NEW - 1; paintWhatsNew();
    step(!$('#create-whatsnew').hidden, 'someone who saw the last card sees the new one');
    step(!$('#create-whatsnew').hidden, "What's new shows in Create until it is dismissed");
    $('#whatsnew-ok').click();
    await until(() => $('#create-whatsnew').hidden && JSON.parse(disk.createSettings).seen === WHATS_NEW, "Got it hides What's new for good");
    // The 0.12 view: a pasteboard around the page, panning, drops where things land, transform readouts.
    await settle(newDesign(), 'view design');
    fitBoard(); board.renderAll();
    const pixelAt = (x, y) => [...board.contextContainer.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3)].join();
    const v0 = board.viewportTransform, z0 = board.getZoom();
    step(pixelAt(3, 3).split(',').every((v, i) => Math.abs(v - [58, 60, 68][i]) <= 2) && pixelAt(v0[4] + 408 * z0, v0[5] + 528 * z0) === '255,255,255', () => 'the page is drawn white on a grey pasteboard: ' + pixelAt(3, 3) + ' / ' + pixelAt(v0[4] + 408 * z0, v0[5] + 528 * z0));
    addShape('rect'); const hanging = board.getActiveObject(); hanging.set({ left: -120, top: 40 }); hanging.setCoords(); commitDesign(); board.renderAll();
    step(board.getObjects().includes(hanging) && JSON.parse(JSON.stringify(blob())).canvas.objects[0].left === -120, 'an object can hang off the page and is saved where it is');
    const before = [...board.viewportTransform];
    board.fire('mouse:wheel', { e: new WheelEvent('wheel', { deltaY: 120, cancelable: true }) });
    step(board.viewportTransform[5] === before[5] - 120 && board.getZoom() === before[0], 'the wheel moves the view without zooming');
    panBy(-100000, -100000);
    const vp = board.viewportTransform;
    step(vp[4] === 80 - 816 * vp[0] && vp[5] === 80 - 1056 * vp[3], 'the page cannot be panned out of sight');
    fitBoard();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    step(spacePan && board.skipTargetFind && !board.selection, 'holding Space switches to moving the view');
    document.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
    step(!spacePan && !board.skipTargetFind && board.selection, 'letting go of Space switches back');
    const items = new DataTransfer(); items.setData(DRAG_TYPE, JSON.stringify(['shape', 'star']));
    const canvasBox = board.upperCanvasEl.getBoundingClientRect(), vf = board.viewportTransform, zf = board.getZoom();
    $('#create-stage').dispatchEvent(new DragEvent('drop', { dataTransfer: items, clientX: canvasBox.left + vf[4] + 200 * zf, clientY: canvasBox.top + vf[5] + 300 * zf, bubbles: true, cancelable: true }));
    const dropped = board.getObjects().at(-1), dc = dropped.getCenterPoint();
    step(dropped.kbName === 'Star' && Math.abs(dc.x - 200) < 2 && Math.abs(dc.y - 300) < 2, () => 'a shape dragged from the drawer lands where it is dropped: ' + dropped.kbName + ' ' + Math.round(dc.x) + ',' + Math.round(dc.y));
    step($('#add-star').draggable && $('#add-heading').draggable && $('#emoji-list button').draggable, 'shapes, text and graphics can be dragged from the drawers');
    board.fire('object:scaling', { target: dropped, transform: { action: 'scale', target: dropped }, e: new MouseEvent('mousemove', { clientX: 300, clientY: 300 }) });
    step(!$('#create-readout').hidden && $('#create-readout').textContent.endsWith(' in'), () => 'resizing shows the size in inches: ' + $('#create-readout').textContent);
    board.fire('object:rotating', { target: dropped, transform: { action: 'rotate', target: dropped }, e: new MouseEvent('mousemove', { clientX: 300, clientY: 300, shiftKey: true }) });
    step(dropped.snapAngle === 15 && $('#create-readout').textContent.endsWith('°'), 'rotating shows the angle and Shift snaps to 15°');
    board.fire('object:rotating', { target: dropped, transform: { action: 'rotate', target: dropped }, e: new MouseEvent('mousemove', { clientX: 300, clientY: 300 }) });
    step(dropped.snapAngle === 45 && dropped.snapThreshold === 4, 'without Shift rotation snaps near 45°');
    board.fire('mouse:up', { e: new MouseEvent('mouseup') });
    step($('#create-readout').hidden, 'the readout goes away when the mouse is let go');
    const exported = await createImageBitmap(new Blob([toBytes(await render(1, 'png'))], { type: 'image/png' }));
    step(exported.width === 816 && exported.height === 1056, 'export is still exactly the page'); exported.close();
    }
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
    step(await newDesign().then(() => 'opened', () => 'refused') === 'refused' && design.title === 'Renamed A' && !$('#create').inert && !$('#home').inert, 'a new design is refused too, so the work stays on the page');
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
    // Updating owns the freeze while navigation and destination additions drain.
    {
      const releaseLoad = hold('load_creation'), releaseInstall = hold('install_update'), installs = count('install_update');
      const loads = count('load_creation'), opening = openDesign(design.title);
      await until(() => count('load_creation') > loads, 'destination loading is held');
      const update = $('#update-now').onclick(); await tick();
      step(count('install_update') === installs && updating && $('#create').inert && $('#home').inert, 'update waits for destination loading with both screens frozen');
      let releaseAddition;
      const addition = track(new Promise(r => releaseAddition = r).then(() => { board.getObjects()[0].set({ left: 37 }); commitDesign(); }));
      releaseLoad(); await settle(opening, 'destination finishes loading during update'); await tick();
      step(count('install_update') === installs && updating && $('#create').inert && $('#home').inert, 'navigation preserves the update freeze and installation waits for additions');
      releaseAddition(); await settle(addition, 'destination addition lands');
      await until(() => count('install_update') === installs + 1, 'installation starts after destination work saves');
      step(!dirty && adding.size === 0 && JSON.parse(disk['c:designs:' + design.title]).canvas.objects[0].left === 37, 'the final update save includes destination additions');
      selectObjects([board.getObjects()[0]]);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      document.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true }));
      step(updating && $('#create').inert && $('#home').inert && !dirty && adding.size === 0 && board.getObjects()[0].left === 37, 'editing stays blocked during installation');
      const quitsBeforeClose = count('quit'), triedBeforeClose = closeTried;
      window.failSave = true; board.getObjects()[0].set({ left: 39 }); commitDesign();
      await settle(kbClose(), 'failed close during installation');
      step(count('quit') === quitsBeforeClose && dirty && updating && $('#create').inert && $('#home').inert, 'failed close preserves the update freeze');
      closeTried = triedBeforeClose; window.failSave = false; await flush();
      releaseInstall(); await settle(update, 'failed installation restores interaction');
      step(!updating && !$('#create').inert && !$('#home').inert && !$('#update-now').disabled, 'update failure releases its freeze');
      window.failSave = true; board.getObjects()[0].set({ left: 38 }); commitDesign();
      await settle($('#update-now').onclick(), 'failed final update save');
      step(count('install_update') === installs + 1 && dirty && !updating && !$('#create').inert && !$('#home').inert && $('#update-text').textContent.includes('disk full'), 'a failed final save prevents installation and restores interaction');
      window.failSave = false; await flush();
    }
    // A damaged design refuses to open without cancelling an update already waiting for it.
    {
      const brokenKey = 'c:designs:Damaged update test', sourceTitle = design.title, installs = count('install_update');
      disk[brokenKey] = '{';
      const releaseLoad = hold('load_creation'), releaseInstall = hold('install_update'), loads = count('load_creation');
      const opening = openDesign('Damaged update test').then(() => null, error => error);
      await until(() => count('load_creation') > loads, 'damaged design loading is held');
      const update = $('#update-now').onclick(); await tick();
      step(count('install_update') === installs, 'update waits for the damaged design open to finish');
      releaseLoad();
      step(await settle(opening, 'damaged design open fails') instanceof SyntaxError, 'damaged JSON is refused');
      await until(() => count('install_update') === installs + 1, 'update proceeds after failed design open');
      step(design.title === sourceTitle && !dirty && updating && $('#create').inert && $('#home').inert, 'failed open retains the saved source and update freeze');
      releaseInstall(); await settle(update, 'installation result after failed open');
      step($('#update-text').textContent.includes('signature mismatch') && !updating && !$('#create').inert && !$('#home').inert, 'update reports its own result after failed open');
      delete disk[brokenKey];
    }
    // Closing during navigation waits until the destination finishes loading.
    {
      const release = hold('load_creation'), q0 = count('quit');
      const opening = openDesign(design.title); await tick();
      const closing = kbClose(); await tick();
      step(count('quit') === q0 && $('#create').inert, 'close waits for navigation to finish');
      release(); await settle(opening, 'destination loads before close'); await settle(closing, 'close after navigation');
      step(count('quit') === q0 + 1 && $('#create').inert, 'close preserves the editing freeze after navigation');
      $('#create').inert = false;
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
    // 0.13: frames, drop-to-replace and This shoot.
    showDrawer('shoot');
    await until(() => $('#shoot-list').children.length === photos.filter(p => rating(p).flag !== 'reject').length && $('#shoot-list').children.length > 0 && $('#shoot-empty').hidden, () => 'This shoot lists the open shoot without rejects: ' + $('#shoot-list').children.length);
    step(photos.some(p => rating(p).flag === 'pick') ? $('#shoot-list').firstElementChild.classList.contains('pick') : true, 'picks come first');
    step($('#add-frame-circle') && $('#add-frame-portrait').draggable, 'Elements offers photo frames that can be dragged');
    const frameAt = new fabric.Point(250, 300);
    dropItem(['frame', 'circle'], frameAt);
    const frame = board.getActiveObject(), frameIndex = board.getObjects().indexOf(frame);
    step(emptyFrame(frame) && frame.kbFrame === 'circle' && Math.abs(frame.getCenterPoint().x - 250) < 1 && blob().canvas.objects.at(-1).kbFrame === 'circle', 'a frame lands where it is dropped and is saved as a frame');
    board.renderAll();
    const exportedFrame = await createImageBitmap(new Blob([toBytes(await render(1, 'png'))], { type: 'image/png' }));
    const probe = Object.assign(document.createElement('canvas'), { width: 816, height: 1056 }).getContext('2d'); probe.drawImage(exportedFrame, 0, 0);
    step([...probe.getImageData(250, 300 - 25, 1, 1).data.slice(0, 3)].join() === '223,227,234', 'an empty frame exports plain grey, without the on-screen hint');
    const sendsBefore = count('export_source');
    $('#shoot-list').children[1].click();
    await until(() => board.getObjects()[frameIndex]?.type === 'image', 'clicking a shoot photo fills the selected frame');
    const filled = board.getObjects()[frameIndex];
    step(count('export_source') === sendsBefore + 1 && filled.clipPath?.type === 'circle' && Math.abs(filled.getScaledWidth() - 300) < 1 && Math.abs(filled.getScaledHeight() - 300) < 1 && Math.abs(filled.getCenterPoint().x - 250) < 1 && !board.getObjects().includes(frame), () => 'it is developed and cropped to fill the circle: ' + filled.getScaledWidth() + 'x' + filled.getScaledHeight());
    const swapCanvas = Object.assign(document.createElement('canvas'), { width: 400, height: 200 }); swapCanvas.getContext('2d').fillStyle = '#c00'; swapCanvas.getContext('2d').fillRect(0, 0, 400, 200);
    const swapFile = new File([await new Promise(done => swapCanvas.toBlob(done, 'image/png'))], 'swap.png', { type: 'image/png' });
    const files = new DataTransfer(); files.items.add(swapFile);
    const stageBox = board.upperCanvasEl.getBoundingClientRect(), vt = board.viewportTransform, zt = board.getZoom();
    const over = { dataTransfer: files, clientX: stageBox.left + vt[4] + 250 * zt, clientY: stageBox.top + vt[5] + 300 * zt, bubbles: true, cancelable: true };
    $('#create-stage').dispatchEvent(new DragEvent('dragover', over));
    step(dropHover === filled, 'dragging a picture over a picture outlines it');
    const objectsBefore = board.getObjects().length;
    $('#create-stage').dispatchEvent(new DragEvent('drop', over));
    await until(() => board.getObjects()[frameIndex]?.kbName === 'Photo swap', 'dropping a picture file on a picture replaces it');
    const swapped = board.getObjects()[frameIndex];
    step(board.getObjects().length === objectsBefore && dropHover === null && swapped.clipPath?.type === 'circle' && Math.abs(swapped.getScaledWidth() - 300) < 1 && Math.round(swapped.cropX) === 100 && swapped.cropY === 0, () => 'it keeps the place, size and circle, cropped from the middle: ' + swapped.cropX + ',' + swapped.cropY);
    stepHistory(-1);
    await until(() => board.getObjects()[frameIndex]?.kbName?.startsWith('Photo IMG'), () => 'undo brings the previous picture back: ' + board.getObjects()[frameIndex]?.kbName);
    // 0.13: print and social sizes, photographer templates.
    step(PAGE_GROUPS.flatMap(([, keys]) => keys).sort().join() === Object.keys(PAGES).sort().join() && $('#create-page').querySelectorAll('optgroup').length === 3, 'every page size is offered once, in Printing, Photo prints and Social media');
    step(PAGE_LABEL('social-portrait') === 'Instagram post (1080 × 1350 px)' && PAGE_LABEL('photo-5x7') === '5 × 7 photo' && PAGE_LABEL('poster') === 'Poster (11 × 17 in)', () => 'size names: ' + PAGE_LABEL('social-portrait'));
    await settle(newDesign('Instagram post', 'starter'), 'Instagram template');
    step(design.page === 'social-portrait' && pagePx().join() === '540,675' && board.getObjects().filter(emptyFrame).length === 1, () => 'the Instagram template opens on its own page with a frame: ' + design.page);
    const postSaves = count('save_output');
    $('#create-png').click();
    await until(() => count('save_output') === postSaves + 1, 'the post saves as a PNG');
    const post = await createImageBitmap(new Blob([new Uint8Array(calls.filter(c => c.command === 'save_output').at(-1).args)], { type: 'image/png' }));
    step(post.width === 1080 && post.height === 1350, () => 'a social post saves at exactly 1080 × 1350: ' + post.width + 'x' + post.height); post.close();
    await settle(newDesign(), 'blank for template');
    await useTemplate('Square collage', 'starter');
    step(design.page === 'social-square' && board.getObjects().filter(emptyFrame).length === 4 && design.title.startsWith('My Square collage'), () => 'a template used on a blank page takes its size too: ' + design.page);
    const cardThumb = await templateThumb('Photo card', 'starter', 0);
    const cardImage = await new Promise(done => Object.assign(new Image(), { onload() { done(this); }, src: cardThumb }));
    step(cardImage.width > cardImage.height, 'template pictures have the template page shape');
    // 0.14: pages, custom size and Resize that scales.
    await settle(newDesign(), 'pages design');
    put($('#create-title'), 'Pages test', 'change');
    step($('#page-list').children.length === 1 && $('#page-delete').disabled && $('#page-count').textContent === 'Page 1 of 1' && blob().format === 1, 'a new design has one page and still saves as format 1');
    addText('heading'); board.getActiveObject().exitEditing(); commitDesign();
    $('#page-add').click();
    await until(() => designPages.length === 2 && pageAt === 1 && board.getObjects().length === 0, 'Add page adds a blank page after this one and shows it');
    addShape('star');
    const two = blob();
    step(two.format === 2 && two.pages.length === 2 && two.pages[0].objects[0].type.toLowerCase() === 'textbox' && two.pages[1].objects[0].kbName === 'Star' && !('canvas' in two), 'two pages save as format 2, each with its own things');
    $('#page-list').children[0].click();
    await until(() => pageAt === 0 && board.getObjects()[0]?.type === 'textbox', 'clicking a page in the strip shows it');
    $('#page-list').children[1].click();
    await until(() => pageAt === 1 && board.getObjects()[0]?.kbName === 'Star', 'and back');
    $('#page-duplicate').click();
    await until(() => designPages.length === 3 && pageAt === 2 && board.getObjects()[0]?.kbName === 'Star' && $('#page-count').textContent === 'Page 3 of 3', 'Duplicate page copies this page after it');
    board.getObjects()[0].set({ fill: '#123456' }); commitDesign();
    $('#page-left').click();
    step(pageAt === 1 && allPages()[1].objects[0].fill === '#123456' && allPages()[2].objects[0].fill !== '#123456', 'moving a page earlier swaps it with the one before');
    $('#create-undo').click();
    await until(() => allPages()[2].objects[0].fill === '#123456' && pageAt === 2 && !restoring, 'undo puts the page back');
    $('#page-delete').click();
    await until(() => designPages.length === 2 && pageAt === 1, 'Delete page removes it');
    $('#create-undo').click();
    await until(() => designPages.length === 3 && !restoring, 'undo brings a deleted page back');
    await flush();
    const savedPages = JSON.parse(disk['c:designs:Pages test']);
    step(savedPages.format === 2 && savedPages.pages.length === 3, 'all pages are saved');
    for (const name of ['Pages test page 1.png', 'Pages test page 2.png', 'Pages test page 3.png']) delete window.outputs[name];
    $('#create-png').click();
    await until(() => window.outputs['Pages test page 3.png'] && window.outputs['Pages test page 1.png'], () => 'a picture is saved per page: ' + $('#create-saved').textContent);
    step($('#create-saved').textContent === 'Saved 3 pictures in the Exports folder', 'and it says so');
    put($('#create-copies'), '2', 'change');
    $('#create-pdf').click();
    await until(() => window.outputs['Pages test.pdf'], 'multi-page PDF');
    const pagesPdf = new TextDecoder('latin1').decode(window.outputs['Pages test.pdf'].bytes);
    step((pagesPdf.match(/\\/Type\\s*\\/Page\\b/g) || []).length === 6, () => 'the PDF has every page once per copy: ' + (pagesPdf.match(/\\/Type\\s*\\/Page\\b/g) || []).length);
    put($('#create-copies'), '1', 'change');
    await settle($('#create-home').onclick(), 'leave pages design');
    await settle(openDesign('Pages test'), 'reopen pages design');
    step(designPages.length === 3 && pageAt === 0 && board.getObjects()[0]?.type === 'textbox' && $('#page-list').children.length === 3, 'reopening brings every page back, starting on the first');
    // Resize scales everything about the middle; a custom size is kept with the design.
    const head = board.getObjects()[0], headBefore = head.getCenterPoint(), beforeWidth = head.getScaledWidth();
    put($('#create-page'), 'quarter', 'change');
    await until(() => pagePx().join() === '408,528', 'resized to quarter sheet');
    const headAfter = board.getObjects()[0];
    step(Math.abs(headAfter.getScaledWidth() - beforeWidth / 2) < 0.5 && Math.abs(headAfter.getCenterPoint().x - headBefore.x / 2) < 0.5 && Math.abs(headAfter.getCenterPoint().y - headBefore.y / 2) < 0.5 && allPages()[1].objects[0].scaleX === 0.5, 'Resize scales every page to fit, keeping things in place');
    $('#resize-scale').checked = false;
    put($('#create-page'), 'custom', 'change');
    await until(() => !$('#custom-size').hidden && design.page === 'custom', 'Custom size shows width and height');
    put($('#custom-w'), '10', 'change');
    await until(() => pagePx().join() === '960,528', 'a custom width');
    put($('#custom-h'), '99', 'change');
    await until(() => pagePx().join() === '960,3456' && $('#custom-h').value === '36', 'custom sides stop at 36 inches');
    step(Math.abs(board.getObjects()[0].getScaledWidth() - beforeWidth / 2) < 0.5, 'with scaling off, Resize leaves things as they are');
    $('#resize-scale').checked = true;
    await flush();
    const custom = JSON.parse(disk['c:designs:Pages test']);
    step(custom.format === 2 && custom.page === 'custom' && custom.size.join() === '10,36', 'a custom size is saved with the design');
    await settle(openDesign('Pages test'), 'reopen custom design');
    step(design.page === 'custom' && pagePx().join() === '960,3456', 'and comes back');
    // 0.15: colour panel, text effects, draggable layers, start-screen pictures.
    await settle(newDesign(), 'effects design');
    put($('#create-title'), 'Effects test', 'change');
    const effectText = addText('heading'); effectText.exitEditing(); effectText.set({ fill: '#ff3131' });
    addShape('rect'); board.getActiveObject().set({ fill: '#5e17eb' }); commitDesign();
    $('#colours-open').click();
    const docColours = [...$('#colours-document').children].map(b => b.dataset.colour);
    step(docColours.includes('#ff3131') && docColours.includes('#5e17eb') && docColours.includes('#ffffff') && $('#colours-default').children.length === DEFAULT_COLOURS.length, () => "the colour panel shows this design's colours and a default palette: " + docColours);
    selectObjects([effectText]);
    $('#colours-default').querySelector('[data-colour="#00bf63"]').click();
    step(effectText.fill === '#00bf63' && $('#prop-fill').value === '#00bf63', 'a default colour applies to the selection');
    board.discardActiveObject(); paintPanel();
    $('#colours-default').querySelector('[data-colour="#f4e1c1"]').click();
    step(board.backgroundColor === '#f4e1c1', 'with nothing selected it colours the background');
    closeMenus();
    selectObjects([effectText]);
    step(shown('#text-effects'), 'text has an effects grid');
    $('#text-effects').querySelector('[data-effect=hollow]').click();
    step(effectText.kbEffect === 'hollow' && effectText.fill === 'transparent' && effectText.stroke === '#00bf63' && $('#text-effects .on').dataset.effect === 'hollow', 'Hollow turns the text into its outline');
    put($('#prop-fill'), '#8c52ff', 'input');
    step(effectText.stroke === '#8c52ff' && effectText.fill === 'transparent', 'recolouring hollow text recolours the outline');
    $('#text-effects').querySelector('[data-effect=neon]').click();
    step(effectText.kbEffect === 'neon' && effectText.fill === '#8c52ff' && effectText.shadow?.color === '#8c52ff' && effectText.stroke === null, 'Neon glows in the text colour, starting from plain text');
    $('#text-effects').querySelector('[data-effect=lift]').click();
    await settle(flush(), 'effects save'); await settle(openDesign('Effects test'), 'effects reopen');
    const liftText = board.getObjects()[0];
    step(liftText.kbEffect === 'lift' && liftText.shadow?.offsetY > 0 && liftText.fill === '#8c52ff', 'text effects survive save and reopen');
    selectObjects([liftText]); $('#text-effects').querySelector('[data-effect=none]').click();
    step(!liftText.kbEffect && !liftText.shadow && liftText.fill === '#8c52ff', 'None takes the effect off');
    // Layers drag: the list is front-first, so the rectangle's row (top) dropped below the text's row sends it behind.
    showDrawer('layers');
    const rows = () => [...$('#layers').children];
    const rectRow = rows()[0], textRow = rows()[1];
    const layerDrag = new DataTransfer();
    rectRow.dispatchEvent(new DragEvent('dragstart', { dataTransfer: layerDrag, bubbles: true }));
    const layerBox = textRow.getBoundingClientRect();
    textRow.dispatchEvent(new DragEvent('dragover', { dataTransfer: layerDrag, clientY: layerBox.bottom - 2, bubbles: true, cancelable: true }));
    textRow.dispatchEvent(new DragEvent('drop', { dataTransfer: layerDrag, clientY: layerBox.bottom - 2, bubbles: true, cancelable: true }));
    step(board.getObjects()[0].type === 'rect' && board.getObjects()[1].type === 'textbox', () => 'dragging a layer below another sends it behind: ' + board.getObjects().map(o => o.type));
    moveLayer(0, 1, true);
    step(board.getObjects()[1].type === 'rect', 'dropping above a layer brings it in front');
    await settle($('#create-home').onclick(), 'home for pictures');
    await until(() => $('#home-recent').firstElementChild?.querySelector('img')?.src.startsWith('data:image/png') && $('#home-recent').children.length > 24 && !$('#home-recent').children[24].querySelector('img'), 'the newest 24 designs show a picture of their first page');
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
  .replace('<script src="vendor/fabric-extensions.min.js"></script>', () => '<script>' + ui('vendor/fabric-extensions.min.js') + '</script>')
  .replace('<script src="vendor/jspdf.umd.min.js"></script>', () => '<script>' + ui('vendor/jspdf.umd.min.js') + '</script>')
  .replace('<script src="vendor/qrcode.js"></script>', () => '<script>' + ui('vendor/qrcode.js') + '</script>')
  .replace('<script src="vendor/qrcode_UTF8.js"></script>', () => '<script>' + ui('vendor/qrcode_UTF8.js') + '</script>')
  .replace('<script src="create.js"></script>', () => '<script>' + ui('create.js') + '</script>' + test);
const file = path.join(temp, 'check.html');
fs.writeFileSync(file, html);
// Real time, not --virtual-time-budget: virtual time runs ahead of GPU readbacks and image decodes, ending the run early.
// Chromium runs with a DevTools port; we poll the page's result until it reports or stays silent too long.
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const chromium = cp.spawn(process.env.CHROMIUM || '/usr/bin/chromium', ['--headless', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-first-run', '--no-sandbox', '--allow-file-access-from-files', '--window-size=1300,850', '--user-data-dir=' + path.join(temp, 'profile'), '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' });
  let outcome, step, skipped, error;
  try {
    const portFile = path.join(temp, 'profile', 'DevToolsActivePort');
    for (let i = 0; i < 200 && !fs.existsSync(portFile); i++) await sleep(100);
    const [port] = fs.readFileSync(portFile, 'utf8').split('\n');
    const target = await (await fetch('http://127.0.0.1:' + port + '/json/new?file://' + file, { method: 'PUT' })).json();
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let id = 0;
    const waiting = new Map();
    socket.onmessage = e => { const m = JSON.parse(e.data); waiting.get(m.id)?.(m); };
    const send = (method, params = {}) => new Promise(resolve => { waiting.set(++id, resolve); socket.send(JSON.stringify({ id, method, params })); });
    // A tab opened over DevTools starts hidden, and a hidden page gets no frames or IntersectionObserver callbacks.
    await send('Page.bringToFront'); await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    const read = expression => new Promise(resolve => { waiting.set(++id, resolve); socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } })); }).then(m => m.result?.result?.value);
    let lastStep, lastChange = Date.now();
    while (!outcome && Date.now() - lastChange < 120000) {
      await sleep(250);
      outcome = await read('document.body && document.body.dataset.testResult');
      step = await read('document.body && document.body.dataset.testStep');
      if (step !== lastStep) { lastStep = step; lastChange = Date.now(); }
    }
    skipped = await read('document.body && document.body.dataset.skipped');
    socket.close();
  } catch (e) { error = e; } finally { const exited = new Promise(r => chromium.once('exit', r)); chromium.kill(); await exited; }
  if (outcome === 'PASS') { fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5 }); console.log('PASS: culling and develop UI' + (skipped ? '; skipped odd-scale sources:' + skipped : '')); process.exit(0); }
  console.error('UI check failed: ' + (outcome || 'stuck after ' + (step || error)) + '\nCheck file: ' + file);
  process.exit(1);
})();
