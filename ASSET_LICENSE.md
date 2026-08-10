# Asset license

The original Blender source and exported GLB files included in this repository
are distributed under the same [MIT License](LICENSE) as the game code.

Covered files include:

- `blender/slop_zoo_game_assets.blend`
- `blender/slop_zoo_game_assets_dragon_new_year.blend`
- `blender/slop_zoo_game_assets_bamboo_guardian.blend`
- `blender/slop_zoo_game_assets_abyssal_whale.blend`
- `blender/slop_zoo_game_assets_stellar_voyager.blend`
- `public/assets/slop-cannon.glb`
- `public/assets/slop-cannon.asset.json`
- `public/assets/slop-cannon-dragon-new-year.glb`
- `public/assets/slop-cannon-dragon-new-year.asset.json`
- `public/assets/slop-cannon-bamboo-guardian.glb`
- `public/assets/slop-cannon-bamboo-guardian.asset.json`
- `public/assets/slop-cannon-abyssal-whale.glb`
- `public/assets/slop-cannon-abyssal-whale.asset.json`
- `public/assets/slop-cannon-stellar-voyager.glb`
- `public/assets/slop-cannon-stellar-voyager.asset.json`
- `public/assets/previews/slop-cannon-classic.jpg`
- `public/assets/previews/slop-cannon-dragon-new-year.jpg`
- `public/assets/previews/slop-cannon-bamboo-guardian.jpg`
- `public/assets/previews/slop-cannon-abyssal-whale.jpg`
- `public/assets/previews/slop-cannon-stellar-voyager.jpg`

The five `*.asset.json` files are release manifests for their corresponding
GLBs. They record the source and output paths, MIT license identifier, toolchain
versions, asset budgets, file size and SHA-256 checksum so each packaged asset
can be traced back to its editable source. The JPG files are Blender-rendered
catalogue previews of those same original models and are not embedded textures.
The named variants are the Dragon New Year, Bamboo Guardian, Abyssal Whale and
Stellar Voyager skins; all were created specifically for this project from the
repository's original cannon source.

Third-party software retains its respective license. Three.js is MIT licensed.
The CSS names Barlow Condensed and Rajdhani as optional local font choices, but
the repository does not bundle those font files or request them from Google
Fonts at runtime; system fallbacks are used when they are not installed.
