// Drive the culling and develop UI in headless Chromium with a fake 500-photo shoot; no real photos are read.
// The real develop shader runs on known pixels (WebGL2 through SwiftShader).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'shoot-studio-check-'));
const ui = name => fs.readFileSync(path.join(__dirname, 'ui', name), 'utf8');
const mock = `<script>
window.calls = []; window.disk = {}; window.gates = {}; window.failing = null; window.offer = null; window.onerror = m => document.body.dataset.testResult = 'FAIL: page error ' + m;
// Half floats for develop_source's layout: width and height as u32s, then RGB.
const half = v => { const i = new Uint32Array(new Float32Array([v]).buffer)[0], e = ((i >>> 23) & 255) - 112; return ((i >>> 16) & 0x8000) | (e <= 0 ? 0 : e >= 31 ? 0x7c00 : (e << 10) | ((i & 0x7fffff) >>> 13)); };
const rawImage = (w, h, rgb) => { const b = new ArrayBuffer(8 + w * h * 6); new Uint32Array(b, 0, 2).set([w, h]); new Uint16Array(b, 8).set(rgb.map(half)); return b; };
const jpeg = () => new Promise(done => { const c = document.createElement('canvas'); c.width = 60; c.height = 40; c.getContext('2d').fillRect(0, 0, 60, 40); c.toBlob(b => b.arrayBuffer().then(done), 'image/jpeg'); });
window.__TAURI__ = { core: { Channel: class { onmessage() {} }, invoke: async (command, args) => {
  calls.push({ command, args });
  if (gates[command]) await gates[command].promise; // a test holds this command until it calls release()
  if (command === 'pick_shoot') return '/shoots/Smith Wedding';
  if (command === 'startup_shoot') return null;
  if (command === 'app_version') return '0.1.0';
  if (command === 'check_update') { if (offer instanceof Error) throw offer.message; return offer; }
  if (command === 'install_update') { args.progress.onmessage(42); throw 'signature mismatch'; }
  if (command === 'open_shoot') return Array.from({ length: 500 }, (_, i) => { const id = 'IMG_' + String(i).padStart(4, '0'); return { id, jpg: i % 3 ? id + '.JPG' : null, raw: i % 3 < 2 ? id + '.CR2' : null }; });
  if (command === 'load_shoot') return disk[args.dir] ? JSON.parse(disk[args.dir]) : null;
  if (command === 'save_shoot') { disk[args.dir] = JSON.stringify(args.data); return null; }
  if (command === 'load_recipes') return JSON.parse(disk['recipes:' + args.dir] || '{}');
  if (command === 'save_recipe') {
    const all = JSON.parse(disk['recipes:' + args.dir] || '{}');
    if (args.recipe) all[args.id] = args.recipe; else { delete all[args.id]; delete disk[args.dir + '/edited/' + args.id]; delete disk[args.dir + '/edited/' + args.id + '.thumb']; }
    disk['recipes:' + args.dir] = JSON.stringify(all); return null;
  }
  const edited = args.dir + '/edited/' + args.id + (args.thumb ? '.thumb' : '');
  if (command === 'save_edited') { disk[edited] = new Uint8Array(args.data); return null; }
  if (command === 'edited') { if (disk[edited]) return disk[edited].buffer; throw 'no edited preview'; }
  if (command === 'develop_source') return rawImage(4, 2, Array(24).fill(0.18));
  const key = args.dir + '/' + args.name;
  if (command === 'thumb') { if (disk[key]) return disk[key].buffer; throw 'no thumbnail yet'; }
  if (command === 'save_thumb') { disk[key] = new Uint8Array(args.data); return null; }
  if (command === 'preview') { if (args.name === failing) throw 'broken preview'; return jpeg(); }
  throw 'unknown command ' + command;
} } };
</script>`;
const test = `<script>
(async () => {
  const step = (ok, message) => { document.body.dataset.testStep = message; if (!ok) throw Error(message); };
  const until = async (ok, message) => { for (let i = 0; i < 4000 && !ok(); i++) await new Promise(r => setTimeout(r, 25)); step(ok(), typeof message === 'function' ? message() : message); };
  const press = key => grid.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  const count = command => calls.filter(c => c.command === command).length;
  const hold = command => { let release; const promise = new Promise(r => release = r); gates[command] = { promise }; return () => { delete gates[command]; release(); }; };
  const tick = () => new Promise(r => setTimeout(r, 50));
  const lastSave = () => calls.filter(c => c.command === 'save_shoot').at(-1)?.args.data.ratings;
  try {
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
    dev.setImage(await createImageBitmap(src));
    const out = recipe => dev.pixels(recipe, 16).data;
    const worst = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) if (i % 4 !== 3) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
    step(worst(out({}), want) <= 1, 'a JPEG at the default recipe renders as itself (off by ' + worst(out({}), want) + ')');
    const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const enc = v => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
    const bright = out({ exposure: 1 });
    let off = 0;
    for (let i = 0; i < want.length; i++) if (i % 4 !== 3 && lin(want[i]) <= 0.5) off = Math.max(off, Math.abs(bright[i] - enc(2 * lin(want[i]))));
    step(off <= 1.5, 'exposure +1 doubles linear light (off by ' + off.toFixed(2) + ')');
    for (const s of SLIDERS) step(worst(out({ [s.key]: s.max / 2 }), want) > 2, s.label + ' changes the picture');
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

    // Develop: the view.
    const ctrl = (key, shiftKey = false) => grid.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey, bubbles: true }));
    const slide = (key, value) => { const input = sliders.querySelector('[data-key="' + key + '"]'); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); return input; };
    const savedRecipe = id => JSON.parse(disk['recipes:' + dir] || '{}')[id];
    move(1); press('d');
    await until(() => editing?.ready && !sliders.disabled, 'D develops the photo');
    step(!develop.classList.contains('hidden') && grid.classList.contains('hidden') && calls.at(-1).command === 'develop_source' && calls.at(-1).args.name === 'IMG_0001.CR2', 'a RAW+JPEG pair develops from its RAW');
    slide('exposure', 1);
    await until(() => savedRecipe('IMG_0001')?.exposure === 1 && savedRecipe('IMG_0001').version === 1, 'a slider change saves the recipe');
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
    step(!calls.some(c => c.command === 'develop_source' && c.args.name.startsWith('IMG_0002')), 'a JPEG-only photo develops from its JPEG');
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
    press('Escape');

    // Updates.
    step($('#update').hidden && $('#version').textContent === 'Shoot Studio 0.1.0', 'no banner without an update; version shown');
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
    document.body.dataset.testResult = 'PASS';
  } catch (e) { document.body.dataset.testResult = 'FAIL: ' + e.message; }
})();
</script>`;
const html = ui('index.html')
  .replace('<link rel="stylesheet" href="style.css">', '<style>' + ui('style.css') + '</style>')
  .replace('<script src="develop.js"></script>', mock + '<script>' + ui('develop.js') + '</script>')
  .replace('<script src="app.js"></script>', '<script>' + ui('app.js') + '</script>' + test);
const file = path.join(temp, 'check.html');
fs.writeFileSync(file, html);
const result = cp.spawnSync(process.env.CHROMIUM || '/usr/bin/chromium', ['--headless', '--disable-gpu', '--enable-unsafe-swiftshader', '--no-first-run', '--no-sandbox', '--window-size=1300,850', '--user-data-dir=' + path.join(temp, 'profile'), '--virtual-time-budget=600000', '--dump-dom', 'file://' + file], { encoding: 'utf8', timeout: 60000, maxBuffer: 2e7 });
const outcome = result.stdout?.match(/data-test-result="([^"]*)"/)?.[1];
if (outcome === 'PASS') { fs.rmSync(temp, { recursive: true, force: true }); console.log('PASS: culling and develop UI'); process.exit(0); }
console.error('UI check failed: ' + (outcome || 'no result after ' + (result.stdout?.match(/data-test-step="([^"]*)"/)?.[1] || result.stderr || result.error)) + '\nCheck file: ' + file);
process.exit(1);
