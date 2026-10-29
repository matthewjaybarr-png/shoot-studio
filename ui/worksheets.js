// Puzzles and worksheets, in the Classroom drawer: a word search, a crossword or a math page made from a word list
// (typed, or one of My lists) or a few choices, as a new design: the puzzle on page 1 and, if wanted, the answer key
// on page 2. Everything on the pages is ordinary text and shapes she can restyle. The generators are plain functions
// with a seed, so the tests can check them and New puzzle can shuffle. Needs create.js and classroom.js.

const SHEET_KINDS = {
  search: { title: 'Word search', words: true, hint: 'One word per line. Up to 30 words; spaces and dashes are left out.' },
  crossword: { title: 'Crossword', words: true, hint: 'One per line: the word, then a colon and its clue (cat: A pet that purrs). Up to 25 words.' },
  math: { title: 'Math practice', words: false }
};
const sheet = { kind: 'search', seed: 1 };

// A small seeded random number generator (mulberry32), so a puzzle can be made again exactly.
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const cleanWord = w => w.toUpperCase().normalize('NFD').replace(/[^A-Z]/g, '');

// ---- Word search ----
const SEARCH_DIRS = { easy: [[1, 0], [0, 1]], medium: [[1, 0], [0, 1], [1, 1], [1, -1]], hard: [[1, 0], [0, 1], [1, 1], [1, -1], [-1, 0], [0, -1], [-1, -1], [-1, 1]] };
// The grid (rows of letters), where each word went, and any word that didn't fit.
function wordSearch(list, level = 'medium', seed = 1) {
  const words = [...new Set(list.map(cleanWord).filter(w => w.length >= 2))].slice(0, 30).sort((a, b) => b.length - a.length);
  if (!words.length) return null;
  const letters = words.reduce((n, w) => n + w.length, 0);
  let size = Math.min(18, Math.max(8, words[0].length, Math.ceil(Math.sqrt(letters * 2.2))));
  for (;; size++) {
    const rand = seededRandom(seed + size), grid = Array.from({ length: size }, () => Array(size).fill('')), placed = [], skipped = [];
    for (const word of words) {
      if (word.length > size) { skipped.push(word); continue; }
      let ok = false;
      for (let tries = 0; tries < 500 && !ok; tries++) {
        const dirs = SEARCH_DIRS[level] || SEARCH_DIRS.medium, [dx, dy] = dirs[Math.floor(rand() * dirs.length)];
        const x = Math.floor(rand() * size), y = Math.floor(rand() * size), ex = x + dx * (word.length - 1), ey = y + dy * (word.length - 1);
        if (ex < 0 || ex >= size || ey < 0 || ey >= size) continue;
        if ([...word].some((c, i) => { const g = grid[y + dy * i][x + dx * i]; return g && g !== c; })) continue;
        [...word].forEach((c, i) => { grid[y + dy * i][x + dx * i] = c; });
        placed.push({ word, x, y, dx, dy }); ok = true;
      }
      if (!ok) skipped.push(word);
    }
    if (skipped.length && size < 18) continue; // a bigger grid, and try again
    for (const row of grid) for (let x = 0; x < size; x++) row[x] ||= 'ABCDEFGHIJKLMNOPRSTUVWY'[Math.floor(rand() * 23)];
    return { size, grid, placed, skipped };
  }
}

