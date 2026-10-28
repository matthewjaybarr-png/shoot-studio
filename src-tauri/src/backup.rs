//! Backups of everything made in Create: designs, templates, saved elements and class lists from `~/Documents/KB
//! Studio/`, and the settings files (saved colours, folders, presets), as one zip in a folder she chooses (a USB stick
//! or a cloud folder). Exports are left out, since they can be made again. The newest `KEEP` backups are kept.
//!
//! Restoring never overwrites: a file that isn't there comes back as it was, an identical one is skipped, and one that
//! changed since comes back beside it as "Name (from backup).ext". Settings files come back only where there are none
//! (a new computer), since they change all the time.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use crate::creations;

pub const KEEP: usize = 8;
const PREFIX: &str = "KB Studio backup ";
const DESIGNS: &str = "KB Studio/";
const SETTINGS: &str = "Settings/";
/// Folders under the designs root that aren't backed up.
const SKIP: [&str; 1] = ["Exports"];

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct Made {
    pub file: String,
    pub files: usize,
}

#[derive(serde::Serialize, Debug, PartialEq, Default)]
pub struct Restored {
    /// Files that weren't there and came back.
    pub restored: usize,
    /// Files that had changed since, put back beside the current one.
    pub beside: usize,
    /// Files already the same.
    pub same: usize,
}

/// Every file to back up, as (name in the zip, path on disk).
fn gather(root: &Path, config: &Path) -> Vec<(String, PathBuf)> {
    fn walk(dir: &Path, rel: &str, top: bool, out: &mut Vec<(String, PathBuf)>) {
        let Ok(entries) = fs::read_dir(dir) else { return };
        let mut entries: Vec<_> = entries.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let name = e.file_name().to_string_lossy().into_owned();
            // hidden files and half-written temp files (creations::write's ".part") stay out
            if name.starts_with('.') || name.ends_with(".part") || (top && SKIP.contains(&name.as_str())) {
                continue;
            }
            let Ok(kind) = e.file_type() else { continue };
            if kind.is_dir() {
                walk(&e.path(), &format!("{rel}{name}/"), false, out);
            } else if kind.is_file() {
                out.push((format!("{rel}{name}"), e.path()));
            }
        }
    }
    let mut files = Vec::new();
    walk(root, DESIGNS, true, &mut files);
    // settings: only the files at the top of the settings folder
    if let Ok(entries) = fs::read_dir(config) {
        let mut entries: Vec<_> = entries.flatten().filter(|e| e.file_type().is_ok_and(|t| t.is_file())).collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let name = e.file_name().to_string_lossy().into_owned();
            if !name.starts_with('.') && !name.ends_with(".part") && !name.ends_with(".tmp") {
                files.push((format!("{SETTINGS}{name}"), e.path()));
            }
        }
    }
    files
}

/// Back up into `dest` as "KB Studio backup <stamp>.zip" (written whole or not at all), then keep only the newest
/// `KEEP` backups there. `stamp` is the local date and time, from the page.
pub fn back_up(root: &Path, config: &Path, dest: &Path, stamp: &str) -> Result<Made, String> {
    if !dest.is_dir() {
        return Err(format!("the backup folder isn't there ({}). If it's a USB stick, plug it in.", dest.display()));
    }
    let name = creations::clean(&format!("{PREFIX}{stamp}"))?;
    let files = gather(root, config);
    let path = dest.join(format!("{name}.zip"));
    let temp = dest.join(format!(".{name}.zip.{}.part", std::process::id()));
    let result = (|| -> Result<(), String> {
        let file = fs::File::create(&temp).map_err(|e| format!("could not write to the backup folder: {e}"))?;
        let mut zip = zip::ZipWriter::new(std::io::BufWriter::new(file));
        let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).large_file(true);
        zip.start_file("README.txt", options).map_err(|e| e.to_string())?;
        zip.write_all(b"A KB Studio backup. To bring it back: in KB Studio, File > Back up my designs > Restore from a backup.\n\nKB Studio/ holds the designs, templates, saved elements and class lists; Settings/ holds saved colours, folders and presets.\n").map_err(|e| e.to_string())?;
        for (name, path) in &files {
            let mut source = match fs::File::open(path) {
                Ok(f) => f,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue, // deleted while backing up
                Err(e) => return Err(format!("could not read {}: {e}", path.display())),
            };
            zip.start_file(name.as_str(), options).map_err(|e| e.to_string())?;
            std::io::copy(&mut source, &mut zip).map_err(|e| format!("could not back up {name}: {e}"))?;
        }
        let mut out = zip.finish().map_err(|e| e.to_string())?;
        out.flush().map_err(|e| format!("could not finish the backup: {e}"))?;
        out.get_ref().sync_all().map_err(|e| format!("could not finish the backup: {e}"))?;
        Ok(())
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&temp);
        return Err(e);
    }
    fs::rename(&temp, &path).map_err(|e| {
        let _ = fs::remove_file(&temp);
        format!("could not finish the backup: {e}")
    })?;
    prune(dest, &path);
    Ok(Made { file: path.display().to_string(), files: files.len() })
}

