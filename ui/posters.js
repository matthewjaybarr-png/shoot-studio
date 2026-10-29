// Posters and wall cards, in Classroom's Puzzles and worksheets: alphabet cards, number cards, colours, shapes, and a
// calendar set (days, months, seasons and weather) for the wall. Big cards, one to a page or four, in the pastels.
// They are Puzzles and worksheets kinds with no answer key, and draw letters and numbers with preschool.js' ball-and-
// stick strokes. Needs create.js, worksheets.js and preschool.js.

const CARD_COLOURS = [['#fde4ef', '#e7779f'], ['#ece4fb', '#9a86d6'], ['#e1f0fd', '#6fa8dc'], ['#e3f6ec', '#5bb88a'], ['#fff4d6', '#e0b84a'], ['#ffe9dc', '#e89a6b']];
// Where the cards go: one filling the page, or four (two by two).
function cardSpots(layout) {
  if (layout === 'one') return [[48, 48, 720, 960]];
  const w = (720 - 16) / 2, h = (960 - 16) / 2;
  return [0, 1, 2, 3].map(i => [48 + (i % 2) * (w + 16), 48 + Math.floor(i / 2) * (h + 16), w, h]);
}
// Pages of cards: `draw(card, x, y, w, h, i)` gives each card's parts, on a soft rounded card of its own colour.
async function cardPages(cards, layout, draw) {
  const spots = cardSpots(layout), pages = [];
  for (let first = 0; first < cards.length; first += spots.length) {
    const parts = [];
    for (const [j, [x, y, w, h]] of spots.entries()) {
      const i = first + j, card = cards[i];
      if (card === undefined) break;
      const [fill, edge] = CARD_COLOURS[i % CARD_COLOURS.length];
      parts.push(R(x, y, w, h, { rx: w * 0.06, ry: w * 0.06, fill, stroke: edge, strokeWidth: Math.max(3, w * 0.012), kbName: 'Card' }), ...await draw(card, x, y, w, h, i));
    }
    pages.push(toPage(parts.filter(Boolean)));
  }
  return pages;
}
// Ball-and-stick letters or numbers, solid and in a colour, centred in a box (tails below the base line allowed for).
function bigGlyphs(text, cx, top, maxW, maxH, colour) {
  const tails = /[gjpqy]/.test(text) ? 140 : 100, k = Math.min(maxW / glyphsWidth(text), maxH / tails);
  return traceText(text, cx - glyphsWidth(text) * k / 2, top + (maxH - tails * k) / 2, k, false, { stroke: colour, strokeWidth: Math.max(6, 14 * k), kbName: 'Big letters' });
}
const cardWords = (text, x, y, w, size, o = {}) => T(text, x, y, { width: w, fontSize: size, textAlign: 'center', fontFamily: 'Fredoka', fontWeight: 'bold', fill: '#3a3a3a', kbName: 'Card words', ...o });

// ---- Alphabet: Aa big, a picture and its word ----
async function alphabetCard(letter, x, y, w, h, i) {
  const name = LETTER_PICS[letter].find(p => picLabel(p)[0].toUpperCase() === letter) || LETTER_PICS[letter][0], edge = CARD_COLOURS[i % CARD_COLOURS.length][1];
  return [bigGlyphs(letter + letter.toLowerCase(), x + w / 2, y + h * 0.06, w * 0.8, h * 0.38, edge),
    await pic(name, x + w / 2, y + h * 0.66, h * 0.3), cardWords(picLabel(name).replace(/ \(.*\)$/, ''), x, y + h * 0.84, w, h * 0.07)];
}
// ---- Numbers: the numeral, its word, and that many pictures in rows of five ----
async function numberCard(n, x, y, w, h, i) {
  const edge = CARD_COLOURS[i % CARD_COLOURS.length][1], parts = [bigGlyphs(String(n), x + w / 2, y + h * 0.05, w * 0.6, h * 0.3, edge), cardWords(NUMBER_WORDS[n], x, y + h * 0.37, w, h * 0.07, { fill: edge })];
  const per = 5, rows = Math.max(1, Math.ceil(n / per)), size = Math.min(w * 0.8 / per, h * 0.4 / Math.max(rows, 2)) * 0.86, name = COUNT_PICS[n % COUNT_PICS.length];
  for (let p = 0; p < n; p++) {
    const row = Math.floor(p / per), inRow = Math.min(per, n - row * per), gap = size / 0.86;
    parts.push(await pic(name, x + w / 2 + (p % per - (inRow - 1) / 2) * gap, y + h * 0.5 + gap * (row + 0.5) + (h * 0.44 - rows * gap) / 2, size));
  }
  return parts;
}
// ---- Colours: a big blob of the colour, its name in it, and three things that colour ----
const COLOUR_CARDS = [['red', '#e53935', ['red apple', 'strawberry', 'fire engine']], ['orange', '#fb8c00', ['tangerine', 'carrot', 'basketball']], ['yellow', '#fdd835', ['banana', 'sun', 'lemon']],
  ['green', '#43a047', ['green apple', 'frog', 'broccoli']], ['blue', '#1e88e5', ['blue heart', 'whale', 'blueberries']], ['purple', '#8e24aa', ['grapes', 'eggplant', 'purple heart']],
  ['pink', '#ec407a', ['pig', 'flamingo', 'cherry blossom']], ['brown', '#795548', ['teddy bear', 'chocolate bar', 'horse']], ['black', '#212121', ['black cat', 'spider', 'black heart']],
  ['white', '#ffffff', ['snowman without snow', 'cloud', 'ghost']]];
