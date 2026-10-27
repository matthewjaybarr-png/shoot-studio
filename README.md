# KB Studio

A small desktop app for culling and editing a photo shoot on Linux. Open a folder of Canon CR2 and JPEG files, flip through them, mark picks, rejects and stars with the mouse or the keyboard, adjust, retouch and crop the ones you keep, and deliver them as JPEGs.

- RAW and JPEG files with the same name are shown as one photo.
- Your originals are only ever read. Ratings live in `<shoot>/.shootstudio/shoot.json` and edits in `<shoot>/.shootstudio/recipes/`, next to the photos. Delete `.shootstudio` and you're back to the camera files.
- The app makes no network calls except one update check at launch.

Everything works with the mouse: the Grid, Photo, Compare and Develop buttons switch views; the bar above the photos has Pick, Reject, Unflag and the stars, Copy and Paste settings, and in Develop Hold for before, Undo, Redo and zoom. In the grid, pointing at a photo shows a flag and star bar on it. Arrows over the photo and the filmstrip under it move between photos. Develop's settings sit in drawers on the left (Adjust, Looks, Crop, Retouch), and Looks shows each look as a picture of the photo.

Keys: arrows move, Enter opens the loupe, C compares, Esc goes back to the grid, P picks, X rejects, U unflags, 1–5 set stars, 0 clears stars.

Develop: D edits the current photo. ←/→ go to the previous/next photo, hold \ to see it before your edits, Ctrl+Z / Ctrl+Shift+Z undo and redo, double-click a slider to reset it. RAW files are developed from their sensor data; editing needs WebGL2, which any graphics from the last decade provides.

Retouch, in Develop: pick a brush, then paint over what you want gone. Strokes are saved in the recipe and can be undone like any other edit.
- **G remove**: paint over something (a stray hair, a sign, a person in the background), or draw a ring around it, and it disappears; the gap is filled from what's around it.
- **J spot heal**: paint over a blemish or dust spot; the app finds clean texture nearby and blends it in to match the light around it.
- **H heal**: Alt+click (or Ctrl+click) a clean area first, then paint. Like spot heal, but you choose where the texture comes from.
- **S clone**: Alt+click (or Ctrl+click) a source, then paint an exact copy of it, with no blending.
- **B soften skin**: paint over skin to even out blotchy colour while keeping pores and fine detail. Strength sets how much.
- [ and ] change the brush size. Heal and clone show source pixels inside the brush. With Aligned on (the default), the source offset carries between strokes; turn it off to restart each stroke from the chosen source. Strength controls every brush.
- **E red eye**: click a red pupil, or drag out a circle over the eye. Only strongly red pixels are darkened, so the white catchlight stays.
- **L blur**, **O dodge**, **I burn**: paint to blur a busy background, lighten (dodge) or darken (burn) by one stop. Dodge and burn start at 25% strength; build them up in light strokes.

Looks, in Develop: pick one from the Look list (black & white, toned such as sepia, or a colour look), then set its strength from 0 to 100%. Every slider still works on top of it. Split toning tints shadows and highlights separately; Finishing adds a vignette (darker or lighter corners), film grain and a faded, matte black.

Detail, in Develop: Sharpen adds definition; Masking limits it to edges. Colour noise and Luminance noise reduce coloured speckles and grain.

Presets save the current settings under a name for every shoot; choose one from the Presets list to apply it, and Ctrl+Z takes it back off. Retouch strokes belong to one photo, so presets and copy/paste leave them alone.

Crop, in Develop: R shows the crop frame. Drag inside it to move it, drag a corner or edge to resize it, pick an aspect ratio (Swap turns it between landscape and portrait) and use Straighten to level a horizon. Enter applies the crop and Esc cancels; Reset crop goes back to the whole photo. Like every edit, the original is untouched.

Deliver: Ctrl+E, or the Deliver… button, saves finished JPEGs for the client: the picks, the selected photos, or everything except rejects. Choose full size or 2048 pixels on the long edge for the web, a JPEG quality, and whether files are named after the client and numbered in shoot order (Smith-Wedding-0001.jpg) or keep their own names. They go to `<shoot>/Delivered/<client>` unless you choose another folder, and a PROOF watermark can be added at the bottom right. Stop finishes the current photo and stops there. Delivering never writes inside `.shootstudio` and never touches the originals.

Copy and paste: Ctrl+C copies a photo's settings and Ctrl+V pastes them, onto the open photo in Develop or onto the selected photos in the grid. Ctrl+click adds a photo to the selection, Shift+click adds a run of photos, Ctrl+A selects them all and Esc clears it.
- The wheel zooms at the pointer up to 1600%; + and − step, 0 fits the photo and 1 shows 100% (in Develop these two zoom instead of rating), Z toggles between the two; a navigator in the corner shows where you are. Hold Space and drag, or drag with the middle button, to move around. Esc puts the brush down; a second Esc goes back to the grid.