// ---- Crossword ----
// Lines of "word: clue" (or a dash or a tab between), into words and clues.
function cluesFrom(text) {
  return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^([^:\t–—-]+?)\s*(?:[:\t–—]|\s-\s|-)\s*(.*)$/);
    return { word: cleanWord(m ? m[1] : l), clue: (m ? m[2] : '').trim() };
  }).filter(e => e.word.length >= 2).slice(0, 25);
}
// Words crossing each other on a grid, as many as fit; the tightest of a few tries.
function crossword(entries, seed = 1) {
  const unique = [...new Map(entries.map(e => [e.word, e])).values()];
  if (!unique.length) return null;
  let best = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const rand = seededRandom(seed * 31 + attempt), order = unique.slice().sort((a, b) => b.word.length - a.word.length + (attempt ? rand() - 0.5 : 0) * 4);
    const cells = new Map(), placed = [], skipped = [], at = (x, y) => cells.get(x + ',' + y);
    const fits = (word, x, y, dx, dy) => {
      if (at(x - dx, y - dy) || at(x + dx * word.length, y + dy * word.length)) return -1;
      let crossings = 0;
      for (let i = 0; i < word.length; i++) {
        const cx = x + dx * i, cy = y + dy * i, here = at(cx, cy);
        if (here) { if (here !== word[i]) return -1; crossings++; continue; }
        if (at(cx + dy, cy + dx) || at(cx - dy, cy - dx)) return -1; // no letters touching side by side
      }
      return crossings;
    };
    const put = (e, x, y, dx, dy) => { [...e.word].forEach((c, i) => cells.set((x + dx * i) + ',' + (y + dy * i), c)); placed.push({ ...e, x, y, dx, dy }); };
    put(order[0], 0, 0, 1, 0);
    for (const e of order.slice(1)) {
      let choice = null;
      for (const p of placed) for (let i = 0; i < p.word.length; i++) for (let j = 0; j < e.word.length; j++) {
        if (p.word[i] !== e.word[j]) continue;
        const [dx, dy] = p.dx ? [0, 1] : [1, 0], x = p.x + p.dx * i - dx * j, y = p.y + p.dy * i - dy * j, n = fits(e.word, x, y, dx, dy);
        if (n < 1) continue;
        const score = n * 10 - Math.abs(x) - Math.abs(y) + rand();
        if (!choice || score > choice.score) choice = { x, y, dx, dy, score };
      }
      if (choice) put(e, choice.x, choice.y, choice.dx, choice.dy); else skipped.push(e);
    }
    const xs = [...cells.keys()].map(k => +k.split(',')[0]), ys = [...cells.keys()].map(k => +k.split(',')[1]);
    const minX = Math.min(...xs), minY = Math.min(...ys), w = Math.max(...xs) - minX + 1, h = Math.max(...ys) - minY + 1;
    const result = { w, h, cells: new Map([...cells].map(([k, c]) => { const [x, y] = k.split(',').map(Number); return [(x - minX) + ',' + (y - minY), c]; })), placed: placed.map(p => ({ ...p, x: p.x - minX, y: p.y - minY })), skipped };
    const better = !best || result.skipped.length < best.skipped.length || (result.skipped.length === best.skipped.length && Math.max(w, h) < Math.max(best.w, best.h));
    if (better) best = result;
  }
  // Numbers, in reading order, on every square a word starts from.
  const starts = [...new Set(best.placed.map(p => p.x + ',' + p.y))].sort((a, b) => { const [ax, ay] = a.split(',').map(Number), [bx, by] = b.split(',').map(Number); return ay - by || ax - bx; });
  const number = new Map(starts.map((k, i) => [k, i + 1]));
  for (const p of best.placed) p.n = number.get(p.x + ',' + p.y);
  best.numbers = number;
  return best;
}

// ---- Math ----
// Problems for one operation (or + and − mixed), with whole-number answers and nothing below zero.
function mathProblems(op = 'add', upTo = 10, count = 20, seed = 1) {
  const rand = seededRandom(seed), n = max => Math.floor(rand() * (max + 1)), out = [];
  for (let i = 0; i < count; i++) {
    const kind = op === 'mixed' ? (rand() < 0.5 ? 'add' : 'sub') : op, small = Math.min(upTo, 12);
    if (kind === 'add') { const a = n(upTo), b = n(upTo - a); out.push({ text: `${a} + ${b}`, answer: a + b }); }
    else if (kind === 'sub') { const a = n(upTo), b = n(a); out.push({ text: `${a} − ${b}`, answer: a - b }); }
    else if (kind === 'mul') { const a = n(upTo), b = n(small); out.push({ text: `${a} × ${b}`, answer: a * b }); }
    else { const b = 1 + n(small - 1), q = n(upTo); out.push({ text: `${b * q} ÷ ${b}`, answer: q }); }
  }
  return out;
}

// ---- Pages: 816 × 1056 (Letter at 96 px an inch), all plain text boxes and shapes ----
const SHEET_PINK = '#d0489b';
function sheetHeader(title, answers) {
  return [T(answers ? title + ': answer key' : title, 48, 40, { width: 720, fontSize: 48, textAlign: 'center', fontFamily: 'Fredoka', fontWeight: 'bold', kbName: 'Title' }),
    T(answers ? ' ' : 'Name: ____________________     Date: ____________', 48, 116, { width: 720, fontSize: 22, textAlign: 'center', kbName: 'Name line' })];
}
const toPage = objects => ({ objects: objects.map(o => o.toObject(KEEP)), background: '#ffffff' });

