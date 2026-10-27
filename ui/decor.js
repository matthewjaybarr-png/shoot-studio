// Decorations for Create: leaves, flowers, doodles, dividers and party and school pieces, drawn here as SVG so they're
// our own and work offline. Each one arrives as a group whose colours show as swatches to change, like Canva's
// graphics; ungroup it to move the pieces apart. Needs create.js.
const f2 = n => Math.round(n * 10) / 10;
const rad = d => d * Math.PI / 180;
// A pointed leaf from (x, y) pointing at `angle` degrees (0 = up), `len` long and `w` wide, with a midrib.
function leaf(x, y, len, w, angle, fill, vein = 'rgba(0,0,0,.18)', side = true) {
  const c = Math.cos(rad(angle)), s = Math.sin(rad(angle));
  const at = (u, v) => `${f2(x + v * c + u * s)} ${f2(y - u * c + v * s)}`; // u along the leaf, v across it
  let svg = `<path d="M${at(0, 0)} C${at(len * 0.3, w)} ${at(len * 0.75, w * 0.8)} ${at(len, 0)} C${at(len * 0.75, -w * 0.8)} ${at(len * 0.3, -w)} ${at(0, 0)}Z" fill="${fill}"/>`;
  svg += `<path d="M${at(0, 0)} L${at(len * 0.92, 0)}" stroke="${vein}" stroke-width="${f2(Math.max(0.8, w / 7))}" fill="none" stroke-linecap="round"/>`;
  if (side) for (const t of [0.35, 0.6]) svg += `<path d="M${at(len * t, 0)} L${at(len * (t + 0.16), w * 0.55)} M${at(len * t, 0)} L${at(len * (t + 0.16), -w * 0.55)}" stroke="${vein}" stroke-width="${f2(Math.max(0.6, w / 10))}" fill="none" stroke-linecap="round"/>`;
  return svg;
}
// A petal or round leaf: an ellipse from (x, y) outwards at `angle`.
const petal = (x, y, len, w, angle, fill) => `<ellipse cx="${f2(x + Math.sin(rad(angle)) * len / 2)}" cy="${f2(y - Math.cos(rad(angle)) * len / 2)}" rx="${f2(w / 2)}" ry="${f2(len / 2)}" transform="rotate(${f2(angle)} ${f2(x + Math.sin(rad(angle)) * len / 2)} ${f2(y - Math.cos(rad(angle)) * len / 2)})" fill="${fill}"/>`;
const flower = (x, y, r, n, fill, centre, w = r * 0.8) => Array.from({ length: n }, (_, i) => petal(x, y, r, w, i * 360 / n, fill)).join('') + `<circle cx="${x}" cy="${y}" r="${f2(r * 0.32)}" fill="${centre}"/>`;
// Points along a quadratic curve, for stems.
const along = (p0, p1, p2, t) => [(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]];
const heading = (p0, p1, p2, t) => { const d = [2 * (1 - t) * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]), 2 * (1 - t) * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1])]; return Math.atan2(d[0], -d[1]) * 180 / Math.PI; };
// A curved stem with leaves along both sides, made by `make(x, y, angle, size)`.
function stem(p0, p1, p2, count, colour, width, make) {
  let svg = `<path d="M${p0} Q${p1} ${p2}" stroke="${colour}" stroke-width="${width}" fill="none" stroke-linecap="round"/>`;
  for (let i = 0; i < count; i++) {
    const t = 0.12 + 0.8 * i / Math.max(1, count - 1), [x, y] = along(p0, p1, p2, t), h = heading(p0, p1, p2, t), size = 1 - t * 0.45;
    svg += make(x, y, h + (i % 2 ? 50 : -50), size);
  }
  return svg + make(...along(p0, p1, p2, 1), heading(p0, p1, p2, 1), 0.6);
}
const svgOf = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;
const sparkle = (x, y, r, fill) => `<path d="M${x} ${y - r} Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y} Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r} Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y} Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r}Z" fill="${fill}"/>`;
const INK = '#3d2b48';

