// Drive the culling UI in headless Chromium with a fake 500-photo shoot; no real photos are read.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'shoot-studio-check-'));
const ui = name => fs.readFileSync(path.join(__dirname, 'ui', name), 'utf8');
const mock = `<script>
window.calls = []; window.disk = {}; window.gates = {}; window.failing = null; window.offer = null; window.onerror = m => document.body.dataset.testResult = 'FAIL: page error ' + m;
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
  .replace('<script src="app.js"></script>', mock + '<script>' + ui('app.js') + '</script>' + test);
const file = path.join(temp, 'check.html');
fs.writeFileSync(file, html);
const result = cp.spawnSync(process.env.CHROMIUM || '/usr/bin/chromium', ['--headless', '--disable-gpu', '--no-first-run', '--no-sandbox', '--window-size=1300,850', '--user-data-dir=' + path.join(temp, 'profile'), '--virtual-time-budget=600000', '--dump-dom', 'file://' + file], { encoding: 'utf8', timeout: 60000, maxBuffer: 2e7 });
const outcome = result.stdout?.match(/data-test-result="([^"]*)"/)?.[1];
if (outcome === 'PASS') { fs.rmSync(temp, { recursive: true, force: true }); console.log('PASS: culling UI'); process.exit(0); }
console.error('UI check failed: ' + (outcome || 'no result after ' + (result.stdout?.match(/data-test-step="([^"]*)"/)?.[1] || result.stderr || result.error)) + '\nCheck file: ' + file);
process.exit(1);
