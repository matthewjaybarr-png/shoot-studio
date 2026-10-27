//! Running as an AppImage, KB Studio adds itself to the app menu and, once, to the dock.
//! It runs at every launch, so each update refreshes the menu entry and icon in place.
//! Nothing here can stop the app starting; failures are only logged.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const ICON_PNG: &[u8] = include_bytes!("../icons/icon.png");
/// The window's app id is `shoot-studio`, so the dock matches the window to this entry. It is also
/// the file name the README once told people to create by hand, which this replaces.
pub const DESKTOP_ID: &str = "shoot-studio.desktop";
/// Each new artwork gets a new name: GNOME Shell caches icons by name for the whole session, so
/// rewriting the same name left the taskbar on the old picture until she logged out.
const ICON_NAME: &str = "kb-studio-2";
/// Icon files from earlier artwork, removed so nothing can fall back to them.
const OLD_ICONS: [&str; 2] = ["scalable/apps/kb-studio.svg", "512x512/apps/kb-studio.png"];

/// Quote a path for the Exec key (Desktop Entry spec: double quotes, with " ` $ \ escaped, % doubled).
fn exec_quote(path: &str) -> String {
    let mut out = String::from("\"");
    for c in path.chars() {
        match c {
            '"' | '`' | '$' | '\\' => { out.push('\\'); out.push(c); }
            '%' => out.push_str("%%"),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

pub fn entry(appimage: &str) -> String {
    format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=KB Studio\n\
         GenericName=Photo editor and design maker\n\
         Comment=Cull, edit and deliver photo shoots; make posters, cards and classroom printables\n\
         Exec={}\n\
         Icon={ICON_NAME}\n\
         Terminal=false\n\
         Categories=Graphics;Photography;Education;\n\
         Keywords=photo;camera;raw;poster;worksheet;classroom;canva;\n\
         StartupWMClass=shoot-studio\n\
         StartupNotify=true\n",
        exec_quote(appimage)
    )
}

fn write_if_changed(path: &Path, bytes: &[u8]) -> std::io::Result<bool> {
    if fs::read(path).ok().as_deref() == Some(bytes) {
        return Ok(false);
    }
    fs::create_dir_all(path.parent().expect("absolute path"))?;
    let part = path.with_extension("part");
    fs::write(&part, bytes)?;
    fs::rename(&part, path)?;
    Ok(true)
}

/// Writes the menu entry and icons under `data` (~/.local/share). Returns whether anything changed.
pub fn integrate(data: &Path, appimage: &str) -> std::io::Result<bool> {
    let icons = data.join("icons/hicolor");
    let mut changed = false;
    for old in OLD_ICONS {
        match fs::remove_file(icons.join(old)) {
            Ok(()) => changed = true,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
    }
    changed |= write_if_changed(&icons.join(format!("512x512/apps/{ICON_NAME}.png")), ICON_PNG)?;
    if changed {
        // GNOME Shell notices new icons only when the theme folder itself changes, not a folder inside
        // it, so without this the taskbar showed a gear until she logged out.
        fs::File::open(&icons)?.set_modified(std::time::SystemTime::now())?;
    }
    changed |= write_if_changed(&data.join("applications").join(DESKTOP_ID), entry(appimage).as_bytes())?;
    Ok(changed)
}

/// The ids in a `gsettings get` string list, such as "['a.desktop', 'b.desktop']" or "@as []".
pub fn parse_list(text: &str) -> Vec<String> {
    text.split('\'').skip(1).step_by(2).map(str::to_string).collect()
}

pub fn format_list(ids: &[String]) -> String {
    format!("[{}]", ids.iter().map(|id| format!("'{id}'")).collect::<Vec<_>>().join(", "))
}

/// gsettings from the system, without the AppImage's bundled GLib schemas and modules in the way.
fn gsettings() -> Command {
    let mut command = Command::new("gsettings");
    for key in ["LD_LIBRARY_PATH", "LD_PRELOAD", "GSETTINGS_SCHEMA_DIR", "GIO_MODULE_DIR", "GI_TYPELIB_PATH", "GTK_PATH", "GTK_EXE_PREFIX", "GTK_DATA_PREFIX", "GDK_PIXBUF_MODULE_FILE"] {
        command.env_remove(key);
    }
    if let (Ok(dirs), Ok(appdir)) = (std::env::var("XDG_DATA_DIRS"), std::env::var("APPDIR")) {
        let system: Vec<_> = dirs.split(':').filter(|d| !d.starts_with(&appdir)).collect();
        command.env("XDG_DATA_DIRS", system.join(":"));
    }
    command
}

/// The title bar buttons the desktop asks for, such as "appmenu:minimize,maximize,close". The AppImage's own GLib
/// can't read the system's settings, so without this GTK uses GNOME's built-in default: a close button alone.
pub fn button_layout() -> String {
    let asked = gsettings().args(["get", "org.gnome.desktop.wm.preferences", "button-layout"]).output().ok()
        .filter(|out| out.status.success())
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().trim_matches('\'').to_string());
    layout_or_default(asked)
}

/// What gsettings said, or all three buttons on the right when it said nothing usable.
pub fn layout_or_default(asked: Option<String>) -> String {
    match asked {
        Some(layout) if layout.contains(':') => layout,
        _ => "appmenu:minimize,maximize,close".to_string(),
    }
}

/// Adds the app to the end of GNOME's dock favourites (Zorin's taskbar reads the same list).
/// Returns Ok(true) once it is there, whether it was added now or already pinned.
fn pin_to_dock() -> Result<bool, String> {
    let out = gsettings().args(["get", "org.gnome.shell", "favorite-apps"]).output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Ok(false); // not GNOME, or no dock list
    }
    let mut ids = parse_list(&String::from_utf8_lossy(&out.stdout));
    if ids.iter().any(|id| id == DESKTOP_ID) {
        return Ok(true);
    }
    ids.push(DESKTOP_ID.to_string());
    let status = gsettings().args(["set", "org.gnome.shell", "favorite-apps", &format_list(&ids)]).status().map_err(|e| e.to_string())?;
    Ok(status.success())
}

/// Called first thing at launch, before any window exists, so the dock matches the new window to
/// the refreshed entry instead of an old one. Only file writes; returns quickly.
pub fn add_to_menu() {
    let (Ok(appimage), Some(home)) = (std::env::var("APPIMAGE"), std::env::var_os("HOME")) else { return };
    let data = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|| Path::new(&home).join(".local/share"));
    match integrate(&data, &appimage) {
        // The menu notices new entries by itself; this just makes it quicker where the tool exists.
        Ok(true) => { let _ = Command::new("update-desktop-database").arg(data.join("applications")).env_remove("LD_LIBRARY_PATH").status(); }
        Ok(false) => {}
        Err(e) => eprintln!("could not add KB Studio to the app menu: {e}"),
    }
}