function searchPage(title, s, answers) {
  const cell = Math.min(40, 680 / s.size), left = (816 - cell * s.size) / 2, top = 170, mark = new Set();
  if (answers) for (const p of s.placed) for (let i = 0; i < p.word.length; i++) mark.add((p.x + p.dx * i) + ',' + (p.y + p.dy * i));
  const letters = s.grid.flatMap((row, y) => row.map((c, x) => T(c, left + x * cell, top + y * cell + cell * 0.18, { width: cell, fontSize: cell * 0.58, textAlign: 'center', fontWeight: mark.has(x + ',' + y) ? 'bold' : 'normal', fill: mark.has(x + ',' + y) ? SHEET_PINK : '#222222', kbName: 'Letter' })));
  const grid = new fabric.Group([R(left - 8, top - 8, cell * s.size + 16, cell * s.size + 16, { rx: 12, ry: 12, stroke: '#9b6bd6', strokeWidth: 3, kbName: 'Border' }), ...letters], { kbName: 'Word search grid' });
  const words = s.placed.map(p => p.word).sort(), cols = 3, per = Math.ceil(words.length / cols), below = top + cell * s.size + 36;
  const lists = Array.from({ length: cols }, (_, c) => words.slice(c * per, (c + 1) * per)).filter(l => l.length)
    .map((l, c) => T(l.join('\n'), 96 + c * 220, below, { width: 200, fontSize: Math.min(24, (1000 - below) / per / 1.3), kbName: 'Words' }));
  return toPage([...sheetHeader(title, answers), grid, ...lists]);
}
function crosswordPage(title, x, answers) {
  const cell = Math.min(44, 700 / x.w, 520 / x.h), left = (816 - cell * x.w) / 2, top = 170, parts = [];
  for (const [k, c] of x.cells) {
    const [cx, cy] = k.split(',').map(Number), l = left + cx * cell, t = top + cy * cell;
    parts.push(R(l, t, cell, cell, { fill: '#ffffff', stroke: '#333333', strokeWidth: 1.5, kbName: 'Square' }));
    if (x.numbers.has(k)) parts.push(T(String(x.numbers.get(k)), l + 2, t + 1, { width: cell * 0.5, fontSize: Math.max(8, cell * 0.28), kbName: 'Number' }));
    if (answers) parts.push(T(c, l, t + cell * 0.22, { width: cell, fontSize: cell * 0.55, textAlign: 'center', fill: SHEET_PINK, fontWeight: 'bold', kbName: 'Letter' }));
  }
  const grid = new fabric.Group(parts, { kbName: 'Crossword grid' }), below = top + cell * x.h + 32;
  const clue = p => `${p.n}. ${p.clue || '(write a clue)'}${answers ? ' (' + p.word + ')' : ''}`;
  const across = x.placed.filter(p => p.dx).sort((a, b) => a.n - b.n), down = x.placed.filter(p => p.dy).sort((a, b) => a.n - b.n);
  const size = Math.max(14, Math.min(22, (1010 - below) / (Math.max(across.length, down.length) + 1) / 1.35));
  return toPage([...sheetHeader(title, answers), grid,
    T('Across\n' + across.map(clue).join('\n'), 64, below, { width: 330, fontSize: size, kbName: 'Across clues' }),
    T('Down\n' + down.map(clue).join('\n'), 424, below, { width: 330, fontSize: size, kbName: 'Down clues' })]);
}
function mathPage(title, problems, answers) {
  const rows = Math.ceil(problems.length / 2), gap = Math.min(80, 840 / rows), size = Math.min(34, gap * 0.45);
  const items = problems.map((p, i) => T(`${i + 1}.   ${p.text} = ${answers ? p.answer : '______'}`, i < rows ? 80 : 440, 180 + (i % rows) * gap, { width: 320, fontSize: size, fill: '#222222', kbName: 'Problem ' + (i + 1) }));
  if (answers) items.forEach((t, i) => { const at = t.text.lastIndexOf('= ') + 2; t.styles = { 0: Object.fromEntries([...String(problems[i].answer)].map((_, k) => [at + k, { fill: SHEET_PINK, fontWeight: 'bold' }])) }; });
  return toPage([...sheetHeader(title, answers), ...items]);
}

