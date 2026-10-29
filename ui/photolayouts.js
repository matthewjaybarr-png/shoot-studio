// Photos to Create: this photo, the selected ones or the picks, developed, as a page each, a collage, or photo-booth
// strips, in a new design. "Use in a design" in Photos opens it. Needs app.js and create.js.
const USE_MAX = 60; // a design holds a few dozen photos comfortably; more is a delivery, not a design
const USE_LAYOUTS = {
  page: { label: 'A page each', page: 'letter', per: 1, edge: IMAGE_EDGE, name: '' },
  collage: { label: 'Collage', page: 'letter', per: 9, edge: 1600, name: ' collage' },
  strip: { label: 'Photo strips', page: 'photo-4x6', per: 4, edge: 1000, name: ' photo strips' }
};
const useChoice = { which: 'this', layout: 'page' };
const usePicks = () => photos.filter(p => rating(p).flag === 'pick');
function useList(which = useChoice.which) {
  if (which === 'selected') return visible.filter(p => selected.has(p.id));
  if (which === 'picks') return usePicks();
  return [visible[cursor]].filter(Boolean);
}
function paintUse() {
  const counts = { this: useList('this').length, selected: useList('selected').length, picks: useList('picks').length };
  for (const b of $('#use-which').children) {
    const n = counts[b.dataset.which];
    b.disabled = !n || (b.dataset.which === 'selected' && n < 2);
    b.hidden = b.dataset.which === 'selected' && n < 2;
    b.textContent = { this: 'This photo', selected: `The ${n} selected`, picks: `My picks (${n})` }[b.dataset.which];
    b.classList.toggle('on', b.dataset.which === useChoice.which);
  }
  for (const b of $('#use-layout').children) b.classList.toggle('on', b.dataset.layout === useChoice.layout);
  const n = useList().length, layout = USE_LAYOUTS[useChoice.layout], pages = Math.ceil(Math.min(n, USE_MAX) / layout.per);
  $('#use-make').disabled = !n;
  $('#use-note').textContent = !n ? 'Pick some photos first: the ⚑ Pick button marks a favourite.'
    : `${Math.min(n, USE_MAX)} photo${n === 1 ? '' : 's'} → ${pages} page${pages === 1 ? '' : 's'}${useChoice.layout === 'strip' ? ', two strips on each 4 × 6 print to cut apart' : ''}.`
    + (n > USE_MAX ? ` The first ${USE_MAX} go in; that's the most one design holds.` : '');
}
function openUse() {
  if (!dir || !visible[cursor] || sending || delivering) return;
  useChoice.which = selected.size > 1 ? 'selected' : 'this';
  useChoice.layout = useChoice.which === 'this' ? 'page' : 'collage';
  paintUse();
  $('#use-dialog').showModal();
}
for (const b of $('#use-which').children) b.onclick = () => { useChoice.which = b.dataset.which; if (useChoice.which !== 'this' && useChoice.layout === 'page') useChoice.layout = 'collage'; paintUse(); };
for (const b of $('#use-layout').children) b.onclick = () => { useChoice.layout = b.dataset.layout; paintUse(); };
$('#use-close').onclick = () => $('#use-dialog').close();
$('#use-make').onclick = () => { $('#use-dialog').close(); useInDesign(); };
$('#use-in-design').onclick = () => { $('#use-in-design').blur(); openUse(); };

