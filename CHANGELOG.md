# Changelog

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
