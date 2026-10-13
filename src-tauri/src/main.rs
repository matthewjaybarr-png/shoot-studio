// Shoot Studio backend: list a shoot folder, serve previews and RAW pixels, store ratings and edits.
// Originals are only ever opened for reading; all writes go to <shoot>/.shootstudio/.
// The one network call is the update check, made here in Rust; the webview stays offline.
#[allow(dead_code)] // copied whole; not every function is used yet
mod creations;
mod photocraft;
mod retouch;

use rawler::formats::tiff::reader::TiffReader;
use rawler::formats::tiff::GenericTiffReader;
use rawler::rawsource::RawSource;
use rawler::tags::TiffCommonTag;
use retouch::{Retouching, Session, Stroke};
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_updater::{Update, Updater, UpdaterExt};

const STATE_DIR: &str = ".shootstudio";
/// shoot.json format version. Files without one predate it and read as version 1.
/// Bump it only with a migration in `upgrade`; updates only move forward.
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
    let (source, tiff) = cr2_open(path)?;
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
    let orientation = cr2_orientation(&tiff);
    let mut exif = b"\xFF\xE1\0\x22Exif\0\0II*\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0".to_vec();
    exif.extend_from_slice(&orientation.to_le_bytes());
    exif.extend_from_slice(&[0; 6]);
    Ok([&jpeg[..2], &exif, &jpeg[2..]].concat())
}

fn cr2_open(path: &Path) -> Result<(RawSource, GenericTiffReader), String> {
    let source =
        RawSource::new(path).map_err(|e| format!("could not open {}: {e}", path.display()))?;
    if source.buf().get(8..10) != Some(b"CR") {
        return Err("not a Canon CR2 file".into());
    }
    let tiff = GenericTiffReader::new_with_buffer(source.buf(), 0, 0, Some(1))
        .map_err(|e| format!("CR2 unreadable: {e}"))?;
    Ok((source, tiff))
}

/// EXIF orientation (1–8) from CR2 IFD0. rawler reports these files as Normal, so read the tag.
fn cr2_orientation(tiff: &GenericTiffReader) -> u16 {
    tiff.root_ifd()
        .get_entry(TiffCommonTag::Orientation)
        .map_or(1, |e| e.value.force_u16(0))
}

/// Longest edge of the image Develop edits. Export (Step 3) will decode at full size.
const DEVELOP_EDGE: usize = 3072;

/// A CR2 decoded to linear light (sRGB primaries, camera white balance, values above 1 kept
/// for highlight recovery), box-downscaled to at most `max_edge` and turned upright.
fn raw_linear(path: &Path, max_edge: usize) -> Result<(usize, usize, Vec<f32>), String> {
    use rawler::imgop::develop::{Intermediate, ProcessingStep::*, RawDevelop};
    let (source, tiff) = cr2_open(path)?;
    let raw = rawler::decode(&source, &Default::default())
        .map_err(|e| format!("could not decode {}: {e}", path.display()))?;
    let steps = [
        Rescale,
        Demosaic,
        CropActiveArea,
        WhiteBalance,
        Calibrate,
        CropDefault,
    ];
    let Intermediate::ThreeColor(rgb) = RawDevelop::new_with(&steps)
        .develop_intermediate(&raw)
        .map_err(|e| format!("could not develop {}: {e}", path.display()))?
    else {
        return Err("not a colour RAW file".into());
    };
    let (w, h, small) = downscale(rgb.width, rgb.height, &rgb.data, max_edge);
    Ok(orient(w, h, &small, cr2_orientation(&tiff)))
}

/// Average f x f blocks, with f the smallest whole factor that fits `max_edge`.
fn downscale(
    w: usize,
    h: usize,
    px: &[[f32; 3]],
    max_edge: usize,
) -> (usize, usize, Vec<[f32; 3]>) {
    let f = w.max(h).div_ceil(max_edge).max(1);
    let (sw, sh) = (w / f, h / f);
    let mut out = vec![[0f32; 3]; sw * sh];
    for (y, row) in out.chunks_mut(sw.max(1)).enumerate() {
        for (x, o) in row.iter_mut().enumerate() {
            for dy in 0..f {
                for p in &px[(y * f + dy) * w + x * f..][..f] {
                    for c in 0..3 {
                        o[c] += p[c];
                    }
                }
            }
            o.iter_mut().for_each(|v| *v /= (f * f) as f32);
        }
    }
    (sw, sh, out)
}

/// Apply an EXIF orientation so the pixels are upright; returns width, height and flat RGB.
fn orient(w: usize, h: usize, px: &[[f32; 3]], orientation: u16) -> (usize, usize, Vec<f32>) {
    let swap = (5..=8).contains(&orientation);
    let (ow, oh) = if swap { (h, w) } else { (w, h) };
    let mut out = Vec::with_capacity(ow * oh * 3);
    for y in 0..oh {
        for x in 0..ow {
            // Where output (x, y) comes from in the stored image.
            let (sx, sy) = match orientation {
                2 => (w - 1 - x, y),
                3 => (w - 1 - x, h - 1 - y),
                4 => (x, h - 1 - y),
                5 => (y, x),
                6 => (y, h - 1 - x),
                7 => (w - 1 - y, h - 1 - x),
                8 => (w - 1 - y, x),
                _ => (x, y),
            };
            out.extend_from_slice(&px[sy * w + sx]);
        }
    }
    (ow, oh, out)
}

