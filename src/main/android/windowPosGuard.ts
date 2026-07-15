import { readFile, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// The Android emulator saves its last window position and restores it blindly on the
// next launch. When the monitor layout changed in between, that point can be outside
// every display and the emulator opens off-screen. Depending on the emulator version
// the position lives in `emu-last-window-pos` (shared or per-AVD) or in the per-AVD
// `emulator-user.ini` (`window.x` / `window.y`). Before launching an AVD we validate
// the saved position against the current displays; a stale `emu-last-window-pos` is
// deleted (the emulator falls back to default placement), while `emulator-user.ini`
// gets its window.x/window.y rewritten in place because the file carries other
// settings. A visible saved position is left untouched.

export type DisplayRect = { x: number; y: number; width: number; height: number };
export type WindowPos = { x: number; y: number };

// How far a window's saved top-left may sit outside a display and still count as
// reachable: generous to the left/top (window borders, maximized offsets), and
// requiring a grabbable sliver before the right/bottom edges.
const LEFT_TOLERANCE = 200;
const TOP_TOLERANCE = 60;
const MIN_REACHABLE = 60;

export function parseWindowPos(content: string): WindowPos | null {
  const labeled = (key: string) =>
    content.match(new RegExp(`^\\s*(?:window\\.)?${key}\\s*[=:]\\s*(-?\\d+)\\s*$`, 'mi'))?.[1];
  const x = labeled('x');
  const y = labeled('y');
  if (x !== undefined && y !== undefined) return { x: Number(x), y: Number(y) };
  const numbers = content.match(/-?\d+/g);
  if (!numbers || numbers.length < 2) return null;
  return { x: Number(numbers[0]), y: Number(numbers[1]) };
}

export function isPositionVisible(pos: WindowPos, displays: DisplayRect[]): boolean {
  return displays.some(
    (display) =>
      pos.x >= display.x - LEFT_TOLERANCE &&
      pos.x <= display.x + display.width - MIN_REACHABLE &&
      pos.y >= display.y - TOP_TOLERANCE &&
      pos.y <= display.y + display.height - MIN_REACHABLE
  );
}

// Rewrite window.x / window.y lines to a reachable position, leaving other lines as-is.
export function rewriteUserIniPos(content: string, pos: WindowPos): string {
  return content
    .replace(/^(\s*window\.x\s*[=:]\s*)-?\d+\s*$/mi, `$1${pos.x}`)
    .replace(/^(\s*window\.y\s*[=:]\s*)-?\d+\s*$/mi, `$1${pos.y}`);
}

export type GuardDeps = {
  readFile(target: string): Promise<string>;
  writeFile(target: string, content: string): Promise<void>;
  unlink(target: string): Promise<void>;
  homedir(): string;
  getDisplays(): Promise<DisplayRect[]>;
};

const defaultDeps: GuardDeps = {
  readFile: (target) => readFile(target, 'utf8'),
  writeFile: (target, content) => writeFile(target, content, 'utf8'),
  unlink,
  homedir: () => os.homedir(),
  async getDisplays() {
    try {
      const { screen } = await import('electron');
      return screen.getAllDisplays().map((display) => display.workArea);
    } catch {
      return [];
    }
  },
};

async function resolveAvdPath(avdName: string, deps: GuardDeps): Promise<string | null> {
  try {
    const ini = await deps.readFile(
      path.join(deps.homedir(), '.android', 'avd', `${avdName}.ini`)
    );
    return ini.match(/^path=(.+)$/m)?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

export async function sanitizeEmulatorWindowPos(
  avdName: string,
  overrides: Partial<GuardDeps> = {}
): Promise<void> {
  const deps = { ...defaultDeps, ...overrides };
  const displays = await deps.getDisplays();
  if (displays.length === 0) return; // Cannot judge visibility — leave everything alone.
  const avdPath = await resolveAvdPath(avdName, deps);

  const legacyFiles = [path.join(deps.homedir(), '.android', 'emu-last-window-pos')];
  if (avdPath) legacyFiles.push(path.join(avdPath, 'emu-last-window-pos'));
  for (const file of legacyFiles) {
    try {
      const pos = parseWindowPos(await deps.readFile(file));
      if (pos && !isPositionVisible(pos, displays)) await deps.unlink(file);
    } catch {
      // Missing or unreadable file — nothing to sanitize.
    }
  }

  if (!avdPath) return;
  const userIni = path.join(avdPath, 'emulator-user.ini');
  try {
    const content = await deps.readFile(userIni);
    const pos = parseWindowPos(content);
    if (pos && !isPositionVisible(pos, displays)) {
      const safe = { x: displays[0].x + 80, y: displays[0].y + 80 };
      await deps.writeFile(userIni, rewriteUserIniPos(content, safe));
    }
  } catch {
    // Missing or unreadable file — nothing to sanitize.
  }
}
