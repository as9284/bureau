import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSdkResolver } from '@main/android/SdkResolver';
import type { SettingsStore } from '@main/settings/SettingsStore';
import type { PublicSettings } from '@shared/contracts/settings';

const tempDirs: string[] = [];
afterEach(async () =>
  Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
);

function settings(sdkPath?: string): SettingsStore {
  const value = {
    schemaVersion: 1,
    editor: { kind: 'none' },
    terminal: { kind: 'auto' },
    general: { startupView: 'hub', confirmBeforeQuit: true },
    appearance: {
      theme: 'dark',
      density: 'compact',
      accentColor: '#7c9cff',
      immersiveMode: false,
    },
    tools: { showOpenInEditor: true, showOpenInTerminal: true, showOpenInExplorer: true },
    layout: { paneWidths: { files: 340, commit: 280 } },
    notifications: { enabled: false, longRunningOnly: true },
    android: { sdkPath, defaultLogcatPriority: 'V', defaultLogcatFilter: '' },
  } as PublicSettings;
  return { get: () => value } as SettingsStore;
}

describe('SdkResolver', () => {
  it('prefers a configured SDK and resolves its adb and emulator tools', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bureau-sdk-'));
    tempDirs.push(root);
    await mkdir(path.join(root, 'platform-tools'), { recursive: true });
    await mkdir(path.join(root, 'emulator'), { recursive: true });
    await writeFile(path.join(root, 'platform-tools', 'adb.exe'), '');
    await writeFile(path.join(root, 'emulator', 'emulator.exe'), '');
    const resolver = createSdkResolver(settings(root), {
      platform: 'win32',
      env: {},
      home: root,
      resolveExecutable: async () => undefined,
    });
    const result = await resolver.resolve();
    expect(result.sdkPath).toBe(root);
    expect(result.adb.available).toBe(true);
    expect(result.emulator.available).toBe(true);
    expect(result.scrcpy.available).toBe(false);
  });
});
