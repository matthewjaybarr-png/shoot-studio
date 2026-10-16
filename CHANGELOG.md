# Changelog

## 0.9.0

- Create editing: smart guides and page snapping; group and ungroup; align selected objects and distribute equal gaps; cut, copy, paste and duplicate selections across designs; paste or drop pictures; zoom and Fit.
- More shape and text properties, picture frames, triangles, stars, rounded rectangles, speech bubbles and free drawing. A 0.25-inch print-safe overlay stays out of exports.
- Switching designs waits for pending imports and pastes to save; layer shortcuts preserve selection order at stack boundaries. Native file drops use the HTML importer.
- Updating waits for design navigation and pending additions to save, and keeps editing frozen until restart or update failure. A failed design open does not cancel the update.
- Undo history shares embedded image data between snapshots instead of repeating it.
- Crop pictures directly, with Apply and Cancel, using Fabric 7.4. Frames resize with the crop, and finishing or cancelling restores zoom and scrolling. Existing designs keep their left/top origins and format 1.
- Create content: the full Twemoji 15.0.0 bundle with searchable categories and paged results; six more fonts; certificate, name-tag, flash-card, calendar and handwriting templates; editable tables, handwriting lines and vector QR codes. Designs and starters open with a persistent fallback-font warning if fonts fail to load; exports and Print wait for all bundled fonts and refuse output after a font failure. Save and restart KB Studio to try loading fonts again; reinstall if the problem persists. Local clip-art requests are allowed by the packaged CSP; narrow table cells start with blank text.

## 0.8.0

- Detail in Develop: Sharpen (with Masking, so flat areas and noise aren't sharpened), Colour noise and Luminance noise reduction. Photos without Detail render exactly as before. Recipes move to version 5; older KB Studio can't open them.

## 0.7.0

- A start screen: Photos (as before) or Create. The app opens on it, unless it was launched with a shoot.
- Create: make posters, labels, charts and cards on a Letter, landscape Letter, half-sheet or quarter-sheet page. Add text, pictures, rectangles, circles, lines, arrows and clip art; set the background and colours; move, resize and rotate; reorder, hide and lock layers in the Layers list; align to the page; undo and redo (up to 50 steps). Pictures are shrunk to 3300 pixels on the long side.
- Designs save themselves, one file each, in `~/Documents/KB Studio/`, and the start screen lists the recent ones.
- Output: PDF at 300 dpi (one page per copy), PNG, JPEG, and Print, which makes the PDF and opens it in your PDF viewer. Half and quarter cards can be tiled two or four to a Letter sheet with cut marks. "Preview in B&W" shows how it prints on a black-and-white printer.
- Starter templates (behaviour chart, labels, word wall, newsletter) with placeholder words, and Save as template for your own.
- Five bundled fonts (Lexend, Andika, Atkinson Hyperlegible, Comic Neue, Fredoka) with favourites, saved colours, and 40 clip-art pictures (Twemoji, CC-BY 4.0).
- Use in a design: in Photos, sends the developed photo to a new page in Create at 2048 pixels.
- Create never loses work: a rename can't overwrite another design, a failed save keeps you on the page and says so, and closing the window or updating saves first (close again to quit anyway if it can't). The heal and clone preview also shows a source that is off-screen.

## 0.6.0

- Deep zoom in Develop: the wheel zooms at the pointer from fit up to 1600%, with + and - for steps, 0 to fit and 1 for 100%. A zoom readout and a navigator thumbnail with a draggable box show where you are. Above 200% pixels are drawn sharp, and the brush outline scales with the zoom. In Develop, 0 and 1 zoom instead of rating.
- Every retouch brush has a Strength slider. Soften's blur now follows the brush size, so a big brush softens wrinkles properly: spot heal at 100% removes them, 40-60% softens them. Photos retouched before keep their old look.
- Clone and heal: Alt+click sets the source (Ctrl+click still works), the brush shows a preview of what it will copy, and an Aligned option (on by default) keeps the same distance to the source between strokes.
- Renamed to KB Studio. The release file is now `KB.Studio_<version>_amd64.AppImage`; the updater replaces an installed copy in place, and settings and presets carry over.
- Recipes still open as before.

## 0.5.0

- Crop in Develop (R): drag the frame or its handles, choose an aspect (Original, Free, 1:1, 4:5, 5:7, 2:3, 16:9, or swap it to portrait), and straighten up to 45° either way; the frame keeps to the photo. Enter applies it as one undo step, Esc cancels.
- Deliver (Ctrl+E): finished JPEGs of the picks, the selection or everything except rejects, at full size or 2048 pixels for the web, with a quality setting. Files are named after the client and numbered in shoot order (Smith-Wedding-0001.jpg), or keep their own names. They go to `<shoot>/Delivered/<client>` or a folder you choose, with an optional PROOF watermark. The app asks once before replacing files already there, and the shoot remembers your choices.
- Clone and heal start each stroke from the spot you Ctrl+clicked, and show a line to the source while you paint.
- Recipes are now version 4; older ones still open.

## 0.4.0

- Looks in Develop: 18 of them in black & white, toned (sepia, warm brown, cool selenium) and colour (warm & soft, bright & airy, moody, golden hour, teal & orange, vintage and more), each with a 0–100% strength and every slider still working on top.
- Split toning for shadows and highlights; Finishing adds vignette, grain and fade.
- Presets: save the current settings under a name, apply them to any photo in any shoot, delete them. They live in the app's settings folder.
- Ctrl+C / Ctrl+V copy and paste settings, onto the open photo or onto a grid selection (Ctrl+click, Shift+click, Ctrl+A; Esc clears).
- Red eye (E) in Retouch: click the pupil or drag a circle over the eye; the catchlight stays.
- Recipes are now version 3; older ones still open.

## 0.3.0

- Retouch in Develop: spot heal (J), heal from a source you choose (H), clone (S) and soften skin (B). Ctrl+click sets the heal or clone source; [ and ] change the brush size.
- Z zooms to 100% at the pointer and back; Space+drag or middle-drag moves around a zoomed photo. Esc puts the brush down before it leaves Develop.
- Strokes are saved in the recipe (now version 2; version 1 recipes still open) and replayed on the photo each time it opens, so the original is never changed. Ctrl+Z undoes a stroke.
- JPEGs are now decoded and edited at the same quality as RAW files, so retouching works on both.

## 0.2.0

- Develop: press D to edit a photo with white balance, exposure, contrast, highlights, shadows, whites, blacks, vibrance and saturation.
- RAW files are developed from their sensor data, so blown-looking highlights can often be brought back; JPEGs are edited directly.
- Hold \ to see the photo before your edits; Ctrl+Z and Ctrl+Shift+Z undo and redo; double-click a slider to reset it, or use Reset all.
- Edits save as small recipes in `<shoot>/.shootstudio/recipes/`. The grid and loupe show edited photos; originals are never changed.

## 0.1.0

- Cull a shoot folder: RAW+JPEG pairs, thumbnail grid, loupe and side-by-side compare.
- Pick, reject and star from the keyboard; ratings save to `<shoot>/.shootstudio/shoot.json`, and originals are never changed.
- Checks for updates at launch and installs them with one click.
