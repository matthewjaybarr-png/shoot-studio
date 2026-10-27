// More of Canva's tools in Create: strikethrough, capitals, lists and curved text for words; Copy style for anything;
// exact size and rotation in Position. Needs create.js (board, change, paintPanel, commitDesign).
KEEP.push('kbCaps', 'kbList', 'kbCurve');

// ---- Curved text: drawn along an arc, straight again while it's being typed in ----
// kbCurve runs from -100 (a smile) to 100 (an arch); 100 bends the line almost into a circle.
const curveOf = o => o.kbCurve && !o.isEditing ? Math.max(-100, Math.min(100, o.kbCurve)) : 0;
const curveText = o => o.text.replace(/\n/g, ' ');
// The arc for the text's current font: its radius, the angle it spans, and how tall and wide it stands.
function curveArc(o, ctx) {
  ctx.font = o._getFontDeclaration();
  const gap = (o.charSpacing || 0) / 1000 * o.fontSize;
  const widths = [...curveText(o)].map(c => ctx.measureText(c).width + gap);
  const length = Math.max(1, widths.reduce((a, b) => a + b, 0) - gap);
  const angle = Math.abs(curveOf(o)) / 100 * Math.PI * 1.9, radius = length / angle;
  const sag = radius * (1 - Math.cos(angle / 2)), span = angle >= Math.PI ? 2 * radius : 2 * radius * Math.sin(angle / 2);
  return { widths, angle, radius, height: sag + o.fontSize * 1.2, width: span + o.fontSize };
}
const measure = document.createElement('canvas').getContext('2d');
{
  const proto = fabric.Textbox.prototype, initDimensions = proto.initDimensions, render = proto._render;
  // A curved text box is as wide as its straight line and as tall as its arc.
  proto.initDimensions = function () {
    initDimensions.call(this);
    if (curveOf(this)) { const arc = curveArc(this, measure); this.height = arc.height; this.width = Math.max(this.width, arc.width); }
  };
  proto._render = function (ctx) {
    if (!curveOf(this)) return render.call(this, ctx);
    const arc = curveArc(this, ctx), up = curveOf(this) > 0, size = this.fontSize;
    // Arch: the circle's top touches the top of the box. Smile: its bottom touches the bottom, letters upright inside it.
    const cy = up ? -this.height / 2 + size * 0.9 + arc.radius : this.height / 2 - size * 0.3 - arc.radius;
    const paint = (method, style) => {
      if (!style || style === 'transparent') return;
      ctx[method + 'Style'] = style.toLive ? style.toLive(ctx, this) : style;
      let at = -arc.angle / 2;
      [...curveText(this)].forEach((c, i) => {
        const mid = at + arc.widths[i] / 2 / arc.radius;
        ctx.save();
        if (up) { ctx.translate(Math.sin(mid) * arc.radius, cy - Math.cos(mid) * arc.radius); ctx.rotate(mid); }
        else { ctx.translate(Math.sin(mid) * arc.radius, cy + Math.cos(mid) * arc.radius); ctx.rotate(-mid); }
        ctx[method + 'Text'](c, 0, 0);
        ctx.restore();
        at += arc.widths[i] / arc.radius;
      });
    };
    ctx.save();
    ctx.font = this._getFontDeclaration(); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = this.strokeWidth; ctx.lineJoin = 'round';
    const stroke = this.stroke && this.strokeWidth ? this.stroke : null;
    if (this.paintFirst === 'stroke') { paint('stroke', stroke); this._removeShadow?.(ctx); paint('fill', this.fill); }
    else { paint('fill', this.fill); this._removeShadow?.(ctx); paint('stroke', stroke); }
    ctx.restore();
  };
}
// Changing the curve keeps the text where it is, centred on the same point.
function setCurve(o, amount) {
  const centre = o.getCenterPoint();
  if (amount && !o.kbCurve) { measure.font = o._getFontDeclaration(); o.set({ width: Math.max(o.width, measure.measureText(curveText(o)).width * 1.05 + o.fontSize) }); }
  o.kbCurve = amount || undefined;
  o.initDimensions(); o.setPositionByOrigin(centre, 'center', 'center'); o.dirty = true; o.setCoords();
}
$('#prop-curve').oninput = e => {
  const amount = Math.round(+e.target.value); $('#prop-curve-value').textContent = amount;
  for (const o of board.getActiveObjects()) if (o.type === 'textbox') setCurve(o, amount);
  board.requestRenderAll();
};
$('#prop-curve').onchange = () => commitDesign();