const DECOR = [
  // Autumn
  ['maple', 'Maple leaf', 'Autumn', svgOf(100, 100, `<path d="M50 4 L57 22 L67 15 L64 34 L81 25 L77 39 L95 41 L82 52 L88 61 L66 62 L69 75 L54 67 L52 96 L48 96 L46 67 L31 75 L34 62 L12 61 L18 52 L5 41 L23 39 L19 25 L36 34 L33 15 L43 22Z" fill="#c8552b" stroke="#a5401f" stroke-width="1.5" stroke-linejoin="round"/><path d="M50 94 L50 22 M50 62 L24 44 M50 62 L76 44 M50 70 L32 66 M50 70 L68 66" stroke="#8f3417" stroke-width="2" fill="none" stroke-linecap="round"/>`)],
  ['oak', 'Oak leaf', 'Autumn', svgOf(70, 110, (() => {
    let d = 'M35 104 L35 96';
    const lobes = [[96, 14], [80, 24], [64, 22], [48, 28], [32, 22], [16, 16]];
    for (const [y, w] of lobes) d += ` Q${35 - w - 6} ${y - 2} ${35 - w * 0.55} ${y - 8}`;
    d += ' Q35 -4 ' + `${35 + 16 * 0.55} 8`;
    for (const [y, w] of [...lobes].reverse()) d += ` Q${35 + w + 6} ${y - 2} ${35 + w * 0.55} ${y + 8}`;
    return `<path d="${d} Z" fill="#b8742a" stroke="#8a5a2b" stroke-width="1.5" stroke-linejoin="round"/><path d="M35 104 L35 10 M35 70 L22 58 M35 70 L48 58 M35 46 L24 36 M35 46 L46 36" stroke="#7a4b20" stroke-width="2" fill="none" stroke-linecap="round"/>`;
  })())],
  ['leaf-fall', 'Autumn leaf', 'Autumn', svgOf(70, 100, leaf(35, 96, 90, 28, 0, '#e08a2e', '#a85d16'))],
  ['falling', 'Falling leaves', 'Autumn', svgOf(160, 120, leaf(30, 60, 50, 16, 40, '#c8552b', '#8f3417') + leaf(95, 40, 44, 14, -25, '#e9b44c', '#a97d22') + leaf(110, 112, 46, 15, 70, '#e08a2e', '#a85d16'))],
  ['acorn', 'Acorn', 'Autumn', svgOf(80, 110, `<path d="M40 8 Q44 2 50 4" stroke="#6b4423" stroke-width="5" fill="none" stroke-linecap="round"/><ellipse cx="40" cy="70" rx="24" ry="32" fill="#d9a441"/><ellipse cx="33" cy="64" rx="6" ry="14" fill="#f0c66b"/><path d="M10 42 Q40 2 70 42 Q40 56 10 42Z" fill="#8a5a2b"/><path d="M18 34 L60 50 M28 24 L66 40 M14 42 L48 28 M26 50 L62 30" stroke="#6b4423" stroke-width="2"/>`)],
  ['pumpkin', 'Pumpkin', 'Autumn', svgOf(120, 100, `<ellipse cx="60" cy="60" rx="54" ry="36" fill="#e07b24"/><ellipse cx="38" cy="60" rx="26" ry="34" fill="#ec8d32"/><ellipse cx="82" cy="60" rx="26" ry="34" fill="#ec8d32"/><ellipse cx="60" cy="60" rx="18" ry="36" fill="#f29c42"/><path d="M58 26 Q56 14 62 6" stroke="#5f7a34" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M64 18 Q78 10 84 20" stroke="#7d9a44" stroke-width="3" fill="none" stroke-linecap="round"/>`)],
  ['wheat', 'Wheat', 'Autumn', svgOf(60, 130, stem([30, 128], [28, 70], [30, 14], 10, '#c79a3e', 3, (x, y, a, s) => petal(x, y, 24 * s, 11 * s, a * 0.55, '#e2b65a')))],
  ['apple', 'Apple', 'School', svgOf(100, 100, `<path d="M50 30 C30 16 6 26 8 52 C10 80 30 98 50 90 C70 98 90 80 92 52 C94 26 70 16 50 30Z" fill="#d6463a"/><path d="M26 40 Q20 52 24 64" stroke="#f08a7e" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M50 30 Q48 16 54 8" stroke="#6b4423" stroke-width="4" fill="none" stroke-linecap="round"/>` + leaf(54, 18, 30, 12, 60, '#6f9a4a', '#4f7a34', false))],
  ['mushroom', 'Mushroom', 'Autumn', svgOf(100, 100, `<path d="M38 56 L34 92 Q50 98 66 92 L62 56Z" fill="#f4e6d0"/><path d="M6 58 Q8 12 50 10 Q92 12 94 58 Q50 66 6 58Z" fill="#cf4b3a"/><circle cx="30" cy="34" r="7" fill="#fff"/><circle cx="56" cy="24" r="5" fill="#fff"/><circle cx="72" cy="42" r="6" fill="#fff"/><circle cx="46" cy="46" r="4" fill="#fff"/>`)],
  // Leaves and branches
  ['sprig', 'Leafy sprig', 'Leaves', svgOf(80, 140, stem([40, 136], [30, 80], [44, 12], 8, '#5d7f4e', 3, (x, y, a, s) => leaf(x, y, 34 * s, 13 * s, a, '#7fa36a', '#4f6e42', false)))],
  ['eucalyptus', 'Eucalyptus', 'Leaves', svgOf(90, 150, stem([45, 146], [58, 80], [40, 10], 9, '#7f9a8c', 2.5, (x, y, a, s) => petal(x, y, 26 * s, 24 * s, a, '#9dbdb0')))],
  ['fern', 'Fern', 'Leaves', svgOf(80, 150, stem([40, 148], [36, 80], [42, 8], 16, '#4f7a4a', 2.5, (x, y, a, s) => petal(x, y, 30 * s, 9 * s, a > 0 ? a + 25 : a - 25, '#6c9a5e')))],
  ['branch', 'Branch', 'Leaves', svgOf(160, 70, stem([6, 50], [80, 20], [154, 36], 10, '#6b5640', 3, (x, y, a, s) => leaf(x, y, 30 * s, 12 * s, a, a % 2 ? '#8fae76' : '#6f9a5c', '#4f6e42', false)))],
  ['laurel', 'Leaf wreath', 'Leaves', svgOf(140, 140, (() => {
    // Two branches up either side of a circle, leaves in pairs pointing the way each branch grows.
    const cx = 70, cy = 72, r = 56, at = t => [cx + r * Math.sin(rad(t)), cy - r * Math.cos(rad(t))];
    let svg = '';
    for (const [from, to] of [[192, 340], [168, 20]]) {
      const [x0, y0] = at(from), [x1, y1] = at(to);
      svg += `<path d="M${f2(x0)} ${f2(y0)} A${r} ${r} 0 0 ${from > to ? 0 : 1} ${f2(x1)} ${f2(y1)}" stroke="#5d7f4e" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
      for (let i = 0; i <= 8; i++) {
        const t = from + (to - from) * i / 8, [x, y] = at(t), dir = from > to ? -1 : 1;
        const head = Math.atan2(dir * Math.cos(rad(t)), -dir * Math.sin(rad(t))) * 180 / Math.PI, size = 1 - i * 0.04;
        svg += leaf(x, y, 22 * size, 9 * size, head - 38, '#7fa36a', '#4f6e42', false) + leaf(x, y, 22 * size, 9 * size, head + 38, '#93b67c', '#4f6e42', false);
      }
    }
    return svg;
  })())],
  ['corner-leaves', 'Leafy corner', 'Leaves', svgOf(130, 130, stem([4, 126], [10, 20], [120, 6], 9, '#5d7f4e', 3, (x, y, a, s) => leaf(x, y, 30 * s, 12 * s, a, '#7fa36a', '#4f6e42', false)) + flower(18, 112, 14, 5, '#f2a7c3', '#e9b44c') + flower(112, 14, 11, 5, '#f2a7c3', '#e9b44c'))],
  ['heart-leaf', 'Heart leaf', 'Leaves', svgOf(90, 100, `<path d="M45 94 C20 70 4 52 8 32 C12 12 34 8 45 26 C56 8 78 12 82 32 C86 52 70 70 45 94Z" fill="#6f9a5c"/><path d="M45 92 L45 30 M45 60 L26 44 M45 60 L64 44 M45 76 L32 66 M45 76 L58 66" stroke="#4f6e42" stroke-width="2" fill="none" stroke-linecap="round"/>`)],
  // Flowers
  ['daisy', 'Daisy', 'Flowers', svgOf(100, 100, `<g stroke="#e7dcc8" stroke-width="1.5">${flower(50, 50, 40, 14, '#ffffff', '#f2b636', 12)}</g>`)],
  ['blossom', 'Blossom', 'Flowers', svgOf(100, 100, flower(50, 50, 40, 5, '#f4a6c4', '#e86f9b', 36) + `<g stroke="#e86f9b" stroke-width="2" stroke-linecap="round">${Array.from({ length: 5 }, (_, i) => { const a = rad(i * 72 + 36); return `<line x1="50" y1="50" x2="${f2(50 + Math.sin(a) * 20)}" y2="${f2(50 - Math.cos(a) * 20)}"/>`; }).join('')}</g><circle cx="50" cy="50" r="6" fill="#f7d26a"/>`)],
  ['tulip', 'Tulip', 'Flowers', svgOf(80, 140, `<path d="M40 60 Q36 100 40 136" stroke="#5d7f4e" stroke-width="4" fill="none"/>` + leaf(40, 132, 50, 16, -28, '#7fa36a', '#4f6e42', false) + leaf(40, 128, 44, 14, 32, '#6f9a5c', '#4f6e42', false) + `<path d="M18 22 L28 34 L40 14 L52 34 L62 22 Q66 56 40 64 Q14 56 18 22Z" fill="#e8607e"/><path d="M40 14 L52 34 Q50 56 40 64 Q30 56 28 34Z" fill="#f07f98"/>`)],
  ['rose', 'Rose', 'Flowers', svgOf(100, 100, `<circle cx="50" cy="50" r="40" fill="#e46a8a"/><path d="M50 18 C74 18 82 44 70 60 C60 74 36 72 30 56 C24 40 38 30 50 34 C62 38 62 54 52 58 C44 60 40 52 46 48" stroke="#b9415f" stroke-width="5" fill="none" stroke-linecap="round"/>` + leaf(20, 82, 30, 13, -120, '#6f9a5c', '#4f6e42', false) + leaf(80, 82, 30, 13, 120, '#7fa36a', '#4f6e42', false))],
  ['lavender', 'Lavender', 'Flowers', svgOf(60, 140, `<path d="M30 138 Q28 80 30 20" stroke="#6f8f5a" stroke-width="3" fill="none"/>` + Array.from({ length: 11 }, (_, i) => petal(30, 70 - i * 5.5, 12 - i * 0.5, 7 - i * 0.3, i % 2 ? 35 : -35, i % 3 ? '#a98bd6' : '#8e6cc4')).join(''))],
  ['sunflower', 'Sunflower', 'Flowers', svgOf(100, 100, Array.from({ length: 18 }, (_, i) => petal(50, 50, 44, 13, i * 20, i % 2 ? '#f2b636' : '#f6c94e')).join('') + `<circle cx="50" cy="50" r="17" fill="#6b4423"/><circle cx="50" cy="50" r="10" fill="#4f301a"/>`)],
  ['bouquet', 'Bouquet', 'Flowers', svgOf(120, 130, leaf(60, 118, 60, 18, -40, '#7fa36a', '#4f6e42', false) + leaf(60, 118, 60, 18, 40, '#6f9a5c', '#4f6e42', false) + leaf(60, 118, 54, 16, 0, '#93b67c', '#4f6e42', false) + flower(38, 52, 20, 5, '#f4a6c4', '#e9b44c') + flower(82, 48, 20, 5, '#b79ad9', '#f7d26a') + flower(60, 30, 22, 6, '#ffffff', '#f2b636') + `<path d="M44 96 L60 126 L76 96Z" fill="#e8c9a4"/><path d="M48 104 Q60 98 72 104" stroke="#c99a6b" stroke-width="3" fill="none"/>`)],
  ['flower-corner', 'Floral corner', 'Flowers', svgOf(140, 140, stem([4, 136], [8, 30], [136, 6], 8, '#5d7f4e', 2.5, (x, y, a, s) => leaf(x, y, 26 * s, 10 * s, a, '#7fa36a', '#4f6e42', false)) + flower(22, 24, 22, 5, '#f4a6c4', '#e86f9b') + flower(54, 18, 13, 5, '#b79ad9', '#f7d26a') + flower(16, 58, 12, 6, '#ffffff', '#f2b636'))],
  ['flower-row', 'Flower border', 'Flowers', svgOf(240, 60, `<path d="M4 34 Q60 14 120 34 T236 34" stroke="#5d7f4e" stroke-width="2.5" fill="none"/>` + [20, 60, 100, 140, 180, 220].map((x, i) => leaf(x, 32, 18, 8, i % 2 ? 140 : 40, '#7fa36a', '#4f6e42', false) + flower(x + 10, 26, 10, 5, ['#f4a6c4', '#b79ad9', '#ffffff'][i % 3], '#e9b44c')).join(''))],
  // Doodles
  ['sparkle', 'Sparkle', 'Doodles', svgOf(100, 100, sparkle(50, 50, 46, '#f2b636'))],
  ['sparkles', 'Sparkles', 'Doodles', svgOf(120, 110, sparkle(46, 60, 40, '#e86f9b') + sparkle(96, 26, 20, '#b79ad9') + sparkle(100, 88, 12, '#f2b636'))],
  ['doodle-heart', 'Doodle heart', 'Doodles', svgOf(110, 100, `<path d="M55 88 C30 68 8 52 10 30 C12 12 36 6 55 26 C74 6 98 12 100 30 C102 52 80 68 55 88Z M52 80 C30 62 16 48 18 32 C20 18 38 16 52 32" fill="none" stroke="#e8607e" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`)],
  ['swirl-arrow', 'Swirly arrow', 'Doodles', svgOf(160, 90, `<path d="M8 70 C40 76 60 60 54 40 C48 22 26 30 34 48 C42 66 90 70 146 36" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/><path d="M128 30 L148 34 L140 52" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`)],
  ['squiggle', 'Squiggle', 'Doodles', svgOf(200, 40, `<path d="M6 20 ${Array.from({ length: 8 }, (_, i) => `Q${16 + i * 24} ${i % 2 ? 38 : 2} ${28 + i * 24} 20`).join(' ')}" fill="none" stroke="#b79ad9" stroke-width="5" stroke-linecap="round"/>`)],
  ['burst', 'Burst lines', 'Doodles', svgOf(100, 100, `<g stroke="#f2b636" stroke-width="5" stroke-linecap="round">${Array.from({ length: 12 }, (_, i) => { const a = rad(i * 30); return `<line x1="${f2(50 + Math.sin(a) * 24)}" y1="${f2(50 - Math.cos(a) * 24)}" x2="${f2(50 + Math.sin(a) * (i % 2 ? 38 : 46))}" y2="${f2(50 - Math.cos(a) * (i % 2 ? 38 : 46))}"/>`; }).join('')}</g>`)],
  ['scribble-circle', 'Circle scribble', 'Doodles', svgOf(200, 110, `<path d="M150 18 C110 4 30 10 14 46 C0 80 70 104 130 96 C186 88 200 50 170 28 C140 8 80 10 56 16" fill="none" stroke="#e8607e" stroke-width="4" stroke-linecap="round"/>`)],
  ['swash', 'Underline swash', 'Doodles', svgOf(220, 40, `<path d="M8 28 C60 8 140 6 212 18 C150 18 90 22 40 34" fill="none" stroke="#e8607e" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`)],
  ['rainbow', 'Boho rainbow', 'Doodles', svgOf(140, 80, [['#c86b4a', 62], ['#e3a75a', 50], ['#9fb08a', 38], ['#efc3b5', 26]].map(([c, r]) => `<path d="M${70 - r} 76 A${r} ${r} 0 0 1 ${70 + r} 76" fill="none" stroke="${c}" stroke-width="11"/>`).join(''))],
  ['sun', 'Sun', 'Doodles', svgOf(100, 100, `<circle cx="50" cy="50" r="22" fill="#e9b44c"/><g stroke="#e9b44c" stroke-width="5" stroke-linecap="round">${Array.from({ length: 10 }, (_, i) => { const a = rad(i * 36); return `<line x1="${f2(50 + Math.sin(a) * 30)}" y1="${f2(50 - Math.cos(a) * 30)}" x2="${f2(50 + Math.sin(a) * 44)}" y2="${f2(50 - Math.cos(a) * 44)}"/>`; }).join('')}</g>`)],
  ['cloud', 'Cloud', 'Doodles', svgOf(140, 80, `<path d="M30 72 C8 72 6 46 26 42 C24 22 50 14 62 30 C70 10 104 12 106 38 C130 36 136 72 112 72Z" fill="#dbe9f8" stroke="#9cc3ea" stroke-width="3" stroke-linejoin="round"/>`)],
  ['star-doodle', 'Star', 'Doodles', svgOf(100, 100, `<path d="${Array.from({ length: 10 }, (_, i) => { const a = rad(i * 36), r = i % 2 ? 20 : 46; return (i ? 'L' : 'M') + f2(50 + Math.sin(a) * r) + ' ' + f2(54 - Math.cos(a) * r); }).join(' ')}Z" fill="#f7d26a" stroke="#e2a400" stroke-width="3" stroke-linejoin="round"/>`)],
  // Dividers and corners
  ['flourish', 'Flourish divider', 'Dividers', svgOf(240, 50, `<path d="M120 25 C100 6 80 10 84 24 C88 36 104 30 98 22 M120 25 C140 6 160 10 156 24 C152 36 136 30 142 22 M84 25 L10 25 M156 25 L230 25" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/><path d="M120 18 L126 25 L120 32 L114 25Z" fill="${INK}"/>`)],
  ['dots', 'Dotted divider', 'Dividers', svgOf(240, 20, Array.from({ length: 13 }, (_, i) => `<circle cx="${12 + i * 18}" cy="10" r="${i === 6 ? 6 : 3.5}" fill="#b79ad9"/>`).join(''))],
  ['vine', 'Leafy divider', 'Dividers', svgOf(240, 50, `<path d="M6 26 Q60 10 120 26 T234 26" stroke="#5d7f4e" stroke-width="2.5" fill="none"/>` + Array.from({ length: 11 }, (_, i) => leaf(18 + i * 21, 24 + (i % 2 ? 2 : -2), 16, 7, i % 2 ? 130 : 50, '#7fa36a', '#4f6e42', false)).join(''))],
  ['corner-flourish', 'Corner flourish', 'Dividers', svgOf(100, 100, `<path d="M6 94 L6 30 C6 14 14 6 30 6 L94 6 M18 82 L18 36 C18 24 24 18 36 18 L82 18 M6 30 C20 30 30 20 30 6" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/><circle cx="30" cy="30" r="4" fill="${INK}"/>`)],
  ['label', 'Scalloped label', 'Dividers', svgOf(160, 90, `<path d="${Array.from({ length: 24 }, (_, i) => { const a = rad(i * 15), r = i % 2 ? 40 : 44; return (i ? 'L' : 'M') + f2(80 + Math.sin(a) * r * 1.7) + ' ' + f2(45 - Math.cos(a) * r); }).join(' ')}Z" fill="#f7d6e4" stroke="#e8607e" stroke-width="2.5" stroke-linejoin="round"/><ellipse cx="80" cy="45" rx="58" ry="30" fill="none" stroke="#e8607e" stroke-width="1.5" stroke-dasharray="4 4"/>`)],
  // Celebrations and school
  ['confetti', 'Confetti', 'Party', svgOf(160, 110, [[20, 20, '#e86f9b', 20], [60, 70, '#f2b636', -30], [110, 30, '#8ec1ef', 50], [140, 86, '#b79ad9', 10], [40, 96, '#9fb08a', 70], [92, 92, '#e86f9b', -60], [128, 60, '#f2b636', 30]].map(([x, y, c, a]) => `<rect x="${x - 6}" y="${y - 3}" width="12" height="6" rx="2" fill="${c}" transform="rotate(${a} ${x} ${y})"/>`).join('') + [[80, 16, '#b79ad9'], [30, 56, '#8ec1ef'], [150, 20, '#e86f9b'], [100, 62, '#9fb08a']].map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="4" fill="${c}"/>`).join(''))],
  ['balloons', 'Balloons', 'Party', svgOf(120, 150, [[36, 48, '#e86f9b'], [84, 40, '#8ec1ef'], [60, 64, '#f2b636']].map(([x, y, c]) => `<path d="M${x} ${y + 30} Q${x - 4} ${y + 70} 60 146" stroke="#9a8aa6" stroke-width="1.5" fill="none"/><ellipse cx="${x}" cy="${y}" rx="22" ry="28" fill="${c}"/><path d="M${x - 4} ${y + 28} L${x + 4} ${y + 28} L${x} ${y + 34}Z" fill="${c}"/><ellipse cx="${x - 8}" cy="${y - 10}" rx="5" ry="8" fill="#ffffff" opacity=".45"/>`).join(''))],
  ['bunting', 'Bunting', 'Party', svgOf(240, 70, `<path d="M4 10 Q120 34 236 10" stroke="#9a8aa6" stroke-width="2" fill="none"/>` + Array.from({ length: 7 }, (_, i) => { const x = 22 + i * 33, y = 10 + Math.sin(Math.PI * (x / 240)) * 22 - 2; return `<path d="M${x - 13} ${f2(y)} L${x + 13} ${f2(y)} L${x} ${f2(y + 34)}Z" fill="${['#e86f9b', '#f2b636', '#8ec1ef', '#b79ad9', '#9fb08a'][i % 5]}"/>`; }).join(''))],
  ['pencil', 'Pencil', 'School', svgOf(200, 50, `<rect x="40" y="12" width="120" height="26" fill="#f2b636"/><rect x="40" y="12" width="120" height="9" fill="#f6c94e"/><rect x="160" y="12" width="14" height="26" fill="#b9b4bd"/><rect x="174" y="12" width="20" height="26" rx="6" fill="#e8607e"/><path d="M40 12 L8 25 L40 38Z" fill="#f4dbb4"/><path d="M8 25 L18 21 L18 29Z" fill="${INK}"/>`)],
  ['ribbon', 'Ribbon banner', 'Party', svgOf(240, 70, `<path d="M4 22 L40 22 L40 58 L4 58 L16 40Z M236 22 L200 22 L200 58 L236 58 L224 40Z" fill="#c9466e"/><path d="M28 14 L212 14 L212 50 L28 50Z" fill="#e8607e"/><path d="M28 50 L40 58 L40 50Z M212 50 L200 58 L200 50Z" fill="#9c2f52"/>`)],
  ['bow', 'Bow', 'Party', svgOf(120, 90, `<path d="M60 40 C40 10 8 12 10 36 C12 58 40 56 60 40Z M60 40 C80 10 112 12 110 36 C108 58 80 56 60 40Z" fill="#f4a6c4" stroke="#e86f9b" stroke-width="2.5"/><path d="M54 44 L40 84 L50 80 L56 88 L60 48 M66 44 L80 84 L70 80 L64 88 L60 48" fill="#e86f9b"/><circle cx="60" cy="40" r="9" fill="#e8607e"/>`)],
  ['camera', 'Camera', 'School', svgOf(120, 90, `<rect x="8" y="22" width="104" height="62" rx="12" fill="#9fb08a"/><rect x="8" y="22" width="104" height="18" rx="9" fill="#f4ead8"/><rect x="38" y="12" width="30" height="14" rx="4" fill="#9fb08a"/><circle cx="60" cy="54" r="22" fill="#3d3a3f"/><circle cx="60" cy="54" r="14" fill="#5b5662"/><circle cx="54" cy="48" r="4" fill="#ffffff" opacity=".6"/><circle cx="96" cy="32" r="4" fill="#e8607e"/>`)],
  ['paw', 'Paw print', 'School', svgOf(100, 100, `<ellipse cx="50" cy="66" rx="24" ry="20" fill="#d9a441"/><ellipse cx="22" cy="40" rx="10" ry="13" fill="#d9a441"/><ellipse cx="40" cy="22" rx="10" ry="13" fill="#d9a441"/><ellipse cx="62" cy="22" rx="10" ry="13" fill="#d9a441"/><ellipse cx="80" cy="40" rx="10" ry="13" fill="#d9a441"/>`)],
  ['book', 'Books', 'School', svgOf(120, 90, `<rect x="10" y="62" width="100" height="22" rx="4" fill="#9fb08a"/><rect x="16" y="40" width="92" height="22" rx="4" fill="#e8a196"/><rect x="8" y="18" width="96" height="22" rx="4" fill="#f4ead8" stroke="#d9c9a8" stroke-width="2"/><path d="M20 29 L80 29 M22 51 L70 51 M22 73 L86 73" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity=".8"/>`)]
];
const DECOR_GROUPS = [...new Set(DECOR.map(d => d[2]))];
const decorUrl = svg => 'data:image/svg+xml,' + encodeURIComponent(svg);

// Adds a decoration about 200 pixels across at `at`, or in the middle of the view.
async function addDecor(id, at) {
  const found = DECOR.find(d => d[0] === id);
  if (!found || !board) return null;
  const { objects, options } = await fabric.loadSVGFromString(found[3]);
  // Always a group, even for a single shape, so every decoration offers its colours the same way.
  const parts = objects.filter(Boolean), art = parts.length > 1 ? fabric.util.groupSVGElements(parts, options) : new fabric.Group(parts);
  art.scale(200 / Math.max(art.getScaledWidth(), art.getScaledHeight()));
  art.set({ kbName: found[1] });
  place(art, at);
  return art;
}
function paintDecor() {
  const box = $('#create-decor'), group = $('#decor-group').value;
  box.replaceChildren(...DECOR.filter(d => !group || d[2] === group).map(([id, name, , svg]) => {
    const b = button('', () => addDecor(id).catch(e => { $('#create-saved').textContent = String(e); }));
    b.id = 'add-decor-' + id; b.title = name; draggable(b, ['decor', id]);
    b.append(Object.assign(document.createElement('img'), { src: decorUrl(svg), alt: '', draggable: false }), name);
    return b;
  }));
}
$('#decor-group').replaceChildren(Object.assign(document.createElement('option'), { value: '', textContent: 'All decorations' }), ...DECOR_GROUPS.map(g => Object.assign(document.createElement('option'), { value: g, textContent: g })));
$('#decor-group').onchange = paintDecor;
paintDecor();

// ---- A graphic's own colours, as swatches to change (fills and outlines alike) ----
const partsOf = o => o.type === 'group' ? o.getObjects().flatMap(partsOf) : [o];
const colourKey = c => typeof c === 'string' ? (hex(c) || (c.startsWith('rgb') ? (() => { const m = c.match(/[\d.]+/g); return m && m.length >= 3 ? '#' + m.slice(0, 3).map(v => (+v).toString(16).padStart(2, '0')).join('') : null; })() : null)) : null;
function graphicColours(o) {
  const found = new Set();
  for (const part of partsOf(o)) for (const c of [part.fill, part.stroke]) { const k = colourKey(c); if (k) found.add(k.toLowerCase()); }
  return [...found].slice(0, 12);
}
function paintGraphicColours(o) {
  const box = $('#graphic-colours');
  const colours = o?.type === 'group' && !o.kbLocked && !o.kbChart ? graphicColours(o) : []; // a chart's colours are in Edit chart
  box.hidden = colours.length < 1;
  box.replaceChildren(...colours.map(colour => {
    const input = Object.assign(document.createElement('input'), { type: 'color', value: colour, title: 'Change this colour' });
    input.dataset.colour = colour;
    input.oninput = () => {
      const from = input.dataset.colour, to = input.value;
      for (const part of partsOf(o)) for (const key of ['fill', 'stroke']) if (colourKey(part[key])?.toLowerCase() === from) part.set(key, to);
      input.dataset.colour = to; o.dirty = true; board.requestRenderAll();
    };
    input.onchange = () => commitDesign();
    return input;
  }));
}

// ---- Elements sections fold away; the ones she closes stay closed next time ----
function paintFolds() {
  for (const fold of document.querySelectorAll('#create-drawer details.fold')) fold.open = !settings.closed.includes(fold.dataset.fold);
}
for (const fold of document.querySelectorAll('#create-drawer details.fold')) fold.addEventListener('toggle', () => {
  const closed = settings.closed.filter(name => name !== fold.dataset.fold);
  if (!fold.open) closed.push(fold.dataset.fold);
  if (closed.join() !== settings.closed.join()) { settings.closed = closed; saveSettings(); }
});
paintFolds();
