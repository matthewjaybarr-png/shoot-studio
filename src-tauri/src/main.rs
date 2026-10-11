// Shoot Studio backend: list a shoot folder, serve previews, store ratings.
// Originals are only ever opened for reading; all writes go to <shoot>/.shootstudio/.
// The one network call is the update check, made here in Rust; the webview stays offline.
use rawler::formats::tiff::reader::TiffReader;
use rawler::formats::tiff::GenericTiffReader;
use rawler::rawsource::RawSource;
use rawler::tags::TiffCommonTag;
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_updater::{Update, Updater, UpdaterExt};

const STATE_DIR: &str = ".shootstudio";
/// shoot.json format version. Files without one predate it and read as version 1.
/// Bump it only with a migration in `upgrade_shoot`; updates only move forward.
const SHOOT_VERSION: u64 = 1;

#[derive(Serialize, Debug, PartialEq)]
struct Photo {
    id: String,
    jpg: Option<String>,
    raw: Option<String>,
}

/// Group same-stem JPEG/CR2 files into one photo, case-insensitively.
/// Names are sorted first so the id (the rating key) never depends on read_dir order.
fn pair(names: &[String]) -> Vec<Photo> {
    let mut names = names.to_vec();
    names.sort();
    let mut photos: BTreeMap<String, Photo> = BTreeMap::new();
    for name in &names {
        let Some((stem, ext)) = name.rsplit_once('.') else {
            continue;
        };
        let ext = ext.to_ascii_lowercase();
        let is_jpg = ext == "jpg" || ext == "jpeg";
        if !is_jpg && ext != "cr2" {
            continue;
        }
        let photo = photos.entry(stem.to_lowercase()).or_insert_with(|| Photo {
            id: stem.to_owned(),
            jpg: None,
            raw: None,
        });
        if is_jpg {
            photo.jpg = Some(name.clone())
        } else {
            photo.raw = Some(name.clone())
        }
    }
    photos.into_values().collect()
}

/// A bare file name inside the shoot folder; refuses paths and our own state.
fn shoot_file(dir: &str, name: &str) -> Result<PathBuf, String> {
    if name.is_empty()
        || name.starts_with('.')
        || Path::new(name).file_name() != Some(name.as_ref())
    {
        return Err(format!("not a shoot file: {name}"));
    }
    Ok(Path::new(dir).join(name))
}

/// The full-size JPEG Canon stores in CR2 IFD0, found with rawler's TIFF reader (no decode),
/// with its Orientation tag injected as a tiny EXIF block so the webview rotates it like any JPEG.
// ponytail: CR2 only; CR3 is ISO-BMFF and needs rawler's CR3 path when a newer body arrives.
fn cr2_preview(path: &Path) -> Result<Vec<u8>, String> {
    let source =
        RawSource::new(path).map_err(|e| format!("could not open {}: {e}", path.display()))?;
    if source.buf().get(8..10) != Some(b"CR") {
        return Err("not a Canon CR2 file".into());
    }
    let tiff = GenericTiffReader::new_with_buffer(source.buf(), 0, 0, Some(1))
        .map_err(|e| format!("CR2 unreadable: {e}"))?;
    let ifd0 = tiff.root_ifd();
    if !ifd0.contains_singlestrip_image() {
        return Err("CR2 has no embedded preview".into());
    }
    let jpeg = ifd0
        .singlestrip_data_rawsource(&source)
        .map_err(|e| format!("CR2 preview unreadable: {e}"))?;
    if !jpeg.starts_with(&[0xFF, 0xD8]) {
        return Err("CR2 embedded preview is not a JPEG".into());
    }
    let orientation = ifd0
        .get_entry(TiffCommonTag::Orientation)
        .map_or(1, |e| e.value.force_u16(0));
    let mut exif = b"\xFF\xE1\0\x22Exif\0\0II*\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0".to_vec();
    exif.extend_from_slice(&orientation.to_le_bytes());
    exif.extend_from_slice(&[0; 6]);
    Ok([&jpeg[..2], &exif, &jpeg[2..]].concat())
}