/// Called at launch, off the main thread. `config` holds the marker that the dock pin was done, so
/// unpinning it is respected: the app never pins itself a second time.
pub fn pin_once(config: PathBuf) {
    if std::env::var_os("APPIMAGE").is_none() {
        return;
    }
    let marker = config.join("dock-pinned");
    if marker.exists() {
        return;
    }
    std::thread::sleep(std::time::Duration::from_secs(2)); // let the shell see the new entry before it is pinned
    match pin_to_dock() {
        Ok(true) => { let _ = fs::create_dir_all(&config).and_then(|_| fs::write(&marker, b"")); }
        Ok(false) => {}
        Err(e) => eprintln!("could not pin KB Studio to the dock: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn title_bar_buttons_follow_the_desktop_or_show_all_three() {
        assert_eq!(layout_or_default(Some("close,minimize:".into())), "close,minimize:");
        assert_eq!(layout_or_default(Some("appmenu:close".into())), "appmenu:close");
        assert_eq!(layout_or_default(None), "appmenu:minimize,maximize,close");
        assert_eq!(layout_or_default(Some(String::new())), "appmenu:minimize,maximize,close");
    }

    #[test]
    fn exec_paths_are_quoted_for_the_desktop_spec() {
        assert_eq!(exec_quote("/home/k/Applications/ShootStudio.AppImage"), "\"/home/k/Applications/ShootStudio.AppImage\"");
        assert_eq!(exec_quote("/home/k/My Apps/a\"b$c`d\\e%f"), "\"/home/k/My Apps/a\\\"b\\$c\\`d\\\\e%%f\"");
        assert!(entry("/x/KB.AppImage").contains("\nExec=\"/x/KB.AppImage\"\n"));
        assert!(entry("/x").contains("\nStartupWMClass=shoot-studio\n"));
    }

    #[test]
    fn dock_lists_parse_and_print_like_gsettings() {
        assert_eq!(parse_list("['org.gnome.Nautilus.desktop', 'firefox.desktop']\n"), ["org.gnome.Nautilus.desktop", "firefox.desktop"]);
        assert!(parse_list("@as []\n").is_empty());
        assert_eq!(format_list(&["a.desktop".into(), "b.desktop".into()]), "['a.desktop', 'b.desktop']");
        assert_eq!(format_list(&[]), "[]");
    }

    #[test]
    fn integrating_writes_the_entry_and_icons_and_is_quiet_when_nothing_changed() {
        let data = std::env::temp_dir().join(format!("kb-desktop-{}", std::process::id()));
        let _ = fs::remove_dir_all(&data);
        fs::create_dir_all(data.join("applications")).unwrap();
        let old_svg = data.join("icons/hicolor/scalable/apps/kb-studio.svg");
        let old_png = data.join("icons/hicolor/512x512/apps/kb-studio.png");
        for old in [&old_svg, &old_png] {
            fs::create_dir_all(old.parent().unwrap()).unwrap();
            fs::write(old, b"previous icon").unwrap();
        }
        let long_ago = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_000_000_000);
        fs::File::open(data.join("icons/hicolor")).unwrap().set_modified(long_ago).unwrap();
        fs::write(data.join("applications").join(DESKTOP_ID), "[Desktop Entry]\nName=KB Studio\nExec=/old\n").unwrap(); // the hand-made README entry
        assert!(integrate(&data, "/apps/KB.AppImage").unwrap());
        assert_eq!(fs::read_to_string(data.join("applications").join(DESKTOP_ID)).unwrap(), entry("/apps/KB.AppImage"));
        assert!(!old_svg.exists() && !old_png.exists(), "icons from earlier artwork must be removed");
        let touched = fs::metadata(data.join("icons/hicolor")).unwrap().modified().unwrap();
        assert!(touched.elapsed().unwrap() < std::time::Duration::from_secs(60), "the theme folder is touched so the shell rescans");
        assert_eq!(fs::read(data.join("icons/hicolor/512x512/apps/kb-studio-2.png")).unwrap(), ICON_PNG);
        assert!(entry("/x").contains("\nIcon=kb-studio-2\n"), "the menu entry names the new icon");
        assert!(!integrate(&data, "/apps/KB.AppImage").unwrap());
        assert!(integrate(&data, "/moved/KB.AppImage").unwrap(), "a moved AppImage updates Exec");
        fs::remove_dir_all(&data).unwrap();
    }
}
