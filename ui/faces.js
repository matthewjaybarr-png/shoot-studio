// Faces, a tab of Create's Edit photo drawer: the faces in the picture are found (Rust's find_faces), circled and
// numbered on the page, and sliders touch them up. Smooth skin, Brighter eyes and Whiter teeth are Rust's face_tones;
// Bigger eyes, Smile, Slimmer face and Smaller nose are a Reshape field built here from where the eyes, nose and mouth
// are, warped by reshape_picture with the picture's masks, so a cut-out edge moves with the face. Like Effects, each
// change redraws from how the picture was before, so moving a slider back really goes back. Needs create.js,
// phototools.js and reshape.js.

const FACE_SLIDERS = [
  ['smooth', 'Smooth skin'], ['eyes', 'Brighter eyes'], ['teeth', 'Whiter teeth'],
  ['bigEyes', 'Bigger eyes'], ['smile', 'Smile'], ['slim', 'Slimmer face'], ['nose', 'Smaller nose']
];
const faceFx = { image: null, base: null, faces: null, which: -1, finding: false, busy: false, again: false, ...Object.fromEntries(FACE_SLIDERS.map(([key]) => [key, 0])) };
const faceSay = text => { $('#face-hint').textContent = text; };
const faceTouched = () => FACE_SLIDERS.some(([key]) => faceFx[key] > 0);
const facesTab = () => mode === 'create' && !!board && drawer === 'retouch' && photoTab === 'faces';

function paintFaces() {
  const image = typeof funImage === 'function' ? funImage() : null;
  // A new picture (or the old one gone, as after Undo) starts a fresh session from how it looks now.
  if (image !== faceFx.image) {
    Object.assign(faceFx, { image, base: null, faces: null, which: -1, masks: null }, Object.fromEntries(FACE_SLIDERS.map(([key]) => [key, 0])));
    if (image && facesTab()) findFaces();
  }
  const sliders = $('#face-sliders');
  if (!sliders.children.length) sliders.append(...FACE_SLIDERS.map(([key, label], i) => {
    const row = document.createElement('label'), out = document.createElement('output'), input = Object.assign(document.createElement('input'), { type: 'range', min: 0, max: 100, step: 5, value: 0, id: 'face-' + key });
    out.id = `face-${key}-out`;
    row.append(label + ' ', out, input);
    input.oninput = () => { faceFx[key] = +input.value; paintFaces(); };
    input.onchange = () => runFaces(); // redraws once the slider is let go
    if (i === 3) { const h = document.createElement('h3'); h.textContent = 'Shape'; return [h, row]; }
    return row;
  }).flat());
  for (const [key] of FACE_SLIDERS) { $('#face-' + key).value = faceFx[key]; $(`#face-${key}-out`).textContent = faceFx[key] + '%'; }
  const n = faceFx.faces?.length || 0, which = $('#face-which');
  $('#face-actions').hidden = !n;
  which.hidden = n < 2;
  if (n > 1 && which.children.length !== n + 1) which.replaceChildren(...[-1, ...faceFx.faces.keys()].map(i => { const b = button(i < 0 ? 'All faces' : `Face ${i + 1}`, () => { faceFx.which = i; paintFaces(); if (faceTouched()) runFaces(); }); b.dataset.face = i; return b; }));
  for (const b of which.children) { b.classList.toggle('on', +b.dataset.face === faceFx.which); b.setAttribute('aria-pressed', +b.dataset.face === faceFx.which); }
  $('#face-back').disabled = !faceTouched() || faceFx.busy;
  if (!faceFx.busy && !faceFx.finding) faceSay(!image ? 'Click the picture with the faces in it.' : !faceFx.faces ? '' : !n ? "No faces found in this picture. Faces need to be facing the camera and not too small." : n === 1 ? 'Found one face. Move a slider to touch it up.' : `Found ${n} faces. Touch up all of them, or pick one.`);
  board?.requestRenderAll();
}

