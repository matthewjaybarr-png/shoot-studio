// Import from Canva: a design downloaded from Canva as PowerPoint becomes an editable design, page by page, with
// its pictures, shapes, text and the fonts Canva embeds. A PNG or JPEG download becomes a locked picture to build on.
// Needs create.js. The Rust side only unpacks the file (read_pptx); everything is converted here.
const EMU = 914400;                                    // PowerPoint units per inch
const ANGLE = 60000;                                   // PowerPoint angles are in 60000ths of a degree
const FIT = 0.01;                                      // inches of slack when matching a page to a named size
const KIDS = el => el ? [...el.children] : [];
const kid = (el, ...path) => path.reduce((e, name) => e && KIDS(e).find(c => c.localName === name), el);
const num = (el, name, fallback = 0) => { const v = el?.getAttribute(name); return v == null || v === '' || !Number.isFinite(+v) ? fallback : +v; };
const yes = v => v === '1' || v === 'true';
const relId = (el, name) => el?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', name) || el?.getAttribute('r:' + name) || null;

// ---- Reading the package ----
function xmlPart(pkg, path) {
  const text = pkg.parts[path];
  if (!text) return null;
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  return doc.getElementsByTagName('parsererror').length ? null : doc.documentElement;
}
// A part's relationships: id → resolved path inside the package.
function rels(pkg, path) {
  const dir = path.slice(0, path.lastIndexOf('/')), root = xmlPart(pkg, `${dir}/_rels/${path.slice(dir.length + 1)}.rels`), out = new Map();
  for (const r of KIDS(root)) {
    if (r.getAttribute('TargetMode') === 'External') continue;
    const target = r.getAttribute('Target') || '', parts = target.startsWith('/') ? [] : dir.split('/');
    for (const step of target.replace(/^\//, '').split('/')) step === '..' ? parts.pop() : step !== '.' && parts.push(step);
    out.set(r.getAttribute('Id'), parts.join('/'));
  }
  return out;
}
const relOfType = (map, pkg, path, type) => { const root = xmlPart(pkg, path.replace(/([^/]+)$/, '_rels/$1.rels')); const r = KIDS(root).find(r => (r.getAttribute('Type') || '').endsWith('/' + type)); return r && map.get(r.getAttribute('Id')); };

// ---- Colours ----
function themeColours(pkg) {
  const theme = Object.keys(pkg.parts).find(p => /^ppt\/theme\/theme\d*\.xml$/.test(p)), scheme = kid(xmlPart(pkg, theme), 'themeElements', 'clrScheme'), out = {};
  for (const c of KIDS(scheme)) { const v = kid(c, 'srgbClr')?.getAttribute('val') || kid(c, 'sysClr')?.getAttribute('lastClr'); if (v) out[c.localName] = '#' + v.toLowerCase(); }
  return Object.assign(out, { bg1: out.lt1, tx1: out.dk1, bg2: out.lt2, tx2: out.dk2 });
}
const PRESET_COLOURS = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', gray: '#808080', grey: '#808080' };
function hsl([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function rgb([h, s, l]) {
  if (!s) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [r2(h + 1 / 3), r2(h), r2(h - 1 / 3)];
}
// The colour inside a fill-like element as { hex, alpha }, with the brightness and transparency changes applied.
function colourOf(el, theme) {
  const c = KIDS(el).find(c => ['srgbClr', 'schemeClr', 'prstClr', 'sysClr', 'scrgbClr'].includes(c.localName));
  if (!c) return null;
  let hex = c.localName === 'srgbClr' ? '#' + c.getAttribute('val') : c.localName === 'schemeClr' ? theme[c.getAttribute('val')] : c.localName === 'sysClr' ? '#' + (c.getAttribute('lastClr') || '000000') : c.localName === 'prstClr' ? PRESET_COLOURS[c.getAttribute('val')] : null;
  if (c.localName === 'scrgbClr') hex = '#' + ['r', 'g', 'b'].map(k => Math.round(Math.min(1, num(c, k) / 100000) ** (1 / 2.2) * 255).toString(16).padStart(2, '0')).join('');
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) hex = '#000000';
  let [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255), alpha = 1;
  for (const m of KIDS(c)) {
    const v = num(m, 'val') / 100000;
    if (m.localName === 'alpha') alpha = v;
    else if (m.localName === 'lumMod' || m.localName === 'lumOff') { const x = hsl([r, g, b]); x[2] = Math.min(1, Math.max(0, m.localName === 'lumMod' ? x[2] * v : x[2] + v)); [r, g, b] = rgb(x); }
    else if (m.localName === 'tint') [r, g, b] = [r, g, b].map(x => x + (1 - x) * (1 - v));
    else if (m.localName === 'shade') [r, g, b] = [r, g, b].map(x => x * v);
  }
  return { hex: '#' + [r, g, b].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join(''), alpha };
}
// A fill for Fabric: a colour, a gradient, or null for none. `undefined` means none was given.
function fillOf(spPr, theme) {
  const solid = kid(spPr, 'solidFill'), grad = kid(spPr, 'gradFill');
  if (kid(spPr, 'noFill')) return { fill: null };
  if (solid) { const c = colourOf(solid, theme); return c && { fill: c.hex, alpha: c.alpha }; }
  if (grad) {
    const stops = KIDS(kid(grad, 'gsLst')).map(gs => ({ offset: num(gs, 'pos') / 100000, c: colourOf(gs, theme) })).filter(s => s.c).sort((a, b) => a.offset - b.offset);
    if (!stops.length) return undefined;
    const lin = kid(grad, 'lin'), a = (lin ? num(lin, 'ang') / ANGLE : 90) * Math.PI / 180, dx = Math.cos(a) / 2, dy = Math.sin(a) / 2;
    const circle = !!kid(grad, 'path');
    return { fill: new fabric.Gradient({
      type: circle ? 'radial' : 'linear', gradientUnits: 'percentage',
      coords: circle ? { x1: 0.5, y1: 0.5, r1: 0, x2: 0.5, y2: 0.5, r2: 0.5 } : { x1: 0.5 - dx, y1: 0.5 - dy, x2: 0.5 + dx, y2: 0.5 + dy },
      colorStops: stops.map(s => ({ offset: s.offset, color: s.c.hex, opacity: s.c.alpha }))
    }), first: stops[0].c.hex };
  }
  return undefined;
}
const lineOf = (spPr, theme, k) => strokeOf(kid(spPr, 'ln'), theme, k);
// A line element (a:ln, or a table cell's a:lnT and friends) as Fabric stroke settings, or null for none.
function strokeOf(ln, theme, k) {
  if (!ln || kid(ln, 'noFill')) return null;
  const c = colourOf(kid(ln, 'solidFill'), theme);
  if (!c) return null;
  const width = Math.max(0.5, num(ln, 'w', 12700) * k), dash = kid(ln, 'prstDash')?.getAttribute('val');
  return { stroke: c.hex, strokeWidth: width, strokeDashArray: dash && dash !== 'solid' ? (dash.includes('dot') && !dash.includes('Dash') ? [width, width * 2] : [width * 4, width * 3]) : null };
}

// ---- Geometry: every PowerPoint shape outline as an SVG path in its own box, or null for a plain rectangle ----
const r2 = n => Math.round(n * 100) / 100;
function adj(geom, name, fallback) {
  const gd = KIDS(kid(geom, 'avLst')).find(g => g.getAttribute('name') === name), m = /val\s+(-?\d+)/.exec(gd?.getAttribute('fmla') || '');
  return m ? +m[1] : fallback;
}
const POLY = pts => 'M ' + pts.map(([x, y]) => `${r2(x)} ${r2(y)}`).join(' L ') + ' Z';
const ELLIPSE = (w, h) => `M 0 ${r2(h / 2)} A ${r2(w / 2)} ${r2(h / 2)} 0 1 1 ${r2(w)} ${r2(h / 2)} A ${r2(w / 2)} ${r2(h / 2)} 0 1 1 0 ${r2(h / 2)} Z`;
function star(points, inner, w, h) {
  return POLY(Array.from({ length: points * 2 }, (_, i) => { const a = i * Math.PI / points - Math.PI / 2, r = i % 2 ? inner : 1; return [w / 2 + Math.cos(a) * r * w / 2, h / 2 + Math.sin(a) * r * h / 2]; }));
}
const PRESETS = {
  rect: () => null,
  roundRect: (w, h, g) => { const r = Math.min(w, h) * adj(g, 'adj', 16667) / 100000; return `M ${r2(r)} 0 L ${r2(w - r)} 0 Q ${r2(w)} 0 ${r2(w)} ${r2(r)} L ${r2(w)} ${r2(h - r)} Q ${r2(w)} ${r2(h)} ${r2(w - r)} ${r2(h)} L ${r2(r)} ${r2(h)} Q 0 ${r2(h)} 0 ${r2(h - r)} L 0 ${r2(r)} Q 0 0 ${r2(r)} 0 Z`; },
  ellipse: ELLIPSE,
  triangle: (w, h, g) => POLY([[w * adj(g, 'adj', 50000) / 100000, 0], [w, h], [0, h]]),
  rtTriangle: (w, h) => POLY([[0, 0], [w, h], [0, h]]),
  diamond: (w, h) => POLY([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]),
  parallelogram: (w, h, g) => { const x = Math.min(w, h) * adj(g, 'adj', 25000) / 100000; return POLY([[x, 0], [w, 0], [w - x, h], [0, h]]); },
  trapezoid: (w, h, g) => { const x = Math.min(w, h) * adj(g, 'adj', 25000) / 100000; return POLY([[x, 0], [w - x, 0], [w, h], [0, h]]); },
  pentagon: (w, h) => POLY(Array.from({ length: 5 }, (_, i) => { const a = i * 2 * Math.PI / 5 - Math.PI / 2; return [w / 2 + Math.cos(a) * w / 2, h / 2 + Math.sin(a) * h / 2]; })),
  hexagon: (w, h, g) => { const x = Math.min(w, h) * adj(g, 'adj', 25000) / 100000; return POLY([[x, 0], [w - x, 0], [w, h / 2], [w - x, h], [x, h], [0, h / 2]]); },
  octagon: (w, h, g) => { const x = Math.min(w, h) * adj(g, 'adj', 29289) / 100000; return POLY([[x, 0], [w - x, 0], [w, x], [w, h - x], [w - x, h], [x, h], [0, h - x], [0, x]]); },
  star4: (w, h) => star(4, 0.38, w, h), star5: (w, h) => star(5, 0.38, w, h), star6: (w, h) => star(6, 0.5, w, h), star8: (w, h) => star(8, 0.6, w, h),
  plus: (w, h, g) => { const x = Math.min(w, h) * adj(g, 'adj', 25000) / 100000; return POLY([[x, 0], [w - x, 0], [w - x, x], [w, x], [w, h - x], [w - x, h - x], [w - x, h], [x, h], [x, h - x], [0, h - x], [0, x], [x, x]]); },
  rightArrow: (w, h) => POLY([[0, h / 4], [w - h / 2, h / 4], [w - h / 2, 0], [w, h / 2], [w - h / 2, h], [w - h / 2, h * 3 / 4], [0, h * 3 / 4]]),
  leftArrow: (w, h) => POLY([[w, h / 4], [h / 2, h / 4], [h / 2, 0], [0, h / 2], [h / 2, h], [h / 2, h * 3 / 4], [w, h * 3 / 4]]),
  heart: (w, h) => `M ${r2(w / 2)} ${r2(h / 4)} C ${r2(w / 2)} 0 0 0 0 ${r2(h / 4)} C 0 ${r2(h / 2)} ${r2(w / 2)} ${r2(h * 0.75)} ${r2(w / 2)} ${r2(h)} C ${r2(w / 2)} ${r2(h * 0.75)} ${r2(w)} ${r2(h / 2)} ${r2(w)} ${r2(h / 4)} C ${r2(w)} 0 ${r2(w / 2)} 0 ${r2(w / 2)} ${r2(h / 4)} Z`
};
const LINES = ['line', 'straightConnector1'];
// A custom outline: each path is drawn in its own w × h units, stretched to the box.
function customPath(geom, w, h) {
  let d = '', open = false;
  for (const path of KIDS(kid(geom, 'pathLst'))) {
    const sx = w / (num(path, 'w') || w), sy = h / (num(path, 'h') || h);
    let at = [0, 0];
    const pt = p => [num(p, 'x') * sx, num(p, 'y') * sy], str = ([x, y]) => `${r2(x)} ${r2(y)}`;
    if (path.getAttribute('fill') === 'none') open = true;
    for (const c of KIDS(path)) {
      const pts = KIDS(c).filter(p => p.localName === 'pt').map(pt);
      if (c.localName === 'moveTo' && pts[0]) { d += `M ${str(pts[0])} `; at = pts[0]; }
      else if (c.localName === 'lnTo' && pts[0]) { d += `L ${str(pts[0])} `; at = pts[0]; }
      else if (c.localName === 'cubicBezTo' && pts.length === 3) { d += `C ${pts.map(str).join(' ')} `; at = pts[2]; }
      else if (c.localName === 'quadBezTo' && pts.length === 2) { d += `Q ${pts.map(str).join(' ')} `; at = pts[1]; }
      else if (c.localName === 'arcTo') {
        const rx = num(c, 'wR') * sx, ry = num(c, 'hR') * sy, st = num(c, 'stAng') / ANGLE * Math.PI / 180, sw = num(c, 'swAng') / ANGLE * Math.PI / 180;
        const cx = at[0] - rx * Math.cos(st), cy = at[1] - ry * Math.sin(st), end = [cx + rx * Math.cos(st + sw), cy + ry * Math.sin(st + sw)];
        d += `A ${r2(rx)} ${r2(ry)} 0 ${Math.abs(sw) > Math.PI ? 1 : 0} ${sw > 0 ? 1 : 0} ${str(end)} `; at = end;
      } else if (c.localName === 'close') d += 'Z ';
    }
  }
  return { d: d.trim(), open };
}
// The outline of `spPr` as { d, open } (d null for a rectangle), or undefined for a preset this importer doesn't know.
function outline(spPr, w, h) {
  const preset = kid(spPr, 'prstGeom'), custom = kid(spPr, 'custGeom');
  if (custom) {
    const c = customPath(custom, w, h);
    return /^M [\d.]+ [\d.]+( L [\d.]+ [\d.]+){3,4} Z$/.test(c.d) && isBox(c.d, w, h) ? { d: null } : c.d ? c : undefined;
  }
  const kind = preset?.getAttribute('prst') || 'rect';
  if (LINES.includes(kind)) return { line: true };
  return PRESETS[kind] ? { d: PRESETS[kind](w, h, preset) } : undefined;
}
// Whether a straight-line path only visits the box's corners, as Canva writes plain rectangles.
function isBox(d, w, h) {
  const nums = d.match(/-?[\d.]+/g).map(Number), near = (a, b) => Math.abs(a - b) < 0.6;
  for (let i = 0; i < nums.length; i += 2) if (!((near(nums[i], 0) || near(nums[i], w)) && (near(nums[i + 1], 0) || near(nums[i + 1], h)))) return false;
  return true;
}

// ---- Placement: PowerPoint boxes (unrotated, then turned about their centre) to Fabric objects ----
// `space` maps a box in the slide's units to design pixels; groups add their own mapping on top.
function boxOf(xfrm, space) {
  const off = kid(xfrm, 'off'), ext = kid(xfrm, 'ext');
  let box = { x: num(off, 'x'), y: num(off, 'y'), w: num(ext, 'cx'), h: num(ext, 'cy'), rot: num(xfrm, 'rot') / ANGLE, flipH: yes(xfrm?.getAttribute('flipH')), flipV: yes(xfrm?.getAttribute('flipV')) };
  for (const map of space.groups) box = map(box);
  return { x: box.x * space.k, y: box.y * space.k, w: box.w * space.k, h: box.h * space.k, rot: box.rot, flipH: box.flipH, flipV: box.flipV, scale: space.k * (box.scale || 1) };
}
// A group's child boxes are in chOff/chExt units; this maps them into the group's own box, turning with it.
function groupMap(xfrm) {
  const off = kid(xfrm, 'off'), ext = kid(xfrm, 'ext'), chOff = kid(xfrm, 'chOff'), chExt = kid(xfrm, 'chExt');
  const sx = num(ext, 'cx') / (num(chExt, 'cx') || num(ext, 'cx') || 1), sy = num(ext, 'cy') / (num(chExt, 'cy') || num(ext, 'cy') || 1);
  const rot = num(xfrm, 'rot') / ANGLE, flipH = yes(xfrm?.getAttribute('flipH')), flipV = yes(xfrm?.getAttribute('flipV'));
  const gx = num(off, 'x') + num(ext, 'cx') / 2, gy = num(off, 'y') + num(ext, 'cy') / 2;
  return b => {
    let cx = num(off, 'x') + (b.x + b.w / 2 - num(chOff, 'x')) * sx - gx, cy = num(off, 'y') + (b.y + b.h / 2 - num(chOff, 'y')) * sy - gy;
    let angle = b.rot, fh = b.flipH, fv = b.flipV;
    if (flipH) { cx = -cx; fh = !fh; angle = -angle; }
    if (flipV) { cy = -cy; fv = !fv; angle = -angle; }
    const a = rot * Math.PI / 180, x = cx * Math.cos(a) - cy * Math.sin(a), y = cx * Math.sin(a) + cy * Math.cos(a), w = b.w * sx, h = b.h * sy;
    return { x: gx + x - w / 2, y: gy + y - h / 2, w, h, rot: angle + rot, flipH: fh, flipV: fv, scale: (b.scale || 1) * Math.sqrt(sx * sy) };
  };
}
// Put `object` where the part of the box at (cx, cy), in box pixels, belongs once the box is turned and flipped.
function settle(object, box, cx = box.w / 2, cy = box.h / 2) {
  let dx = cx - box.w / 2, dy = cy - box.h / 2;
  if (box.flipH) dx = -dx;
  if (box.flipV) dy = -dy;
  const a = box.rot * Math.PI / 180, centre = new fabric.Point(box.x + box.w / 2 + dx * Math.cos(a) - dy * Math.sin(a), box.y + box.h / 2 + dx * Math.sin(a) + dy * Math.cos(a));
  object.set({ angle: ((box.rot % 360) + 360) % 360 });
  object.setPositionByOrigin(centre, 'center', 'center');
  return object;
}

// ---- Text ----
const SERIF = /serif|playfair|garamond|times|georgia|baskerville|merriweather|cormorant|bodoni|didot|libre|crimson|prata|abril|cinzel|lora/i;
const SCRIPT = /script|hand|brush|signature|pacifico|dancing|vibes|sacramento|allura|amatic|caveat|marker|kalam|satisfy|parisienne/i;
// A font Canva didn't embed is swapped for the closest bundled one; the swaps are listed afterwards.
function fontFor(name, families, swaps) {
  if (!name) return FONTS[0];
  const bundled = FONTS.find(b => b.toLowerCase() === name.toLowerCase());
  if (bundled || families.has(name)) return bundled || name;
  const pick = /sans/i.test(name) && !/comic/i.test(name) ? (/round|nunito|quicksand|comfortaa|varela/i.test(name) ? 'Nunito' : 'Lexend')
    : /slab|arvo|rockwell|courier/i.test(name) ? 'Roboto Slab' : SERIF.test(name) ? 'Lora' : SCRIPT.test(name) ? 'Caveat'
    : /comic/i.test(name) ? 'Comic Neue' : /fredoka|baloo|chewy|bubble|round/i.test(name) ? 'Fredoka' : /nunito|quicksand|comfortaa|varela/i.test(name) ? 'Nunito' : 'Lexend';
  swaps.set(name, pick);
  return pick;
}
const PT = PX / 72;
const ALIGN = { l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify' };
// One text box from a txBody, or null if it has no text. Runs that differ from the first are kept as styles.
// `cell` is a table cell's tcPr, whose margins and anchor stand in for the text box's own.
function textOf(txBody, box, shapeStyle, ctx, cell) {
  const lines = [], styles = {}, k = box.scale / ctx.k;   // k: how much groups shrank or grew this text
  let base = null, align = 'left', lineHeight = null;
  const listStyle = lvl => kid(txBody, 'lstStyle', `lvl${lvl}pPr`);
  for (const p of KIDS(txBody).filter(c => c.localName === 'p')) {
    const pPr = kid(p, 'pPr'), lvl = num(pPr, 'lvl') + 1;
    if (!lines.length) align = ALIGN[pPr?.getAttribute('algn') || listStyle(lvl)?.getAttribute('algn')] || 'left';
    let line = '';
    const runs = KIDS(p).filter(c => ['r', 'br', 'fld'].includes(c.localName));
    if (!runs.length) { lines.push(''); continue; }
    for (const r of runs) {
      if (r.localName === 'br') { lines.push(line); line = ''; continue; }
      const rPr = kid(r, 'rPr'), def = kid(listStyle(lvl), 'defRPr');
      const attr = name => rPr?.getAttribute(name) ?? def?.getAttribute(name);
      const sizePt = num(rPr, 'sz', num(def, 'sz', 1800)) / 100;
      const face = kid(rPr, 'latin')?.getAttribute('typeface') || kid(def, 'latin')?.getAttribute('typeface') || ctx.majorFont;
      const family = fontFor(face && !face.startsWith('+') ? face : ctx.minorFont, ctx.families, ctx.swaps);
      // Canva embeds a font's bold cut as its own family ("Name Bold"); asking for bold again would thicken it twice.
      const boldFace = /\b(bold|black|heavy)\b/i.test(family) && ctx.families.has(family);
      const colour = colourOf(kid(rPr, 'solidFill') || kid(def, 'solidFill'), ctx.theme) || shapeStyle || { hex: '#000000' };
      let text = kid(r, 't')?.textContent || '';
      if (attr('cap') === 'all') text = text.toUpperCase();
      const style = {
        fontFamily: family, fontSize: Math.round(sizePt * PT * k * 100) / 100, fill: colour.hex,
        fontWeight: yes(attr('b')) && !boldFace ? 'bold' : 'normal', fontStyle: yes(attr('i')) ? 'italic' : 'normal',
        underline: !!attr('u') && attr('u') !== 'none', linethrough: !!attr('strike') && attr('strike') !== 'noStrike'
      };
      const spc = num(rPr, 'spc', num(def, 'spc', 0));
      if (spc) style.charSpacing = Math.round(spc / 100 / sizePt * 1000);
      if (!base) {
        base = style;
        const ln = kid(pPr, 'lnSpc') || kid(listStyle(lvl), 'lnSpc');
        // Fabric spaces lines at fontSize × lineHeight × 1.13; PowerPoint's single spacing is 1.2 × the size.
        lineHeight = kid(ln, 'spcPts') ? num(kid(ln, 'spcPts'), 'val') / 100 / sizePt / 1.13 : kid(ln, 'spcPct') ? num(kid(ln, 'spcPct'), 'val') / 100000 * 1.2 / 1.13 : 1.2 / 1.13;
      }
      const diff = Object.fromEntries(Object.entries(style).filter(([key, v]) => base[key] !== v));
      if (!('charSpacing' in style) && base.charSpacing) diff.charSpacing = 0;
      if (Object.keys(diff).length) {
        const row = styles[lines.length] ||= {}, start = [...line].length;
        [...text].forEach((_, i) => { row[start + i] = diff; });
      }
      line += text;
    }
    lines.push(line);
  }
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  if (!base || !lines.some(l => l.trim())) return null;
  const bodyPr = kid(txBody, 'bodyPr'), inset = (name, margin, fallback) => (cell ? num(cell, margin, fallback) : num(bodyPr, name, fallback)) * box.scale;
  const left = inset('lIns', 'marL', 91440), right = inset('rIns', 'marR', 91440), top = inset('tIns', 'marT', 45720), bottom = inset('bIns', 'marB', 45720);
  const { charSpacing = 0, ...font } = base;
  const text = new fabric.Textbox(lines.join('\n'), { ...font, charSpacing, styles, textAlign: align, lineHeight: Math.round(lineHeight * 1000) / 1000, width: Math.max(8, box.w - left - right), splitByGrapheme: false, kbName: lines.find(l => l.trim()).trim().slice(0, 40) });
  const anchor = (cell || bodyPr)?.getAttribute('anchor'), room = box.h - top - bottom;
  const cy = (anchor === 'ctr' ? top + room / 2 : anchor === 'b' ? box.h - bottom - text.height / 2 : top + text.height / 2) + baselineShift(text);
  return settle(text, box, left + text.width / 2, cy);
}

// Canva lays lines out like a web page: each line's glyphs sit centred in its line by the font's own ascent and
// descent. Fabric puts every baseline at a fixed fraction of the size instead, which leaves tall fonts too high.
const metrics = document.createElement('canvas').getContext('2d');
function baselineShift(text) {
  metrics.font = `${text.fontStyle} ${text.fontWeight} 100px "${text.fontFamily}"`;
  const m = metrics.measureText('Hg'), a = m.fontBoundingBoxAscent / 100, d = m.fontBoundingBoxDescent / 100;
  if (!(a > 0 && d >= 0)) return 0;
  const size = text.fontSize, line = size * text.lineHeight * text._fontSizeMult;
  return (line - (a + d) * size) / 2 + a * size - size * text._fontSizeMult * (1 - text._fontSizeFraction);
}

// ---- Pictures ----
async function pictureOf(blipFill, spPr, box, ctx) {
  const blip = kid(blipFill, 'blip'), src = await ctx.picture(ctx.rels.get(relId(blip, 'embed')));
  if (!src) return null;
  const image = await fabric.FabricImage.fromURL(src);
  const nw = image.width, nh = image.height, sr = kid(blipFill, 'srcRect'), fr = kid(blipFill, 'stretch', 'fillRect');
  // The part of the picture used (srcRect), stretched over the box inset by fillRect; negative insets overflow the box.
  const crop = { l: num(sr, 'l') / 1e5, t: num(sr, 't') / 1e5, r: num(sr, 'r') / 1e5, b: num(sr, 'b') / 1e5 };
  const fill = { l: num(fr, 'l') / 1e5, t: num(fr, 't') / 1e5, r: num(fr, 'r') / 1e5, b: num(fr, 'b') / 1e5 };
  const sw = nw * (1 - crop.l - crop.r), sh = nh * (1 - crop.t - crop.b), iw = box.w * (1 - fill.l - fill.r), ih = box.h * (1 - fill.t - fill.b);
  if (sw <= 0 || sh <= 0 || iw <= 0 || ih <= 0) return null;
  const scaleX = iw / sw, scaleY = ih / sh, x0 = Math.max(0, fill.l * box.w), x1 = Math.min(box.w, box.w - fill.r * box.w), y0 = Math.max(0, fill.t * box.h), y1 = Math.min(box.h, box.h - fill.b * box.h);
  if (x1 <= x0 || y1 <= y0) return null;
  image.set({ cropX: crop.l * nw + (x0 - fill.l * box.w) / scaleX, cropY: crop.t * nh + (y0 - fill.t * box.h) / scaleY, width: (x1 - x0) / scaleX, height: (y1 - y0) / scaleY, scaleX, scaleY, flipX: box.flipH, flipY: box.flipV, kbName: 'Picture' });
  const amt = kid(blip, 'alphaModFix');
  if (amt) image.opacity = num(amt, 'amt', 100000) / 1e5;
  // A shaped picture (circle, rounded, Canva's frames) is clipped to its outline, drawn in the picture's own units.
  const shape = outline(spPr, box.w, box.h);
  if (shape?.d) {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const d = shape.d.replace(/(-?[\d.]+) (-?[\d.]+)/g, (m, x, y) => `${r2((x - cx) / scaleX)} ${r2((y - cy) / scaleY)}`);
    // Arc radii are pairs too and were moved; arcs only occur in ellipses, which are rebuilt in picture units instead.
    const clip = /A/.test(shape.d) && kid(spPr, 'prstGeom')?.getAttribute('prst') === 'ellipse'
      ? new fabric.Ellipse({ rx: box.w / 2 / scaleX, ry: box.h / 2 / scaleY, originX: 'center', originY: 'center', left: (box.w / 2 - cx) / scaleX, top: (box.h / 2 - cy) / scaleY })
      : /A/.test(shape.d) ? null : new fabric.Path(d, { originX: 'center', originY: 'center' });
    if (clip && clip.type === 'path') clip.set({ left: clip.pathOffset.x, top: clip.pathOffset.y });
    if (clip) image.clipPath = clip;
  }
  return settle(image, box, (x0 + x1) / 2, (y0 + y1) / 2);
}

// ---- Shapes ----
// Shapes without their own fill take the colour of their style's fill reference, as PowerPoint draws them.
function shapeOf(spPr, box, ctx, styleEl) {
  const shape = outline(spPr, box.w, box.h);
  if (!shape) return null;
  const fill = fillOf(spPr, ctx.theme) ?? { fill: colourOf(kid(styleEl, 'fillRef'), ctx.theme)?.hex ?? null };
  const line = lineOf(spPr, ctx.theme, box.scale);
  if (shape.line) {
    if (!line) return null;
    const [x1, y1, x2, y2] = [box.flipH ? box.w : 0, box.flipV ? box.h : 0, box.flipH ? 0 : box.w, box.flipV ? 0 : box.h];
    const l = new fabric.Line([x1, y1, x2, y2], { ...line, strokeLineCap: 'round', kbName: 'Line' });
    return settle(l, { ...box, flipH: false, flipV: false });
  }
  if (!fill.fill && !line) return null;
  const look = { fill: fill.fill, opacity: fill.alpha ?? 1, ...(line || { strokeWidth: 0, stroke: null }) };
  const kind = kid(spPr, 'prstGeom')?.getAttribute('prst');
  let object;
  if (!shape.d) object = new fabric.Rect({ width: box.w, height: box.h, ...look, kbName: 'Rectangle' });
  else if (kind === 'roundRect') { const r = Math.min(box.w, box.h) * adj(kid(spPr, 'prstGeom'), 'adj', 16667) / 100000; object = new fabric.Rect({ width: box.w, height: box.h, rx: r, ry: r, ...look, kbName: 'Rounded rectangle' }); }
  else if (kind === 'ellipse') object = new fabric.Ellipse({ rx: box.w / 2, ry: box.h / 2, ...look, kbName: 'Circle' });
  else {
    object = new fabric.Path(shape.d, { ...look, kbName: 'Shape' });
    if (shape.open) object.fill = null;
    object.set({ flipX: box.flipH, flipY: box.flipV });
    return settle(object, box, object.pathOffset.x, object.pathOffset.y);
  }
  return settle(object, box);
}

// ---- Tables: a box and a text box per cell, the way Create's own tables are made ----
function tableOf(tbl, box, ctx) {
  const cols = KIDS(kid(tbl, 'tblGrid')).map(c => num(c, 'w') * box.scale), rows = KIDS(tbl).filter(c => c.localName === 'tr');
  const heights = rows.map(r => num(r, 'h') * box.scale), objects = [];
  const xs = cols.map((_, i) => cols.slice(0, i).reduce((a, b) => a + b, 0)), ys = heights.map((_, i) => heights.slice(0, i).reduce((a, b) => a + b, 0));
  rows.forEach((tr, r) => KIDS(tr).filter(c => c.localName === 'tc').forEach((tc, c) => {
    if (yes(tc.getAttribute('hMerge')) || yes(tc.getAttribute('vMerge')) || c >= cols.length) return; // covered by a merged cell
    const span = Math.max(1, num(tc, 'gridSpan', 1)), down = Math.max(1, num(tc, 'rowSpan', 1)), tcPr = kid(tc, 'tcPr');
    const cell = { ...box, x: box.x + xs[c], y: box.y + ys[r], w: cols.slice(c, c + span).reduce((a, b) => a + b, 0), h: heights.slice(r, r + down).reduce((a, b) => a + b, 0), rot: 0, flipH: false, flipV: false };
    // Fabric draws one border all round, so the cell takes the first edge that has one.
    const edge = ['lnT', 'lnL', 'lnB', 'lnR'].map(name => kid(tcPr, name)).find(ln => ln && !kid(ln, 'noFill') && kid(ln, 'solidFill'));
    const fill = fillOf(tcPr, ctx.theme), line = strokeOf(edge, ctx.theme, box.scale);
    objects.push(new fabric.Rect({ left: cell.x, top: cell.y, width: cell.w, height: cell.h, fill: fill?.fill ?? null, opacity: fill?.alpha ?? 1, ...(line || { stroke: null, strokeWidth: 0 }), kbName: 'Table cell' }));
    const txBody = kid(tc, 'txBody'), text = txBody && textOf(txBody, cell, null, ctx, tcPr);
    if (text) objects.push(text.set({ kbName: 'Cell text' }));
  }));
  return objects;
}

// ---- Slides ----
// Everything on one slide, in drawing order, as Fabric objects. `skipped` counts what couldn't come across.
async function slideObjects(tree, ctx, space, out) {
  for (const el of KIDS(tree)) {
    const name = el.localName;
    try {
      if (name === 'grpSp') {
        const xfrm = kid(el, 'grpSpPr', 'xfrm');
        await slideObjects(el, ctx, { ...space, groups: [groupMap(xfrm), ...space.groups] }, out);
      } else if (name === 'sp' || name === 'pic' || name === 'cxnSp') {
        const spPr = kid(el, 'spPr'), xfrm = kid(spPr, 'xfrm');
        if (!xfrm) { if (kid(el, 'txBody') && KIDS(kid(el, 'txBody')).some(p => p.textContent.trim())) out.skipped.push('text in a layout box'); continue; }
        if (kid(el, 'nvPicPr', 'nvPr', 'videoFile') || kid(el, 'nvPicPr', 'nvPr', 'audioFile')) { out.skipped.push('a video or sound'); continue; }
        const box = boxOf(xfrm, space), blipFill = name === 'pic' ? kid(el, 'blipFill') : kid(spPr, 'blipFill');
        const hidden = yes(kid(el, name === 'pic' ? 'nvPicPr' : name === 'cxnSp' ? 'nvCxnSpPr' : 'nvSpPr', 'cNvPr')?.getAttribute('hidden'));
        let object = null;
        if (blipFill) { object = await pictureOf(blipFill, spPr, box, ctx); if (!object) out.skipped.push('a picture in a format that can\'t be shown'); }
        else if (outline(spPr, 1, 1) === undefined) out.skipped.push('a shape');
        else object = shapeOf(spPr, box, ctx, kid(el, 'style'));
        if (object) { if (hidden) object.visible = false; out.objects.push(object); }
        const txBody = kid(el, 'txBody');
        if (txBody) {
          const fontRef = colourOf(kid(el, 'style', 'fontRef'), ctx.theme);
          const text = textOf(txBody, { ...box, rot: box.rot + num(kid(txBody, 'bodyPr'), 'rot') / ANGLE }, fontRef, ctx);
          if (text) { if (hidden) text.visible = false; out.objects.push(text); }
        }
      } else if (name === 'graphicFrame') {
        const table = kid(el, 'graphic', 'graphicData', 'tbl');
        if (table) out.objects.push(...tableOf(table, boxOf(kid(el, 'xfrm'), space), ctx));
        else out.skipped.push('a chart or diagram');
      } else if (name === 'AlternateContent') { const fb = kid(el, 'Fallback'); if (fb) await slideObjects(fb, ctx, space, out); }
    } catch (error) {
      console.warn('Canva import: skipped', name, error);
      out.skipped.push('something that couldn\'t be read');
    }
  }
}
function backgroundOf(slideRoot, ctx) {
  const bg = kid(slideRoot, 'cSld', 'bg');
  if (!bg) return null;
  const bgPr = kid(bg, 'bgPr'), ref = kid(bg, 'bgRef');
  if (bgPr) return { fill: fillOf(bgPr, ctx.theme), blip: kid(bgPr, 'blipFill') };
  if (ref) return { fill: { fill: colourOf(ref, ctx.theme)?.hex } };
  return null;
}

// The design page for a slide size in inches, and how much everything is scaled to fit it.
function pageForSize(w, h) {
  const named = Object.keys(PAGES).find(key => !isSocial(key) && Math.abs(PAGES[key][0] - w) < FIT && Math.abs(PAGES[key][1] - h) < FIT);
  if (named) return { page: named, size: PAGES[named], scale: 1 };
  // Canva's social posts are pixel sizes (1080 wide), which come out as 11.25 inches at 96 per inch.
  const social = Object.keys(PAGES).find(key => isSocial(key) && Math.abs(w * PX - 1080) < 3 && Math.abs(PAGES[key][1] / PAGES[key][0] - h / w) < 0.01);
  if (social) return { page: social, size: PAGES[social], scale: PAGES[social][0] / w };
  let scale = 1;
  if (Math.max(w, h) > MAX_SIDE) scale = MAX_SIDE / Math.max(w, h);
  if (Math.min(w, h) * scale < 1) scale = 1 / Math.min(w, h);
  return { page: 'custom', size: [w, h].map(v => Math.min(MAX_SIDE, Math.round(v * scale * 1000) / 1000)), scale };
}

// A whole presentation as a design document plus notes on what changed.
async function designFromPowerPoint(pkg) {
  const pres = xmlPart(pkg, 'ppt/presentation.xml');
  if (!pres) throw Error('this PowerPoint file can\'t be read');
  const presRels = rels(pkg, 'ppt/presentation.xml'), sz = kid(pres, 'sldSz');
  const fit = pageForSize(num(sz, 'cx', 9144000) / EMU, num(sz, 'cy', 6858000) / EMU);
  // Embedded fonts: each typeface with its regular, bold, italic and bold-italic cuts.
  const fonts = [];
  for (const ef of KIDS(kid(pres, 'embeddedFontLst'))) {
    const family = kid(ef, 'font')?.getAttribute('typeface');
    for (const [cut, weight, style] of [['regular', 'normal', 'normal'], ['bold', 'bold', 'normal'], ['italic', 'normal', 'italic'], ['boldItalic', 'bold', 'italic']]) {
      const src = pkg.fonts[presRels.get(relId(kid(ef, cut), 'id'))];
      if (family && src) fonts.push({ family, src, weight, style });
    }
  }
  const added = await addDesignFonts(fonts), families = new Set(added.map(f => f.family));
  const themeFonts = kid(xmlPart(pkg, Object.keys(pkg.parts).find(p => /^ppt\/theme\/theme\d*\.xml$/.test(p))), 'themeElements', 'fontScheme');
  const pictures = new Map();
  const ctx = {
    theme: themeColours(pkg), families, swaps: new Map(), k: PX / EMU * fit.scale,
    majorFont: kid(themeFonts, 'majorFont', 'latin')?.getAttribute('typeface'), minorFont: kid(themeFonts, 'minorFont', 'latin')?.getAttribute('typeface'),
    // Pictures are shrunk like uploads, once each however often they're used.
    picture: path => {
      const url = pkg.media[path];
      if (!url) return Promise.resolve(null);
      if (!pictures.has(path)) pictures.set(path, shrink(new Blob([dataBytes(url)], { type: url.slice(5, url.indexOf(';')) })).catch(() => null));
      return pictures.get(path);
    }
  };
  const slides = KIDS(kid(pres, 'sldIdLst')).map(s => presRels.get(relId(s, 'id'))).filter(p => pkg.parts[p]);
  if (!slides.length) throw Error('this file has no pages');
  const pages = [], skipped = [];
  for (const path of slides.slice(0, MAX_PAGES)) {
    const root = xmlPart(pkg, path), slideRels = rels(pkg, path);
    if (!root || root.getAttribute('show') === '0') continue; // hidden slides stay behind
    const out = { objects: [], skipped };
    // The background comes from the slide, else its layout, else the master.
    const layout = relOfType(slideRels, pkg, path, 'slideLayout'), master = layout && relOfType(rels(pkg, layout), pkg, layout, 'slideMaster');
    let background = '#ffffff';
    for (const [part, partRels] of [[path, slideRels], [layout, layout && rels(pkg, layout)], [master, master && rels(pkg, master)]]) {
      const bg = part && backgroundOf(xmlPart(pkg, part), ctx);
      if (!bg) continue;
      if (bg.blip) {
        const picture = await pictureOf(bg.blip, null, { x: 0, y: 0, w: fit.size[0] * PX, h: fit.size[1] * PX, rot: 0, flipH: false, flipV: false, scale: ctx.k }, { ...ctx, rels: partRels });
        if (picture) out.objects.push(picture.set({ kbName: 'Background picture', kbLocked: true }));
      } else if (bg.fill?.fill) background = typeof bg.fill.fill === 'string' ? bg.fill.fill : bg.fill.first;
      break;
    }
    await slideObjects(kid(root, 'cSld', 'spTree'), { ...ctx, rels: slideRels }, { k: ctx.k, groups: [] }, out);
    pages.push({ version: fabric.version, objects: out.objects.map(o => o.toObject(KEEP)), background });
  }
  if (slides.length > MAX_PAGES) skipped.push(`${slides.length - MAX_PAGES} pages past the first ${MAX_PAGES}`);
  return { doc: { format: 2, page: fit.page, size: fit.page === 'custom' ? fit.size : undefined, tile: 'single', copies: 1, fonts: added, pages }, swaps: ctx.swaps, skipped, fonts: families };
}

// A PNG or JPEG download: one locked picture filling a page of the same shape.
async function designFromPicture(file) {
  const src = await shrink(file), image = await fabric.FabricImage.fromURL(src), ratio = image.height / image.width;
  const key = Object.keys(PAGES).find(k => Math.abs(PAGES[k][1] / PAGES[k][0] - ratio) < 0.005);
  const size = key ? PAGES[key] : ratio >= 1 ? [8.5, Math.min(MAX_SIDE, 8.5 * ratio)] : [Math.min(MAX_SIDE, 11 / ratio), 11];
  image.set({ left: 0, top: 0, scaleX: size[0] * PX / image.width, scaleY: size[1] * PX / image.height, kbName: 'Canva design', kbLocked: true });
  return { doc: { format: 2, page: key || 'custom', size: key ? undefined : size.map(v => Math.round(v * 1000) / 1000), tile: 'single', copies: 1, pages: [{ version: fabric.version, objects: [image.toObject(KEEP)], background: '#ffffff' }] }, swaps: new Map(), skipped: [], picture: true };
}

// What came across and what didn't, shown once over the new design.
function importNote(result) {
  const lines = [];
  if (result.picture) lines.push('This is a picture of the design, locked in place. Add text and photos on top, or download it from Canva as PowerPoint to edit everything.');
  else {
    lines.push(`Brought over ${result.doc.pages.length === 1 ? 'one page' : result.doc.pages.length + ' pages'}. Check the text: line breaks can fall a little differently than in Canva.`);
    if (result.fonts.size) lines.push(`Canva's fonts came too: ${[...result.fonts].join(', ')}. They're listed at the bottom of the font menu.`);
    if (result.swaps.size) lines.push('Swapped fonts: ' + [...result.swaps].map(([from, to]) => `${from} → ${to}`).join(', ') + '.');
    const counts = new Map();
    for (const s of result.skipped) counts.set(s, (counts.get(s) || 0) + 1);
    if (counts.size) lines.push('Left out: ' + [...counts].map(([what, n]) => n > 1 ? `${what} (${n})` : what).join(', ') + '.');
  }
  const note = $('#create-import-note');
  note.querySelector('ul').replaceChildren(...lines.map(text => Object.assign(document.createElement('li'), { textContent: text })));
  note.hidden = false;
}
$('#import-note-ok').onclick = () => { $('#create-import-note').hidden = true; };

function importCanva(file) {
  return navigateDesign(async () => {
    const result = /\.pptx$/i.test(file.name)
      ? await designFromPowerPoint(await invoke('read_pptx', new Uint8Array(await file.arrayBuffer())))
      : /^image\/(png|jpeg)$/.test(file.type) ? await designFromPicture(file)
      : (() => { throw Error(/\.pdf$/i.test(file.name) ? 'PDFs can\'t be opened yet. In Canva, choose Share → Download → PowerPoint (or PNG) instead' : 'choose a PowerPoint (.pptx), PNG or JPEG file downloaded from Canva'); })();
    const base = file.name.replace(/\.[^.]*$/, '').replace(/[\/\\:*?"<>|\x00-\x1f]/g, '').replace(/^\.+/, '').trim().slice(0, 80) || 'From Canva';
    await open(result.doc, await uniqueTitle(base), null);
    schedule();
    importNote(result);
  });
}
$('#home-import').onclick = () => $('#import-file').click();
$('#import-file').onchange = event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (file) importCanva(file).catch(error => { $(mode === 'create' ? '#create-saved' : '#home-status').textContent = `Could not import “${file.name}”: ${error.message || error}`; });
};
