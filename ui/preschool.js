// Preschool pages, in Classroom's Puzzles and worksheets: name and letter tracing, tracing lines and shapes, count and
// write, matching, what comes next and mazes. They share worksheets.js' window, header and seeds, and add their own
// choices to it. Letters to trace are drawn here as "ball and stick" strokes (lines and circles, as preschools teach
// them), dotted along the middle of each stroke the way tracing sheets are; free tracing fonts can't be shipped with
// the app. Pictures are the app's clip art. Needs create.js and worksheets.js.

// ---- Ball-and-stick letters: SVG paths in a box where the top line is y=0, the dashed middle line y=50, the base
// line y=100 and tails reach y=140. Only absolute M, L, Q and A commands, so they can be moved and scaled. ----
const BALL = (cx, cy, rx, ry = rx) => `M${cx - rx} ${cy} A${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}`;
const GLYPHS = {
  A: [70, 'M0 100 L35 0 L70 100 M13 62 L57 62'],
  B: [60, 'M0 0 L0 100 M0 0 L30 0 A25 25 0 0 1 30 50 L0 50 M0 50 L34 50 A25 25 0 0 1 34 100 L0 100'],
  C: [90, 'M85.4 14.6 A50 50 0 1 0 85.4 85.4'],
  D: [70, 'M0 0 L0 100 M0 0 L20 0 A50 50 0 0 1 20 100 L0 100'],
  E: [60, 'M60 0 L0 0 L0 100 L60 100 M0 50 L45 50'],
  F: [60, 'M60 0 L0 0 L0 100 M0 50 L45 50'],
  G: [100, 'M85.4 14.6 A50 50 0 1 0 100 50 L62 50'],
  H: [65, 'M0 0 L0 100 M65 0 L65 100 M0 50 L65 50'],
  I: [50, 'M25 0 L25 100 M0 0 L50 0 M0 100 L50 100'],
  J: [60, 'M60 0 L60 70 A30 30 0 0 1 0 70'],
  K: [60, 'M0 0 L0 100 M60 0 L0 60 M20 40 L60 100'],
  L: [55, 'M0 0 L0 100 L55 100'],
  M: [80, 'M0 100 L0 0 L40 70 L80 0 L80 100'],
  N: [65, 'M0 100 L0 0 L65 100 L65 0'],
  O: [100, BALL(50, 50, 50)],
  P: [60, 'M0 100 L0 0 L30 0 A25 25 0 0 1 30 50 L0 50'],
  Q: [100, BALL(50, 50, 50) + ' M60 70 L100 105'],
  R: [60, 'M0 100 L0 0 L30 0 A25 25 0 0 1 30 50 L0 50 M25 50 L60 100'],
  S: [70, 'M65 12.1 A35 25 0 1 0 35 50 A35 25 0 1 1 5 87.9'],
  T: [70, 'M0 0 L70 0 M35 0 L35 100'],
  U: [70, 'M0 0 L0 65 A35 35 0 0 0 70 65 L70 0'],
  V: [70, 'M0 0 L35 100 L70 0'],
  W: [90, 'M0 0 L22 100 L45 30 L68 100 L90 0'],
  X: [65, 'M0 0 L65 100 M65 0 L0 100'],
  Y: [64, 'M0 0 L32 50 L64 0 M32 50 L32 100'],
  Z: [65, 'M0 0 L65 0 L0 100 L65 100'],
  a: [50, BALL(25, 75, 25) + ' M50 50 L50 100'],
  b: [50, 'M0 0 L0 100 ' + BALL(25, 75, 25)],
  c: [45, 'M42.7 57.3 A25 25 0 1 0 42.7 92.7'],
  d: [50, 'M50 0 L50 100 ' + BALL(25, 75, 25)],
  e: [50, 'M0 75 L50 75 A25 25 0 1 0 42.7 92.7'],
  f: [40, 'M40 5 Q15 -5 15 25 L15 100 M0 50 L35 50'],
  g: [50, BALL(25, 75, 25) + ' M50 50 L50 118 A21 21 0 0 1 8 118'],
  h: [50, 'M0 0 L0 100 M0 72 A25 22 0 0 1 50 72 L50 100'],
  i: [20, 'M10 50 L10 100 M10 30 L10 30.5'],
  j: [32, 'M30 50 L30 122 A16 16 0 0 1 0 122 M30 30 L30 30.5'],
  k: [45, 'M0 0 L0 100 M45 50 L0 80 M15 70 L45 100'],
  l: [10, 'M5 0 L5 100'],
  m: [80, 'M0 50 L0 100 M0 70 A20 20 0 0 1 40 70 L40 100 M40 70 A20 20 0 0 1 80 70 L80 100'],
  n: [50, 'M0 50 L0 100 M0 72 A25 22 0 0 1 50 72 L50 100'],
  o: [50, BALL(25, 75, 25)],
  p: [50, 'M0 50 L0 140 ' + BALL(25, 75, 25)],
  q: [50, BALL(25, 75, 25) + ' M50 50 L50 140'],
  r: [40, 'M0 50 L0 100 M0 72 A22 22 0 0 1 40 58'],
  s: [50, 'M43.9 56.1 A22 12.5 0 1 0 25 75 A22 12.5 0 1 1 6.1 93.9'],
  t: [35, 'M15 15 L15 100 M0 50 L35 50'],
  u: [50, 'M0 50 L0 78 A25 22 0 0 0 50 78 L50 50 L50 100'],
  v: [50, 'M0 50 L25 100 L50 50'],
  w: [70, 'M0 50 L17 100 L35 60 L53 100 L70 50'],
  x: [45, 'M0 50 L45 100 M45 50 L0 100'],
  y: [50, 'M0 50 L25 100 M50 50 L12 140'],
  z: [45, 'M0 50 L45 50 L0 100 L45 100'],
  0: [60, BALL(30, 50, 30, 50)],
  1: [40, 'M10 20 L30 0 L30 100'],
  2: [60, 'M5 22 A27 22 0 1 1 52 42 L0 100 L60 100'],
  3: [58, 'M6.6 12 A27 24 0 1 1 30 48 A28 26 0 1 1 5.8 87'],
  4: [60, 'M45 100 L45 0 L0 70 L60 70'],
  5: [58, 'M55 0 L10 0 L6 44 Q30 32 50 50 Q62 66 50 86 Q32 106 3 90'],
  6: [60, 'M48 4 Q8 20 2 72 ' + BALL(30, 72, 28)],
  7: [60, 'M0 0 L60 0 L20 100'],
  8: [60, BALL(30, 24, 22, 24) + ' ' + BALL(30, 74, 28, 26)],
  9: [60, BALL(30, 28, 28) + ' M58 28 L58 100'],
  '-': [30, 'M0 70 L30 70'],
  "'": [10, 'M5 0 L5 20']
};
const GLYPH_GAP = 16, GLYPH_SPACE = 45;
const traceable = text => [...text.normalize('NFD').replace(/[̀-ͯ]/g, '')].filter(c => GLYPHS[c] || c === ' ').join('');
const glyphsWidth = text => [...text].reduce((w, c, i) => w + (c === ' ' ? GLYPH_SPACE : GLYPHS[c][0]) + (i ? GLYPH_GAP : 0), 0);
// A path moved by (dx, dy) after scaling by k: every x/y pair and arc radius scales; flags and angles stay.
function shiftPath(d, dx, dy, k) {
  const out = [], tokens = d.match(/[MLQA]|-?\d*\.?\d+/g);
  let cmd = '', nums = [];
  const per = { M: 2, L: 2, Q: 4, A: 7 }, flush = () => {
    for (let i = 0; i + per[cmd] <= nums.length; i += per[cmd]) {
      const n = nums.slice(i, i + per[cmd]), p = (x, y) => `${+(dx + x * k).toFixed(2)} ${+(dy + y * k).toFixed(2)}`;
      out.push(cmd === 'A' ? `A${+(n[0] * k).toFixed(2)} ${+(n[1] * k).toFixed(2)} ${n[2]} ${n[3]} ${n[4]} ${p(n[5], n[6])}`
        : cmd === 'Q' ? `Q${p(n[0], n[1])} ${p(n[2], n[3])}` : cmd + p(n[0], n[1]));
    }
  };
  for (const t of tokens) if (per[t]) { if (cmd) flush(); cmd = t; nums = []; } else nums.push(+t);
  if (cmd) flush();
  return out.join(' ');
}
// Text as one path, its top line at `top` and its left edge at `left`, k pixels per unit (cap height = 100k).
function letterPath(text, left, top, k) {
  let x = 0;
  const parts = [];
  for (const [i, c] of [...text].entries()) {
    if (i) x += GLYPH_GAP;
    if (c === ' ') { x += GLYPH_SPACE; continue; }
    parts.push(shiftPath(GLYPHS[c][1], left + x * k, top, k));
    x += GLYPHS[c][0];
  }
  return parts.join(' ');
}
const TRACE_GREY = '#8c8c8c', MODEL_INK = '#3a3a3a';
// Letters to look at (solid) or to trace (dots along the middle of each stroke).
function traceText(text, left, top, k, dotted, o = {}) {
  const d = letterPath(text, left, top, k);
  if (!d) return null;
  const path = new fabric.Path(d, { fill: '', stroke: dotted ? TRACE_GREY : MODEL_INK, strokeWidth: Math.max(2.5, 7 * k), strokeLineCap: 'round', strokeLineJoin: 'round',
    strokeDashArray: dotted ? [0.1, Math.max(7, 15 * k)] : null, kbName: dotted ? 'Letters to trace' : 'Letters', ...o });
  return path;
}
// Three writing lines, as on school paper: a solid top line, a dashed middle line and a solid base line.
function writingLines(left, top, width, k) {
  const line = (y, o) => new fabric.Line([left, y, left + width, y], { stroke: '#8fb3e8', strokeWidth: 2, kbName: 'Writing line', ...o });
  return [line(top), line(top + 50 * k, { stroke: '#f2a0c4', strokeDashArray: [10, 8] }), line(top + 100 * k)];
}

