// Backups of everything made in Create (backup.rs): one zip in a folder she chooses, made by hand or automatically
// every day or week when KB Studio starts, with the newest eight kept. The start screen always says when the last one
// was, so a missed backup (a USB stick left out) is noticed. Restoring never overwrites anything. Needs create.js.

const BACKUP_EVERY = { day: 864e5, week: 7 * 864e5 };
const cleanBackup = b => ({
  folder: typeof b?.folder === 'string' ? b.folder.slice(0, 1000) : '',
  every: ['day', 'week', 'off'].includes(b?.every) ? b.every : 'week',
  last: Number.isFinite(b?.last) ? b.last : 0,
  failed: typeof b?.failed === 'string' ? b.failed.slice(0, 300) : ''
});
let backingUp = false;
const backupStamp = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}`;
const folderName = path => path.split(/[\\/]/).filter(Boolean).pop() || path;
function backupAge(last) {
  const days = Math.floor((Date.now() - last) / 864e5);
  return days < 1 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}
// Overdue: automatic backups are on and the last one is more than a day past due (or never happened).
const backupOverdue = b => !b.folder || (b.every !== 'off' && Date.now() - b.last > BACKUP_EVERY[b.every] + 864e5) || !!b.failed;

function paintBackup() {
  const b = settings.backup, line = $('#home-backup');
  const text = !b.folder ? "Your designs aren't backed up yet." : b.failed ? `The last backup didn't work: ${b.failed}` : b.last ? `Designs backed up ${backupAge(b.last)} to ${folderName(b.folder)}.` : `Backups go to ${folderName(b.folder)}.`;
  $('#home-backup-text').textContent = text;
  $('#home-backup-go').textContent = b.folder ? 'Backups…' : 'Set up backups';
  line.classList.toggle('warn', backupOverdue(b));
  $('#backup-folder').textContent = b.folder || 'Not chosen yet';
  $('#backup-every').value = b.every;
  $('#backup-now').disabled = !b.folder || backingUp;
  $('#backup-last').textContent = b.last ? `Last backup: ${new Date(b.last).toLocaleString()}.` : 'No backup yet.';
}
async function backUp(quiet) {
  const b = settings.backup;
  if (!b.folder || backingUp) return;
  backingUp = true; paintBackup();
  if (!quiet) $('#backup-status').textContent = 'Backing up…';
  try {
    const made = await invoke('backup_designs', { folder: b.folder, stamp: backupStamp() });
    Object.assign(b, { last: Date.now(), failed: '' });
    if (!quiet) $('#backup-status').textContent = `Backed up ${made.files} files into ${folderName(made.file)}.`;
  } catch (error) {
    b.failed = String(error?.message || error);
    if (!quiet) $('#backup-status').textContent = `Couldn't back up: ${b.failed}`;
  } finally {
    backingUp = false; saveSettings(); paintBackup();
  }
}
// Called once settings are loaded: an automatic backup when one is due.
function startBackups() {
  const b = settings.backup = cleanBackup(settings.backup);
  paintBackup();
  if (b.folder && b.every !== 'off' && Date.now() - b.last >= BACKUP_EVERY[b.every]) backUp(true);
}
function openBackups() {
  if (typeof closeMenus === 'function') closeMenus();
  $('#backup-status').textContent = '';
  paintBackup(); $('#backup-dialog').showModal();
}
$('#home-backup-go').onclick = openBackups;
$('#file-backup').onclick = openBackups;
$('#backup-close').onclick = () => $('#backup-dialog').close();
$('#backup-choose').onclick = async () => {
  const folder = await invoke('pick_shoot', { title: 'Choose where backups go (a USB stick or a cloud folder)' });
  if (!folder) return;
  Object.assign(settings.backup, { folder, failed: '' }); saveSettings(); paintBackup();
  backUp(false); // the first backup right away, so she sees it work
};
$('#backup-every').onchange = e => { settings.backup.every = e.target.value; saveSettings(); paintBackup(); };
$('#backup-now').onclick = () => backUp(false);
$('#backup-restore').onclick = async () => {
  const file = await invoke('pick_backup');
  if (!file) return;
  $('#backup-status').textContent = 'Restoring…';
  try {
    const r = await invoke('restore_backup', { file });
    const parts = [r.restored && `${r.restored} brought back`, r.beside && `${r.beside} that had changed since put back beside the current ones as “(from backup)”`, r.same && `${r.same} already the same`].filter(Boolean);
    $('#backup-status').textContent = `Restored: ${parts.join(', ') || 'nothing to bring back'}.`;
    const backup = settings.backup;
    await loadSettings(); // restored settings (folders, colours) on a new computer
    settings.backup = backup.folder ? backup : cleanBackup(settings.backup); saveSettings();
    paintBackup(); if (mode === 'home') paintHome();
  } catch (error) {
    $('#backup-status').textContent = `Couldn't restore it: ${error?.message || error}`;
  }
};
