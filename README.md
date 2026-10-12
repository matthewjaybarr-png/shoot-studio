# Shoot Studio

A small desktop app for culling and editing a photo shoot on Linux. Open a folder of Canon CR2 and JPEG files, flip through them, mark picks, rejects and stars from the keyboard, and adjust the light and colour of the ones you keep.

- RAW and JPEG files with the same name are shown as one photo.
- Your originals are only ever read. Ratings live in `<shoot>/.shootstudio/shoot.json` and edits in `<shoot>/.shootstudio/recipes/`, next to the photos. Delete `.shootstudio` and you're back to the camera files.
- The app makes no network calls except one update check at launch.

Keys: arrows move, Enter opens the loupe, C compares, Esc goes back to the grid, P picks, X rejects, U unflags, 1–5 set stars, 0 clears stars.

Develop: D edits the current photo. ←/→ go to the previous/next photo, hold \ to see it before your edits, Ctrl+Z / Ctrl+Shift+Z undo and redo, double-click a slider to reset it. RAW files are developed from their sensor data; editing needs WebGL2, which any graphics from the last decade provides.

Retouch, in Develop: pick a brush, then paint over what you want gone. Strokes are saved in the recipe and can be undone like any other edit.
- **J spot heal**: paint over a blemish or dust spot; the app finds clean texture nearby and blends it in to match the light around it.
- **H heal**: Ctrl+click a clean area first, then paint. Like spot heal, but you choose where the texture comes from.
- **S clone**: Ctrl+click a source, then paint an exact copy of it, with no blending.
- **B soften skin**: paint over skin to even out blotchy colour while keeping pores and fine detail. Strength sets how much.
- [ and ] change the brush size. Heal and clone stay "aligned": the source keeps the same distance from the brush until you Ctrl+click again.
- Z zooms between the whole photo and 100% (one photo pixel per screen pixel) at the pointer; hold Space and drag, or drag with the middle button, to move around. Esc puts the brush down; a second Esc goes back to the grid.

## Install (Zorin OS, Ubuntu and similar)

1. Download `Shoot.Studio_<version>_amd64.AppImage` from the [latest release](https://github.com/matthewjaybarr-png/shoot-studio/releases/latest).
2. Move it to `~/Applications/ShootStudio.AppImage` and make it executable: right-click → Properties → Permissions → "Allow executing file as program", or `chmod +x ~/Applications/ShootStudio.AppImage`.
3. AppImages need FUSE 2. If the app doesn't start, install it: `sudo apt install libfuse2` on Zorin 17 / Ubuntu 22.04, or `sudo apt install libfuse2t64` on Ubuntu 24.04 and later.
4. To add it to the app menu, save this as `~/.local/share/applications/shoot-studio.desktop`, replacing `USER` with your user name:

   ```ini
   [Desktop Entry]
   Type=Application
   Name=Shoot Studio
   Exec=/home/USER/Applications/ShootStudio.AppImage
   Terminal=false
   Categories=Graphics;Photography;
   ```

The AppImage file must belong to the user who runs it, so the app can replace it when it updates.

## Updates

At launch the app checks the latest release. If a newer version exists, a bar offers "Update now"; one click downloads it, checks its signature and restarts into the new version. The app never restarts on its own, and shows nothing when offline. Updates are signed, and the app refuses any file not signed with the release key.

## Development

Needs Rust, Node.js and the [Tauri 2 Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux).

```sh
cargo test --release --manifest-path src-tauri/Cargo.toml   # Rust tests
node ui-check.cjs                                           # UI in headless Chromium (CHROMIUM=... to pick the browser)
npx @tauri-apps/cli@2 dev                                   # run the app
```

`live-check.sh` drives the real window on a hidden Hyprland monitor; see the comment at its top.

## Releasing

Release builds come only from CI (`.github/workflows/release.yml`, on Ubuntu 22.04), so they run on Zorin OS 17 and newer.

1. Set the new version in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, and add it to `CHANGELOG.md`.
2. Run the Rust tests and the UI check; both must pass.
3. Commit, then tag and push: `git tag v0.1.1 && git push origin main v0.1.1`.

CI builds the AppImage, signs it, and publishes a release with `latest.json`, which installed apps check. The workflow needs two repository secrets: `TAURI_SIGNING_PRIVATE_KEY` (the private key file's contents) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The matching public key is in `tauri.conf.json`. If the private key is lost, installed copies can no longer update and must be reinstalled by hand.

## Licence notices

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
