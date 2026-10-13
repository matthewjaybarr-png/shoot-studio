//! Create: designs and templates are one JSON file each (images embedded) in `~/Documents/KB Studio/`.
//! Exports and print copies go to `Exports/` there. Every write lands whole or not at all.

use std::fs;
use std::path::{Path, PathBuf};

const MAX_NAME: usize = 80;
/// Designs hold their images, so allow big files, but not a runaway one.
pub const MAX_BYTES: usize = 200 * 1024 * 1024;

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct Entry {
    pub name: String,
    /// Seconds since 1970 when the file last changed.
    pub modified: u64,
}

/// Which folder a call is for: your designs, your templates, or exported files.
pub fn folder(root: &Path, kind: &str) -> Result<PathBuf, String> {
    match kind {
        "designs" => Ok(root.to_path_buf()),
        "templates" => Ok(root.join("Templates")),
        "exports" => Ok(root.join("Exports")),
        _ => Err("unknown folder".into()),
    }
}

/// A name that is safe as a file name: no separators, no leading dot, not empty.
pub fn clean(name: &str) -> Result<String, String> {
    let name = name.trim();
    let bad = |c: char| c.is_control() || "/\\:*?\"<>|".contains(c);
    if name.is_empty() || name.chars().count() > MAX_NAME || name.starts_with('.') || name.chars().any(bad) {
        return Err("a name needs 1–80 characters, no slashes or leading dot".into());
    }
    Ok(name.to_string())
}

/// Write `name.<ext>` whole or not at all: a temp file next to it, then a rename.
pub fn write(dir: &Path, name: &str, ext: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let name = clean(name)?;
    if bytes.len() > MAX_BYTES {
        return Err("that file is too big".into());
    }
    fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    let path = dir.join(format!("{name}.{ext}"));
    write_with(&path, |file| std::io::Write::write_all(file, bytes))?;
    Ok(path)
}

/// The write itself, with the filling of the temp file passed in so a test can fail it halfway.
fn write_with(path: &Path, fill: impl FnOnce(&mut fs::File) -> std::io::Result<()>) -> Result<(), String> {
    let temp = path.with_extension("part");
    let _ = fs::remove_file(&temp); // left by a crash
    let result = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .and_then(|mut file| {
            fill(&mut file)?;
            file.sync_all()
        })
        .and_then(|_| fs::rename(&temp, path));
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(|e| format!("could not save {}: {e}", path.display()))
}

pub fn read(dir: &Path, name: &str) -> Result<Vec<u8>, String> {
    let path = dir.join(format!("{}.json", clean(name)?));
    fs::read(&path).map_err(|e| format!("could not open {}: {e}", path.display()))
}

pub fn delete(dir: &Path, name: &str) -> Result<(), String> {
    let path = dir.join(format!("{}.json", clean(name)?));
    match fs::remove_file(&path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(format!("could not delete {}: {e}", path.display())),
        _ => Ok(()),
    }
}

/// The `.json` files in `dir`, newest first. A missing folder is an empty list.
pub fn list(dir: &Path) -> Vec<Entry> {
    let Ok(read) = fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<Entry> = read
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            let name = path.file_name()?.to_str()?.strip_suffix(".json")?.to_string();
            let meta = e.metadata().ok().filter(|m| m.is_file())?;
            let modified = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
            Some(Entry { name, modified })
        })
        .collect();
    out.sort_by(|a, b| b.modified.cmp(&a.modified).then(a.name.cmp(&b.name)));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kb-studio-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn a_design_round_trips_and_lists() {
        let root = scratch("create-roundtrip");
        let json = r#"{"format":1,"canvas":{"objects":[{"type":"Textbox","text":"Café ❤"}]}}"#.as_bytes();
        write(&root, "Spelling test", "json", json).unwrap();
        write(&root.join("Templates"), "Word wall", "json", b"{}").unwrap();
        assert_eq!(read(&root, "Spelling test").unwrap(), json);
        let names: Vec<_> = list(&root).into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["Spelling test"], "templates are in their own folder");
        delete(&root, "Spelling test").unwrap();
        delete(&root, "Spelling test").unwrap();
        assert!(list(&root).is_empty() && list(&root.join("missing")).is_empty());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_failed_or_crashed_write_keeps_the_old_file() {
        let root = scratch("create-crash");
        write(&root, "Chart", "json", b"old design").unwrap();
        let path = root.join("Chart.json");
        // A write that dies halfway through filling its temp file.
        let failed = write_with(&path, |file| {
            std::io::Write::write_all(file, b"new des")?;
            Err(std::io::Error::other("disk full"))
        });
        assert!(failed.is_err());
        assert_eq!(fs::read(&path).unwrap(), b"old design");
        assert!(!path.with_extension("part").exists(), "the half file is cleaned up");
        // A crash leaves its half file behind: the old design still opens, and the next save works.
        fs::write(path.with_extension("part"), b"new des").unwrap();
        assert_eq!(read(&root, "Chart").unwrap(), b"old design");
        write(&root, "Chart", "json", b"newer design").unwrap();
        assert_eq!(read(&root, "Chart").unwrap(), b"newer design");
        assert_eq!(list(&root).len(), 1, "the half file is never listed");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn names_cannot_escape_the_folder() {
        for bad in ["", "  ", "../x", "a/b", ".hidden", "a\\b", "x\0y", &"n".repeat(81)] {
            assert!(clean(bad).is_err(), "{bad:?}");
        }
        assert_eq!(clean("  Ms. Smith's chart ").unwrap(), "Ms. Smith's chart");
        assert!(folder(Path::new("/d"), "elsewhere").is_err());
    }
}
