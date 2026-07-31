/**
 * What the packaged app must contain, shared by `vite.main.config.ts` and `forge.config.ts`.
 *
 * A module the main bundle keeps **external** is `require()`d from `node_modules` at runtime, so
 * electron-packager has to copy it into the app. Nothing catches that drift at build time: the
 * bundle compiles fine and the app dies on launch. Bureau 1.1.0 shipped exactly that way — `ws`
 * (the API workbench's WebSocket transport) was external but absent from the packager allowlist,
 * so the first `require` in `main.js` threw `Cannot find module 'ws'`.
 */

/** Modules excluded from the main bundle, and therefore packaged from `node_modules`. */
export const MAIN_EXTERNAL_MODULES = ['node-pty', 'ws'] as const;

/**
 * electron-packager `ignore` predicate (inverted): paths kept in the packaged app. Paths always
 * start with `/` and use forward slashes.
 */
export const isPackagedMainRuntime = (filePath: string): boolean =>
  filePath.startsWith('/.vite') ||
  filePath === '/node_modules' ||
  MAIN_EXTERNAL_MODULES.some((name) => filePath.startsWith(`/node_modules/${name}`)) ||
  filePath.startsWith('/node_modules/node-addon-api') ||
  // The API script sandbox worker loads QuickJS by absolute path at runtime, so these must ship.
  // The `singlefile` variant embeds its Wasm in the JS, so there is no separate asset to copy.
  filePath === '/node_modules/@jitl' ||
  filePath.startsWith('/node_modules/@jitl/quickjs-singlefile-cjs-release-sync') ||
  filePath.startsWith('/node_modules/@jitl/quickjs-ffi-types') ||
  filePath.startsWith('/node_modules/quickjs-emscripten-core');