// Where the photos go on a page, as [left, top, width, height] in design pixels, plus anything else on it.
function useCells(layout, count) {
  if (layout === 'collage') { // even rows; a short last row is centred
    const [w, h] = [8.5 * PX, 11 * PX], margin = 36, gap = 12, cols = count <= 3 ? 1 : count <= 6 ? 2 : 3, rows = Math.ceil(count / cols);
    const cw = (w - 2 * margin - (cols - 1) * gap) / cols, ch = (h - 2 * margin - (rows - 1) * gap) / rows;
    return Array.from({ length: count }, (_, i) => {
      const row = Math.floor(i / cols), inRow = row === rows - 1 ? count - row * cols : cols, shift = (cols - inRow) * (cw + gap) / 2;
      return [margin + shift + (i % cols) * (cw + gap), margin + row * (ch + gap), cw, ch];
    });
  }
  // Two strips of four side by side on a 4 × 6, the same photos in each, with room for words at the bottom; all of it
  // inside the dashed safe line, so a home printer's edge doesn't cut a photo or the words.
  const margin = 24, gap = 8, sw = (4 * PX - 3 * margin) / 2, ph = (6 * PX - margin - 64 - 3 * gap) / 4;
  return [0, 1].flatMap(s => Array.from({ length: 4 }, (_, i) => [margin + s * (sw + margin), margin + i * (ph + gap), sw, ph]));
}
async function usePage(layout, pictures) {
  const objects = [];
  if (layout === 'page') {
    const [w, h] = [8.5 * PX, 11 * PX], { url, id } = pictures[0], image = await fabric.FabricImage.fromURL(url), k = Math.min(1, (w * 0.8) / image.width, (h * 0.8) / image.height);
    image.set({ scaleX: k, scaleY: k, kbName: 'Photo ' + id });
    image.setPositionByOrigin(new fabric.Point(w / 2, h / 2), 'center', 'center');
    return { objects: [image.toObject(KEEP)], background: '#ffffff' };
  }
  const cells = useCells(layout, layout === 'collage' ? pictures.length : 4);
  for (const [i, [left, top, width, height]] of cells.entries()) {
    const frame = makeFrame(width, height, 'rect', { left, top }), picture = pictures[layout === 'strip' ? i % 4 : i];
    if (!picture) { objects.push(frame.toObject(KEEP)); continue; } // a short last strip keeps empty frames to drop photos in
    const image = await fabric.FabricImage.fromURL(picture.url);
    image.kbName = 'Photo ' + picture.id;
    objects.push(fitInFrame(image, frame, await faceBox(image)).toObject(KEEP));
  }
  if (layout === 'strip') for (const s of [0, 1]) objects.push(new fabric.Textbox('Say cheese!', { left: cells[s * 4][0], top: 6 * PX - 64, width: cells[0][2], fontSize: 24, fontFamily: 'Caveat', textAlign: 'center', fill: '#333333', kbName: 'Strip words' }).toObject(KEEP));
  return { objects, background: '#ffffff' };
}

// Each photo is developed (one at a time, as the exporter is shared) and shrunk to what the layout needs.
let sending = false;
async function useInDesign() {
  const list = useList().slice(0, USE_MAX), layout = USE_LAYOUTS[useChoice.layout];
  if (!list.length || !dir || sending || delivering) return;
  sending = true;
  const shoot = dir;
  try {
    const pictures = [];
    for (const [i, photo] of list.entries()) {
      status(list.length === 1 ? `Sending ${photo.id} to Create…` : `Sending ${i + 1} of ${list.length} to Create…`);
      pictures.push({ id: photo.id, url: await shrink(await developedJpeg(photo, shoot), layout.edge) });
    }
    const per = useChoice.layout === 'collage' ? Math.ceil(pictures.length / Math.ceil(pictures.length / layout.per)) : layout.per, pages = [];
    for (let first = 0; first < pictures.length; first += per) pages.push(await usePage(useChoice.layout, pictures.slice(first, first + per)));
    const title = list.length === 1 ? 'Photo ' + list[0].id : $('#shoot-name').textContent + (layout.name || ' photos');
    await navigateDesign(async () => {
      startBoard();
      await open({ format: 2, page: layout.page, pages }, await uniqueTitle(title), null);
      commitDesign();
    });
    setMode('create');
    status('');
  } catch (error) { status('Could not send the photos: ' + error, true); } finally { sending = false; }
}
