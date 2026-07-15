// Dev launcher with reliable main-process auto-restart.
//
// `electron-forge start` only registers its `rs` (restart Electron) stdin listener when
// `process.stdin.isTTY` is true. In non-TTY contexts (IDE task runners, background
// shells, CI) that listener is absent, which silently disables the auto-restart emitted
// by vite.hot-restart.ts on main/preload rebuilds. Forcing the flag before Forge boots
// makes the restart path work everywhere; when run from a real terminal it's a no-op.
Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

// Forge's start command parses process.argv (optional [dir] + flags); pass none.
process.argv = process.argv.slice(0, 2);

await import('@electron-forge/cli/dist/electron-forge-start.js');
