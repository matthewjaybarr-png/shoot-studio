# Third-party notices

Shoot Studio is built on these open-source projects. Thank you to their authors.

| Project | Used for | Licence | Copyright | Source |
|---|---|---|---|---|
| rawler 0.8.0 (part of dnglab) | Reading Canon CR2 files: the embedded preview, and the raw sensor data for Develop | LGPL-2.1 | © Daniel Vogelbacher, Pedro Côrte-Real and dnglab contributors | https://github.com/dnglab/dnglab |
| Tauri 2 | App shell and webview | MIT or Apache-2.0 | © Tauri Programme within The Commons Conservancy | https://github.com/tauri-apps/tauri |
| tauri-plugin-dialog 2 | The "Open shoot" folder picker | MIT or Apache-2.0 | © Tauri Programme within The Commons Conservancy | https://github.com/tauri-apps/plugins-workspace |
| tauri-plugin-updater 2 | Checking for, verifying and installing signed updates | MIT or Apache-2.0 | © Tauri Programme within The Commons Conservancy | https://github.com/tauri-apps/plugins-workspace |
| serde / serde_json 1 | Reading and writing `.shootstudio/shoot.json` and edit recipes | MIT or Apache-2.0 | © Erick Tryzelaar, David Tolnay and contributors | https://github.com/serde-rs/serde, https://github.com/serde-rs/json |
| half 2 | Sending RAW pixels to the editor as half floats | MIT or Apache-2.0 | © Kathryn Long and contributors | https://github.com/starkat99/half-rs |
| PhotoCraft (commit 60ef9d836f62) | Healing (Poisson blending), finding a spot heal's source, and the blur behind skin softening, copied and modified into `src-tauri/src/photocraft.rs` | MIT or Apache-2.0 (used under Apache-2.0) | © 2026 ArtCraft Team and the PhotoCraft contributors | https://github.com/storytold/photocraft |
| image 0.25 (JPEG only) | Decoding JPEGs for Develop and retouching | MIT or Apache-2.0 | © The image-rs Developers | https://github.com/image-rs/image |
| rayon 1 | Healing the colour channels in parallel | MIT or Apache-2.0 | © Josh Stone, Niko Matsakis and contributors | https://github.com/rayon-rs/rayon |
| OkLab colour space | The Vibrance and Saturation sliders (`ui/develop.js`) | MIT | © 2020 Björn Ottosson | https://bottosson.github.io/posts/oklab/ |

The transitive Rust dependencies are under permissive licences (MIT, Apache-2.0, BSD, Zlib, Unicode-3.0, MPL-2.0 and similar). rawler is the only LGPL dependency, and nothing in the tree is GPL. To list them all, run `cargo tree -e normal -f '{p} {l}'` in `src-tauri/`.

## LGPL-2.1 (rawler)

rawler is used unmodified, as published on crates.io, and is linked statically into the app. To meet the LGPL:
- rawler's licence text is in `LICENSES/rawler-LGPL-2.1.txt`;
- rawler's source is at https://github.com/dnglab/dnglab, and the exact version used is pinned in `src-tauri/Cargo.lock`;
- Shoot Studio's complete source is in this repository, so you can rebuild it against a modified rawler (point `src-tauri/Cargo.toml` at your copy and run `npx @tauri-apps/cli@2 build`).

## Apache-2.0 (PhotoCraft)

`src-tauri/src/photocraft.rs` is copied from PhotoCraft's `crates/algo` (`poisson.rs`, parts of `inpaint.rs` and `retouch.rs`) and modified, as its header lists: trimmed to the functions Shoot Studio uses, let-chains rewritten for Rust edition 2021, and the WebAssembly branch removed. The Apache License 2.0 text is in `LICENSES/photocraft-Apache-2.0.txt`. PhotoCraft's NOTICE, for the parts used:

> Copyright (c) 2026 ArtCraft Team and the PhotoCraft contributors.
> Licensed under the MIT License or the Apache License, Version 2.0, at your option.

Shoot Studio uses none of PhotoCraft's or ArtCraft's names, logos, fonts or icons as branding, and none of its other bundled material.

No code from GPL projects (darktable, RawTherapee) has been copied into Shoot Studio.