// ---- The dialog ----
function openSheet(kind) {
  sheet.kind = kind; sheet.seed = Math.floor(Math.random() * 1e9);
  const k = SHEET_KINDS[kind];
  $('#sheet-heading').textContent = k.title;
  $('#sheet-title').value = k.title;
  $('#sheet-words-part').hidden = !k.words; $('#sheet-math-part').hidden = k.words;
  $('#sheet-level-row').hidden = kind !== 'search';
  $('#sheet-words-hint').textContent = k.hint || '';
  $('#sheet-words').placeholder = kind === 'crossword' ? 'cat: A pet that purrs\nsun: It shines in the day\nfrog: It hops and says ribbit' : 'apple\nbanana\ncherry';
  const lists = typeof classLists !== 'undefined' ? [...classLists.keys()].sort((a, b) => a.localeCompare(b)) : [];
  $('#sheet-list').replaceChildren(new Option('Type them below', ''), ...lists.map(n => new Option(n, n)));
  $('#sheet-list-row').hidden = !lists.length;
  $('#sheet-note').textContent = '';
  $('#sheet-dialog').showModal();
}
// One of My lists: the first column as the words, and the second (if there is one) as the crossword clues.
$('#sheet-list').onchange = e => {
  const c = typeof classLists !== 'undefined' && classLists.get(e.target.value);
  if (!c) return;
  const rows = toRows(c).slice(1).filter(r => r[0]?.trim());
  $('#sheet-words').value = rows.map(r => sheet.kind === 'crossword' && r[1] ? `${r[0]}: ${r[1]}` : r[0]).join('\n');
};
$('#sheet-close').onclick = () => $('#sheet-dialog').close();
$('#sheet-make').onclick = () => makeSheet().catch(error => { $('#sheet-note').textContent = `Couldn't make it: ${error.message || error}`; });

async function makeSheet() {
  const kind = sheet.kind, title = $('#sheet-title').value.trim() || SHEET_KINDS[kind].title, key = $('#sheet-key').checked, pages = [];
  let note = '';
  if (kind === 'search') {
    const s = wordSearch($('#sheet-words').value.split(/\r?\n/), $('#sheet-level').value, sheet.seed);
    if (!s) return void ($('#sheet-note').textContent = 'Type a few words first, one per line.');
    pages.push(searchPage(title, s, false)); if (key) pages.push(searchPage(title, s, true));
    if (s.skipped.length) note = `Left out (too long, or no room): ${s.skipped.join(', ')}.`;
  } else if (kind === 'crossword') {
    const x = crossword(cluesFrom($('#sheet-words').value), sheet.seed);
    if (!x) return void ($('#sheet-note').textContent = 'Type a few words first, one per line, each with a clue after a colon.');
    if (x.placed.length < 2) return void ($('#sheet-note').textContent = 'These words share no letters, so they can\'t cross. Add a few more words.');
    pages.push(crosswordPage(title, x, false)); if (key) pages.push(crosswordPage(title, x, true));
    if (x.skipped.length) note = `Left out (no letter to cross with): ${x.skipped.map(e => e.word).join(', ')}.`;
  } else {
    const problems = mathProblems($('#sheet-op').value, +$('#sheet-upto').value, +$('#sheet-count').value, sheet.seed);
    pages.push(mathPage(title, problems, false)); if (key) pages.push(mathPage(title, problems, true));
  }
  $('#sheet-dialog').close();
  await navigateDesign(async () => {
    startBoard();
    await open({ format: 2, page: 'letter', pages }, await uniqueTitle(title), null);
    commitDesign(); // saved, with its page thumbnails and Layers
  });
  $('#sheet-done').textContent = note || `Made “${design.title}”${key ? ', with the answer key on page 2' : ''}. Click again for a new one.`;
  sheet.seed++; // the next one is a new puzzle
}
for (const [id, kind] of [['#sheet-search', 'search'], ['#sheet-crossword', 'crossword'], ['#sheet-math', 'math']]) $(id).onclick = () => openSheet(kind);