async function colourCard([name, hex, pics], x, y, w, h) {
  const r = Math.min(w, h) * 0.26, parts = [new fabric.Circle({ left: x + w / 2 - r, top: y + h * 0.06, radius: r, fill: hex, stroke: '#00000022', strokeWidth: 3, kbName: 'Colour' }),
    cardWords(name, x, y + h * 0.06 + r * 2 + h * 0.03, w, h * 0.09, { fill: name === 'white' || name === 'yellow' ? '#555555' : hex, stroke: name === 'white' ? '#999999' : null, strokeWidth: name === 'white' ? 1 : 0 })];
  for (const [j, p] of pics.entries()) parts.push(await pic(p, x + w * (0.22 + j * 0.28), y + h * 0.82, Math.min(w * 0.22, h * 0.2)));
  return parts;
}
// ---- Shapes: the shape big and filled, its name, and how many sides ----
const regular = (n, turn = -Math.PI / 2) => Array.from({ length: n }, (_, i) => [0.5 + 0.5 * Math.cos(turn + 2 * Math.PI * i / n), 0.5 + 0.5 * Math.sin(turn + 2 * Math.PI * i / n)]);
const SHAPE_CARDS = [
  ['circle', '0 sides, round all the way', null], ['square', '4 sides, all the same', [[0, 0], [1, 0], [1, 1], [0, 1]]], ['triangle', '3 sides', [[0.5, 0.04], [1, 0.92], [0, 0.92]]],
  ['rectangle', '4 sides, two long and two short', [[0, 0.2], [1, 0.2], [1, 0.8], [0, 0.8]]], ['oval', 'round and long', null], ['star', '5 points', Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + Math.PI * i / 5, r = i % 2 ? 0.2 : 0.5; return [0.5 + r * Math.cos(a), 0.54 + r * Math.sin(a)]; })],
  ['heart', 'a shape for love', null], ['diamond', '4 sides, standing on a point', [[0.5, 0], [0.85, 0.5], [0.5, 1], [0.15, 0.5]]], ['pentagon', '5 sides', regular(5)], ['hexagon', '6 sides', regular(6, 0)]];
