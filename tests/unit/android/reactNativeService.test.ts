import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReactNativeService } from '@main/android/ReactNativeService';
import type { ProcessDefinition } from '@shared/contracts/projects';
import type { ProcessRuntime } from '@shared/contracts/processes';

const projectId = '11111111-1111-4111-8111-111111111111';
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'bureau-rn-'));
  await fs.mkdir(path.join(root, 'android', 'app'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      dependencies: { 'react-native': '0.84.0' },
      scripts: { start: 'react-native start', android: 'react-native run-android' },
    })
  );
  await fs.writeFile(
    path.join(root, 'android', 'app', 'build.gradle'),
    'android { defaultConfig { applicationId "com.ledger.mobile" } }'
  );
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function setup() {
  const definitions: ProcessDefinition[] = [];
  const runtimes: ProcessRuntime[] = [];
  const processes = {
    list: vi.fn(async () => ({ definitions, runtimes })),
    saveDefinition: vi.fn(async ({ definition }: { definition: ProcessDefinition }) => {
      const index = definitions.findIndex((item) => item.id === definition.id);
      if (index >= 0) definitions[index] = definition;
      else definitions.push(definition);
      return { definitions, runtimes };
    }),
    start: vi.fn(async ({ processId }: { processId: string }) => {
      const index = runtimes.findIndex((item) => item.processId === processId);
      const runtime: ProcessRuntime = {
        projectId,
        processId,
        status: 'running',
        restartCount: 0,
        ready: false,
      };
      if (index >= 0) runtimes[index] = runtime;
      else runtimes.push(runtime);
      return { ok: true as const };
    }),
    stop: vi.fn(async ({ processId }: { processId: string }) => {
      const runtime = runtimes.find((item) => item.processId === processId);
      if (runtime) runtime.status = 'exited';
      return { ok: true as const };
    }),
  };
  const adb = {
    selectDevice: vi.fn(async () => ({
      id: 'emulator-5554',
      model: 'Pixel 9',
      type: 'emulator',
      state: 'device',
    })),
    reversePort: vi.fn(async () => undefined),
    reloadReactNative: vi.fn(async () => undefined),
    openDevMenu: vi.fn(async () => undefined),
  };
  const settingsStore = {
    get: () => ({
      android: {
        reactNativeMetroPort: 8088,
        reactNativeAutoReverse: true,
      },
    }),
  };
  const service = createReactNativeService({
    catalogue: { get: () => ({ projectId, path: root }) } as never,
    processes: processes as never,
    adb: adb as never,
    settingsStore: settingsStore as never,
  });
  return { service, definitions, processes, adb };
}

describe('ReactNativeService', () => {
  it('inspects a native project and detects its package and scripts', async () => {
    const { service } = setup();
    await expect(service.getStatus(projectId)).resolves.toMatchObject({
      detected: true,
      nativeAndroid: true,
      packageManager: 'npm',
      metroPort: 8088,
      metroStatus: 'idle',
      packageName: 'com.ledger.mobile',
      startScriptAvailable: true,
      androidScriptAvailable: true,
    });
  });

  it('starts managed Metro and targets one device for the Android build', async () => {
    const { service, definitions, adb } = setup();
    await expect(service.runAndroid({ projectId, deviceId: 'emulator-5554' })).resolves.toEqual({
      ok: true,
    });
    expect(definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'react-native-metro',
          command: 'npm',
          args: ['run', 'start', '--', '--port', '8088'],
        }),
        expect.objectContaining({
          id: 'react-native-android-emulator-5554',
          command: 'npm',
          args: [
            'run',
            'android',
            '--',
            '--device',
            'emulator-5554',
            '--no-packager',
            '--port',
            '8088',
          ],
          env: { ANDROID_SERIAL: 'emulator-5554', RCT_METRO_PORT: '8088' },
        }),
      ])
    );
    expect(adb.reversePort).toHaveBeenCalledWith('emulator-5554', 8088);
  });

  it('uses the detected package for reload and opens the developer menu explicitly', async () => {
    const { service, adb } = setup();
    await expect(service.reload({ projectId, deviceId: 'emulator-5554' })).resolves.toEqual({
      ok: true,
    });
    await expect(service.openDevMenu({ projectId, deviceId: 'emulator-5554' })).resolves.toEqual({
      ok: true,
    });
    expect(adb.reloadReactNative).toHaveBeenCalledWith('emulator-5554', 'com.ledger.mobile');
    expect(adb.openDevMenu).toHaveBeenCalledWith('emulator-5554');
  });

  it('explains why a managed project without native Android cannot run', async () => {
    await fs.rm(path.join(root, 'android'), { recursive: true });
    const { service } = setup();
    await expect(service.getStatus(projectId)).resolves.toMatchObject({
      detected: true,
      nativeAndroid: false,
      reason: expect.stringContaining('Expo prebuild'),
    });
  });
});