/// Width and height as little-endian u32s, then RGB half floats, ready for an RGB16F texture.
fn half_float_image(w: usize, h: usize, rgb: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + rgb.len() * 2);
    out.extend_from_slice(&(w as u32).to_le_bytes());
    out.extend_from_slice(&(h as u32).to_le_bytes());
    for v in rgb {
        out.extend_from_slice(&half::f16::from_f32(*v).to_le_bytes());
    }
    out
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
async fn pick_shoot(app: tauri::AppHandle, title: Option<String>) -> Option<String> {
    app.dialog()
        .file()
        .set_title(title.as_deref().unwrap_or("Open shoot folder"))
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

/// Bring a saved JSON file up to `current`. Refuses a file from a newer app rather than
/// risk saving over fields it doesn't know.
fn upgrade(mut data: Value, current: u64, file: &str) -> Result<Value, String> {
    let Some(fields) = data.as_object_mut() else {
        return Err(format!("{file} is not an object"));
    };
    let version = match fields.get("version") {
        None => 1,
        Some(v) => v.as_u64().ok_or(format!("{file} has a bad version"))?,
    };
    if version > current {
        return Err(format!(
            "this shoot was saved by a newer Shoot Studio ({file} format {version}); update the app to open it"
        ));
    }
    fields.insert("version".into(), current.into());
    Ok(data)
}

#[tauri::command]
fn load_shoot(dir: String) -> Result<Value, String> {
    match fs::read_to_string(state_dir(&dir, None)?.join("shoot.json")) {
        Ok(text) => upgrade(
            serde_json::from_str(&text).map_err(|e| format!("shoot.json is unreadable: {e}"))?,
            SHOOT_VERSION,
            "shoot.json",
        ),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Value::Null),
        Err(e) => Err(format!("could not read shoot.json: {e}")),
    }
}

#[tauri::command]
fn save_shoot(dir: String, data: Value) -> Result<(), String> {
    let data = upgrade(data, SHOOT_VERSION, "shoot.json")?;
    let text = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    write_atomic(&state_dir(&dir, None)?.join("shoot.json"), text.as_bytes())
}

/// A JPEG decoded to linear light, turned upright and box-downscaled to at most `max_edge`.
fn jpeg_linear(path: &Path, max_edge: usize) -> Result<(usize, usize, Vec<f32>), String> {
    use image::ImageDecoder;
    let bad = |e: image::ImageError| format!("could not decode {}: {e}", path.display());
    let file = fs::File::open(path).map_err(|e| format!("could not read {}: {e}", path.display()))?;
    let mut decoder = image::codecs::jpeg::JpegDecoder::new(std::io::BufReader::new(file)).map_err(bad)?;
    let orientation = decoder.orientation().map_err(bad)?;
    let mut img = image::DynamicImage::from_decoder(decoder).map_err(bad)?;
    img.apply_orientation(orientation);
    let img = img.into_rgb8();
    let linear: Vec<f32> = (0..=255u8)
        .map(|v| {
            let c = v as f32 / 255.0;
            if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) }
        })
        .collect();
    let px: Vec<[f32; 3]> = img.pixels().map(|p| p.0.map(|v| linear[v as usize])).collect();
    let (w, h, small) = downscale(img.width() as usize, img.height() as usize, &px, max_edge);
    Ok((w, h, small.into_iter().flatten().collect()))
}

/// A CR2 or JPEG from the shoot as upright linear RGB, at most `max_edge` on the long side.
fn photo_linear(dir: &str, name: &str, max_edge: usize) -> Result<(usize, usize, Vec<f32>), String> {
    let path = shoot_file(dir, name)?;
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".cr2") {
        raw_linear(&path, max_edge)
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        jpeg_linear(&path, max_edge)
    } else {
        Err(format!("{name} is not a photo Shoot Studio can develop"))
    }
}

/// Decode a photo for Develop, replay its retouch strokes and keep it as the open session.
fn open_develop(
    state: &Retouching,
    dir: String,
    name: String,
    strokes: Vec<Stroke>,
) -> Result<Vec<u8>, String> {
    retouch::validate(&strokes)?;
    let ticket = state.opened.fetch_add(1, Ordering::SeqCst) + 1;
    *state.session.lock().map_err(|e| e.to_string())? = None; // free the last photo first
    let (w, h, rgb) = photo_linear(&dir, &name, DEVELOP_EDGE)?;
    let session = Session::new(dir, name, w, h, rgb, strokes);
    let bytes = half_float_image(w, h, &session.current);
    let mut open = state.session.lock().map_err(|e| e.to_string())?;
    if state.opened.load(Ordering::SeqCst) == ticket {
        *open = Some(session);
    }
    Ok(bytes)
}

/// The session for this photo, refusing any other.
fn with_session<T>(
    state: &Retouching,
    dir: &str,
    name: &str,
    f: impl FnOnce(&mut Session) -> T,
) -> Result<T, String> {
    let mut open = state.session.lock().map_err(|e| e.to_string())?;
    match open.as_mut() {
        Some(s) if s.dir == dir && s.name == name => Ok(f(s)),
        _ => Err(format!("{name} is not the photo open in Develop")),
    }
}

/// Bring the open photo to `strokes`. Returns the changed rectangle (x, y, w, h as LE u32s)
/// then its half floats: just the new strokes' area when they extend the last call, the whole
/// image after an undo.
fn retouch_session(
    state: &Retouching,
    dir: &str,
    name: &str,
    strokes: Vec<Stroke>,
) -> Result<Vec<u8>, String> {
    retouch::validate(&strokes)?;
    with_session(state, dir, name, |s| {
        let rect = s.update(strokes);
        s.region(rect)
    })
}

/// Linear pixels for Develop, in the `half_float_image` layout, with the retouch strokes
/// applied. Async so the seconds-long decode runs off the main thread.
#[tauri::command]
async fn develop_source(
    app: AppHandle,
    dir: String,
    name: String,
    strokes: Vec<Stroke>,
) -> Result<Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        open_develop(&app.state::<Retouching>(), dir, name, strokes)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(Response::new(bytes))
}

#[tauri::command]
async fn retouch(
    app: AppHandle,
    dir: String,
    name: String,
    strokes: Vec<Stroke>,
) -> Result<Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        retouch_session(&app.state::<Retouching>(), &dir, &name, strokes)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(Response::new(bytes))
}