async function shapeCard([name, about, points], x, y, w, h, i) {
  const edge = CARD_COLOURS[(i + 2) % CARD_COLOURS.length][1], s = Math.min(w * 0.7, h * 0.5), left = x + (w - s) / 2, top = y + h * 0.07, look = { fill: edge, stroke: '#3a3a3a', strokeWidth: Math.max(3, s * 0.015), kbName: 'Shape' };
  const at = ([px, py]) => ({ x: left + px * s, y: top + py * s });
  const shape = name === 'circle' ? new fabric.Circle({ left, top, radius: s / 2, ...look })
    : name === 'oval' ? new fabric.Ellipse({ left, top: top + s * 0.18, rx: s / 2, ry: s * 0.32, ...look })
      : new fabric.Polygon((name === 'heart' ? heartPoints(80) : points).map(at), look);
  return [shape, cardWords(name, x, y + h * 0.64, w, h * 0.1), cardWords(about, x + w * 0.08, y + h * 0.8, w * 0.84, h * 0.045, { fontWeight: 'normal', fill: '#555555' })];
}
// ---- Calendar set: days of the week strips, then months, seasons and weather as cards ----
const WALL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WALL_MONTHS = [['January', 'snowflake'], ['February', 'red heart'], ['March', 'kite'], ['April', 'umbrella with rain drops'], ['May', 'tulip'], ['June', 'sun'], ['July', 'beach with umbrella'], ['August', 'sunflower'], ['September', 'red apple'], ['October', 'jack-o-lantern'], ['November', 'maple leaf'], ['December', 'snowman']];
const WALL_SEASONS = [['Spring', 'tulip'], ['Summer', 'sun with face'], ['Autumn', 'fallen leaf'], ['Winter', 'snowman']];
const WALL_WEATHER = [['Sunny', 'sun'], ['Partly cloudy', 'sun behind small cloud'], ['Cloudy', 'cloud'], ['Rainy', 'cloud with rain'], ['Snowy', 'cloud with snow'], ['Windy', 'wind face'], ['Stormy', 'cloud with lightning and rain'], ['Foggy', 'fog']];
async function calendarPages() {
  const days = [cardWords('Days of the Week', 48, 30, 720, 44, { fill: '#7f63c9', kbName: 'Title' })];
  for (const [i, d] of WALL_DAYS.entries()) {
    const [fill, edge] = CARD_COLOURS[i % CARD_COLOURS.length], top = 110 + i * 132;
    days.push(R(48, top, 720, 116, { rx: 24, ry: 24, fill, stroke: edge, strokeWidth: 3, kbName: 'Day strip' }), cardWords(d, 48, top + 28, 720, 52, { fill: edge }));
  }
  // Six cards a page: a picture on top and the word under it.
  const sixes = async (title, list) => {
    const pages = [];
    for (let first = 0; first < list.length; first += 6) {
      const parts = [cardWords(title, 48, 30, 720, 44, { fill: '#7f63c9', kbName: 'Title' })];
      for (const [j, [word, icon]] of list.slice(first, first + 6).entries()) {
        const i = first + j, x = 48 + (j % 2) * 368, y = 110 + Math.floor(j / 2) * 310, [fill, edge] = CARD_COLOURS[i % CARD_COLOURS.length];
        parts.push(R(x, y, 352, 294, { rx: 22, ry: 22, fill, stroke: edge, strokeWidth: 3, kbName: 'Card' }), await pic(icon, x + 176, y + 116, 150), cardWords(word, x, y + 210, 352, 40));
      }
      pages.push(toPage(parts));
    }
    return pages;
  };
  return [toPage(days), ...await sixes('Months of the Year', WALL_MONTHS), ...await sixes('Seasons', WALL_SEASONS), ...await sixes('Weather', WALL_WEATHER)];
}

const NUMBER_SPANS = { '0-10': [0, 10], '1-10': [1, 10], '1-20': [1, 20], '0-20': [0, 20] };
const cardLayout = () => $('#sheet-card-layout').value;
Object.assign(SHEET_KINDS, {
  'abc-cards': { title: 'Alphabet cards', words: false, key: false,
    async make() { return { pages: await cardPages(Object.keys(LETTER_PICS), cardLayout(), alphabetCard) }; } },
  'number-cards': { title: 'Number cards', words: false, key: false,
    async make() { const [from, to] = NUMBER_SPANS[$('#sheet-card-numbers').value]; return { pages: await cardPages(Array.from({ length: to - from + 1 }, (_, i) => from + i), cardLayout(), numberCard) }; } },
  'colour-cards': { title: 'Colours', words: false, key: false,
    async make() { return { pages: await cardPages(COLOUR_CARDS, cardLayout(), colourCard) }; } },
  'shape-cards': { title: 'Shapes', words: false, key: false,
    async make() { return { pages: await cardPages(SHAPE_CARDS, cardLayout(), shapeCard) }; } },
  'calendar-cards': { title: 'Calendar and weather', words: false, key: false,
    async make() { return { pages: await calendarPages(), note: 'Days on page 1, then months, seasons and weather.' }; } }
});
for (const [id, kind] of [['#sheet-abc-cards', 'abc-cards'], ['#sheet-number-cards', 'number-cards'], ['#sheet-colour-cards', 'colour-cards'], ['#sheet-shape-cards', 'shape-cards'], ['#sheet-calendar-cards', 'calendar-cards']]) $(id).onclick = () => openSheet(kind);
