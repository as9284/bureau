import type { Plugin } from 'vite';

/**
 * Auto-restart the Electron **main** process during `electron-forge start`.
 *
 * Electron Forge's Vite plugin rebuilds the main/preload bundles on change but does
 * not restart the running app — only the renderer hot-reloads. Forge's `start` command
 * does, however, listen on stdin for the string `rs` and restarts Electron with the
 * freshly-built bundles (its documented manual-restart keystroke).
 *
 * This plugin emits that `rs` event programmatically whenever a rebuild finishes, so a
 * change to any main- or preload-process file restarts the app automatically — the
 * Forge-native equivalent of nodemon/electronmon, without fighting Forge's launcher.
 *
 * The debounce is stored on `globalThis` so that an edit to a shared module (which
 * rebuilds both the main and preload targets in the same Forge process) triggers a
 * single restart rather than two.
 */
type RestartGlobal = typeof globalThis & { __bureauForgeRestart__?: ReturnType<typeof setTimeout> };

function scheduleRestart(): void {
  const g = globalThis as RestartGlobal;
  if (g.__bureauForgeRestart__) clearTimeout(g.__bureauForgeRestart__);
  g.__bureauForgeRestart__ = setTimeout(() => {
    g.__bureauForgeRestart__ = undefined;
    // Same process as Forge's `start` command → its stdin `rs` listener fires and
    // re-spawns Electron. No-op when not run interactively (no listener registered).
    console.log('[hot-restart] main/preload rebuilt — restarting Electron');
    process.stdin.emit('data', Buffer.from('rs\n'));
  }, 200);
}

export function forgeRestartOnRebuild(label: string): Plugin {
  // The first `closeBundle` is the initial build (before Electron has launched) — skip
  // it; only later watch-mode rebuilds should trigger a restart.
  let built = false;
  return {
    name: `bureau:forge-restart:${label}`,
    apply: 'build',
    closeBundle() {
      if (!built) {
        built = true;
        return;
      }
      scheduleRestart();
    },
  };
}