/// <shoot>/.shootstudio[/sub], created if missing. Refuses a symlink or non-folder at any
/// level so state can never be redirected outside the shoot.
fn state_dir(dir: &str, sub: Option<&str>) -> Result<PathBuf, String> {
    let mut path = PathBuf::from(dir);
    for part in std::iter::once(STATE_DIR).chain(sub) {
        path.push(part);
        match fs::symlink_metadata(&path) {
            Ok(meta) if meta.is_dir() => {}
            Ok(_) => return Err(format!("{} is not a plain folder", path.display())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => fs::create_dir(&path)
                .map_err(|e| format!("could not create {}: {e}", path.display()))?,
            Err(e) => return Err(format!("could not check {}: {e}", path.display())),
        }
    }
    Ok(path)
}

/// Write via a fresh temp file then rename. create_new never follows an existing link,
/// and rename replaces a link at `path` rather than writing through it.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temp = path.with_extension("tmp");
    let _ = fs::remove_file(&temp); // a leftover from a crash, or a planted link (removes the link only)
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .and_then(|mut file| {
            file.write_all(bytes)?;
            file.sync_all()
        })
        .and_then(|_| fs::rename(&temp, path))
        .map_err(|e| format!("could not save {}: {e}", path.display()))
}

fn thumb_path(dir: &str, name: &str) -> Result<PathBuf, String> {
    shoot_file(dir, name)?;
    Ok(state_dir(dir, Some("thumbs"))?.join(format!("{name}.jpg")))
}

#[tauri::command]
async fn pick_shoot(app: tauri::AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .set_title("Open shoot folder")
        .blocking_pick_folder()?
        .into_path()
        .ok()
        .map(|p| p.display().to_string())
}

/// Development and testing: SHOOT_STUDIO_OPEN=<folder> opens that shoot at startup, skipping the picker.
#[tauri::command]
fn startup_shoot() -> Option<String> {
    std::env::var("SHOOT_STUDIO_OPEN")
        .ok()
        .filter(|dir| !dir.is_empty())
}

#[tauri::command]
fn open_shoot(dir: String) -> Result<Vec<Photo>, String> {
    let names: Vec<String> = fs::read_dir(&dir)
        .map_err(|e| format!("could not open {dir}: {e}"))?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|e| e.file_name().into_string().ok())
        .collect();
    Ok(pair(&names))
}

/// Full preview bytes: the JPEG itself, or the JPEG embedded in a CR2.
#[tauri::command]
fn preview(dir: String, name: String) -> Result<Response, String> {
    let path = shoot_file(&dir, &name)?;
    let bytes = if name.to_ascii_lowercase().ends_with(".cr2") {
        cr2_preview(&path)?
    } else {
        fs::read(&path).map_err(|e| format!("could not read {name}: {e}"))?
    };
    Ok(Response::new(bytes))
}

#[tauri::command]
fn thumb(dir: String, name: String) -> Result<Response, String> {
    fs::read(thumb_path(&dir, &name)?)
        .map(Response::new)
        .map_err(|_| "no thumbnail yet".into())
}

#[tauri::command]
fn save_thumb(dir: String, name: String, data: Vec<u8>) -> Result<(), String> {
    write_atomic(&thumb_path(&dir, &name)?, &data)
}

/// Bring shoot.json up to SHOOT_VERSION. Refuses a file from a newer app rather than
/// risk saving over fields it doesn't know.
fn upgrade_shoot(mut data: Value) -> Result<Value, String> {
    let Some(fields) = data.as_object_mut() else {
        return Err("shoot.json is not an object".into());
    };
    let version = match fields.get("version") {
        None => 1,
        Some(v) => v.as_u64().ok_or("shoot.json has a bad version")?,
    };
    if version > SHOOT_VERSION {
        return Err(format!(
            "this shoot was saved by a newer Shoot Studio (format {version}); update the app to open it"
        ));
    }
    fields.insert("version".into(), SHOOT_VERSION.into());
    Ok(data)
}

#[tauri::command]
fn load_shoot(dir: String) -> Result<Value, String> {
    match fs::read_to_string(state_dir(&dir, None)?.join("shoot.json")) {
        Ok(text) => upgrade_shoot(
            serde_json::from_str(&text).map_err(|e| format!("shoot.json is unreadable: {e}"))?,
        ),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Value::Null),
        Err(e) => Err(format!("could not read shoot.json: {e}")),
    }
}

#[tauri::command]
fn save_shoot(dir: String, data: Value) -> Result<(), String> {
    let text = serde_json::to_string_pretty(&upgrade_shoot(data)?).map_err(|e| e.to_string())?;
    write_atomic(&state_dir(&dir, None)?.join("shoot.json"), text.as_bytes())
}

#[tauri::command]
fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

/// The update found at launch, kept until the user clicks "Update now".
#[derive(Default)]
struct PendingUpdate(Mutex<Option<Update>>);