async function findFaces() {
  const image = faceFx.image;
  faceFx.finding = true; faceSay('Looking for faces…');
  try {
    faceFx.base = image.kbOriginal || image.getSrc();
    const work = await touchPixels(faceFx.base), { width: w, height: h } = work.canvas, data = work.ctx.getImageData(0, 0, w, h).data;
    const body = new Uint8Array(8 + data.length), view = new DataView(body.buffer);
    view.setUint32(0, w, true); view.setUint32(4, h, true); body.set(data, 8);
    const faces = await invoke('find_faces', body);
    if (faceFx.image === image) faceFx.faces = faces;
  } catch (error) {
    if (faceFx.image === image) { faceFx.faces = []; faceFx.finding = false; return faceSay(`Couldn't look for faces: ${error}`); }
  }
  faceFx.finding = false;
  if (faceFx.image === image) paintFaces();
}

// Every face's landmarks give it a frame: across (the line between the eyes) and down, so a tilted head bends right.
function faceFrame(face, k) {
  const [eyeA, eyeB, nose, mouthA, mouthB] = face.landmarks.map(([x, y]) => [x * k, y * k]);
  const d = Math.max(Math.hypot(eyeB[0] - eyeA[0], eyeB[1] - eyeA[1]), face.rect[2] * k * 0.25);
  const across = [(eyeB[0] - eyeA[0]) / d, (eyeB[1] - eyeA[1]) / d], down = [-across[1], across[0]];
  const at = (p, a, b) => [p[0] + across[0] * a + down[0] * b, p[1] + across[1] * a + down[1] * b];
  return { eyeA, eyeB, nose, mouthA, mouthB, d, mw: Math.max(Math.hypot(mouthB[0] - mouthA[0], mouthB[1] - mouthA[1]), d * 0.6), across, down, at };
}
// The shape sliders as one Reshape field over the picture (in the field's pixels, `k` per found-face pixel).
function faceField(faces, size, k) {
  const f = newShapeField(null, size), s = name => faceFx[name] / 100;
  const dab = (c, r, move) => shapeDab(c[0], c[1], r, move, f, 1);
  for (const face of faces) {
    const { eyeA, eyeB, nose, mouthA, mouthB, d, mw, across, down, at } = faceFrame(face, k), vec = (a, b) => [across[0] * a + down[0] * b, across[1] * a + down[1] * b];
    if (s('bigEyes')) for (const c of [eyeA, eyeB]) dab(c, d * 0.42, (x, y) => [(x - c[0]) * -0.22 * s('bigEyes'), (y - c[1]) * -0.22 * s('bigEyes')]);
    if (s('smile')) {
      dab(mouthA, mw * 0.5, () => vec(mw * 0.06 * s('smile'), mw * 0.12 * s('smile'))); // the corner moves out and up
      dab(mouthB, mw * 0.5, () => vec(-mw * 0.06 * s('smile'), mw * 0.12 * s('smile')));
    }
    if (s('slim')) for (const side of [-1, 1]) for (const [a, b, r] of [[1.05, 0.15, 0.6], [1.0, 0.65, 0.6], [0.78, 1.1, 0.5]]) {
      dab(at(nose, side * a * d, b * d), r * d, () => vec(side * 0.13 * d * s('slim'), 0)); // the cheek and jaw come in
    }
    if (s('nose')) { const c = at(nose, 0, -0.1 * d); dab(c, d * 0.45, (x, y) => { const along = (x - c[0]) * across[0] + (y - c[1]) * across[1]; return vec(along * 0.3 * s('nose'), 0); }); }
  }
  return f;
}

