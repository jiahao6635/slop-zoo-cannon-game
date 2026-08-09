# Contributing

Contributions are welcome through GitHub issues and pull requests.

1. Fork the repository and create a focused branch.
2. Run `npm install` and `npm run dev` for local development.
3. Run `npm run build` before opening a pull request.
4. Keep gameplay changes keyboard-, pointer-, and touch-accessible.
5. Do not commit `node_modules`, `dist`, Blender backup files, or third-party
   assets without redistribution permission.

For Blender changes, edit `blender/slop_zoo_game_assets.blend`, then run
`npm run export:assets`. Set `BLENDER_BIN` if Blender is not on your `PATH`.