## Install (Zorin OS, Ubuntu and similar)

1. Download `KB.Studio_<version>_amd64.AppImage` from the [latest release](https://github.com/matthewjaybarr-png/shoot-studio/releases/latest).
2. Move it to `~/Applications/ShootStudio.AppImage` and make it executable: right-click → Properties → Permissions → "Allow executing file as program", or `chmod +x ~/Applications/ShootStudio.AppImage`.
3. AppImages need FUSE 2. If the app doesn't start, install it: `sudo apt install libfuse2` on Zorin 17 / Ubuntu 22.04, or `sudo apt install libfuse2t64` on Ubuntu 24.04 and later.
4. Start it once by double-clicking. KB Studio then adds itself to the app menu with its icon, and on Zorin OS and other GNOME desktops pins itself to the taskbar. It pins itself only once: if you unpin it, it stays unpinned. Each update refreshes the menu entry and icon, and if you move the AppImage, the next launch points the entry at the new place.

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

1. Set the new version in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and the application entry in `src-tauri/Cargo.lock`, and add it to `CHANGELOG.md`.
2. Run the Rust tests and the UI check; both must pass.
3. Validate a local candidate in the packaged app: cropping and dialog focus, fonts and clip art, native clipboard and file drops, printing, and a representative large design. A local build does not validate signed updates.
4. Commit, then tag and push: `git tag v0.1.1 && git push origin main v0.1.1`.

CI builds the AppImage, signs it, and publishes a release with `latest.json`, which installed apps check. The workflow needs two repository secrets: `TAURI_SIGNING_PRIVATE_KEY` (the private key file's contents) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The matching public key is in `tauri.conf.json`. If the private key is lost, installed copies can no longer update and must be reinstalled by hand.

## Create

The start screen offers Create next to Photos: a small Canva-style maker for posters, labels, charts and cards. It is offline too; everything it uses is bundled.

- The buttons down the left open drawers: **Templates** (pictures of each one; on a blank page a template fills it, otherwise it opens as a new design), **Elements** (shapes, photo frames, graphics, tables, QR codes), **Text** (heading, subheading, body), **Uploads**, **This shoot** (the shoot open in Photos, picks first, rejects left out, developed with your edits when added), **Draw** (picks up the pen while it's open) and **Layers** (reorder, hide, lock).
- **Colours ▾** offers the colours already in the design, saved colours and a default palette; with nothing selected it colours the background. Text has effects (Shadow, Lift, Hollow, Outline, Neon) under Effects, and layers drag to reorder.
- **Your designs** on the start screen can be sorted into folders: drag a design onto a folder, or use its ⋯ menu (also right-click) to open, copy, rename, move or put it in the Trash, which keeps it until emptied. Folders are kept in the app's settings; the design files stay where they are.
- **Elements** has 25 shapes and lines, ten frame shapes (including arch, heart and star) and seven **photo grids** that fill the page with frames.
- **Font combinations** in the Text drawer add a few lines of paired fonts at once, selected together, each still its own text box.
- **File** in Create holds new design, import from Canva, make a copy, rename, folder, save as template, download and print, and move to trash.
- **Import from Canva** on the start screen opens a design downloaded from Canva as PowerPoint (Share → Download → PowerPoint) as an editable design: pages, pictures, text, shapes, tables, colours and the fonts Canva embeds. A PNG or JPEG download becomes a locked picture to build on.
- **Decorations** in Elements (leaves, flowers, doodles, dividers, party and school pieces) are drawn for the app; their colours show as dots in the toolbar to change. Elements sections fold away.
- **Charts** in Elements: column, bar, line, pie and donut. Edit chart in the toolbar takes your own labels, numbers, colours and a title. Charts in Canva files come across as charts you can edit.
- **Gradients** in Colours for text, shapes and the page; **Set as background** makes a photo fill the page behind everything; PNGs can be downloaded see-through.
- **Tables** keep working after they're added: rows and columns added or taken away, cell colours, borders, and rows that grow with their words (Canva tables too).
- **Bulk create** (File, or the Text drawer): paste a list of names, or a spreadsheet with more columns, and get one page per name in a new design. Each column goes into the text box chosen for it, or wherever {Column} is typed; long names shrink to stay on one line.
- **Label sheets**: Avery 5160, 5163, 5164, 5395, 5371 and 5388 as page sizes. Print and PDF place each label where the sheet has it, either the same label throughout or the pages one after another.
- **My elements**: save anything from a page (including pieces of Canva designs) and use it again in any design. **Save to** puts it in My elements or at the top of Shapes, Frames, Decorations, Charts, Graphics or Text; **Move** sorts it later.
- **Links** that work in the downloaded PDF, and **Find and replace** across every page.
- **Retouch** any picture in Create with Photos' brushes and **Remove**, which makes things disappear and fills the gap from what's around them; **Edit a photo** on the start screen opens a photo as a page its own size. Remove is in Develop too.
- **Cut out** part of any picture in Create: **Remove the background** in one click, or choose what to keep with the Smart brush, Box, Magic wand, Lasso or Brush, then keep it, erase it or make a sticker of it, or **Blur the background** behind it. Nothing is lost: Erase and Bring back brushes touch it up later.
- **Photo layers** in Create: adjust just one part of a picture, fade it into the page, or blend it with what's underneath; Layers shows each picture and what was done to it.
- **Straighten and Reshape** in Create's Edit photo: flatten a page or poster photographed at an angle by dragging its four corners, or push, grow and shrink parts of a picture.
- **Rulers** and **guide lines** to line things up (drag a guide out of a ruler), and **All pages**, a grid of every page to find one or drag it to a new place.
- Text can curve (Effects → Curve), become a bulleted or numbered list, switch to capitals or get a strikethrough. **Copy style** paints one thing's look onto another, and Position takes an exact size and rotation.
- **Filters** on a selected picture offers the looks from Photos and your Develop presets as previews, with a strength slider and Brightness, Contrast, Saturation, Warmth and Vignette. **✨ Auto fix** sets them for a dark or tinted picture in one click. The original is kept, so filters can be changed or removed later.
- Click something on the page and its options appear along the top: font, size − / +, colour, bold, alignment, spacing, border, corners, crop, frame, flip, effects, transparency and Position (arrange, align, equal gaps). With nothing selected it offers the background colour. A small toolbar above the selection duplicates, locks and deletes; ⋯ or a right-click opens a menu with copy, paste, layer order, lock, group and centre on the page.
- Drop a picture, from your files or This shoot, on a frame or another picture and it fills that spot: same place, size, angle and shape, cropped from the middle. Clicking a photo or uploading one with an empty frame selected fills it too.
- The strip under the page shows every page: click one to edit it, **+ Add page** adds a blank one after it, and Duplicate, Delete and the arrows copy, remove and reorder the page you're on. Undo covers all of it. PDF and Print hold every page (once per copy); PNG and JPEG save one picture per page, numbered, which suits an Instagram carousel.
- **Resize** changes the page size, scaling everything on every page to fit unless you untick that; **Custom size** takes any width and height from 1 to 36 inches. Sizes: Letter, landscape Letter, half and quarter sheet cards, an 11 × 17 poster, 4 × 6, 5 × 7 and 8 × 10 photo prints, and Instagram posts (1080 × 1350), square posts (1080 × 1080) and stories (1080 × 1920). Social posts save as PNG or JPEG at exactly those pixel sizes; everything else at 300 dpi. **Download & print** holds PDF, PNG, JPEG (each asks where to save, starting in Downloads, then shows where it went with Open it and Show in folder), Print (the system print window), tiling, copies, the print-safe margin, the black-and-white preview and Save as template.
- Delete removes, Ctrl+Z / Ctrl+Y undo and redo, arrow keys nudge, Ctrl+] / Ctrl+[ move forward and back, Ctrl+Shift+] / Ctrl+Shift+[ to the front and back. Group/ungroup with Ctrl+G / Ctrl+Shift+G, and copy/paste between designs. Paste or drop pictures; they land where they are dropped.
- Drag shapes, text and graphics from the drawers onto the page, or click to add them in the middle. Grey space surrounds the page, so things can hang off the edge; anything outside the page is left out of exports. Scroll to move around, Shift+scroll sideways, Ctrl+scroll or the zoom buttons to zoom, hold Space or the middle button and drag to pan, and Fit (or 0) to show the whole page.
- Resizing shows the size in inches and rotating shows the angle. Rotation snaps near 45°; hold Shift for 15° steps.
- Select a picture and choose Crop. Drag edges to crop or drag inside to reposition the source, then Apply crop; Cancel or Esc discards it. Frames resize with the crop.
- Search clip art by name or category. Add editable tables, handwriting lines or a QR code containing a link or text. Eleven bundled fonts and fifteen starter templates cover charts, cards, certificates, calendars and worksheets, plus Student of the week, a mini-session flyer, a 5 × 7 photo card, an Instagram post, a square collage and a story.
- Designs save themselves as one `.json` file each (pictures included) in `~/Documents/KB Studio/`, and your own templates in its `Templates` folder. Saved fonts and colours live in the app's settings.
- PDF, PNG and JPEG export are at 300 dpi and go to the `Exports` folder there. Print makes the PDF and opens it in your PDF viewer, which prints it. Tile mode puts two half sheets or four quarter sheets on one Letter page with cut marks. "Preview in B&W" shows a greyscale preview only; the file is still in colour.
- If a bundled font fails to load, designs remain editable and retain their font choices, but fallback fonts may change layout. Export and Print are blocked. Save and restart KB Studio; reinstall if the warning persists.
- In Photos, **Use in a design** sends the developed photo, at 2048 pixels, to a new page.

## Licence notices

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
