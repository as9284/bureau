import { describe, it, expect, vi } from 'vitest';
import {
  isPositionVisible,
  parseWindowPos,
  rewriteUserIniPos,
  sanitizeEmulatorWindowPos,
  type DisplayRect,
  type GuardDeps,
} from '../../../src/main/android/windowPosGuard';

const PRIMARY: DisplayRect = { x: 0, y: 0, width: 1920, height: 1080 };

describe('parseWindowPos', () => {
  it('parses bare coordinate pairs', () => {
    expect(parseWindowPos('1912, -8')).toEqual({ x: 1912, y: -8 });
    expect(parseWindowPos('100 200')).toEqual({ x: 100, y: 200 });
  });

  it('prefers labeled x/y values (ini-style)', () => {
    expect(parseWindowPos('[General]\nwidth=400\nx = 3840\ny = 120')).toEqual({ x: 3840, y: 120 });
  });

  it('parses emulator-user.ini window.x/window.y keys', () => {
    const ini = 'window.x = 2500\nwindow.y = -300\nwindow.scale = -1.000000\nuuid = 17839\n';
    expect(parseWindowPos(ini)).toEqual({ x: 2500, y: -300 });
  });

  it('returns null when no coordinates are present', () => {
    expect(parseWindowPos('')).toBeNull();
    expect(parseWindowPos('not a position')).toBeNull();
    expect(parseWindowPos('42')).toBeNull();
  });
});

describe('rewriteUserIniPos', () => {
  it('replaces only the window.x/window.y values', () => {
    const ini = 'window.x = 2500\nwindow.y = -300\nwindow.scale = 0.25\nuuid = 17839\n';
    expect(rewriteUserIniPos(ini, { x: 80, y: 90 })).toBe(
      'window.x = 80\nwindow.y = 90\nwindow.scale = 0.25\nuuid = 17839\n'
    );
  });
});

describe('isPositionVisible', () => {
  it('accepts positions inside a display', () => {
    expect(isPositionVisible({ x: 200, y: 300 }, [PRIMARY])).toBe(true);
  });

  it('tolerates slightly negative offsets from maximized borders', () => {
    expect(isPositionVisible({ x: -8, y: -8 }, [PRIMARY])).toBe(true);
  });

  it('rejects positions on a disconnected monitor', () => {
    // Saved while a second display sat at x=1920+; only the primary remains.
    expect(isPositionVisible({ x: 2200, y: 100 }, [PRIMARY])).toBe(false);
    expect(isPositionVisible({ x: -1600, y: 100 }, [PRIMARY])).toBe(false);
    expect(isPositionVisible({ x: 100, y: -1300 }, [PRIMARY])).toBe(false);
  });

  it('accepts positions on any of several displays', () => {
    const second: DisplayRect = { x: 1920, y: 0, width: 1920, height: 1080 };
    expect(isPositionVisible({ x: 2200, y: 100 }, [PRIMARY, second])).toBe(true);
  });
});

function makeDeps(files: Record<string, string>, displays: DisplayRect[]) {
  const unlink = vi.fn().mockResolvedValue(undefined);
  const writeFile = vi.fn().mockResolvedValue(undefined);
  const deps: GuardDeps = {
    readFile: vi.fn(async (target: string) => {
      const normalized = target.replaceAll('\\', '/');
      const match = Object.keys(files).find((key) => normalized.endsWith(key));
      if (!match) throw new Error('ENOENT');
      return files[match];
    }),
    writeFile,
    unlink,
    homedir: () => 'C:/Users/test',
    getDisplays: async () => displays,
  };
  return { deps, unlink, writeFile };
}

const AVD_INI = { '.android/avd/Pixel_8.ini': 'avd.ini.encoding=UTF-8\npath=C:/avds/Pixel_8.avd\n' };

describe('sanitizeEmulatorWindowPos', () => {
  it('deletes the saved position file when it points off-screen', async () => {
    const { deps, unlink } = makeDeps({ '.android/emu-last-window-pos': '2500, 100' }, [PRIMARY]);
    await sanitizeEmulatorWindowPos('Pixel_8', deps);
    expect(unlink).toHaveBeenCalledTimes(1);
    expect(String(unlink.mock.calls[0][0])).toContain('emu-last-window-pos');
  });

  it('keeps the file when the position is still visible', async () => {
    const { deps, unlink } = makeDeps({ '.android/emu-last-window-pos': '400, 300' }, [PRIMARY]);
    await sanitizeEmulatorWindowPos('Pixel_8', deps);
    expect(unlink).not.toHaveBeenCalled();
  });

  it('also checks the per-AVD file resolved through the AVD ini', async () => {
    const { deps, unlink } = makeDeps(
      { ...AVD_INI, 'Pixel_8.avd/emu-last-window-pos': 'x=-3000\ny=50' },
      [PRIMARY]
    );
    await sanitizeEmulatorWindowPos('Pixel_8', deps);
    expect(unlink).toHaveBeenCalledTimes(1);
    expect(String(unlink.mock.calls[0][0]).replaceAll('\\', '/')).toContain(
      'Pixel_8.avd/emu-last-window-pos'
    );
  });

  it('rewrites window.x/window.y in emulator-user.ini when off-screen, keeping other lines', async () => {
    const ini = 'window.x = 2500\nwindow.y = 100\nwindow.scale = -1.000000\nuuid = 17839\n';
    const { deps, unlink, writeFile } = makeDeps(
      { ...AVD_INI, 'Pixel_8.avd/emulator-user.ini': ini },
      [PRIMARY]
    );
    await sanitizeEmulatorWindowPos('Pixel_8', deps);
    expect(unlink).not.toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledTimes(1);
    const [target, content] = writeFile.mock.calls[0] as [string, string];
    expect(target.replaceAll('\\', '/')).toContain('Pixel_8.avd/emulator-user.ini');
    expect(content).toBe(
      'window.x = 80\nwindow.y = 80\nwindow.scale = -1.000000\nuuid = 17839\n'
    );
  });

  it('leaves emulator-user.ini alone when the position is visible', async () => {
    const ini = 'window.x = 100\nwindow.y = 100\nwindow.scale = -1.000000\n';
    const { deps, writeFile } = makeDeps(
      { ...AVD_INI, 'Pixel_8.avd/emulator-user.ini': ini },
      [PRIMARY]
    );
    await sanitizeEmulatorWindowPos('Pixel_8', deps);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('does nothing when displays cannot be determined', async () => {
    const { deps, unlink } = makeDeps({ '.android/emu-last-window-pos': '9999, 9999' }, []);
    await sanitizeEmulatorWindowPos('Pixel_8', deps);
    expect(unlink).not.toHaveBeenCalled();
  });

  it('does nothing when no position file exists or it cannot be parsed', async () => {
    const missing = makeDeps({}, [PRIMARY]);
    await sanitizeEmulatorWindowPos('Pixel_8', missing.deps);
    expect(missing.unlink).not.toHaveBeenCalled();

    const garbage = makeDeps({ '.android/emu-last-window-pos': 'garbage' }, [PRIMARY]);
    await sanitizeEmulatorWindowPos('Pixel_8', garbage.deps);
    expect(garbage.unlink).not.toHaveBeenCalled();
  });
});