// ---- Pictures: the app's clip art by name, drawn small once and reused on every page ----
const prePics = new Map();
async function picUrl(name) {
  if (prePics.has(name)) return prePics.get(name);
  await emojiReady;
  const entry = emojiEntries.find(e => e.name === name);
  if (!entry) throw Error('no picture called ' + name);
  const img = await new Promise((done, fail) => Object.assign(new Image(), { onload() { done(this); }, onerror: () => fail('clip art missing'), src: `emoji/${entry.code}.svg` }));
  const out = Object.assign(document.createElement('canvas'), { width: 160, height: 160 });
  out.getContext('2d').drawImage(img, 0, 0, 160, 160);
  prePics.set(name, out.toDataURL('image/png'));
  return prePics.get(name);
}
// A picture `size` pixels square, centred on (cx, cy).
async function pic(name, cx, cy, size, o = {}) {
  const image = await fabric.FabricImage.fromURL(await picUrl(name));
  image.set({ left: cx - size / 2, top: cy - size / 2, scaleX: size / image.width, scaleY: size / image.height, kbName: picLabel(name), ...o });
  return image;
}
const PIC_LABELS = { 'red apple': 'apple', 'nest with eggs': 'nest', 'red heart': 'heart', 'blue heart': 'heart', 'soccer ball': 'ball', 'cheese wedge': 'cheese', 'honeybee': 'bee', 'baby chick': 'chick', 'lady beetle': 'ladybug', 'ear of corn': 'corn', 'teddy bear': 'teddy bear' };
const picLabel = name => PIC_LABELS[name] || name;
const shuffled = (list, rand) => { const a = list.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const LETTER_PICS = {
  A: ['red apple', 'ant'], B: ['banana', 'bear'], C: ['cat', 'carrot'], D: ['dog', 'duck'], E: ['egg', 'elephant'], F: ['fish', 'frog'],
  G: ['grapes', 'goat'], H: ['horse', 'house'], I: ['ice cream'], J: ['jellyfish', 'jeans'], K: ['kite', 'key'], L: ['lion', 'lemon'],
  M: ['monkey', 'mouse'], N: ['nest with eggs', 'nose'], O: ['octopus', 'owl'], P: ['pig', 'pear'], Q: [], R: ['rabbit', 'rainbow'],
  S: ['sun', 'snail'], T: ['tiger', 'turtle'], U: ['umbrella', 'unicorn'], V: ['violin', 'volcano'], W: ['whale', 'watermelon'],
  X: [], Y: ['yarn', 'yo-yo'], Z: ['zebra']
};
const COUNT_PICS = ['red apple', 'strawberry', 'star', 'fish', 'duck', 'butterfly', 'carrot', 'cookie', 'balloon', 'red heart', 'soccer ball', 'sunflower', 'turtle', 'banana', 'cherries', 'lady beetle'];
const MATCH_PICS = ['cat', 'dog', 'rabbit', 'duck', 'fish', 'frog', 'lion', 'pig', 'cow', 'horse', 'elephant', 'monkey', 'owl', 'turtle', 'penguin', 'butterfly'];
const PATTERN_PICS = ['red apple', 'banana', 'grapes', 'strawberry', 'star', 'red heart', 'blue heart', 'sun', 'fish', 'cat', 'carrot', 'balloon'];
const MAZE_PAIRS = { rabbit: ['rabbit', 'carrot'], bee: ['honeybee', 'sunflower'], mouse: ['mouse', 'cheese wedge'], dog: ['dog', 'bone'], monkey: ['monkey', 'banana'], chick: ['baby chick', 'ear of corn'] };

const keyTitle = title => title.replace(/[?!.:]+$/, '') + ': answer key';
// A preschool page's header: a big friendly title and a line for the date (or the name too).
const preHeader = (title, nameLine = true) => [
  T(title, 48, 40, { width: 720, fontSize: 46, textAlign: 'center', fontFamily: 'Fredoka', fontWeight: 'bold', kbName: 'Title' }),
  T(nameLine ? 'Name: ____________________     Date: ____________' : 'Date: ____________', 48, 112, { width: 720, fontSize: 22, textAlign: 'center', kbName: 'Name line' })];

// ---- Name tracing: a page per child, their name to look at, three to trace and two lines to write on ----
function nameTracePage(name, title) {
  const text = traceable(name.trim()), rows = 6, top0 = 175, pitch = 820 / rows;
  const k = Math.min(pitch / 165, 680 / Math.max(1, glyphsWidth(text))), parts = [...preHeader(title, false)];
  for (let r = 0; r < rows; r++) {
    const top = top0 + r * pitch + 8 * k;
    parts.push(...writingLines(60, top, 696, k));
    if (r < 4 && text) parts.push(traceText(text, 68, top, k, r > 0));
  }
  return toPage(parts.filter(Boolean));
}
// ---- Letter tracing: the letter big, pictures that start with it, then rows of it to trace ----
async function letterTracePage(letter) {
  const up = letter, low = letter.toLowerCase(), parts = [...preHeader('Letter ' + up)];
  const bigK = 1.35;
  parts.push(...writingLines(60, 185, 330, bigK).map(l => l.set({ opacity: 0.6 })), traceText(up + ' ' + low, 72, 185, bigK, false));
  const pics = LETTER_PICS[up] || [];
  for (const [i, name] of pics.entries()) {
    const cx = 500 + i * 150;
    parts.push(await pic(name, cx, 250, 110), T(picLabel(name), cx - 70, 312, { width: 140, fontSize: 24, textAlign: 'center', fontFamily: 'Fredoka', kbName: 'Picture word' }));
  }
  const k = 0.72, pitch = 128;
  for (let r = 0; r < 5; r++) {
    const top = 400 + r * pitch, c = r < 2 ? up : r < 4 ? low : '';
    parts.push(...writingLines(60, top, 696, k));
    if (!c) continue;
    const times = Math.max(1, Math.floor((680 + GLYPH_SPACE) / ((GLYPHS[c][0] + GLYPH_SPACE + GLYPH_GAP * 2) * k)));
    parts.push(traceText(Array(times).fill(c).join(' '), 68, top, k, true));
  }
  return toPage(parts.filter(Boolean));
}
// ---- Tracing lines and shapes: pre-writing strokes from one picture to another, then shapes ----
const LINE_STROKES = [
  ['Straight', t => 0],
  ['Zigzag', t => { const p = (t * 8) % 2; return (p < 1 ? p : 2 - p) * 2 - 1; }],
  ['Waves', t => Math.sin(t * Math.PI * 8)],
  ['Hills', t => -Math.abs(Math.sin(t * Math.PI * 5)) * 2 + 1],
  ['Loops', null],
  ['Steps', t => (Math.floor(t * 8) % 2) * 2 - 1]
];
function strokePoints(kind, x0, x1, y, amp) {
  const pts = [];
  if (kind === 'Loops') { // a run of loops: a circle rolled along the line
    // Rolling forward a little less than its own width each turn draws a round loop at the bottom of every turn.
    const turns = 4, a = (x1 - x0) / (turns * 2 * Math.PI), across = a * 2.6;
    for (let i = 0; i <= 600; i++) { const t = i / 600 * turns * 2 * Math.PI; pts.push([x0 + a * t + across * Math.sin(t) * (t < Math.PI / 2 || t > turns * 2 * Math.PI - Math.PI / 2 ? 0.4 : 1), y - amp * 1.1 * Math.cos(t)]); }
    return pts;
  }
  const f = LINE_STROKES.find(s => s[0] === kind)[1];
  if (kind === 'Steps') { // square corners, not slopes
    const n = 8, w = (x1 - x0) / n;
    for (let i = 0; i < n; i++) { const v = y + amp * ((i % 2) * 2 - 1); pts.push([x0 + i * w, v], [x0 + (i + 1) * w, v]); }
    return pts;
  }
  for (let i = 0; i <= 200; i++) { const t = i / 200; pts.push([x0 + (x1 - x0) * t, y + amp * f(t)]); }
  return pts;
}
const pointsPath = pts => 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L');
const dotted = (d, o = {}) => new fabric.Path(d, { fill: '', stroke: TRACE_GREY, strokeWidth: 6, strokeLineCap: 'round', strokeLineJoin: 'round', strokeDashArray: [0.1, 15], kbName: 'Line to trace', ...o });
async function linesPages(title, rand) {
  const pairs = shuffled(Object.values(MAZE_PAIRS), rand), rows = LINE_STROKES.length, pitch = 830 / rows, parts = [...preHeader(title)];
  for (const [i, [kind]] of LINE_STROKES.entries()) {
    const y = 210 + i * pitch, [from, to] = pairs[i % pairs.length];
    parts.push(await pic(from, 95, y, 70), await pic(to, 721, y, 70), dotted(pointsPath(strokePoints(kind, 150, 666, y, 30)), { kbName: kind + ' line' }));
  }
  const shapes = [['circle', 'Circle'], ['square', 'Square'], ['triangle', 'Triangle'], ['rectangle', 'Rectangle'], ['oval', 'Oval'], ['diamond', 'Diamond'], ['star', 'Star'], ['heart', 'Heart']];
  const page2 = [...preHeader('Trace the shapes')];
  for (const [i, [kind, label]] of shapes.entries()) {
    const col = i % 2, row = Math.floor(i / 2), cx = col ? 600 : 216, cy = 250 + row * 205, w = kind === 'rectangle' || kind === 'oval' ? 200 : 140, h = 140;
    const box = (x, y) => kind === 'circle' ? SHAPE_PATHS.ellipse(w, h) : kind === 'square' || kind === 'rectangle' ? pathPoly([[0, 0], [w, 0], [w, h], [0, h]])
      : kind === 'triangle' ? pathPoly([[w / 2, 0], [w, h], [0, h]]) : SHAPE_PATHS[kind === 'oval' ? 'ellipse' : kind](w, h);
    const shape = dotted(box(), { kbName: label + ' to trace' });
    shape.setPositionByOrigin(new fabric.Point(cx, cy), 'center', 'center');
    page2.push(shape, T(label, cx - 100, cy + h / 2 + 10, { width: 200, fontSize: 24, textAlign: 'center', fontFamily: 'Fredoka', kbName: 'Shape name' }));
  }
  return [toPage(parts), toPage(page2)];
}
// ---- Count and write: groups of pictures, and a box to write how many (or numbers to circle) ----
function countRows(upTo, rand, rows = 6) {
  const counts = shuffled(Array.from({ length: upTo }, (_, i) => i + 1), rand), pics = shuffled(COUNT_PICS, rand);
  return Array.from({ length: rows }, (_, i) => {
    const n = counts[i % counts.length], wrong = shuffled(Array.from({ length: upTo + 2 }, (_, j) => j + 1).filter(v => v !== n && Math.abs(v - n) <= 3), rand).slice(0, 2);
    return { n, pic: pics[i % pics.length], choices: shuffled([n, ...wrong], rand) };
  });
}
async function countPage(title, rows, style, answers) {
  const parts = [...preHeader(answers ? keyTitle(title) : title)], pitch = 820 / rows.length;
  for (const [i, row] of rows.entries()) {
    const top = 175 + i * pitch, h = pitch - 18, perLine = Math.min(row.n, 10), lines = Math.ceil(row.n / 10);
    const size = Math.min(64, (530 / perLine) - 8, (h - 16) / lines - 6);
    parts.push(R(48, top, 560, h, { rx: 16, ry: 16, stroke: '#b9a3e3', strokeWidth: 2.5, kbName: 'Picture box' }));
    for (let p = 0; p < row.n; p++) {
      const line = Math.floor(p / 10), inLine = Math.min(10, row.n - line * 10), span = inLine * (size + 8);
      parts.push(await pic(row.pic, 328 - span / 2 + (p % 10) * (size + 8) + size / 2 + 4, top + h / 2 + (line - (lines - 1) / 2) * (size + 6), size));
    }
    if (style === 'circle') row.choices.forEach((v, j) => {
      const cx = 652 + j * 48;
      parts.push(T(String(v), cx - 20, top + h / 2 - 22, { width: 40, fontSize: 36, textAlign: 'center', fontFamily: 'Fredoka', kbName: 'Number' }));
      if (answers && v === row.n) parts.push(new fabric.Circle({ left: cx - 23, top: top + h / 2 - 27, radius: 23, fill: '', stroke: SHEET_PINK, strokeWidth: 4, kbName: 'Answer' }));
    });
    else {
      parts.push(R(650, top + h / 2 - 45, 100, 90, { rx: 12, ry: 12, stroke: '#555555', strokeWidth: 2.5, kbName: 'Write the number' }));
      if (answers) parts.push(T(String(row.n), 650, top + h / 2 - 30, { width: 100, fontSize: 48, textAlign: 'center', fontFamily: 'Fredoka', fontWeight: 'bold', fill: SHEET_PINK, kbName: 'Answer' }));
    }
  }
  return toPage(parts);
}
// ---- Matching: draw a line from each thing on the left to its partner on the right ----
function matchPairs(kind, rand, rows = 5) {
  let left;
  if (kind === 'letters') left = shuffled('ABCDEFGHIJKLMNOPRSTUWYZ'.split(''), rand).slice(0, rows).map(c => ({ a: c, b: c.toLowerCase() }));
  else if (kind === 'numbers') left = shuffled(Array.from({ length: 10 }, (_, i) => i + 1), rand).slice(0, rows).map(n => ({ a: String(n), b: n }));
  else left = shuffled(MATCH_PICS, rand).slice(0, rows).map(p => ({ a: p, b: p }));
  // The right side in a new order where nothing sits straight across from its partner.
  let order = shuffled(left.map((_, i) => i), rand);
  for (let tries = 0; tries < 30 && order.some((j, i) => j === i); tries++) order = shuffled(order, rand);
  return { kind, left, order };
}
const DOT_SPOTS = n => Array.from({ length: n }, (_, i) => { const perRow = n > 5 ? Math.ceil(n / 2) : n, row = Math.floor(i / perRow), col = i % perRow, inRow = Math.min(perRow, n - row * perRow); return [(col - (inRow - 1) / 2) * 30, n > 5 ? (row - 0.5) * 30 : 0]; });
async function matchItem(kind, value, cx, cy, side) {
  if (kind === 'pictures') return [await pic(value, cx, cy, 90)];
  if (kind === 'letters' || side === 'left') { const k = 0.7, w = glyphsWidth(String(value)) * k; return [traceText(String(value), cx - w / 2, cy - (/[a-z]/.test(value) ? 75 : 50) * k, k, false, { kbName: 'Letter' })]; }
  return DOT_SPOTS(value).map(([x, y]) => new fabric.Circle({ left: cx + x - 11, top: cy + y - 11, radius: 11, fill: '#7f63c9', strokeWidth: 0, kbName: 'Dot' }));
}
async function matchPage(title, m, answers) {
  const parts = [...preHeader(answers ? keyTitle(title) : title)], pitch = 820 / m.left.length, y = i => 180 + pitch * (i + 0.5);
  const dot = (x, i) => new fabric.Circle({ left: x - 9, top: y(i) - 9, radius: 9, fill: '#333333', strokeWidth: 0, kbName: 'Line dot' });
  for (const [i, item] of m.left.entries()) parts.push(...await matchItem(m.kind, item.a, 140, y(i), 'left'), dot(270, i));
  for (const [i, j] of m.order.entries()) parts.push(...await matchItem(m.kind, m.left[j].b, 676, y(i), 'right'), dot(546, i));
  if (answers) for (const [i, j] of m.order.entries()) parts.push(new fabric.Line([270, y(j), 546, y(i)], { stroke: SHEET_PINK, strokeWidth: 4, kbName: 'Answer' }));
  return toPage(parts);
}
// ---- What comes next: a pattern of pictures with the last two left to draw ----
const PATTERNS = { easy: ['AB'], harder: ['AB', 'AAB', 'ABB', 'ABC', 'AABB'] };
function patternRows(level, rand, rows = 6) {
  return Array.from({ length: rows }, (_, i) => {
    const unit = PATTERNS[level][i % PATTERNS[level].length], pics = shuffled(PATTERN_PICS, rand).slice(0, 3), length = 8;
    return { seq: Array.from({ length }, (_, j) => pics['ABC'.indexOf(unit[j % unit.length])]), blanks: 2 };
  });
}
async function patternPage(title, rows, answers) {
  const parts = [...preHeader(answers ? keyTitle(title) : title)], pitch = 820 / rows.length, step = 86;
  for (const [i, row] of rows.entries()) {
    const cy = 180 + pitch * (i + 0.5);
    for (const [j, name] of row.seq.entries()) {
      const cx = 106 + j * step, blank = j >= row.seq.length - row.blanks;
      if (blank) parts.push(R(cx - 38, cy - 38, 76, 76, { rx: 12, ry: 12, stroke: answers ? SHEET_PINK : '#555555', strokeWidth: 2.5, strokeDashArray: [8, 6], kbName: 'Draw what comes next' }));
      if (!blank || answers) parts.push(await pic(name, cx, cy, 64));
    }
  }
  return toPage(parts);
}
// ---- Mazes: a square grid, one way through, wide paths, from a picture at the top to one at the bottom ----
function maze(size, rand) {
  const walls = Array.from({ length: size * size }, () => ({ r: true, b: true })), seen = new Set([0]), stack = [0];
  while (stack.length) {
    const c = stack.at(-1), x = c % size, y = Math.floor(c / size);
    const next = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].filter(([a, b]) => a >= 0 && b >= 0 && a < size && b < size && !seen.has(b * size + a));
    if (!next.length) { stack.pop(); continue; }
    const [a, b] = next[Math.floor(rand() * next.length)], n = b * size + a;
    if (a > x) walls[c].r = false; else if (a < x) walls[n].r = false; else if (b > y) walls[c].b = false; else walls[n].b = false;
    seen.add(n); stack.push(n);
  }
  // The way through, for the answer key: a search from the top-left cell to the bottom-right one.
  const open = (c, n) => { const [x, y, a, b] = [c % size, Math.floor(c / size), n % size, Math.floor(n / size)]; return a === x + 1 ? !walls[c].r : a === x - 1 ? !walls[n].r : b === y + 1 ? !walls[c].b : !walls[n].b; };
  const from = new Map([[0, -1]]), queue = [0];
  while (queue.length) { const c = queue.shift(), x = c % size, y = Math.floor(c / size); for (const [a, b] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) { const n = b * size + a; if (a >= 0 && b >= 0 && a < size && b < size && !from.has(n) && open(c, n)) { from.set(n, c); queue.push(n); } } }
  const path = []; for (let c = size * size - 1; c !== -1; c = from.get(c)) path.unshift(c);
  return { size, walls, path };
}
async function mazePage(title, m, pair, answers) {
  const parts = [...preHeader(answers ? keyTitle(title) : title)], s = m.size, cell = 640 / s, left = (816 - 640) / 2, top = 262, segs = [];
  segs.push(`M${left + cell} ${top} L${left + 640} ${top}`, `M${left} ${top} L${left} ${top + 640}`); // the outside; the top-left cell is the way in
  for (let c = 0; c < s * s; c++) {
    const x = left + (c % s) * cell, y = top + Math.floor(c / s) * cell;
    if (m.walls[c].r) segs.push(`M${x + cell} ${y} L${x + cell} ${y + cell}`);
    if (m.walls[c].b && c !== s * s - 1) segs.push(`M${x} ${y + cell} L${x + cell} ${y + cell}`); // the bottom-right cell is the way out
  }
  parts.push(new fabric.Path(segs.join(' '), { fill: '', stroke: '#7f63c9', strokeWidth: Math.max(5, cell * 0.12), strokeLineCap: 'round', strokeLineJoin: 'round', kbName: 'Maze walls' }));
  parts.push(await pic(MAZE_PAIRS[pair][0], left + cell / 2, top - 44, 76), await pic(MAZE_PAIRS[pair][1], left + 640 - cell / 2, top + 640 + 44, 76));
  if (answers) {
    const centre = c => [left + (c % s + 0.5) * cell, top + (Math.floor(c / s) + 0.5) * cell];
    parts.push(new fabric.Path(pointsPath([[left + cell / 2, top - 4], ...m.path.map(centre), [left + 640 - cell / 2, top + 644]]), { fill: '', stroke: SHEET_PINK, strokeWidth: Math.max(4, cell * 0.22), strokeLineCap: 'round', strokeLineJoin: 'round', opacity: 0.75, kbName: 'Answer' }));
  }
  return toPage(parts);
}