/// Testing: SHOOT_STUDIO_UPDATE_URL=<https latest.json url> checks there instead and accepts a
/// self-signed certificate. The download must still carry a signature from our key.
fn updater(app: &AppHandle) -> tauri_plugin_updater::Result<Updater> {
    let builder = app.updater_builder();
    match std::env::var("SHOOT_STUDIO_UPDATE_URL") {
        Ok(url) if !url.is_empty() => builder
            .endpoints(vec![url.parse::<tauri::Url>()?])?
            .configure_client(|client| client.danger_accept_invalid_certs(true))
            .build(),
        _ => builder.build(),
    }
}

/// The newer version on offer, if any. Offline or any other failure shows nothing.
#[tauri::command]
async fn check_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<Option<String>, String> {
    let update = match updater(&app) {
        Ok(updater) => updater.check().await.unwrap_or_default(),
        Err(_) => None,
    };
    let version = update.as_ref().map(|u| u.version.clone());
    *pending.0.lock().unwrap() = update;
    Ok(version)
}

/// Download, verify the signature, replace the AppImage, then restart. Only on the user's click.
/// `progress` gets whole percents while downloading.
#[tauri::command]
async fn install_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
    progress: Channel<u64>,
) -> Result<(), String> {
    let update = pending.0.lock().unwrap().clone().ok_or("no update to install")?;
    let mut got = 0u64;
    update
        .download_and_install(
            |chunk, total| {
                got += chunk as u64;
                if let Some(total) = total.filter(|t| *t > 0) {
                    let _ = progress.send(got * 100 / total);
                }
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    app.restart()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PendingUpdate::default())
        .invoke_handler(tauri::generate_handler![
            app_version,
            check_update,
            install_update,
            pick_shoot,
            startup_shoot,
            open_shoot,
            preview,
            thumb,
            save_thumb,
            load_shoot,
            save_shoot
        ])
        .run(tauri::generate_context!())
        .expect("error while running Shoot Studio");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn photo(id: &str, jpg: Option<&str>, raw: Option<&str>) -> Photo {
        Photo {
            id: id.into(),
            jpg: jpg.map(Into::into),
            raw: raw.map(Into::into),
        }
    }

    #[test]
    fn pairs_raw_and_jpeg_case_insensitively() {
        let names = [
            "IMG_0002.cr2",
            "IMG_0001.JPG",
            "notes.txt",
            "IMG_0001.CR2",
            "img_0002.Jpeg",
            "IMG_0003.jpg",
            "README",
        ];
        let got = pair(&names.map(String::from));
        let mut reversed = names.map(String::from);
        reversed.reverse();
        assert_eq!(pair(&reversed), got, "ids do not depend on folder order");
        assert_eq!(
            pair(&["img_9.jpg".into(), "IMG_9.CR2".into()]),
            pair(&["IMG_9.CR2".into(), "img_9.jpg".into()])
        );
        assert_eq!(
            got,
            vec![
                photo("IMG_0001", Some("IMG_0001.JPG"), Some("IMG_0001.CR2")),
                photo("IMG_0002", Some("img_0002.Jpeg"), Some("IMG_0002.cr2")),
                photo("IMG_0003", Some("IMG_0003.jpg"), None),
            ]
        );
    }

    #[test]
    fn refuses_paths_outside_the_shoot() {
        for bad in ["../x.jpg", "a/b.jpg", "/etc/passwd", ".shootstudio", ""] {
            assert!(shoot_file("/shoot", bad).is_err(), "{bad}");
        }
        assert!(shoot_file("/shoot", "IMG_1.CR2").is_ok());
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("shoot-studio-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Minimal CR2: header, IFD0 with orientation 6 and a strip pointing at a JPEG.
    fn fake_cr2(jpeg: &[u8]) -> Vec<u8> {
        let mut f = b"II*\0\x10\0\0\0CR\x02\0\0\0\0\0".to_vec();
        let data_at = 16 + 2 + 3 * 12 + 4;
        f.extend_from_slice(&3u16.to_le_bytes());
        for (tag, kind, value) in [
            (0x0111u16, 4u16, data_at as u32),
            (0x0112, 3, 6),
            (0x0117, 4, jpeg.len() as u32),
        ] {
            f.extend_from_slice(&tag.to_le_bytes());
            f.extend_from_slice(&kind.to_le_bytes());
            f.extend_from_slice(&1u32.to_le_bytes());
            f.extend_from_slice(&value.to_le_bytes());
        }
        f.extend_from_slice(&[0; 4]);
        f.extend_from_slice(jpeg);
        f
    }

    #[test]
    fn extracts_cr2_preview_with_orientation() {
        let dir = temp_dir("cr2");
        let jpeg = b"\xFF\xD8\xFF\xDBpixels\xFF\xD9";
        fs::write(dir.join("a.CR2"), fake_cr2(jpeg)).unwrap();
        let out = cr2_preview(&dir.join("a.CR2")).unwrap();
        assert_eq!(&out[..2], b"\xFF\xD8");
        assert_eq!(&out[2..4], b"\xFF\xE1");
        let app1 = 4 + u16::from_be_bytes([out[4], out[5]]) as usize;
        assert_eq!(&out[6..12], b"Exif\0\0");
        assert_eq!(
            u16::from_le_bytes([out[30], out[31]]),
            6,
            "orientation value"
        );
        assert_eq!(
            &out[app1..],
            &jpeg[2..],
            "rest of the JPEG follows the EXIF block"
        );
        fs::write(dir.join("b.CR2"), b"II*\0\x10\0\0\0XX").unwrap();
        assert!(cr2_preview(&dir.join("b.CR2")).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn ratings_persist_and_originals_stay_untouched() {
        let dir = temp_dir("state");
        let d = dir.display().to_string();
        let originals = [
            ("IMG_1.JPG", b"\xFF\xD8one".to_vec()),
            ("IMG_1.CR2", fake_cr2(b"\xFF\xD8two")),
            ("IMG_2.jpg", b"\xFF\xD8three".to_vec()),
        ];
        for (name, bytes) in &originals {
            fs::write(dir.join(name), bytes).unwrap();
        }
        assert_eq!(load_shoot(d.clone()).unwrap(), Value::Null);
        assert_eq!(open_shoot(d.clone()).unwrap().len(), 2);
        let state =
            serde_json::json!({"version": 1, "ratings": {"IMG_1": {"flag": "pick", "stars": 4}}});
        save_shoot(d.clone(), state.clone()).unwrap();
        save_thumb(d.clone(), "IMG_1.JPG".into(), vec![1, 2, 3]).unwrap();
        preview(d.clone(), "IMG_1.CR2".into()).unwrap();
        preview(d.clone(), "IMG_2.jpg".into()).unwrap();
        assert_eq!(
            load_shoot(d.clone()).unwrap(),
            state,
            "ratings survive a reload"
        );
        assert!(
            !dir.join(STATE_DIR).join("shoot.tmp").exists(),
            "no temp file left behind"
        );
        for (name, bytes) in &originals {
            assert_eq!(&fs::read(dir.join(name)).unwrap(), bytes, "{name} changed");
        }
        assert!(save_thumb(d.clone(), "../escape".into(), vec![1]).is_err());
        assert_eq!(
            open_shoot(d).unwrap().len(),
            2,
            "state folder is not listed as photos"
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn shoot_json_without_a_version_loads_and_gains_one() {
        let dir = temp_dir("version");
        let d = dir.display().to_string();
        let file = state_dir(&d, None).unwrap().join("shoot.json");
        fs::write(&file, r#"{"ratings": {"IMG_1": {"flag": "pick"}}}"#).unwrap();
        let loaded = load_shoot(d.clone()).unwrap();
        assert_eq!(
            loaded,
            serde_json::json!({"version": 1, "ratings": {"IMG_1": {"flag": "pick"}}})
        );
        save_shoot(d.clone(), serde_json::json!({"ratings": {}})).unwrap();
        let saved: Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(saved["version"], SHOOT_VERSION, "saving stamps the version");

        let newer = r#"{"version": 99, "ratings": {}, "develop": {}}"#;
        fs::write(&file, newer).unwrap();
        assert!(load_shoot(d.clone()).unwrap_err().contains("newer Shoot Studio"));
        assert!(save_shoot(d.clone(), serde_json::json!({"version": 99})).is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), newer, "a newer file is left alone");
        for bad in [r#"[]"#, r#"{"version": "one"}"#] {
            fs::write(&file, bad).unwrap();
            assert!(load_shoot(d.clone()).is_err(), "{bad}");
        }
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn state_symlinks_cannot_redirect_writes() {
        use std::os::unix::fs::symlink;
        let (dir, outside) = (temp_dir("links"), temp_dir("outside"));
        let d = dir.display().to_string();
        fs::write(dir.join("IMG_1.JPG"), b"original").unwrap();
        let state = serde_json::json!({"version": 1, "ratings": {}});

        symlink(&outside, dir.join(STATE_DIR)).unwrap();
        assert!(save_shoot(d.clone(), state.clone()).is_err());
        assert!(save_thumb(d.clone(), "IMG_1.JPG".into(), vec![1]).is_err());
        assert!(load_shoot(d.clone()).is_err());
        assert_eq!(
            fs::read_dir(&outside).unwrap().count(),
            0,
            "nothing written outside"
        );
        fs::remove_file(dir.join(STATE_DIR)).unwrap();

        fs::create_dir_all(dir.join(STATE_DIR)).unwrap();
        symlink(&outside, dir.join(STATE_DIR).join("thumbs")).unwrap();
        assert!(save_thumb(d.clone(), "IMG_1.JPG".into(), vec![1]).is_err());
        assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
        fs::remove_file(dir.join(STATE_DIR).join("thumbs")).unwrap();

        // A planted temp file pointing at an original must not be written through.
        symlink(dir.join("IMG_1.JPG"), dir.join(STATE_DIR).join("shoot.tmp")).unwrap();
        save_shoot(d.clone(), state.clone()).unwrap();
        assert_eq!(fs::read(dir.join("IMG_1.JPG")).unwrap(), b"original");
        assert_eq!(load_shoot(d.clone()).unwrap(), state);

        // shoot.json itself as a link: the save replaces the link, not the original.
        fs::remove_file(dir.join(STATE_DIR).join("shoot.json")).unwrap();
        symlink(
            dir.join("IMG_1.JPG"),
            dir.join(STATE_DIR).join("shoot.json"),
        )
        .unwrap();
        save_shoot(d, state).unwrap();
        assert_eq!(fs::read(dir.join("IMG_1.JPG")).unwrap(), b"original");
        fs::remove_dir_all(dir).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    /// Width x height from a JPEG's first SOF marker.
    fn jpeg_size(b: &[u8]) -> Option<(u16, u16)> {
        let mut i = 2;
        while i + 9 < b.len() {
            let (marker, len) = (b[i + 1], u16::from_be_bytes([b[i + 2], b[i + 3]]) as usize);
            if (0xC0..=0xC3).contains(&marker) {
                return Some((
                    u16::from_be_bytes([b[i + 7], b[i + 8]]),
                    u16::from_be_bytes([b[i + 5], b[i + 6]]),
                ));
            }
            i += 2 + len;
        }
        None
    }

    /// Read-only check against a real shoot: SHOOT_DIR=/path cargo test --release real_shoot -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_shoot() {
        let dir = std::env::var("SHOOT_DIR").expect("set SHOOT_DIR");
        // The live app may have left state here; reading must not change it.
        fn listing(dir: &Path, out: &mut Vec<(PathBuf, u64, std::time::SystemTime)>) {
            for e in fs::read_dir(dir).into_iter().flatten().flatten() {
                let m = e.metadata().unwrap();
                if m.is_dir() {
                    listing(&e.path(), out);
                }
                out.push((e.path(), m.len(), m.modified().unwrap()));
            }
            out.sort();
        }
        let state = Path::new(&dir).join(STATE_DIR);
        let (mut before, mut after) = (vec![], vec![]);
        listing(&state, &mut before);
        let existed = state.exists();
        let photos = open_shoot(dir.clone()).unwrap();
        let start = std::time::Instant::now();
        for p in &photos {
            for name in p.raw.iter().chain(&p.jpg) {
                let path = shoot_file(&dir, name).unwrap();
                let bytes = if name.to_ascii_lowercase().ends_with(".cr2") {
                    cr2_preview(&path).unwrap()
                } else {
                    fs::read(&path).unwrap()
                };
                let orientation = if bytes[2..4] == [0xFF, 0xE1] && &bytes[6..10] == b"Exif" {
                    bytes[30]
                } else {
                    0
                };
                let (w, h) = jpeg_size(&bytes).expect(name);
                println!(
                    "{name}: {w}x{h}, {} KB{}",
                    bytes.len() / 1024,
                    if orientation > 0 {
                        format!(", orientation {orientation}")
                    } else {
                        String::new()
                    }
                );
            }
        }
        println!(
            "{} photos, all previews read in {:.1}s",
            photos.len(),
            start.elapsed().as_secs_f32()
        );
        listing(&state, &mut after);
        assert_eq!(state.exists(), existed, "state dir created");
        assert!(before == after, "state dir changed");
    }
}
