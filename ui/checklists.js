// Checklists, in Classroom's Puzzles and worksheets: a page per child from her class list, for what each one knows
// (letters, letter sounds, or numbers, shapes and colours), with three tick boxes on every item for three check-ins
// across the year. Letters and numbers are preschool.js' ball-and-stick ones; shapes and colours come from posters.js.
// Needs create.js, worksheets.js, preschool.js and posters.js.

const CHECK_KINDS = {
  letters: { title: 'Letters I know', sections: () => [['Capital letters', Object.keys(LETTER_PICS), 9, 116], ['Small letters', Object.keys(LETTER_PICS).map(l => l.toLowerCase()), 9, 116]] },
  sounds: { title: 'Letter sounds I know', sections: () => [['Says the sound', Object.keys(LETTER_PICS), 7, 160]] },
  numbers: { title: 'Numbers, shapes and colours', sections: () => [['Knows the number', Array.from({ length: 21 }, (_, n) => String(n)), 11, 104], ['Knows the shape', SHAPE_CARDS.slice(0, 9).map(s => ({ shape: s })), 9, 104], ['Knows the colour', COLOUR_CARDS.map(c => ({ colour: c })), 10, 104]] }
};
// A child's name for the top of the page: "Smith, Ava" turns round; the rest as typed.
const checkName = raw => { const n = raw.trim().replace(/\s+/g, ' '), m = n.match(/^([^,]+),\s*(.+)$/); return m ? m[2] + ' ' + m[1] : n; };
// Three little boxes, 1 2 3, along the bottom of a tile.
function tickRow(x, y, w) {
  const size = Math.min(18, (w - 16) / 3 - 4), gap = (w - size * 3) / 4, parts = [];
  for (let i = 0; i < 3; i++) {
    const bx = x + gap + i * (size + gap);
    parts.push(R(bx, y, size, size, { rx: 3, ry: 3, stroke: '#666666', strokeWidth: 1.5, kbName: 'Tick box' }), T(String(i + 1), bx, y + size + 1, { width: size, fontSize: 10, textAlign: 'center', fill: '#999999', kbName: 'Check-in number' }));
  }
  return parts;
}
async function checkTile(item, x, y, w, h) {
  const parts = [R(x + 3, y + 3, w - 6, h - 6, { rx: 10, ry: 10, stroke: '#cfc4ee', strokeWidth: 1.5, kbName: 'Tile' })], top = y + 10, room = h - 56; // the tick boxes take the bottom 40
  if (typeof item === 'string') parts.push(bigGlyphs(item, x + w / 2, top, w * 0.7, room * (LETTER_PICS[item] && w > 100 ? 0.55 : 1), '#3a3a3a'));
  if (typeof item === 'string' && LETTER_PICS[item] && w > 100) {
    const name = LETTER_PICS[item].find(p => picLabel(p)[0].toUpperCase() === item) || LETTER_PICS[item][0];
    parts.push(await pic(name, x + w / 2, top + room * 0.78, room * 0.42));
  }
  if (item.shape) {
    const [name, , points] = item.shape, s = Math.min(w * 0.55, room * 0.75), left = x + (w - s) / 2, look = { fill: '#d9cff5', stroke: '#3a3a3a', strokeWidth: 1.5, kbName: 'Shape ' + name };
    parts.push(name === 'circle' ? new fabric.Circle({ left, top, radius: s / 2, ...look }) : name === 'oval' ? new fabric.Ellipse({ left, top: top + s * 0.18, rx: s / 2, ry: s * 0.32, ...look })
      : new fabric.Polygon((name === 'heart' ? heartPoints(40) : points).map(([px, py]) => ({ x: left + px * s, y: top + py * s })), look));
  }
  if (item.colour) {
    const [name, hex] = item.colour, r = Math.min(w, room) * 0.3;
    parts.push(new fabric.Circle({ left: x + w / 2 - r, top, radius: r, fill: hex, stroke: '#00000033', strokeWidth: 1.5, kbName: 'Colour ' + name }), T(name, x, top + r * 2 + 1, { width: w, fontSize: 11, textAlign: 'center', kbName: 'Colour name' }));
  }
  parts.push(...tickRow(x, y + h - 36, w));
  return parts;
}
async function checklistPage(name, kind, title) {
  const parts = [T(title, 48, 28, { width: 720, fontSize: 34, textAlign: 'center', fontFamily: 'Fredoka', fontWeight: 'bold', fill: '#7f63c9', kbName: 'Title' }),
    T(name, 48, 76, { width: 720, fontSize: 30, textAlign: 'center', fontFamily: 'Fredoka', kbName: 'Child name' }),
    T('Check-in 1: __________    2: __________    3: __________', 48, 122, { width: 720, fontSize: 16, textAlign: 'center', fill: '#555555', kbName: 'Check-in dates' })];
  let y = 158;
  for (const [heading, items, cols, h] of CHECK_KINDS[kind].sections()) {
    const w = 720 / cols;
    parts.push(T(heading, 48, y, { width: 720, fontSize: 18, fontFamily: 'Fredoka', fontWeight: 'bold', kbName: 'Heading' }));
    y += 28;
    for (const [i, item] of items.entries()) parts.push(...await checkTile(item, 48 + (i % cols) * w, y + Math.floor(i / cols) * h, w, h));
    y += Math.ceil(items.length / cols) * h + 14;
  }
  if (kind === 'numbers') {
    parts.push(T('Counts out loud to:', 48, y, { width: 720, fontSize: 18, fontFamily: 'Fredoka', fontWeight: 'bold', kbName: 'Heading' }));
    for (const [i, n] of [5, 10, 15, 20, 30, 50, 100].entries()) parts.push(tickBoxAt(64 + i * 100, y + 34), T(String(n), 94 + i * 100, y + 32, { width: 60, fontSize: 18, kbName: 'Count to' }));
  }
  return toPage(parts.filter(Boolean));
}
const tickBoxAt = (x, y) => R(x, y, 22, 22, { rx: 4, ry: 4, stroke: '#555555', strokeWidth: 2, kbName: 'Tick box' });

Object.assign(SHEET_KINDS, {
  checklist: { title: 'Letters I know', words: true, key: false, wordsLabel: 'Their names', hint: 'One name per line, and each child gets a page. Pick your class list above to fill it in.', placeholder: 'Ava\nBen\nCharlie',
    async make(title, key, seed, words) {
      const kind = $('#sheet-check-kind').value, names = words.split(/\r?\n/).map(checkName).filter(Boolean).slice(0, 60);
      if (!names.length) return { error: 'Type a name first, one per line, or pick your class list.' };
      const pages = [];
      for (const n of names) pages.push(await checklistPage(n, kind, title === SHEET_KINDS.checklist.title ? CHECK_KINDS[kind].title : title));
      return { pages, title: title === SHEET_KINDS.checklist.title ? CHECK_KINDS[kind].title : title, note: `Made a checklist page for each of the ${names.length} child${names.length === 1 ? '' : 'ren'}.` };
    } }
});
$('#sheet-checklist').onclick = () => openSheet('checklist');