// ---- The makers, as Puzzles and worksheets kinds ----
const MAZE_SIZES = { easy: 5, medium: 8, hard: 12 };
Object.assign(SHEET_KINDS, {
  'trace-name': { title: 'Trace your name', words: true, key: false, hint: 'One name per line, and each child gets a page. Pick your class list above to fill it in.', placeholder: 'Ava\nBen\nCharlie',
    async make(title, key, seed, words) {
      const names = words.split(/\r?\n/).map(w => w.trim()).filter(w => traceable(w).trim()).slice(0, 60);
      if (!names.length) return { error: 'Type a name first, one per line, or pick your class list.' };
      return { pages: names.map(n => nameTracePage(n, title)), note: `Made a name page for each of the ${names.length} name${names.length === 1 ? '' : 's'}.` };
    } },
  'trace-letter': { title: 'Letter tracing', words: false, key: false,
    async make(title) {
      const pick = $('#sheet-letter').value, letters = pick === 'all' ? Object.keys(LETTER_PICS) : [pick], pages = [];
      for (const l of letters) pages.push(await letterTracePage(l));
      return { pages, title: title + (letters.length > 1 ? ' A to Z' : ' ' + pick) };
    } },
  'trace-lines': { title: 'Trace the lines', words: false, key: false,
    async make(title, key, seed) { return { pages: await linesPages(title, seededRandom(seed)), note: 'Lines on page 1, shapes on page 2.' }; } },
  count: { title: 'Count and write', words: false,
    async make(title, key, seed) {
      const rows = countRows(+$('#sheet-count-upto').value, seededRandom(seed)), style = $('#sheet-count-style').value;
      return { pages: [await countPage(title, rows, style, false), ...(key ? [await countPage(title, rows, style, true)] : [])] };
    } },
  match: { title: 'Draw a line to match', words: false,
    async make(title, key, seed) {
      const m = matchPairs($('#sheet-match').value, seededRandom(seed));
      return { pages: [await matchPage(title, m, false), ...(key ? [await matchPage(title, m, true)] : [])] };
    } },
  pattern: { title: 'What comes next?', words: false,
    async make(title, key, seed) {
      const rows = patternRows($('#sheet-pattern').value, seededRandom(seed));
      return { pages: [await patternPage(title, rows, false), ...(key ? [await patternPage(title, rows, true)] : [])] };
    } },
  maze: { title: 'Help find the way', words: false,
    async make(title, key, seed) {
      const m = maze(MAZE_SIZES[$('#sheet-maze-size').value], seededRandom(seed)), pair = $('#sheet-maze-pair').value;
      return { pages: [await mazePage(title, m, pair, false), ...(key ? [await mazePage(title, m, pair, true)] : [])] };
    } }
});
$('#sheet-letter').replaceChildren(...Object.keys(LETTER_PICS).map(l => new Option(l + ' ' + l.toLowerCase(), l)), new Option('Every letter, A to Z (26 pages)', 'all'));
for (const [id, kind] of [['#sheet-trace-name', 'trace-name'], ['#sheet-trace-letter', 'trace-letter'], ['#sheet-trace-lines', 'trace-lines'], ['#sheet-count-pics', 'count'], ['#sheet-match-pics', 'match'], ['#sheet-pattern-pics', 'pattern'], ['#sheet-maze', 'maze']]) $(id).onclick = () => openSheet(kind);
