# Asset license

The original Blender source and exported GLB files included in this repository
are distributed under the same [MIT License](LICENSE) as the game code.

Covered files include:

- `blender/slop_zoo_game_assets.blend`
- `public/assets/slop-cannon.glb`
- `public/assets/slop-cannon.asset.json`

`public/assets/slop-cannon.asset.json` is the release manifest for the GLB. It
records the source and output paths, MIT license identifier, toolchain versions,
asset budgets, file size and SHA-256 checksum so a packaged asset can be traced
back to the editable source.

Third-party software retains its respective license. Three.js is MIT licensed.
The CSS names Barlow Condensed and Rajdhani as optional local font choices, but
the repository does not bundle those font files or request them from Google
Fonts at runtime; system fallbacks are used when they are not installed.
