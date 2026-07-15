import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createAdbService } from '@main/android/AdbService';
import { createLogcatStreamer } from '@main/android/LogcatStreamer';
import { createAvdService } from '@main/android/AvdService';
import type { ExecutableAdapter } from '@main/android/ExecutableAdapter';
import type { SdkResolver } from '@main/android/SdkResolver';

const status = {
  sdkPath: 'C:\\Android\\Sdk',
  adb: { available: true, path: 'C:\\Android\\Sdk\\platform-tools\\adb.exe' },
  emulator: { available: true, path: 'C:\\Android\\Sdk\\emulator\\emulator.exe' },
  scrcpy: { available: true, path: 'scrcpy.exe' },
  flutter: { available: true, path: 'flutter.exe' },
};

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    killed: boolean;
    kill(): boolean;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    child.emit('close', 0);
    return true;
  };
  return child;
}

describe('Android services', () => {
  it('constructs emulator launch options as isolated arguments', async () => {
    const child = fakeChild();
    const adapter = {
      run: vi.fn(async () => ({ code: 0, stdout: 'Pixel_8_API_35\n', stderr: '' })),
      spawn: vi.fn(() => {
        queueMicrotask(() => child.emit('spawn'));
        return child;
      }),
    } as unknown as ExecutableAdapter;
    const adb = {
      listDevices: vi.fn(async () => []),
      stopEmulator: vi.fn(async () => undefined),
      bootStatus: vi.fn(async () => false),
    };
    const avds = createAvdService(
      { resolve: async () => status } as SdkResolver,
      adapter,
      adb as never
    );
    const result = await avds.start({
      name: 'Pixel_8_API_35',
      options: {
        coldBoot: true,
        wipeData: true,
        gpu: 'host',
        dnsServer: '8.8.8.8',
        writableSystem: true,
      },
      confirmedWipe: true,
    });
    expect(result).toEqual({ ok: true });
    expect(adapter.spawn).toHaveBeenCalledWith(
      status.emulator.path,
      [
        '-avd',
        'Pixel_8_API_35',
        '-no-snapshot-load',
        '-wipe-data',
        '-gpu',
        'host',
        '-dns-server',
        '8.8.8.8',
        '-writable-system',
      ],
      { cwd: status.sdkPath, windowsHide: false }
    );
    await avds.dispose();
  });

  it('gracefully stops an emulator and terminates its tracked process tree', async () => {
    const child = fakeChild();
    let devices: Array<{
      id: string;
      type: 'emulator';
      state: 'device';
      avdName: string;
    }> = [];
    const adapter = {
      run: vi.fn(async () => ({ code: 0, stdout: 'Pixel_8_API_35\n', stderr: '' })),
      spawn: vi.fn(() => {
        queueMicrotask(() => child.emit('spawn'));
        return child;
      }),
    } as unknown as ExecutableAdapter;
    const adb = {
      listDevices: vi.fn(async () => devices),
      stopEmulator: vi.fn(async () => undefined),
      bootStatus: vi.fn(async () => true),
    };
    const stopTree = vi.fn(async () => {
      child.kill();
    });
    const avds = createAvdService(
      { resolve: async () => status } as SdkResolver,
      adapter,
      adb as never,
      stopTree
    );

    await avds.start({
      name: 'Pixel_8_API_35',
      options: { coldBoot: false, wipeData: false, gpu: 'auto', writableSystem: false },
      confirmedWipe: false,
    });
    devices = [
      {
        id: 'emulator-5554',
        type: 'emulator',
        state: 'device',
        avdName: 'Pixel_8_API_35',
      },
    ];

    await expect(avds.stop({ name: 'Pixel_8_API_35', deviceId: 'emulator-5554' })).resolves.toEqual(
      { ok: true }
    );
    expect(adb.stopEmulator).toHaveBeenCalledWith('emulator-5554');
    expect(stopTree).toHaveBeenCalledWith(child);
  });

  it('uses the tracked process tree when graceful emulator shutdown fails', async () => {
    const child = fakeChild();
    const adapter = {
      run: vi.fn(async () => ({ code: 0, stdout: 'Pixel_8_API_35\n', stderr: '' })),
      spawn: vi.fn(() => {
        queueMicrotask(() => child.emit('spawn'));
        return child;
      }),
    } as unknown as ExecutableAdapter;
    const adb = {
      listDevices: vi.fn(async () => []),
      stopEmulator: vi.fn(async () => {
        throw new Error('ADB disconnected.');
      }),
      bootStatus: vi.fn(async () => false),
    };
    const stopTree = vi.fn(async () => {
      child.kill();
    });
    const avds = createAvdService(
      { resolve: async () => status } as SdkResolver,
      adapter,
      adb as never,
      stopTree
    );

    await avds.start({
      name: 'Pixel_8_API_35',
      options: { coldBoot: false, wipeData: false, gpu: 'auto', writableSystem: false },
      confirmedWipe: false,
    });

    await expect(avds.stop({ name: 'Pixel_8_API_35', deviceId: 'emulator-5554' })).resolves.toEqual(
      { ok: true }
    );
    expect(stopTree).toHaveBeenCalledWith(child);
  });

  it('selects explicit devices and includes -s in every device command', async () => {
    const calls: string[][] = [];
    const adapter = {
      run: vi.fn(async (_exe: string, args: string[]) => {
        calls.push(args);
        if (args[0] === 'devices')
          return {
            code: 0,
            stdout:
              'List of devices attached\nserial-1 device model:Pixel_8\nserial-2 device model:Pixel_7\n',
            stderr: '',
          };
        if (args.includes('pm'))
          return { code: 0, stdout: 'package:com.example.app\n', stderr: '' };
        return { code: 0, stdout: '', stderr: '' };
      }),
      spawn: vi.fn(),
    } as unknown as ExecutableAdapter;
    const adb = createAdbService({ resolve: async () => status } as SdkResolver, adapter);
    const packages = await adb.listPackages('serial-2');
    expect(packages.packages).toEqual(['com.example.app']);
    expect(calls).toContainEqual(['-s', 'serial-2', 'shell', 'pm', 'list', 'packages']);
    await adb.reversePort('serial-2', 8081);
    await adb.openDevMenu('serial-2');
    await adb.reloadReactNative('serial-2', 'com.example.app');
    expect(calls).toContainEqual(['-s', 'serial-2', 'reverse', 'tcp:8081', 'tcp:8081']);
    expect(calls).toContainEqual(['-s', 'serial-2', 'shell', 'input', 'keyevent', '82']);
    expect(calls).toContainEqual([
      '-s',
      'serial-2',
      'shell',
      'am',
      'broadcast',
      '-a',
      'com.example.app.RELOAD_APP_ACTION',
      '-p',
      'com.example.app',
    ]);
    await expect(adb.selectDevice()).rejects.toMatchObject({ code: 'AMBIGUOUS_DEVICE' });
  });

  it('starts and stops bounded logcat with an explicit serial', async () => {
    const child = fakeChild();
    const adapter = { spawn: vi.fn(() => child), run: vi.fn() } as unknown as ExecutableAdapter;
    const adb = {
      selectDevice: vi.fn(async () => ({ id: 'serial-1', type: 'physical', state: 'device' })),
      adbPath: vi.fn(async () => 'adb'),
      run: vi.fn(async () => ({ code: 0, stdout: 'PID NAME\n123 com.example.app\n', stderr: '' })),
    };
    const streamer = createLogcatStreamer(adb as never, adapter);
    const events: number[] = [];
    streamer.onEvent((event) => {
      if (event.running) events.push(event.lines.length);
    });
    await streamer.start('serial-1', { priority: 'V' });
    expect(adapter.spawn).toHaveBeenCalledWith('adb', [
      '-s',
      'serial-1',
      'logcat',
      '-v',
      'threadtime',
    ]);
    child.stdout.write('07-14 10:22:31.123  123  125 E Tag: failure\n');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(streamer.snapshot().lines[0]).toMatchObject({
      packageName: 'com.example.app',
      message: 'failure',
    });
    expect(events).toEqual([1]);
    await streamer.stop();
    expect(streamer.snapshot().running).toBe(false);
  });
});
