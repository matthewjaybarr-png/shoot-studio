# Third-party notices

Shoot Studio is built on these open-source projects. Thank you to their authors.

| Project | Used for | Licence | Copyright | Source |
|---|---|---|---|---|
| rawler 0.8.0 (part of dnglab) | Reading the Canon CR2 file structure to find the embedded preview | LGPL-2.1 | © Daniel Vogelbacher, Pedro Côrte-Real and dnglab contributors | https://github.com/dnglab/dnglab |
| Tauri 2 | App shell and webview | MIT or Apache-2.0 | © Tauri Programme within The Commons Conservancy | https://github.com/tauri-apps/tauri |
| tauri-plugin-dialog 2 | The "Open shoot" folder picker | MIT or Apache-2.0 | © Tauri Programme within The Commons Conservancy | https://github.com/tauri-apps/plugins-workspace |
| tauri-plugin-updater 2 | Checking for, verifying and installing signed updates | MIT or Apache-2.0 | © Tauri Programme within The Commons Conservancy | https://github.com/tauri-apps/plugins-workspace |
| serde / serde_json 1 | Reading and writing `.shootstudio/shoot.json` | MIT or Apache-2.0 | © Erick Tryzelaar, David Tolnay and contributors | https://github.com/serde-rs/serde, https://github.com/serde-rs/json |

The transitive Rust dependencies are under permissive licences (MIT, Apache-2.0, BSD, Zlib, Unicode-3.0, MPL-2.0 and similar). rawler is the only LGPL dependency, and nothing in the tree is GPL. To list them all, run `cargo tree -e normal -f '{p} {l}'` in `src-tauri/`.

## LGPL-2.1 (rawler)

rawler is used unmodified, as published on crates.io, and is linked statically into the app. To meet the LGPL:
- rawler's licence text is in `LICENSES/rawler-LGPL-2.1.txt`;
- rawler's source is at https://github.com/dnglab/dnglab, and the exact version used is pinned in `src-tauri/Cargo.lock`;
- Shoot Studio's complete source is in this repository, so you can rebuild it against a modified rawler (point `src-tauri/Cargo.toml` at your copy and run `npx @tauri-apps/cli@2 build`).

No code from GPL projects (darktable, RawTherapee) has been copied into Shoot Studio.
