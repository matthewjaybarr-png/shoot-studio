// Effects, the sixth tab of Create's Edit photo drawer: fun effects (oil paint, pop-art dots, mosaic, pencil sketch)
// and Relight, both from Rust's effects.rs. Each change redraws the picture from how it was before any effect, so
// clicking another effect or another light replaces the last one instead of piling up, and Back to the photo puts it
// back. Masks and adjusted parts stay as they are, since the size doesn't change. Needs create.js and phototools.js.

const FUN_EFFECTS = [['oil', 'Oil paint'], ['dots', 'Pop-art dots'], ['mosaic', 'Mosaic'], ['sketch', 'Pencil sketch']];
// Where the lamp is, as a 3 × 3 grid around the picture: degrees (0 from the right, 90 from above), or the front.
const LIGHT_DIRS = [['135', '↖', 'From the top left'], ['90', '↑', 'From above'], ['45', '↗', 'From the top right'], ['180', '←', 'From the left'], ['front', '●', 'From the front'], ['0', '→', 'From the right'], ['225', '↙', 'From the bottom left'], ['270', '↓', 'From below'], ['315', '↘', 'From the bottom right']];
const funFx = { image: null, base: null, effect: null, light: null, size: 50, amount: 60, even: 0, warmth: 0, busy: false, again: false };
const funSay = text => { $('#fun-hint').textContent = text; };
function funImage() {
  if (!board || !design) return null;
  const active = board.getActiveObject() || (board.getObjects().includes(touch.wasSelected) ? touch.wasSelected : null), pictures = board.getObjects().filter(o => o.type === 'image' && o.visible !== false);
  return active?.type === 'image' ? active : pictures.length === 1 ? pictures[0] : null;
}
function paintFun() {
  const image = funImage();
  // A new picture (or the old one gone, as after Undo) starts a fresh session from how it looks now.
  if (image !== funFx.image) Object.assign(funFx, { image, base: null, effect: null, light: null });
  $('#fun-actions').hidden = !image;
  const list = $('#fun-list'), dirs = $('#light-dirs');
  if (!list.children.length) list.append(...FUN_EFFECTS.map(([key, label]) => { const b = button(label, () => chooseFun(key)); b.dataset.fun = key; return b; }));
  if (!dirs.children.length) dirs.append(...LIGHT_DIRS.map(([key, arrow, label]) => { const b = button(arrow, () => chooseLight(key)); b.dataset.light = key; b.title = label; b.setAttribute('aria-label', label); return b; }));
  for (const b of list.children) { b.classList.toggle('on', b.dataset.fun === funFx.effect); b.setAttribute('aria-pressed', b.dataset.fun === funFx.effect); }
  for (const b of dirs.children) { b.classList.toggle('on', b.dataset.light === funFx.light); b.setAttribute('aria-pressed', b.dataset.light === funFx.light); }
  for (const [id, key, unit] of [['fun-size', 'size', '%'], ['light-amount', 'amount', '%'], ['light-even', 'even', '%'], ['light-warmth', 'warmth', '']]) {
    $('#' + id).value = funFx[key]; $(`#${id}-out`).textContent = key === 'warmth' ? (funFx.warmth > 0 ? 'warmer' : funFx.warmth < 0 ? 'cooler' : 'plain') : funFx[key] + unit;
  }
  $('#fun-back').disabled = !funFx.base || funFx.busy;
  if (!funFx.busy) funSay(!image ? 'Click the picture you want to change.' : funFx.effect || funFx.light ? 'Click another one to swap it, or Back to the photo. Undo works too.' : 'Click an effect, or where the light should come from.');
}
const chooseFun = key => { funFx.effect = funFx.effect === key ? null : key; runFun(); };
const chooseLight = key => { funFx.light = funFx.light === key ? null : key; runFun(); };
for (const [id, key] of [['fun-size', 'size'], ['light-amount', 'amount'], ['light-even', 'even'], ['light-warmth', 'warmth']]) {
  $('#' + id).oninput = e => { funFx[key] = +e.target.value; paintFun(); };
  // a slider redraws once it is let go, and only when what it changes is on
  $('#' + id).onchange = () => { if (key === 'size' ? funFx.effect : funFx.light) runFun(); };
}
$('#fun-back').onclick = () => { funFx.effect = funFx.light = null; runFun(); };
$('#fun-done').onclick = () => { Object.assign(funFx, { image: null, base: null, effect: null, light: null }); photoTab = 'retouch'; showDrawer('retouch'); };

// From the base: the effect, then the light, then one setPicture (one Undo step).
async function runFun() {
  const image = funFx.image;
  if (!image || !board.getObjects().includes(image)) return paintFun();
  if (funFx.busy) { funFx.again = true; return paintFun(); }
  funFx.busy = true; funFx.again = false; paintFun();
  funSay(funFx.effect || funFx.light ? 'Working on it…' : 'Putting the photo back…');
  try {
    funFx.base ||= image.kbOriginal || image.getSrc();
    const work = await touchPixels(funFx.base), { width: w, height: h } = work.canvas;
    let pixels = work.ctx.getImageData(0, 0, w, h).data;
    const send = async (command, headers) => {
      const body = new Uint8Array(8 + pixels.length), view = new DataView(body.buffer);
      view.setUint32(0, w, true); view.setUint32(4, h, true); body.set(pixels, 8);
      return new Uint8ClampedArray(await invoke(command, body, { headers }));
    };
    if (funFx.effect) pixels = await send('effect_picture', { effect: funFx.effect, size: String(funFx.size) });
    if (funFx.light) pixels = await send('relight_picture', { angle: funFx.light, amount: String(funFx.amount), even: String(funFx.even), warmth: String(funFx.warmth) });
    let next = funFx.base;
    if (funFx.effect || funFx.light) {
      const canvas = pictureCanvas(w, h);
      canvas.getContext('2d').putImageData(new ImageData(pixels, w, h), 0, 0);
      next = canvas.toDataURL(work.clear ? 'image/png' : 'image/jpeg', 0.92);
    }
    const base = funFx.base;
    if (await setPicture(image, { original: next })) {
      funFx.base = base; // setPicture repaints the panel; the session carries on with the same picture
      if (!funFx.effect && !funFx.light) funFx.base = null;
    }
  } catch (error) {
    funSay(`Couldn't do it: ${error}`);
    funFx.busy = false; return;
  } finally {
    funFx.busy = false;
  }
  if (funFx.again) return runFun();
  paintFun();
}