// From the base: the tones, then the shape, then one setPicture (one Undo step).
async function runFaces() {
  const image = faceFx.image;
  if (!image || !board.getObjects().includes(image) || !faceFx.faces?.length) return paintFaces();
  if (faceFx.busy) { faceFx.again = true; return paintFaces(); }
  faceFx.busy = true; faceFx.again = false; paintFaces();
  faceSay(faceTouched() ? 'Touching up…' : 'Putting the photo back…');
  try {
    const work = await touchPixels(faceFx.base), { width: w, height: h } = work.canvas, faces = faceFx.which < 0 ? faceFx.faces : [faceFx.faces[faceFx.which]];
    let pixels = work.ctx.getImageData(0, 0, w, h).data;
    if (faceFx.smooth || faceFx.eyes || faceFx.teeth) {
      const body = new Uint8Array(8 + pixels.length), view = new DataView(body.buffer);
      view.setUint32(0, w, true); view.setUint32(4, h, true); body.set(pixels, 8);
      pixels = new Uint8ClampedArray(await invoke('face_tones', body, { headers: { faces: JSON.stringify(faces), smooth: String(faceFx.smooth), eyes: String(faceFx.eyes), teeth: String(faceFx.teeth) } }));
    }
    const type = work.clear ? 'image/png' : 'image/jpeg', changes = {};
    if (faceFx.bigEyes || faceFx.smile || faceFx.slim || faceFx.nose) {
      const f = faceField(faces, [w, h], 1);
      changes.original = await warpShape(new ImageData(pixels, w, h), f, type);
      // The masks, as Reshape does: the session's own masks, so moving a slider back puts them back too.
      faceFx.masks ||= { kbMask: image.kbMask, kbLocal: image.kbLocal };
      const masks = async url => url && warpShape(await pictureData(url, w, h), f, 'image/png');
      changes.kbMask = await masks(faceFx.masks.kbMask) || undefined;
      if (faceFx.masks.kbLocal?.length) changes.kbLocal = await Promise.all(faceFx.masks.kbLocal.map(async part => ({ ...part, kbMask: await masks(part.kbMask) })));
    } else {
      if (faceTouched()) { const canvas = pictureCanvas(w, h); canvas.getContext('2d').putImageData(new ImageData(pixels, w, h), 0, 0); changes.original = canvas.toDataURL(type, 0.92); }
      else changes.original = faceFx.base;
      if (faceFx.masks) Object.assign(changes, { kbMask: faceFx.masks.kbMask, kbLocal: faceFx.masks.kbLocal });
    }
    const keep = { base: faceFx.base, faces: faceFx.faces, which: faceFx.which, masks: faceFx.masks };
    if (await setPicture(image, changes)) Object.assign(faceFx, keep); // setPicture repaints the panel; the session carries on
  } catch (error) {
    faceFx.busy = false; return faceSay(`Couldn't touch it up: ${error}`);
  } finally {
    faceFx.busy = false;
  }
  if (faceFx.again) return runFaces();
  paintFaces();
}
$('#face-back').onclick = () => { for (const [key] of FACE_SLIDERS) faceFx[key] = 0; runFaces(); };
$('#face-done').onclick = () => { Object.assign(faceFx, { image: null, base: null, faces: null, masks: null }); photoTab = 'retouch'; showDrawer('retouch'); };

// A numbered ring round each face while the tab is open, so she can see which is which.
function drawFaces(ctx) {
  if (!facesTab() || !faceFx.faces?.length || !faceFx.image || !board.getObjects().includes(faceFx.image)) return;
  const image = faceFx.image, z = board.getZoom(), [nw, nh] = naturalSize(image), work = touch.work?.src === faceFx.base ? touch.work.canvas : null;
  const k = work ? nw / work.width : 1;
  ctx.save(); ctx.transform(...image.calcTransformMatrix());
  ctx.beginPath(); ctx.rect(-image.width / 2, -image.height / 2, image.width, image.height); ctx.clip();
  ctx.translate(-image.width / 2 - (image.cropX || 0), -image.height / 2 - (image.cropY || 0));
  const scale = Math.abs(image.scaleX || 1) * z;
  faceFx.faces.forEach((face, i) => {
    const [x, y, w, h] = face.rect.map(v => v * k), on = faceFx.which < 0 || faceFx.which === i;
    ctx.lineWidth = 2.5 / scale; ctx.strokeStyle = on ? '#d0489b' : 'rgba(255,255,255,.7)';
    ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w * 0.6, h * 0.62, 0, 0, 2 * Math.PI); ctx.stroke();
    if (faceFx.faces.length > 1) {
      const r = 11 / scale, cx = x + w / 2, cy = y + h / 2 - h * 0.62;
      ctx.fillStyle = on ? '#d0489b' : '#888888'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.font = `bold ${14 / scale}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(i + 1), cx, cy + 0.5 / scale);
    }
  });
  ctx.restore();
}