// ---- Capitals and lists: the words stay as typed underneath, so they can be turned off again ----
const BULLET = /^(• |\d+\. )/;
function listed(text, kind) {
  let n = 0;
  return text.split('\n').map(line => {
    const bare = line.replace(BULLET, '');
    if (!kind || !bare.trim()) return bare;
    return (kind === 'bullets' ? '• ' : `${++n}. `) + bare;
  }).join('\n');
}
const capitals = s => [...s].map(c => c.toUpperCase().length === 1 ? c.toUpperCase() : c).join('');
// After typing, new lines get their bullet or number and new letters become capitals.
function tidyText(o) {
  if (o?.type !== 'textbox') return false;
  let text = o.text;
  if (o.kbList) text = listed(text, o.kbList);
  if (o.kbCaps != null) { o.kbCaps = text; text = capitals(text); }
  if (text === o.text) return false;
  o.set({ text }); o.initDimensions(); o.setCoords();
  return true;
}
$('#prop-caps').onclick = () => change(o => {
  if (o.type !== 'textbox') return {};
  // Turning capitals off brings back the letters as typed, unless the words were changed while they were on.
  if (o.kbCaps != null) { const back = capitals(o.kbCaps) === o.text ? o.kbCaps : o.text; return { kbCaps: undefined, text: back }; }
  return { kbCaps: o.text, text: capitals(o.text) };
});
$('#prop-list').onclick = () => change(o => {
  if (o.type !== 'textbox') return {};
  const kind = { undefined: 'bullets', bullets: 'numbers', numbers: undefined }[o.kbList];
  const text = listed(o.text, kind);
  return { kbList: kind, text, ...(o.kbCaps != null && { kbCaps: listed(o.kbCaps, kind) }) };
});
$('#prop-strike').onclick = () => change(o => o.type === 'textbox' ? { linethrough: !o.linethrough } : {});

// ---- Copy style: click it, then click the thing that should look the same ----
const TEXT_STYLE = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'underline', 'linethrough', 'fill', 'stroke', 'strokeWidth', 'paintFirst', 'shadow', 'charSpacing', 'lineHeight', 'textAlign', 'textBackgroundColor', 'kbEffect', 'opacity'];
const SHAPE_STYLE = ['fill', 'stroke', 'strokeWidth', 'strokeDashArray', 'paintFirst', 'shadow', 'opacity', 'rx', 'ry'];
let copiedStyle = null;
function styleOf(o) {
  const keys = o.type === 'textbox' ? TEXT_STYLE : o.type === 'image' ? ['opacity', 'shadow'] : SHAPE_STYLE;
  const style = { from: o.type };
  for (const k of keys) style[k] = o[k]?.toObject ? new fabric.Shadow(o[k].toObject()) : Array.isArray(o[k]) ? [...o[k]] : o[k];
  if (o.type === 'textbox') style.kbCurve = o.kbCurve;
  return style;
}
// Text takes text styles, shapes and lines take shape styles; anything else takes what both share.
function pasteStyle(o, style) {
  const same = (style.from === 'textbox') === (o.type === 'textbox') && (style.from === 'image') === (o.type === 'image');
  const keys = same ? Object.keys(style).filter(k => k !== 'from' && k !== 'kbCurve') : ['opacity', 'shadow', ...(o.type !== 'image' && style.from !== 'image' ? ['fill'] : [])];
  for (const k of keys) if (k in style) o.set(k, style[k]?.toObject ? new fabric.Shadow(style[k].toObject()) : Array.isArray(style[k]) ? [...style[k]] : style[k]);
  if (o.type === 'rect' && !same) o.set({ rx: o.rx, ry: o.ry });
  if (o.type === 'textbox') { if (same) setCurve(o, style.kbCurve); o.initDimensions(); }
  o.dirty = true; o.setCoords();
}
// While a style is held, the button says what to do next.
function paintCopyStyle() {
  const b = $('#prop-copy-style');
  b.classList.toggle('on', !!copiedStyle);
  b.textContent = copiedStyle ? '🖌 Now click what to style (Esc cancels)' : '🖌 Copy style';
}
$('#prop-copy-style').onclick = () => {
  const o = board.getActiveObject();
  copiedStyle = copiedStyle || !o || o.type === 'activeselection' ? null : styleOf(o);
  paintCopyStyle();
};
function applyCopiedStyle(e) {
  const targets = (e?.selected || []).filter(o => !o.kbLocked);
  if (!copiedStyle || !targets.length) return;
  const style = copiedStyle; copiedStyle = null; paintCopyStyle();
  for (const o of targets) pasteStyle(o, style);
  board.requestRenderAll(); commitDesign(); paintPanel();
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && copiedStyle) { copiedStyle = null; paintCopyStyle(); } });

