# Changelog

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
