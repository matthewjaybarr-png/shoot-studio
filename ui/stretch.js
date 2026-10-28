// Stretch, the fifth tab of Create's Edit photo drawer: content-aware resize (PhotoCraft's seam carving, through Rust's
// carve_picture). Plain areas such as sky, grass and walls give way while people and things keep their shape, so a
// photo can be made wider, narrower, taller, shorter, or the page's own shape, without squashing anyone. Needs
// create.js, phototools.js and straighten.js.

const stretch = { w: 100, h: 100, busy: false };
const stretchSay = text => { $('#stretch-hint').textContent = text; };
// The selected picture, or the only one on the page.
function stretchImage() {
  if (!board || !design) return null;
  const active = board.getActiveObject() || (board.getObjects().includes(touch.wasSelected) ? touch.wasSelected : null), pictures = board.getObjects().filter(o => o.type === 'image' && o.visible !== false);
  return active?.type === 'image' ? active : pictures.length === 1 ? pictures[0] : null;
}
// A photo that is the whole page (as Edit a photo makes): the page follows its new size, as in Straighten.
function stretchWhole(image) {
  const box = image.getBoundingRect(), [pw, ph] = pagePx();
  return designPages.length === 1 && design.page === 'custom' && !image.angle && Math.abs(box.left) < 1 && Math.abs(box.top) < 1 && Math.abs(box.width - pw) < 1 && Math.abs(box.height - ph) < 1;
}
function paintStretch() {
  const image = stretchImage();
  $('#stretch-actions').hidden = !image;
  $('#stretch-w').value = stretch.w; $('#stretch-h').value = stretch.h;
  if (image) {
    const [nw, nh] = naturalSize(image);
    $('#stretch-w-out').textContent = `${stretch.w}% · ${Math.round(nw * stretch.w / 100)} px`;
    $('#stretch-h-out').textContent = `${stretch.h}% · ${Math.round(nh * stretch.h / 100)} px`;
    $('#stretch-fill').hidden = stretchWhole(image) || !!image.angle;
  }
  $('#stretch-go').disabled = stretch.busy || (stretch.w === 100 && stretch.h === 100);
  $('#stretch-fill').disabled = stretch.busy;
  if (!stretch.busy) stretchSay(image ? 'Drag Width or Height, then click Stretch. Sky, grass and walls give way; people and things keep their shape.' : 'Click the picture you want to stretch.');
}
$('#stretch-w').oninput = e => { stretch.w = +e.target.value; paintStretch(); };
$('#stretch-h').oninput = e => { stretch.h = +e.target.value; paintStretch(); };
$('#stretch-reset').onclick = () => { stretch.w = stretch.h = 100; paintStretch(); };
$('#stretch-go').onclick = () => stretchPicture(false);
$('#stretch-fill').onclick = () => stretchPicture(true);
$('#stretch-done').onclick = () => { stretch.w = stretch.h = 100; photoTab = 'retouch'; showDrawer('retouch'); };

// The original's pixels go to Rust and come back at the new size. With `fill` the new size is the page's shape and the
// picture then covers the page; otherwise it keeps its middle and its pixel scale.
async function stretchPicture(fill) {
  const image = stretchImage();
  if (!image || stretch.busy) return;
  stretch.busy = true; paintStretch(); stretchSay('Stretching… a big photo can take a few seconds.');
  try {
    const work = await touchPixels(image.kbOriginal || image.getSrc()), { width: w, height: h } = work.canvas, pixels = work.ctx.getImageData(0, 0, w, h).data;
    const [pw, ph] = pagePx();
    let [ow, oh] = [Math.round(w * stretch.w / 100), Math.round(h * stretch.h / 100)];
    if (fill) [ow, oh] = w / h > pw / ph ? [Math.round(h * pw / ph), h] : [w, Math.round(w * ph / pw)];
    [ow, oh] = [Math.max(1, ow), Math.max(1, oh)];
    if (ow === w && oh === h) return stretchSay(fill ? 'It is already the shape of the page.' : 'Drag Width or Height first.');
    const body = new Uint8Array(8 + pixels.length), view = new DataView(body.buffer);
    view.setUint32(0, w, true); view.setUint32(4, h, true); body.set(pixels, 8);
    const out = new Uint8Array(await invoke('carve_picture', body, { headers: { width: String(ow), height: String(oh), people: $('#stretch-people').checked ? '1' : '0' } }));
    const canvas = pictureCanvas(ow, oh);
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(out.buffer, 8, ow * oh * 4), ow, oh), 0, 0);
    const next = canvas.toDataURL(work.clear ? 'image/png' : 'image/jpeg', 0.92);
    const whole = stretchWhole(image), middle = image.getCenterPoint();
    const place = o => {
      if (fill) return o.set({ left: 0, top: 0, originX: 'left', originY: 'top', scaleX: pw / ow, scaleY: ph / oh });
      if (!whole) return o.setPositionByOrigin(middle, 'center', 'center');
      design.size = [ow, oh].map(v => Math.min(MAX_SIDE, Math.max(1, Math.round(v / DPI * 1000) / 1000)));
      const k = pagePx()[0] / ow;
      o.set({ left: 0, top: 0, scaleX: k, scaleY: k });
    };
    const done = await setPicture(image, { original: next, kbMask: undefined, kbLocal: undefined, resized: true, place });
    if (whole && !fill) paintAll();
    if (done) { stretch.w = stretch.h = 100; stretchSay(`Stretched to ${ow} × ${oh} px. Click Undo to put it back.`); }
  } catch (error) {
    stretchSay(`Couldn't stretch it: ${error}`);
  } finally {
    stretch.busy = false;
    const said = $('#stretch-hint').textContent; paintStretch();
    if (/^(Stretched|Couldn't|It is|Drag Width)/.test(said)) stretchSay(said);
  }
}
