import { describe, expect, it } from 'vitest';
import { createExecutableAdapter } from '@main/android/ExecutableAdapter';
import { createSdkResolver } from '@main/android/SdkResolver';
import { createAdbService } from '@main/android/AdbService';
import { createLogcatStreamer } from '@main/android/LogcatStreamer';
import type { SettingsStore } from '@main/settings/SettingsStore';

const enabled = Boolean(process.env.ANDROID_HOME && process.env.BUREAU_ANDROID_DEVICE);

describe('Android tools integration', () => {
  it.runIf(enabled)('lists a real device and starts and stops logcat', async () => {
    const sdkPath = process.env.ANDROID_HOME;
    const settingsStore = {
      get: () => ({ android: { sdkPath, defaultLogcatPriority: 'V', defaultLogcatFilter: '' } }),
    } as SettingsStore;
    const resolver = createSdkResolver(settingsStore);
    const adapter = createExecutableAdapter();
    const adb = createAdbService(resolver, adapter);
    const devices = await adb.listDevices();
    expect(devices.some((device) => device.id === process.env.BUREAU_ANDROID_DEVICE)).toBe(true);
    const streamer = createLogcatStreamer(adb, adapter);
    await streamer.start(process.env.BUREAU_ANDROID_DEVICE, { priority: 'E' });
    expect(streamer.snapshot().running).toBe(true);
    await streamer.stop();
    expect(streamer.snapshot().running).toBe(false);
  });
});