// ---- Size and rotation, typed in exactly (in the page's pixels, as Canva shows them) ----
function paintSize() {
  const o = board?.getActiveObject();
  if (!o) return;
  $('#prop-w').value = Math.round(o.getScaledWidth()); $('#prop-h').value = Math.round(o.getScaledHeight());
  $('#prop-angle').value = Math.round(((o.angle % 360) + 360) % 360);
}
function resizeTo(axis, value) {
  const o = board.getActiveObject();
  if (!o || !(value > 0)) return paintSize();
  const centre = o.getCenterPoint(), keep = $('#prop-ratio').checked || o.type === 'textbox' && axis === 'h';
  const factor = value / (axis === 'w' ? o.getScaledWidth() : o.getScaledHeight());
  if (o.type === 'textbox' && !keep) o.set({ width: o.width * factor }); // text gets wider rather than stretched
  else if (keep) o.set({ scaleX: o.scaleX * factor, scaleY: o.scaleY * factor });
  else o.set(axis === 'w' ? { scaleX: o.scaleX * factor } : { scaleY: o.scaleY * factor });
  if (o.type === 'textbox') o.initDimensions();
  o.setPositionByOrigin(centre, 'center', 'center'); o.setCoords();
  board.requestRenderAll(); commitDesign(); paintSize();
}
$('#prop-w').onchange = e => resizeTo('w', e.target.valueAsNumber);
$('#prop-h').onchange = e => resizeTo('h', e.target.valueAsNumber);
$('#prop-angle').onchange = e => {
  const o = board.getActiveObject();
  if (!o || !Number.isFinite(e.target.valueAsNumber)) return paintSize();
  o.rotate(((e.target.valueAsNumber % 360) + 360) % 360); o.setCoords();
  board.requestRenderAll(); commitDesign();
};

// Called by paintPanel for the current selection.
function paintTextTools(o) {
  paintSize();
  if (typeof paintGraphicColours === 'function') paintGraphicColours(o);
  if (typeof paintChartPanel === 'function') paintChartPanel(o);
  if (typeof paintTablePanel === 'function') paintTablePanel();
  if (typeof paintLink === 'function') paintLink(o);
  if (o?.type !== 'textbox') return;
  if (typeof paintAlign === 'function') paintAlign(o);
  $('#prop-strike').classList.toggle('on', !!o.linethrough);
  $('#prop-caps').classList.toggle('on', o.kbCaps != null);
  $('#prop-list').classList.toggle('on', !!o.kbList);
  $('#prop-list').textContent = o.kbList === 'numbers' ? '1. List' : '• List';
  $('#prop-curve').value = o.kbCurve || 0; $('#prop-curve-value').textContent = o.kbCurve || 0;
}
// Called once the board exists.
function startTextTools() {
  board.on('text:editing:entered', ({ target }) => { if (target.kbCurve) { target.initDimensions(); target.setCoords(); } });
  board.on('text:editing:exited', ({ target }) => {
    const tidied = tidyText(target);
    if (target.kbCurve) setCurve(target, target.kbCurve);
    if (tidied || target.kbCurve) { board.requestRenderAll(); commitDesign(); }
  });
  for (const e of ['selection:created', 'selection:updated']) board.on(e, applyCopiedStyle);
  board.on('object:modified', paintSize);
}