/// Remove all but the newest `KEEP` backups (by name, which starts with the date), never the one just made.
fn prune(dest: &Path, made: &Path) {
    let Ok(entries) = fs::read_dir(dest) else { return };
    let mut backups: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with(PREFIX) && n.ends_with(".zip")))
        .collect();
    backups.sort();
    let extra = backups.len().saturating_sub(KEEP);
    for old in backups.into_iter().take(extra) {
        if old != made {
            let _ = fs::remove_file(old);
        }
    }
}

/// "Name.ext" → "Name (from backup).ext", numbered if that is taken too.
fn beside(path: &Path) -> PathBuf {
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    let dir = path.parent().unwrap_or(Path::new(""));
    (1..)
        .map(|n| dir.join(if n == 1 { format!("{stem} (from backup){ext}") } else { format!("{stem} (from backup {n}){ext}") }))
        .find(|p| !p.exists())
        .expect("a free name")
}

/// Bring a backup back without overwriting anything.
pub fn restore(zip_path: &Path, root: &Path, config: &Path) -> Result<Restored, String> {
    let file = fs::File::open(zip_path).map_err(|e| format!("could not open the backup: {e}"))?;
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(file)).map_err(|_| "that file isn't a KB Studio backup".to_string())?;
    let mut done = Restored::default();
    let mut found = false;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| format!("the backup is damaged: {e}"))?;
        if entry.is_dir() {
            continue;
        }
        let Some(name) = entry.enclosed_name() else { continue }; // no ../ or absolute paths
        let name = name.to_string_lossy().replace('\\', "/");
        let (target, setting) = if let Some(rel) = name.strip_prefix(DESIGNS) {
            (root.join(rel), false)
        } else if let Some(rel) = name.strip_prefix(SETTINGS) {
            if rel.contains('/') {
                continue;
            }
            (config.join(rel), true)
        } else {
            continue;
        };
        found = true;
        // settings change all the time (the last backup's date is one), so ones already here are kept as they are
        if setting && target.exists() {
            continue;
        }
        if entry.size() as usize > creations::MAX_BYTES {
            return Err(format!("{name} in the backup is too big"));
        }
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut bytes).map_err(|e| format!("the backup is damaged ({name}): {e}"))?;
        let to = match fs::read(&target) {
            Ok(current) if current == bytes => {
                done.same += 1;
                continue;
            }
            Ok(_) => {
                done.beside += 1;
                beside(&target)
            }
            Err(_) => {
                done.restored += 1;
                target
            }
        };
        let dir = to.parent().ok_or("a bad name in the backup")?;
        fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
        let file_name = to.file_name().and_then(|n| n.to_str()).ok_or("a bad name in the backup")?;
        let (stem, ext) = file_name.rsplit_once('.').unwrap_or((file_name, ""));
        if ext.is_empty() {
            fs::write(&to, &bytes).map_err(|e| format!("could not restore {name}: {e}"))?;
        } else {
            creations::write(dir, stem, ext, &bytes).map_err(|e| format!("could not restore {name}: {e}"))?;
        }
    }
    if !found {
        return Err("that file isn't a KB Studio backup".into());
    }
    Ok(done)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kb-backup-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn setup(name: &str) -> (PathBuf, PathBuf, PathBuf, PathBuf) {
        let base = temp(name);
        let (root, config, dest) = (base.join("KB Studio"), base.join("config"), base.join("usb"));
        for d in [&root, &root.join("Classes"), &root.join("Exports"), &config, &dest] {
            fs::create_dir_all(d).unwrap();
        }
        fs::write(root.join("Poster.json"), b"{\"poster\":1}").unwrap();
        fs::write(root.join("Classes/Room 12.json"), b"[\"Ava\"]").unwrap();
        fs::write(root.join("Exports/Poster.pdf"), b"pdf").unwrap();
        fs::write(root.join(".Poster.json.1-0.part"), b"half").unwrap();
        fs::write(config.join("create.json"), b"{\"seen\":27}").unwrap();
        (base, root, config, dest)
    }

    fn names(zip: &Path) -> Vec<String> {
        let mut z = zip::ZipArchive::new(fs::File::open(zip).unwrap()).unwrap();
        (0..z.len()).map(|i| z.by_index(i).unwrap().name().unwrap().to_string()).collect()
    }

    #[test]
    fn backs_up_designs_classes_and_settings_but_not_exports() {
        let (base, root, config, dest) = setup("make");
        let made = back_up(&root, &config, &dest, "2026-10-28 09-00").unwrap();
        assert_eq!(made.files, 3);
        let zip = dest.join("KB Studio backup 2026-10-28 09-00.zip");
        assert_eq!(made.file, zip.display().to_string());
        let mut got = names(&zip);
        got.sort();
        assert_eq!(got, ["KB Studio/Classes/Room 12.json", "KB Studio/Poster.json", "README.txt", "Settings/create.json"]);
        assert!(fs::read_dir(&dest).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().ends_with(".part")), "no temp file left");
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn a_missing_folder_says_so() {
        let (base, root, config, _) = setup("missing");
        let err = back_up(&root, &config, &base.join("unplugged"), "2026-10-28 09-00").unwrap_err();
        assert!(err.contains("plug it in"), "{err}");
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn keeps_the_newest_eight() {
        let (base, root, config, dest) = setup("prune");
        fs::write(dest.join("holiday.zip"), b"not ours").unwrap();
        for day in 1..=10 {
            back_up(&root, &config, &dest, &format!("2026-10-{day:02} 09-00")).unwrap();
        }
        let mut left: Vec<String> = fs::read_dir(&dest).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        left.sort();
        assert_eq!(left.len(), KEEP + 1);
        assert_eq!(left[0], "KB Studio backup 2026-10-03 09-00.zip");
        assert!(left.contains(&"holiday.zip".to_string()), "other files are left alone");
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn restore_brings_back_what_is_gone_and_never_overwrites() {
        let (base, root, config, dest) = setup("restore");
        back_up(&root, &config, &dest, "2026-10-28 09-00").unwrap();
        let zip = dest.join("KB Studio backup 2026-10-28 09-00.zip");
        // the class list is lost, the poster changed, and the settings changed (as they always do)
        fs::remove_file(root.join("Classes/Room 12.json")).unwrap();
        fs::write(root.join("Poster.json"), b"{\"poster\":2}").unwrap();
        fs::write(config.join("create.json"), b"{\"seen\":28}").unwrap();
        let done = restore(&zip, &root, &config).unwrap();
        assert_eq!(done, Restored { restored: 1, beside: 1, same: 0 });
        assert_eq!(fs::read(config.join("create.json")).unwrap(), b"{\"seen\":28}", "settings already here are kept");
        assert!(!config.join("create (from backup).json").exists());
        assert_eq!(fs::read(root.join("Classes/Room 12.json")).unwrap(), b"[\"Ava\"]");
        assert_eq!(fs::read(root.join("Poster.json")).unwrap(), b"{\"poster\":2}", "the newer poster stays");
        assert_eq!(fs::read(root.join("Poster (from backup).json")).unwrap(), b"{\"poster\":1}");
        // restoring again only adds a second copy beside the changed one
        let again = restore(&zip, &root, &config).unwrap();
        assert_eq!(again, Restored { restored: 0, beside: 1, same: 1 });
        assert!(root.join("Poster (from backup 2).json").exists());
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn restore_onto_a_new_computer_brings_everything() {
        let (base, root, config, dest) = setup("fresh");
        back_up(&root, &config, &dest, "2026-10-28 09-00").unwrap();
        let (root2, config2) = (base.join("new/KB Studio"), base.join("new/config"));
        let done = restore(&dest.join("KB Studio backup 2026-10-28 09-00.zip"), &root2, &config2).unwrap();
        assert_eq!(done.restored, 3);
        assert_eq!(fs::read(config2.join("create.json")).unwrap(), b"{\"seen\":27}");
        assert!(root2.join("Classes/Room 12.json").exists());
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn other_zips_are_refused() {
        let base = temp("other");
        let path = base.join("photos.zip");
        let mut z = zip::ZipWriter::new(fs::File::create(&path).unwrap());
        z.start_file("IMG_0001.jpg", zip::write::SimpleFileOptions::default()).unwrap();
        z.write_all(b"jpg").unwrap();
        z.finish().unwrap();
        let err = restore(&path, &base.join("root"), &base.join("config")).unwrap_err();
        assert!(err.contains("isn't a KB Studio backup"), "{err}");
        assert!(!base.join("root").exists(), "nothing is written");
        fs::remove_dir_all(base).unwrap();
    }
}
