// Drive the culling and develop UI in headless Chromium with a fake 500-photo shoot; no real photos are read.
// The real develop shader runs on known pixels (WebGL2 through SwiftShader).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'shoot-studio-check-'));
const ui = name => fs.readFileSync(path.join(__dirname, 'ui', name), 'utf8');
const mock = `<script>
window.calls = []; window.disk = {}; window.gates = {}; window.failing = null; window.offer = null; window.sourceSize = [4, 2]; window.onerror = m => document.body.dataset.testResult = 'FAIL: page error ' + m;
// Half floats for develop_source's layout: width and height as u32s, then RGB.
const half = v => { const i = new Uint32Array(new Float32Array([v]).buffer)[0], e = ((i >>> 23) & 255) - 112; return ((i >>> 16) & 0x8000) | (e <= 0 ? 0 : e >= 31 ? 0x7c00 : (e << 10) | ((i & 0x7fffff) >>> 13)); };
// rgb: every value in order, or one value for them all.
const rawImage = (w, h, rgb) => { const b = new ArrayBuffer(8 + w * h * 6), px = new Uint16Array(b, 8); new Uint32Array(b, 0, 2).set([w, h]); if (Array.isArray(rgb)) px.set(rgb.map(half)); else px.fill(half(rgb)); return b; };
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
    step(fullRecipe({ look: 'not-a-look' }).look === '' && settingsOf({ exposure: 1, retouch: [{}] }).retouch === undefined, 'an unknown look is dropped; settings leave out strokes');

    // Develop: the view.
    const ctrl = (key, shiftKey = false) => grid.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey, bubbles: true }));
    const slide = (key, value) => { const input = sliders.querySelector('[data-key="' + key + '"]'); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); return input; };
    const savedRecipe = id => JSON.parse(disk['recipes:' + dir] || '{}')[id];
    move(1); press('d');
    await until(() => editing?.ready && !sliders.disabled, 'D develops the photo');
    step(!develop.classList.contains('hidden') && grid.classList.contains('hidden') && calls.at(-1).command === 'develop_source' && calls.at(-1).args.name === 'IMG_0001.CR2', 'a RAW+JPEG pair develops from its RAW');
    slide('exposure', 1);
    await until(() => savedRecipe('IMG_0001')?.exposure === 1 && savedRecipe('IMG_0001').version === 3, 'a slider change saves the recipe');
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
    await until(() => savedRecipe('IMG_0001')?.look === 'sepia' && savedRecipe('IMG_0001').version === 3, 'choosing a look saves it');
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
    step(savedRecipe('IMG_0013').version === 3 && $('#develop-caption').textContent.includes('Edited'), 'a retouch alone makes the photo Edited');

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

    press('h');
    drag([[cx, cy], [cx + 20, cy]]);
    step(strokes().length === 1 && $('#status').textContent.includes('Ctrl+click'), 'heal waits for a source');
    mouse('pointerdown', cx - 80, cy - 40, { ctrlKey: true }); mouse('pointerup', cx - 80, cy - 40, { ctrlKey: true });
    const healPath = [[cx, cy], [cx + 10, cy], [cx + 20, cy + 10]];
    drag(healPath);
    await until(() => strokes().length === 2, 'Ctrl+click then a drag saves a heal stroke');
    saved = strokes()[1];
    const from = zoomed(cx - 80, cy - 40), first = zoomed(...healPath[0]);
    step(saved.tool === 'heal' && saved.size === 0.008 && nearAll(saved.points, healPath.map(p => zoomed(...p))) && near(saved.offset, [from[0] - first[0], from[1] - first[1]]), 'at 100% after a pan, the heal points and source offset are right (' + JSON.stringify(saved) + ')');
    drag([[cx + 50, cy], [cx + 60, cy]]);
    await until(() => strokes().length === 3, 'a second heal stroke');
    step(near(strokes()[2].offset, saved.offset), 'the source stays aligned: the same offset for the next stroke');
    await until(() => calls.filter(c => c.command === 'retouch').at(-1)?.args.strokes.length === 3, 'Rust gets all three strokes');

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
    press('Escape');
    step(develop.classList.contains('hidden') && !grid.classList.contains('hidden'), 'a second Esc goes to the grid');
    await until(() => disk[dir + '/edited/IMG_0013.thumb'], 'leaving saves the retouched look');
    sourceSize = [4, 2];

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