/// A nearby clean patch for a spot stroke, as its offset (source minus destination, 0–1 units).
#[tauri::command]
async fn spot_source(app: AppHandle, dir: String, name: String, stroke: Stroke) -> Result<[f64; 2], String> {
    retouch::validate(std::slice::from_ref(&stroke))?;
    tauri::async_runtime::spawn_blocking(move || {
        with_session(&app.state::<Retouching>(), &dir, &name, |s| {
            retouch::spot_source(&s.current, s.w, s.h, &stroke)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A photo for delivery: full size (or Develop's size), strokes replayed on a throwaway copy
/// so the photo open in Develop is left alone. Same layout as `develop_source`.
fn export_pixels(dir: &str, name: &str, strokes: &[Stroke], full: bool) -> Result<Vec<u8>, String> {
    retouch::validate(strokes)?;
    let (w, h, mut rgb) = photo_linear(dir, name, if full { usize::MAX } else { DEVELOP_EDGE })?;
    for stroke in strokes {
        retouch::apply(&mut rgb, w, h, stroke);
    }
    Ok(half_float_image(w, h, &rgb))
}

#[tauri::command]
async fn export_source(dir: String, name: String, strokes: Vec<Stroke>, full: bool) -> Result<Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || export_pixels(&dir, &name, &strokes, full))
        .await
        .map_err(|e| e.to_string())??;
    Ok(Response::new(bytes))
}

/// The ending of the error a delivery gives when the file is already there and `replace` is off.
const ALREADY_EXISTS: &str = "already exists";

/// Write one delivered JPEG to `folder` (absolute, created if missing) as `name`. Never into the
/// shoot folder itself or our state, so originals and edits can't be overwritten.
// ponytail: no copyright EXIF; add if asked
fn write_export(dir: &str, folder: &str, name: &str, replace: bool, jpeg: &[u8]) -> Result<(), String> {
    let lower = name.to_ascii_lowercase();
    if name.starts_with('.') || Path::new(name).file_name() != Some(name.as_ref()) || !lower.ends_with(".jpg") || lower.len() <= 4 {
        return Err(format!("not a delivery file name: {name}"));
    }
    let in_state = |p: &Path| p.components().any(|c| c.as_os_str() == STATE_DIR);
    let wanted = Path::new(folder);
    if !wanted.is_absolute() || in_state(wanted) {
        return Err(format!("can't deliver into {folder}"));
    }
    fs::create_dir_all(wanted).map_err(|e| format!("could not create {folder}: {e}"))?;
    let real = fs::canonicalize(wanted).map_err(|e| format!("could not open {folder}: {e}"))?;
    let shoot = fs::canonicalize(dir).map_err(|e| format!("could not open {dir}: {e}"))?;
    if real == shoot || in_state(&real) {
        return Err(format!("can't deliver into {folder}: choose a folder other than the shoot's own"));
    }
    let path = real.join(name);
    match fs::symlink_metadata(&path) {
        Ok(meta) if meta.is_dir() => return Err(format!("{name} is a folder")),
        Ok(_) if !replace => return Err(format!("{name} {ALREADY_EXISTS}")),
        _ => {}
    }
    write_atomic(&path, jpeg)
}

/// A delivered JPEG as the raw request body, with the other arguments as percent-encoded
/// headers (so a large file isn't sent as a JSON array).
#[tauri::command]
async fn save_export(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(jpeg) = request.body() else {
        return Err("save_export needs the JPEG as its body".into());
    };
    let arg = |key: &str| -> Result<String, String> {
        let value = request.headers().get(key).and_then(|v| v.to_str().ok()).ok_or(format!("save_export needs {key}"))?;
        percent_decode(value).ok_or(format!("save_export: bad {key}"))
    };
    let (dir, folder, name, replace) = (arg("dir")?, arg("folder")?, arg("name")?, arg("replace")? == "true");
    let jpeg = jpeg.clone();
    tauri::async_runtime::spawn_blocking(move || write_export(&dir, &folder, &name, replace, &jpeg))
        .await
        .map_err(|e| e.to_string())?
}

/// Undo JavaScript's encodeURIComponent.
fn percent_decode(s: &str) -> Option<String> {
    let (bytes, mut out, mut i) = (s.as_bytes(), Vec::with_capacity(s.len()), 0);
    while i < bytes.len() {
        if bytes[i] == b'%' {
            out.push(u8::from_str_radix(s.get(i + 1..i + 3)?, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// <shoot>/.shootstudio/recipes/<photo id>.json holds one photo's edit. Bump RECIPE_VERSION
/// only with a migration in `upgrade`. Version 2 added `retouch` (absent means none); version 3
/// added looks, split toning, finishing and red-eye strokes (absent means none), so an older
/// app refuses a recipe it would show without its look. Version 4 added `crop` (absent means
/// the whole photo, unrotated).
const RECIPE_VERSION: u64 = 4;

fn recipe_path(dir: &str, id: &str) -> Result<PathBuf, String> {
    shoot_file(dir, id)?;
    Ok(state_dir(dir, Some("recipes"))?.join(format!("{id}.json")))
}

/// The rendered look of an edited photo: a 2048 px preview, or its grid thumbnail.
fn edited_path(dir: &str, id: &str, thumb: bool) -> Result<PathBuf, String> {
    shoot_file(dir, id)?;
    let suffix = if thumb { ".thumb" } else { "" };
    Ok(state_dir(dir, Some("edited"))?.join(format!("{id}{suffix}.jpg")))
}

/// Every saved recipe in the shoot, by photo id.
#[tauri::command]
fn load_recipes(dir: String) -> Result<BTreeMap<String, Value>, String> {
    let folder = state_dir(&dir, Some("recipes"))?;
    let mut recipes = BTreeMap::new();
    for entry in fs::read_dir(&folder).map_err(|e| format!("could not read recipes: {e}"))? {
        let path = entry.map_err(|e| e.to_string())?.path();
        let (Some(id), Some("json")) = (
            path.file_stem().and_then(|s| s.to_str()),
            path.extension().and_then(|s| s.to_str()),
        ) else {
            continue; // e.g. a temp file left by a crash
        };
        let file = format!("recipe {id}");
        let text = fs::read_to_string(&path).map_err(|e| format!("could not read {file}: {e}"))?;
        let recipe =
            serde_json::from_str(&text).map_err(|e| format!("{file} is unreadable: {e}"))?;
        recipes.insert(id.to_owned(), upgrade(recipe, RECIPE_VERSION, &file)?);
    }
    Ok(recipes)
}

/// Save one photo's recipe, or with none, return the photo to the camera file.
#[tauri::command]
fn save_recipe(dir: String, id: String, recipe: Option<Value>) -> Result<(), String> {
    let path = recipe_path(&dir, &id)?;
    let Some(recipe) = recipe else {
        for path in [
            path,
            edited_path(&dir, &id, false)?,
            edited_path(&dir, &id, true)?,
        ] {
            match fs::remove_file(&path) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                    return Err(format!("could not remove {}: {e}", path.display()))
                }
                _ => {}
            }
        }
        return Ok(());
    };
    let recipe = upgrade(recipe, RECIPE_VERSION, &format!("recipe {id}"))?;
    let text = serde_json::to_string_pretty(&recipe).map_err(|e| e.to_string())?;
    write_atomic(&path, text.as_bytes())
}

#[tauri::command]
fn edited(dir: String, id: String, thumb: bool) -> Result<Response, String> {
    fs::read(edited_path(&dir, &id, thumb)?)
        .map(Response::new)
        .map_err(|_| "no edited preview yet".into())
}

#[tauri::command]
fn save_edited(dir: String, id: String, thumb: bool, data: Vec<u8>) -> Result<(), String> {
    write_atomic(&edited_path(&dir, &id, thumb)?, &data)
}

/// Presets are named settings saved for every shoot, in the app's config folder as
/// `presets.json`: `{"version": 1, "presets": [{"name": "...", "recipe": {...}}]}`.
/// The UI fills in and clamps each recipe the same way it does a photo's.
const PRESETS_VERSION: u64 = 1;
const MAX_PRESETS: usize = 200;

fn read_presets(folder: &Path) -> Result<Vec<Value>, String> {
    let text = match fs::read_to_string(folder.join("presets.json")) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        other => other.map_err(|e| format!("could not read presets: {e}"))?,
    };
    let data = serde_json::from_str(&text).map_err(|e| format!("presets.json is damaged: {e}"))?;
    let data = upgrade(data, PRESETS_VERSION, "presets.json")?;
    Ok(data.get("presets").and_then(Value::as_array).cloned().unwrap_or_default())
}

fn write_presets(folder: &Path, presets: Vec<Value>) -> Result<(), String> {
    if presets.len() > MAX_PRESETS {
        return Err(format!("too many presets (at most {MAX_PRESETS})"));
    }
    for p in &presets {
        let name = p.get("name").and_then(Value::as_str).unwrap_or("");
        if name.trim().is_empty() || name.chars().count() > 60 || !p.get("recipe").is_some_and(Value::is_object) {
            return Err("a preset needs a name of 1–60 characters and its settings".into());
        }
    }
    fs::create_dir_all(folder).map_err(|e| format!("could not create the settings folder: {e}"))?;
    let data = serde_json::json!({"version": PRESETS_VERSION, "presets": presets});
    let text = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    write_atomic(&folder.join("presets.json"), text.as_bytes())
}

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map_err(|e| format!("no settings folder: {e}"))
}

#[tauri::command]
fn load_presets(app: AppHandle) -> Result<Vec<Value>, String> {
    read_presets(&config_dir(&app)?)
}

#[tauri::command]
fn save_presets(app: AppHandle, presets: Vec<Value>) -> Result<(), String> {
    write_presets(&config_dir(&app)?, presets)
}

/// ~/Documents/KB Studio (or the home folder when there is no Documents).
fn create_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app.path().document_dir().or_else(|_| app.path().home_dir()).map_err(|e| format!("no Documents folder: {e}"))?;
    Ok(base.join("KB Studio"))
}

#[tauri::command]
fn list_creations(app: AppHandle, kind: String) -> Result<Vec<creations::Entry>, String> {
    Ok(creations::list(&creations::folder(&create_root(&app)?, &kind)?))
}

#[tauri::command]
fn load_creation(app: AppHandle, kind: String, name: String) -> Result<String, String> {
    let bytes = creations::read(&creations::folder(&create_root(&app)?, &kind)?, &name)?;
    String::from_utf8(bytes).map_err(|_| "that design is damaged".into())
}

/// The design's JSON is the raw body; `kind` and `name` travel as percent-encoded headers.
#[tauri::command]
async fn save_creation(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(json) = request.body() else {
        return Err("save_creation needs the design as its body".into());
    };
    let (kind, name) = (header(&request, "kind")?, header(&request, "name")?);
    let (dir, json) = (creations::folder(&create_root(&app)?, &kind)?, json.clone());
    if kind == "exports" {
        return Err("designs and templates only".into());
    }
    tauri::async_runtime::spawn_blocking(move || creations::write(&dir, &name, "json", &json).map(|_| ()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn delete_creation(app: AppHandle, kind: String, name: String) -> Result<(), String> {
    creations::delete(&creations::folder(&create_root(&app)?, &kind)?, &name)
}

/// Write a finished file (PDF, PNG or JPEG: the body) into Exports and return its path; `open` also shows it
/// in the system viewer, which is how Print works.
#[tauri::command]
async fn save_output(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("save_output needs the file as its body".into());
    };
    let (name, ext, open) = (header(&request, "name")?, header(&request, "ext")?, header(&request, "open")? == "true");
    if !["pdf", "png", "jpg"].contains(&ext.as_str()) {
        return Err("PDF, PNG or JPEG only".into());
    }
    let (dir, bytes) = (creations::folder(&create_root(&app)?, "exports")?, bytes.clone());
    let path = tauri::async_runtime::spawn_blocking(move || creations::write(&dir, &name, &ext, &bytes))
        .await
        .map_err(|e| e.to_string())??;
    if open {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("saved {}, but could not open it: {e}", path.display()))?;
    }
    Ok(path.display().to_string())
}

fn header(request: &tauri::ipc::Request<'_>, key: &str) -> Result<String, String> {
    let value = request.headers().get(key).and_then(|v| v.to_str().ok()).ok_or(format!("missing {key}"))?;
    percent_decode(value).ok_or(format!("bad {key}"))
}

/// Saved colours and favourite fonts: one small file in the app's settings folder.
#[tauri::command]
fn load_create_settings(app: AppHandle) -> Result<Value, String> {
    let path = config_dir(&app)?.join("create.json");
    Ok(fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null))
}

#[tauri::command]
fn save_create_settings(app: AppHandle, settings: Value) -> Result<(), String> {
    let dir = config_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("could not create the settings folder: {e}"))?;
    write_atomic(&dir.join("create.json"), settings.to_string().as_bytes())
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
    let update = pending
        .0
        .lock()
        .unwrap()
        .clone()
        .ok_or("no update to install")?;
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
        .manage(Retouching::default())
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
            save_shoot,
            develop_source,
            retouch,
            spot_source,
            export_source,
            save_export,
            load_recipes,
            save_recipe,
            edited,
            save_edited,
            load_presets,
            save_presets,
            list_creations,
            load_creation,
            save_creation,
            delete_creation,
            save_output,
            load_create_settings,
            save_create_settings
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
        assert!(load_shoot(d.clone())
            .unwrap_err()
            .contains("newer Shoot Studio"));
        assert!(save_shoot(d.clone(), serde_json::json!({"version": 99})).is_err());
        assert_eq!(
            fs::read_to_string(&file).unwrap(),
            newer,
            "a newer file is left alone"
        );
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

    #[test]
    fn presets_save_load_and_refuse_bad_ones() {
        let dir = temp_dir("presets").join("config");
        assert!(read_presets(&dir).unwrap().is_empty(), "no file yet means no presets");
        let mine = serde_json::json!({"name": "Soft sepia", "recipe": {"look": "sepia", "lookAmount": 60}});
        write_presets(&dir, vec![mine.clone()]).unwrap();
        assert_eq!(read_presets(&dir).unwrap(), vec![mine.clone()]);
        let saved: Value = serde_json::from_str(&fs::read_to_string(dir.join("presets.json")).unwrap()).unwrap();
        assert_eq!(saved["version"], PRESETS_VERSION);
        for bad in [
            serde_json::json!({"name": "", "recipe": {}}),
            serde_json::json!({"name": "x".repeat(61), "recipe": {}}),
            serde_json::json!({"name": "No settings"}),
        ] {
            assert!(write_presets(&dir, vec![bad]).is_err());
        }
        assert!(write_presets(&dir, vec![mine.clone(); MAX_PRESETS + 1]).is_err());
        assert_eq!(read_presets(&dir).unwrap(), vec![mine], "a refused save leaves the file alone");
        fs::write(dir.join("presets.json"), r#"{"version": 9, "presets": []}"#).unwrap();
        assert!(read_presets(&dir).is_err(), "presets from a newer app are not misread");
    }

    #[test]
    fn recipes_save_load_and_reset_to_the_camera_file() {
        let dir = temp_dir("recipes");
        let d = dir.display().to_string();
        fs::write(dir.join("IMG_1.CR2"), b"raw").unwrap();
        assert!(load_recipes(d.clone()).unwrap().is_empty());

        let recipe = serde_json::json!({"exposure": 0.5, "temp": 12});
        save_recipe(d.clone(), "IMG_1".into(), Some(recipe)).unwrap();
        save_edited(d.clone(), "IMG_1".into(), false, vec![1, 2]).unwrap();
        save_edited(d.clone(), "IMG_1".into(), true, vec![3]).unwrap();
        let loaded = load_recipes(d.clone()).unwrap();
        assert_eq!(
            loaded["IMG_1"],
            serde_json::json!({"version": 4, "exposure": 0.5, "temp": 12})
        );
        assert_eq!(
            fs::read(edited_path(&d, "IMG_1", true).unwrap()).unwrap(),
            [3]
        );
        assert!(edited(d.clone(), "IMG_1".into(), true).is_ok());

        save_recipe(d.clone(), "IMG_1".into(), None).unwrap();
        assert!(load_recipes(d.clone()).unwrap().is_empty());
        assert!(
            edited(d.clone(), "IMG_1".into(), false).is_err(),
            "edited preview removed"
        );
        assert!(
            edited(d.clone(), "IMG_1".into(), true).is_err(),
            "edited thumbnail removed"
        );
        save_recipe(d.clone(), "IMG_1".into(), None).expect("resetting twice is fine");
        assert_eq!(
            fs::read(dir.join("IMG_1.CR2")).unwrap(),
            b"raw",
            "original untouched"
        );

        for bad in ["../IMG_1", ".shootstudio", "a/b", ""] {
            assert!(
                save_recipe(d.clone(), bad.into(), Some(serde_json::json!({}))).is_err(),
                "{bad}"
            );
            assert!(
                save_edited(d.clone(), bad.into(), true, vec![1]).is_err(),
                "{bad}"
            );
        }

        let newer = r#"{"version": 99, "exposure": 1, "masks": []}"#;
        let file = recipe_path(&d, "IMG_1").unwrap();
        fs::write(&file, newer).unwrap();
        assert!(load_recipes(d.clone())
            .unwrap_err()
            .contains("newer Shoot Studio"));
        assert!(save_recipe(
            d.clone(),
            "IMG_1".into(),
            Some(serde_json::json!({"version": 99}))
        )
        .is_err());
        assert_eq!(
            fs::read_to_string(&file).unwrap(),
            newer,
            "a newer recipe is left alone"
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn older_recipes_load_and_save_as_version_4_and_5_is_refused() {
        let dir = temp_dir("recipe-versions");
        let d = dir.display().to_string();
        fs::write(dir.join("IMG_1.JPG"), b"jpeg").unwrap();
        let file = recipe_path(&d, "IMG_1").unwrap();
        fs::write(&file, r#"{"version": 1, "exposure": 1}"#).unwrap();
        assert_eq!(
            load_recipes(d.clone()).unwrap()["IMG_1"],
            serde_json::json!({"version": 4, "exposure": 1})
        );
        fs::write(&file, r#"{"version": 3, "look": "sepia"}"#).unwrap();
        assert_eq!(
            load_recipes(d.clone()).unwrap()["IMG_1"],
            serde_json::json!({"version": 4, "look": "sepia"}),
            "a version 3 recipe loads uncropped"
        );
        let old = serde_json::json!({"version": 1, "exposure": 1});
        save_recipe(d.clone(), "IMG_1".into(), Some(old)).unwrap();
        let saved: Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(saved["version"], 4);
        fs::write(&file, r#"{"version": 5, "retouch": []}"#).unwrap();
        assert!(load_recipes(d.clone()).unwrap_err().contains("newer Shoot Studio"));
        fs::remove_dir_all(dir).unwrap();
    }

    /// A JPEG of `rgb` with an EXIF orientation tag.
    fn jpeg_with_orientation(w: u32, h: u32, rgb: &[u8], orientation: u16) -> Vec<u8> {
        use image::ImageEncoder;
        let mut plain = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut plain, 100)
            .write_image(rgb, w, h, image::ExtendedColorType::Rgb8)
            .unwrap();
        let mut tiff = b"Exif\0\0II*\0\x08\0\0\0\x01\0".to_vec();
        tiff.extend_from_slice(&[0x12, 0x01, 3, 0, 1, 0, 0, 0]);
        tiff.extend_from_slice(&orientation.to_le_bytes());
        tiff.extend_from_slice(&[0, 0, 0, 0, 0, 0]);
        let mut out = vec![0xff, 0xd8, 0xff, 0xe1];
        out.extend_from_slice(&(tiff.len() as u16 + 2).to_be_bytes());
        out.extend_from_slice(&tiff);
        out.extend_from_slice(&plain[2..]);
        out
    }

    #[test]
    fn portrait_jpeg_develops_upright_and_round_trips() {
        let (w, h) = (48usize, 32usize);
        // Smooth so JPEG compression barely changes it, and lopsided so a wrong turn shows.
        let rgb: Vec<u8> = (0..w * h)
            .flat_map(|i| {
                let (x, y) = (i % w, i / w);
                [(x * 5) as u8, (y * 7) as u8, 128]
            })
            .collect();
        let dir = temp_dir("jpeg-develop");
        let path = dir.join("IMG_1.JPG");
        fs::write(&path, jpeg_with_orientation(w as u32, h as u32, &rgb, 8)).unwrap();
        let (ow, oh, linear) = jpeg_linear(&path, DEVELOP_EDGE).unwrap();
        assert_eq!((ow, oh), (h, w), "turned to portrait");
        // Expected: the decoded pixels turned by the same rule as CR2s.
        let decoded = image::load_from_memory(&fs::read(&path).unwrap()).unwrap().into_rgb8();
        let px: Vec<[f32; 3]> = decoded.pixels().map(|p| p.0.map(|v| v as f32 / 255.0)).collect();
        let (_, _, expect) = orient(w, h, &px, 8);
        let srgb = |v: f32| if v <= 0.0031308 { v * 12.92 } else { 1.055 * v.powf(1.0 / 2.4) - 0.055 };
        let bytes = half_float_image(ow, oh, &linear);
        let err = bytes[8..]
            .chunks(2)
            .map(|b| srgb(half::f16::from_le_bytes([b[0], b[1]]).to_f32()))
            .zip(&expect)
            .map(|(a, b)| (a - b).abs())
            .fold(0.0, f32::max);
        assert!(err <= 1.0 / 255.0, "round trip error {err}");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn export_decodes_full_size_and_replays_strokes_without_a_session() {
        let (w, h) = (3200usize, 16usize); // wider than Develop's 3072
        let rgb: Vec<u8> = (0..w * h).flat_map(|i| [(i % w / 13) as u8, (i / w * 9) as u8, 60]).collect();
        let dir = temp_dir("export-source");
        let d = dir.display().to_string();
        fs::write(dir.join("IMG_1.JPG"), jpeg_with_orientation(w as u32, h as u32, &rgb, 1)).unwrap();
        let spot: Stroke = serde_json::from_value(serde_json::json!(
            {"tool": "clone", "size": 0.003, "points": [[0.5, 0.5]], "offset": [0.1, 0]}
        ))
        .unwrap();
        let size = |b: &[u8]| (u32::from_le_bytes(b[..4].try_into().unwrap()), u32::from_le_bytes(b[4..8].try_into().unwrap()));
        let full = export_pixels(&d, "IMG_1.JPG", &[], true).unwrap();
        assert_eq!(size(&full), (3200, 16));
        let healed = export_pixels(&d, "IMG_1.JPG", std::slice::from_ref(&spot), true).unwrap();
        assert_eq!(healed.len(), full.len());
        assert_ne!(healed, full, "the stroke is replayed at full size");
        // At Develop's size it matches what Develop shows, and Develop's session is untouched.
        let state = Retouching::default();
        let shown = open_develop(&state, d.clone(), "IMG_1.JPG".into(), vec![spot.clone()]).unwrap();
        let small = export_pixels(&d, "IMG_1.JPG", std::slice::from_ref(&spot), false).unwrap();
        assert_eq!(size(&small), (1600, 8));
        assert_eq!(small, shown);
        assert_eq!(with_session(&state, &d, "IMG_1.JPG", |s| s.applied.len()).unwrap(), 1);
        assert!(export_pixels(&d, "../IMG_1.JPG", &[], true).is_err());
        let mut bad = spot;
        bad.size = f64::NAN;
        assert!(export_pixels(&d, "IMG_1.JPG", &[bad], true).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn delivery_writes_outside_the_shoot_and_asks_before_replacing() {
        let dir = temp_dir("deliver");
        let shoot = dir.join("shoot");
        fs::create_dir_all(shoot.join(STATE_DIR)).unwrap();
        let d = shoot.display().to_string();
        let out = shoot.join("Delivered").join("Smith Wedding");
        let o = out.display().to_string();
        write_export(&d, &o, "Smith-Wedding-0001.jpg", false, b"one").unwrap();
        assert_eq!(fs::read(out.join("Smith-Wedding-0001.jpg")).unwrap(), b"one", "folder created, file written");
        let err = write_export(&d, &o, "Smith-Wedding-0001.jpg", false, b"two").unwrap_err();
        assert!(err.ends_with(ALREADY_EXISTS), "{err}");
        assert_eq!(fs::read(out.join("Smith-Wedding-0001.jpg")).unwrap(), b"one", "not replaced unasked");
        write_export(&d, &o, "Smith-Wedding-0001.jpg", true, b"two").unwrap();
        assert_eq!(fs::read(out.join("Smith-Wedding-0001.jpg")).unwrap(), b"two");
        // Never the shoot itself (however it's spelt), our state, a relative folder or a bad name.
        for folder in [d.clone(), format!("{d}/Delivered/.."), format!("{d}/{STATE_DIR}"), format!("{d}/{STATE_DIR}/out"), "Delivered".into()] {
            assert!(write_export(&d, &folder, "a.jpg", true, b"x").is_err(), "{folder}");
        }
        assert!(!shoot.join(STATE_DIR).join("out").exists());
        std::os::unix::fs::symlink(shoot.join(STATE_DIR), dir.join("sneaky")).unwrap();
        assert!(write_export(&d, &dir.join("sneaky").display().to_string(), "a.jpg", true, b"x").is_err(), "a link into our state");
        for name in ["", ".jpg", ".hidden.jpg", "a/b.jpg", "../a.jpg", "a.png", "a.jpg.exe"] {
            assert!(write_export(&d, &o, name, true, b"x").is_err(), "{name}");
        }
        fs::create_dir(out.join("folder.jpg")).unwrap();
        assert!(write_export(&d, &o, "folder.jpg", true, b"x").is_err());
        assert_eq!(percent_decode("Smith%20Wedding%2F%C3%A9").as_deref(), Some("Smith Wedding/é"));
        assert_eq!(percent_decode("bad%2"), None);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn retouch_patches_on_append_replays_on_undo_and_refuses_other_photos() {
        let (w, h) = (64usize, 48usize);
        let rgb: Vec<u8> = (0..w * h).flat_map(|i| [(i % w * 3) as u8, 90, 60]).collect();
        let dir = temp_dir("retouch-session");
        let d = dir.display().to_string();
        fs::write(dir.join("IMG_1.JPG"), jpeg_with_orientation(w as u32, h as u32, &rgb, 1)).unwrap();
        fs::write(dir.join("IMG_2.JPG"), jpeg_with_orientation(w as u32, h as u32, &rgb, 1)).unwrap();
        let state = Retouching::default();
        let full = open_develop(&state, d.clone(), "IMG_1.JPG".into(), vec![]).unwrap();
        assert_eq!(full.len(), 8 + w * h * 6);
        let spot: Stroke = serde_json::from_value(serde_json::json!(
            {"tool": "spot", "size": 0.05, "points": [[0.5, 0.5]], "offset": [0.2, 0]}
        ))
        .unwrap();
        let rect = |b: &[u8]| -> Vec<u32> {
            b[..16].chunks(4).map(|c| u32::from_le_bytes(c.try_into().unwrap())).collect()
        };
        let one = retouch_session(&state, &d, "IMG_1.JPG", vec![spot.clone()]).unwrap();
        let r = rect(&one);
        assert!(r[2] > 0 && (r[2] as usize) < w && (r[3] as usize) < h, "dirty rect {r:?}");
        assert_eq!(one.len(), 16 + (r[2] * r[3]) as usize * 6);
        let undone = retouch_session(&state, &d, "IMG_1.JPG", vec![]).unwrap();
        assert_eq!(rect(&undone), [0, 0, w as u32, h as u32]);
        assert_eq!(undone[16..], full[8..], "undo is back to the clean photo");
        assert!(retouch_session(&state, &d, "IMG_2.JPG", vec![spot.clone()]).is_err());
        let mut bad = spot.clone();
        bad.size = f64::NAN;
        assert!(retouch_session(&state, &d, "IMG_1.JPG", vec![bad]).is_err());
        // Reopening replays the saved strokes.
        let reopened = open_develop(&state, d.clone(), "IMG_1.JPG".into(), vec![spot]).unwrap();
        assert_ne!(reopened, full);
        assert!(open_develop(&state, d.clone(), "../IMG_1.JPG".into(), vec![]).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn recipe_symlinks_cannot_redirect_writes() {
        use std::os::unix::fs::symlink;
        let (dir, outside) = (temp_dir("recipe-links"), temp_dir("recipe-outside"));
        let d = dir.display().to_string();
        fs::create_dir_all(dir.join(STATE_DIR)).unwrap();
        for sub in ["recipes", "edited"] {
            symlink(&outside, dir.join(STATE_DIR).join(sub)).unwrap();
        }
        assert!(save_recipe(d.clone(), "IMG_1".into(), Some(serde_json::json!({}))).is_err());
        assert!(save_edited(d.clone(), "IMG_1".into(), false, vec![1]).is_err());
        assert!(load_recipes(d.clone()).is_err());
        assert_eq!(
            fs::read_dir(&outside).unwrap().count(),
            0,
            "nothing written outside"
        );
        fs::remove_dir_all(dir).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn downscale_averages_blocks() {
        let px: Vec<[f32; 3]> = (0..16).map(|i| [i as f32, 0.0, 1.0]).collect();
        let (w, h, out) = downscale(4, 4, &px, 2);
        assert_eq!((w, h), (2, 2));
        assert_eq!(
            out.iter().map(|p| p[0]).collect::<Vec<_>>(),
            [2.5, 4.5, 10.5, 12.5]
        );
        assert!(out.iter().all(|p| p[2] == 1.0));
        assert_eq!(
            downscale(4, 4, &px, 4).2,
            px,
            "no scaling when it already fits"
        );
        assert_eq!(
            downscale(5, 3, &px[..15], 4).0,
            2,
            "factor rounds up so the result fits"
        );
    }

    #[test]
    fn orientation_turns_pixels_upright() {
        // Stored 3x2: a b c / d e f, one channel used as a label.
        let px: Vec<[f32; 3]> = (0..6).map(|i| [i as f32; 3]).collect();
        let labels = |o| {
            let (w, h, out) = orient(3, 2, &px, o);
            let s: String = out.chunks(3).map(|p| (b'a' + p[0] as u8) as char).collect();
            (w, h, s)
        };
        assert_eq!(labels(1), (3, 2, "abcdef".into()));
        assert_eq!(labels(3), (3, 2, "fedcba".into()));
        assert_eq!(labels(6), (2, 3, "daebfc".into()), "rotate 90° clockwise");
        assert_eq!(
            labels(8),
            (2, 3, "cfbead".into()),
            "rotate 90° anticlockwise"
        );
        assert_eq!(labels(2), (3, 2, "cbafed".into()));
        assert_eq!(labels(5), (2, 3, "adbecf".into()));
    }

    #[test]
    fn half_float_image_layout() {
        let bytes = half_float_image(2, 1, &[0.0, 0.5, 1.0, 2.0, 0.18, -0.1]);
        assert_eq!(&bytes[..8], &[2, 0, 0, 0, 1, 0, 0, 0]);
        assert_eq!(bytes.len(), 8 + 6 * 2);
        assert_eq!(
            &bytes[8..14],
            &[0x00, 0x00, 0x00, 0x38, 0x00, 0x3C],
            "0, 0.5, 1 as f16"
        );
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
        if let Some(raw) = photos.iter().find_map(|p| p.raw.as_ref()) {
            let start = std::time::Instant::now();
            let (w, h, rgb) = raw_linear(&shoot_file(&dir, raw).unwrap(), DEVELOP_EDGE).unwrap();
            let brightest = rgb.iter().cloned().fold(0f32, f32::max);
            println!(
                "{raw}: developed to {w}x{h} in {:.1}s, brightest {brightest:.2}",
                start.elapsed().as_secs_f32()
            );
            assert!(w.max(h) <= DEVELOP_EDGE && rgb.len() == w * h * 3);
        }
        listing(&state, &mut after);
        assert_eq!(state.exists(), existed, "state dir created");
        assert!(before == after, "state dir changed");
    }

    /// Retouch speed on real photos (reads only): SHOOT_DIR=/path cargo test --release retouch_timing -- --ignored --nocapture
    #[test]
    #[ignore]
    fn retouch_timing() {
        let dir = std::env::var("SHOOT_DIR").expect("set SHOOT_DIR");
        let photos = open_shoot(dir.clone()).unwrap();
        let raw = photos.iter().find_map(|p| p.raw.clone()).expect("a CR2");
        let jpg = photos.iter().find_map(|p| p.jpg.clone()).expect("a JPEG");
        let stroke = |json: serde_json::Value| -> Stroke { serde_json::from_value(json).unwrap() };
        for name in [raw, jpg] {
            let state = Retouching::default();
            let t = std::time::Instant::now();
            let source = open_develop(&state, dir.clone(), name.clone(), vec![]).unwrap();
            println!("{name}: develop_source {:?}, {} MB", t.elapsed(), source.len() >> 20);
            // A spot heal as the UI sends it: find a source, then append the stroke.
            let mut spot = stroke(serde_json::json!({"tool":"spot","size":0.008,"points":[[0.4,0.4],[0.405,0.402]],"offset":[0,0]}));
            let t = std::time::Instant::now();
            let offset = with_session(&state, &dir, &name, |s| retouch::spot_source(&s.current, s.w, s.h, &spot)).unwrap();
            let found = t.elapsed();
            spot.offset = Some(offset);
            let t = std::time::Instant::now();
            let patch = retouch_session(&state, &dir, &name, vec![spot.clone()]).unwrap();
            let applied = t.elapsed();
            println!("  spot: source {found:?} + apply {applied:?}, patch {} KB", patch.len() >> 10);
            assert!(found + applied < std::time::Duration::from_millis(100), "spot stroke too slow");
            // 50 strokes of every kind, then an undo, which replays them all.
            let mut strokes = vec![spot];
            for i in 0..49 {
                let (x, y) = (0.1 + 0.016 * i as f64, 0.2 + 0.012 * (i % 7) as f64);
                let path: Vec<[f64; 2]> = (0..20).map(|k| [x + 0.001 * k as f64, y + 0.0005 * k as f64]).collect();
                strokes.push(match i % 4 {
                    0 => stroke(serde_json::json!({"tool":"spot","size":0.008,"points":&path[..3],"offset":[0.02,0.0]})),
                    1 => stroke(serde_json::json!({"tool":"heal","size":0.012,"points":path,"offset":[-0.03,0.01]})),
                    2 => stroke(serde_json::json!({"tool":"clone","size":0.01,"points":path,"offset":[0.0,0.04]})),
                    _ => stroke(serde_json::json!({"tool":"soften","size":0.03,"points":path,"strength":0.6})),
                });
                retouch_session(&state, &dir, &name, strokes.clone()).unwrap();
            }
            strokes.pop();
            let t = std::time::Instant::now();
            let all = retouch_session(&state, &dir, &name, strokes).unwrap();
            let replay = t.elapsed();
            println!("  replay of 49 strokes after undo: {replay:?}, full patch {} MB", all.len() >> 20);
            let t = std::time::Instant::now();
            let state2 = Retouching::default();
            let mut fifty = with_session(&state, &dir, &name, |s| s.applied.clone()).unwrap();
            fifty.truncate(50);
            open_develop(&state2, dir.clone(), name.clone(), fifty).unwrap();
            println!("  develop_source with 49 strokes: {:?}", t.elapsed());
            assert!(replay < std::time::Duration::from_secs(2), "replay too slow");
        }
    }
    #[test]
    #[ignore]
    fn export_timing() {
        let dir = std::env::var("SHOOT_DIR").expect("set SHOOT_DIR");
        let photos = open_shoot(dir.clone()).unwrap();
        let raw = photos.iter().find_map(|p| p.raw.clone()).expect("a CR2");
        let jpg = photos.iter().find_map(|p| p.jpg.clone()).expect("a JPEG");
        let heal = serde_json::from_value::<Stroke>(serde_json::json!({"tool":"heal","size":0.01,"points":[[0.4,0.4],[0.42,0.41]],"offset":[0.03,0.0]})).unwrap();
        for name in [raw, jpg] {
            for full in [true, false] {
                let t = std::time::Instant::now();
                let bytes = export_pixels(&dir, &name, std::slice::from_ref(&heal), full).unwrap();
                let (w, h) = (u32::from_le_bytes(bytes[0..4].try_into().unwrap()), u32::from_le_bytes(bytes[4..8].try_into().unwrap()));
                println!("{name} {}: {w}×{h} in {:?}", if full { "full" } else { "web" }, t.elapsed());
                assert_eq!(bytes.len(), 8 + w as usize * h as usize * 6);
                assert!(full || w.max(h) as usize <= DEVELOP_EDGE);
            }
        }
    }
}
