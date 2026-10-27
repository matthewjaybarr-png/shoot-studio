// A picture's layers in Create, drawn over its original by create.js' setPicture: adjusted parts (a filter seen only
// through a mask), then the picture's own mask and fade. A mask is a PNG the picture's size whose alpha is how much
// shows, so Cut out, the Erase and Bring back brushes and Adjust this part never lose pixels: Undo, Bring back or
// removing an adjustment always has the original to go back to. Needs create.js.

const loadPicture = async src => { const img = new Image(); img.src = src; await img.decode(); return img; };
const pictureCanvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });

// Coverage bytes (one a pixel, 0–255) to a mask PNG and back.
function maskUrl(bytes, w, h) {
  const canvas = pictureCanvas(w, h), ctx = canvas.getContext('2d'), img = ctx.createImageData(w, h);
  for (let i = 0; i < bytes.length; i++) img.data.set([255, 255, 255, bytes[i]], i * 4);
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}
async function maskBytes(url, w, h) {
  const ctx = pictureCanvas(w, h).getContext('2d', { willReadFrequently: true });
  ctx.drawImage(await loadPicture(url), 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data, out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = data[i * 4 + 3];
  return out;
}

// ---- Fade: the picture melts into the page from one side, or all round ----
const FADES = [['', 'None'], ['bottom', 'Bottom'], ['top', 'Top'], ['left', 'Left'], ['right', 'Right'], ['edges', 'All round']];
function fadeShape(ctx, w, h, { side, size }) {
  const k = Math.min(1, Math.max(0.02, size));
  let fill;
  if (side === 'edges') {
    ctx.save(); ctx.translate(w / 2, h / 2); ctx.scale(w / 2, h / 2);
    fill = ctx.createRadialGradient(0, 0, Math.max(0, 1 - k) * 0.999, 0, 0, 1);
    fill.addColorStop(0, '#fff'); fill.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = fill; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
    return;
  }
  const [x0, y0, x1, y1] = { bottom: [0, h * (1 - k), 0, h], top: [0, h * k, 0, 0], left: [w * k, 0, 0, 0], right: [w * (1 - k), 0, w, 0] }[side];
  fill = ctx.createLinearGradient(x0, y0, x1, y1);
  fill.addColorStop(0, '#fff'); fill.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = fill; ctx.fillRect(0, 0, w, h);
}

// The picture seen through its mask and fade.
async function maskPicture(src, mask, fade) {
  const img = await loadPicture(src), w = img.naturalWidth, h = img.naturalHeight, canvas = pictureCanvas(w, h), ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  if (mask) ctx.drawImage(await loadPicture(mask), 0, 0, w, h);
  if (fade?.side) fadeShape(ctx, w, h, fade);
  return canvas.toDataURL('image/png');
}

// Each adjusted part is the picture filtered its own way, seen only through its mask, on top of the picture.
async function adjustParts(src, parts) {
  const img = await loadPicture(src), w = img.naturalWidth, h = img.naturalHeight, canvas = pictureCanvas(w, h), ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  for (const part of parts) {
    if (!part.filter || !part.kbMask) continue;
    const layer = pictureCanvas(w, h), lctx = layer.getContext('2d');
    lctx.drawImage(await loadPicture(await filterPicture(src, part.filter)), 0, 0, w, h);
    lctx.globalCompositeOperation = 'destination-in'; lctx.drawImage(await loadPicture(part.kbMask), 0, 0, w, h);
    ctx.drawImage(layer, 0, 0);
  }
  return canvas.toDataURL(src.startsWith('data:image/png') ? 'image/png' : 'image/jpeg', 0.92);
}
