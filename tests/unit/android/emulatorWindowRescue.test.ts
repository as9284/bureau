import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  buildRescueScript,
  watchEmulatorWindow,
  DEFAULT_EMULATOR_SIZE,
} from '../../../src/main/android/EmulatorWindowRescue';
import type { ExecutableAdapter } from '../../../src/main/android/ExecutableAdapter';

function makeAdapter() {
  const spawn = vi.fn(() => new EventEmitter());
  return { adapter: { run: vi.fn(), spawn } as unknown as ExecutableAdapter, spawn };
}

describe('buildRescueScript', () => {
  it('embeds the regex-escaped AVD name', () => {
    const script = buildRescueScript('Pixel_10_Pro_2', DEFAULT_EMULATOR_SIZE);
    expect(script).toContain("$avdPattern = 'Pixel_10_Pro_2'");
  });

  it('escapes regex metacharacters and single quotes in the AVD name', () => {
    const script = buildRescueScript("Odd (2.0) 'name'", DEFAULT_EMULATOR_SIZE);
    expect(script).toContain("$avdPattern = 'Odd \\(2\\.0\\) ''name'''");
  });

  it('embeds the requested target size and moves/measures the window', () => {
    const script = buildRescueScript('X', { width: 360, height: 760 });
    expect(script).toContain('$targetW = 360');
    expect(script).toContain('$targetH = 760');
    expect(script).toContain('MoveWindow');
    expect(script).toContain('GetWindowRect');
  });

  it('rounds fractional sizes to integers', () => {
    const script = buildRescueScript('X', { width: 400.6, height: 819.4 });
    expect(script).toContain('$targetW = 401');
    expect(script).toContain('$targetH = 819');
  });
});

describe('watchEmulatorWindow', () => {
  it('spawns a hidden PowerShell watcher on Windows with the encoded default-size script', () => {
    const { adapter, spawn } = makeAdapter();
    watchEmulatorWindow(adapter, 'Pixel_10_Pro_2');
    expect(spawn).toHaveBeenCalledTimes(1);
    const [exe, args] = spawn.mock.calls[0] as unknown as [string, string[]];
    expect(exe).toBe('powershell.exe');
    expect(args).toContain('-EncodedCommand');
    const encoded = args[args.indexOf('-EncodedCommand') + 1];
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(decoded).toBe(buildRescueScript('Pixel_10_Pro_2', DEFAULT_EMULATOR_SIZE));
  });

  it('passes a custom size through to the script', () => {
    const { adapter, spawn } = makeAdapter();
    watchEmulatorWindow(adapter, 'Pixel_10_Pro_2', { width: 300, height: 640 }, 'win32');
    const [, args] = spawn.mock.calls[0] as unknown as [string, string[]];
    const encoded = args[args.indexOf('-EncodedCommand') + 1];
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(decoded).toContain('$targetW = 300');
    expect(decoded).toContain('$targetH = 640');
  });

  it('does nothing on non-Windows platforms', () => {
    const { adapter, spawn } = makeAdapter();
    watchEmulatorWindow(adapter, 'Pixel_10_Pro_2', DEFAULT_EMULATOR_SIZE, 'darwin');
    watchEmulatorWindow(adapter, 'Pixel_10_Pro_2', DEFAULT_EMULATOR_SIZE, 'linux');
    expect(spawn).not.toHaveBeenCalled();
  });
});
