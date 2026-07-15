import type { IPty } from 'node-pty';
import type * as PtyModule from 'node-pty';

/**
 * node-pty ships a native binding; a missing or ABI-mismatched build throws at load. We
 * require it lazily (not as a static top-level import) and cache the result so that failure
 * degrades to log mode instead of crashing the main process before any window opens. The
 * main bundle is CommonJS, so `require` is provided by Electron's module wrapper at runtime.
 */
let ptyModule: typeof PtyModule | null | undefined;
function loadPty(): typeof PtyModule | null {
  if (ptyModule !== undefined) return ptyModule;
  try {
    // eslint-disable-next-line no-restricted-globals, @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    ptyModule = require('node-pty') as typeof PtyModule;
  } catch {
    ptyModule = null;
  }
  return ptyModule;
}

export type PtySession = {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  readonly pid: number;
};

export type PtySpawnOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  cols?: number;
  rows?: number;
  onData(data: string): void;
  onExit(code: number): void;
};

/**
 * Spawns an interactive PTY for terminal-mode processes.
 * Uses node-pty; fails soft when the native module is unavailable for this Electron ABI.
 */
export function spawnPty(
  executable: string,
  args: string[],
  options: PtySpawnOptions
): PtySession {
  const pty = loadPty();
  if (!pty) {
    throw new Error('node-pty native module is unavailable for this Electron build');
  }

  const shellEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(options.env)) {
    if (v !== undefined) shellEnv[k] = v;
  }

  const term: IPty = pty.spawn(executable, args, {
    name: 'xterm-color',
    cols: options.cols ?? 120,
    rows: options.rows ?? 30,
    cwd: options.cwd,
    env: shellEnv,
    useConpty: process.platform === 'win32',
  });

  term.onData((data) => options.onData(data));
  term.onExit(({ exitCode }) => options.onExit(exitCode));

  return {
    get pid() {
      return term.pid;
    },
    write(data) {
      term.write(data);
    },
    resize(cols, rows) {
      try {
        term.resize(Math.max(2, cols), Math.max(1, rows));
      } catch {
        // ignore resize races
      }
    },
    kill() {
      try {
        term.kill();
      } catch {
        // already dead
      }
    },
  };
}

export function isPtyAvailable(): boolean {
  return typeof loadPty()?.spawn === 'function';
}
