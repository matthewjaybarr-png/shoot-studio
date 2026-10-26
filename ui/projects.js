// Projects: folders for designs, and a trash, on the start screen and in Create's File menu. Which folder a design is
// in is kept in Create's settings, by design name; the design files themselves never move, so a folder can't lose a
// design or clash with the Templates and Exports folders. A design that's gone from disk simply drops out.
// Needs create.js.
const TRASH = '\u0000trash';                           // the trash view; folder names can't hold control characters
const MAX_FOLDERS = 50, MAX_FOLDER_NAME = 40;
let homeFolder = null;                                 // which designs the start screen shows: null for all, a folder, or TRASH
const validFolder = f => typeof f === 'string' && f === f.trim() && f.length >= 1 && f.length <= MAX_FOLDER_NAME && !/[\x00-\x1f]/.test(f);
const cleanTitle = text => String(text).trim().replace(/[\/\\:*?"<>|\x00-\x1f]/g, '').replace(/^\.+/, '').slice(0, 80);
// Settings read from disk, made safe: known folders only, and no key that could reach an object's prototype.
function cleanProjects(p) {
  const folders = Array.isArray(p?.folders) ? [...new Set(p.folders.filter(validFolder))].slice(0, MAX_FOLDERS) : [];
  const placed = Object.create(null), trash = Object.create(null);
  for (const [name, folder] of Object.entries(p?.placed || {})) if (folders.includes(folder)) placed[name] = folder;
  for (const [name, at] of Object.entries(p?.trash || {})) if (Number.isFinite(at)) trash[name] = at;
  return { folders, placed, trash };
}
const projects = () => settings.projects;
const inTrash = name => name in projects().trash;
const shownHere = d => homeFolder === TRASH ? inTrash(d.name) : !inTrash(d.name) && (homeFolder === null || projects().placed[d.name] === homeFolder);
function setFolder(name, folder) {
  if (folder) projects().placed[name] = folder; else delete projects().placed[name];
  saveSettings();
}
// Called by Create's save when a design is renamed, so it stays in its folder.
function designRenamed(old, name) {
  const p = projects();
  if (old in p.placed) { p.placed[name] = p.placed[old]; delete p.placed[old]; }
  delete p.trash[old];
  saveSettings();
}

// ---- Names: one small dialog for renaming designs and naming folders ----
function askName(title, value = '', check = () => '') {
  const dialog = $('#name-dialog'), input = $('#name-input'), error = $('#name-error'), form = dialog.querySelector('form');
  $('#name-title').textContent = title; input.value = value; error.textContent = ''; dialog.returnValue = '';
  dialog.showModal(); input.select();
  return new Promise(done => {
    form.onsubmit = event => {
      if (event.submitter?.value === 'cancel') return;
      const problem = !input.value.trim() ? 'Type a name' : check(input.value.trim());
      if (problem) { event.preventDefault(); error.textContent = problem; }
    };
    dialog.onclose = () => done(dialog.returnValue === 'ok' ? input.value.trim() : null);
  });
}
const folderProblem = (name, except) => name.length > MAX_FOLDER_NAME ? `Use up to ${MAX_FOLDER_NAME} letters` : /[\x00-\x1f]/.test(name) ? 'That name has a character a folder can\'t use'
  : name !== except && projects().folders.includes(name) ? 'There is already a folder with that name' : projects().folders.length >= MAX_FOLDERS && !except ? `You can have up to ${MAX_FOLDERS} folders` : '';
async function newFolder() {
  const name = await askName('New folder', '', name => folderProblem(name));
  if (!name) return null;
  projects().folders.push(name); saveSettings();
  return name;
}
async function renameFolder(old) {
  const name = await askName('Rename folder', old, name => folderProblem(name, old));
  if (!name || name === old) return;
  const p = projects();
  p.folders[p.folders.indexOf(old)] = name;
  for (const d in p.placed) if (p.placed[d] === old) p.placed[d] = name;
  if (homeFolder === old) homeFolder = name;
  saveSettings(); paintHome();
}
// The folder goes; its designs stay, back under All designs.
function deleteFolder(folder) {
  const p = projects();
  p.folders = p.folders.filter(f => f !== folder);
  for (const d in p.placed) if (p.placed[d] === folder) delete p.placed[d];
  if (homeFolder === folder) homeFolder = null;
  saveSettings(); paintHome();
}

// ---- Designs ----
async function takenNames() { return new Set((await invoke('list_creations', { kind: 'designs' }).catch(() => [])).map(d => d.name)); }
async function copyDesign(name) {
  const text = await invoke('load_creation', { kind: 'designs', name }), title = await uniqueTitle(cleanTitle('Copy of ' + name));
  await invoke('save_creation', new TextEncoder().encode(text), { headers: { kind: 'designs', name: encodeURIComponent(title) } });
  if (projects().placed[name]) setFolder(title, projects().placed[name]);
  return title;
}
async function renameDesign(name) {
  const taken = await takenNames();
  const to = await askName('Rename design', name, text => { const t = cleanTitle(text); return !t ? 'Type a name' : t !== name && taken.has(t) ? 'There is already a design with that name' : ''; });
  const title = to && cleanTitle(to);
  if (!title || title === name) return;
  await invoke('save_creation', new TextEncoder().encode(await invoke('load_creation', { kind: 'designs', name })), { headers: { kind: 'designs', name: encodeURIComponent(title) } });
  await invoke('delete_creation', { kind: 'designs', name });
  designRenamed(name, title);
  if (design && diskName === name) { design.title = diskName = title; $('#create-title').value = title; } // the last design opened
}
function moveToTrash(name) { projects().trash[name] = Math.floor(Date.now() / 1000); saveSettings(); }
function restoreDesign(name) { delete projects().trash[name]; saveSettings(); }
async function deleteForever(names) {
  for (const name of names) {
    await invoke('delete_creation', { kind: 'designs', name });
    delete projects().trash[name]; delete projects().placed[name];
  }
  saveSettings();
}

// ---- The start screen: folder bar, design menus and drag to a folder ----
function homeMenu(x, y, items) {
  const menu = $('#home-menu');
  menu.replaceChildren(...items.map(it => {
    if (it === '-') return document.createElement('hr');
    if (it.heading) return Object.assign(document.createElement('h4'), { textContent: it.heading });
    const b = button(it.label, () => { closeHomeMenu(); it.run(); });
    b.setAttribute('role', 'menuitem'); b.disabled = !!it.disabled;
    if (it.on) b.classList.add('on');
    return b;
  }));
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
  menu.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
}
const closeHomeMenu = () => { $('#home-menu').hidden = true; };
document.addEventListener('pointerdown', e => { if (!$('#home-menu').hidden && !e.target.closest('#home-menu')) closeHomeMenu(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeHomeMenu(); });
const homeError = error => { $('#home-status').textContent = String(error?.message || error); };
const homeAction = work => async () => { let failed = null; try { await work(); } catch (e) { failed = e; } paintHome(); if (failed) homeError(failed); };
function designMenu(name, x, y) {
  if (inTrash(name)) return homeMenu(x, y, [
    { label: 'Restore', run: homeAction(() => restoreDesign(name)) },
    { label: 'Delete forever', run: homeAction(() => deleteForever([name])) }
  ]);
  const p = projects(), here = p.placed[name] || null;
  homeMenu(x, y, [
    { label: 'Open', run: () => openDesign(name).catch(homeError) },
    { label: 'Make a copy', run: homeAction(() => copyDesign(name)) },
    { label: 'Rename', run: homeAction(() => renameDesign(name)) },
    '-', { heading: 'Move to' },
    { label: 'No folder', on: !here, run: homeAction(() => setFolder(name, null)) },
    ...p.folders.map(f => ({ label: f, on: here === f, run: homeAction(() => setFolder(name, f)) })),
    { label: 'New folder…', run: homeAction(async () => { const f = await newFolder(); if (f) setFolder(name, f); }) },
    '-', { label: 'Move to trash', run: homeAction(() => moveToTrash(name)) }
  ]);
}
// A design card: click opens it (in the trash, click offers Restore); ⋯ or a right-click opens its menu.
function designCard(card, name) {
  const more = Object.assign(document.createElement('span'), { className: 'card-more', textContent: '⋯', title: 'More', role: 'button' });
  more.setAttribute('aria-label', `More for ${name}`);
  more.onclick = e => { e.stopPropagation(); const r = more.getBoundingClientRect(); designMenu(name, r.left, r.bottom + 4); };
  card.append(more);
  card.oncontextmenu = e => { e.preventDefault(); designMenu(name, e.clientX, e.clientY); };
  if (inTrash(name)) card.onclick = () => { const r = card.getBoundingClientRect(); designMenu(name, r.left + 8, r.top + 8); };
  else {
    card.draggable = true;
    card.ondragstart = e => { e.dataTransfer.setData('text/x-kb-design', name); e.dataTransfer.effectAllowed = 'move'; };
  }
  return card;
}
function folderChip(label, folder, count) {
  const b = button(label, () => { homeFolder = folder; paintHome(); }, count == null ? '' : String(count));
  b.classList.toggle('on', homeFolder === folder);
  // Drop a design on a folder to move it there; on All designs to take it out; on Trash to throw it away.
  b.ondragover = e => { if (e.dataTransfer.types.includes('text/x-kb-design')) { e.preventDefault(); b.classList.add('drop'); } };
  b.ondragleave = () => b.classList.remove('drop');
  b.ondrop = e => {
    e.preventDefault(); b.classList.remove('drop');
    const name = e.dataTransfer.getData('text/x-kb-design');
    if (!name) return;
    if (folder === TRASH) moveToTrash(name); else setFolder(name, folder);
    paintHome();
  };
  return b;
}
// The folder bar above the designs, and the empty or trash message under it.
function paintFolders(designs) {
  const p = projects(), live = designs.filter(d => !inTrash(d.name)), trashed = designs.length - live.length;
  const count = f => live.filter(d => p.placed[d.name] === f).length;
  const bar = [folderChip('All designs', null, live.length), ...p.folders.map(f => folderChip(f, f, count(f)))];
  bar.push(button('+ New folder', homeAction(async () => { const f = await newFolder(); if (f) homeFolder = f; })));
  if (trashed || homeFolder === TRASH) bar.push(folderChip('Trash', TRASH, trashed));
  if (homeFolder !== null && homeFolder !== TRASH) bar.push(Object.assign(button('Folder ⋯', () => {
    const r = $('#home-folder-more').getBoundingClientRect();
    homeMenu(r.left, r.bottom + 4, [{ label: 'Rename folder', run: () => renameFolder(homeFolder) }, { label: 'Delete folder (keeps its designs)', run: () => deleteFolder(homeFolder) }]);
  }), { id: 'home-folder-more' }));
  if (homeFolder === TRASH && trashed) bar.push(button('Empty trash', homeAction(() => deleteForever(designs.filter(d => inTrash(d.name)).map(d => d.name)))));
  $('#home-folders').replaceChildren(...bar);
  const shown = designs.filter(shownHere).length;
  $('#home-folder-note').textContent = shown ? (homeFolder === TRASH ? 'Designs in the trash stay until you delete them. Click one to restore it.' : '')
    : homeFolder === TRASH ? 'The trash is empty.' : homeFolder === null ? '' : 'Nothing in this folder yet. Drag a design onto the folder above, or use ⋯ on a design → Move to.';
}

// ---- Create's File menu ----
function paintFileMenu() {
  if (!design) return;
  const p = projects(), here = p.placed[design.title] || '', select = $('#file-folder');
  select.replaceChildren(new Option('No folder', ''), ...p.folders.map(f => new Option(f, f)), new Option('New folder…', TRASH));
  select.value = here;
  const pages = designPages.length, size = design.page === 'custom' ? design.size.map(v => +v.toFixed(2)).join(' × ') + ' in' : PAGE_LABEL(design.page);
  $('#file-info').textContent = `${pages === 1 ? 'One page' : pages + ' pages'} · ${size}`;
}
$('#file-open').addEventListener('click', paintFileMenu);
$('#file-new').onclick = () => { closeMenus(); newDesign().catch(e => { $('#create-saved').textContent = 'Could not start a design: ' + (e.message || e); }); };
$('#file-import').onclick = () => { closeMenus(); $('#import-file').click(); };
$('#file-copy').onclick = async () => {
  closeMenus();
  try { await flush(); const title = await copyDesign(diskName || design.title); await openDesign(title); $('#create-saved').textContent = 'This is the copy'; }
  catch (e) { $('#create-saved').textContent = 'Could not copy: ' + (e.message || e); }
};
$('#file-rename').onclick = () => { closeMenus(); $('#create-title').focus(); $('#create-title').select(); };
$('#file-folder').onchange = async e => {
  let folder = e.target.value;
  if (folder === TRASH) { folder = await newFolder(); if (!folder) { paintFileMenu(); return; } }
  setFolder(design.title, folder || null); paintFileMenu();
  $('#create-saved').textContent = folder ? `In the folder “${folder}”` : 'Not in a folder';
};
$('#file-template').onclick = () => { closeMenus(); $('#create-save-template').onclick(); };
$('#file-download').onclick = () => togglePop($('#create .create-bar [data-pop=pop-share]'));
$('#file-trash').onclick = async () => {
  closeMenus();
  const name = design.title;
  try { await navigateDesign(() => setMode('home')); moveToTrash(name); paintHome(); $('#home-status').textContent = `“${name}” is in the trash. Open Trash below to restore it.`; }
  catch (e) { $('#create-saved').textContent = 'Could not move it to the trash: ' + (e.message || e); }
};
