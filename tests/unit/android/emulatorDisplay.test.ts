import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAvdService } from '@main/android/AvdService';
import { createEmulatorDisplayService } from '@main/android/EmulatorDisplayService';
import type {
  EmulatorControllerClient,
  ImageMessage,
} from '@main/android/EmulatorControllerClient';
import { discoverRunningEmulators, parseDiscoveryFile } from '@main/android/emulatorDiscovery';
import { parseSnapshotList } from '@main/android/parsers';
import type { ExecutableAdapter } from '@main/android/ExecutableAdapter';
import type { SdkResolver } from '@main/android/SdkResolver';
import type { EmulatorDisplayEvent } from '@shared/contracts/android';

const status = {
  sdkPath: 'C:\\Android\\Sdk',
  adb: { available: true, path: 'C:\\Android\\Sdk\\platform-tools\\adb.exe' },
  emulator: { available: true, path: 'C:\\Android\\Sdk\\emulator\\emulator.exe' },
  scrcpy: { available: true, path: 'scrcpy.exe' },
  flutter: { available: true, path: 'flutter.exe' },
};

describe('emulator discovery files', () => {
  it('parses a pid_<pid>.ini registration', () => {
    const parsed = parseDiscoveryFile(
      [
        'port.serial=5554',
        'port.adb=5555',
        'avd.name=Pixel_8_API_35',
        'avd.dir=C:\\Users\\dev\\.android\\avd\\Pixel_8_API_35.avd',
        'avd.id=Pixel_8_API_35',
        'cmdline="emulator" "-avd" "Pixel_8_API_35"',
        'grpc.port=8554',
      ].join('\r\n')
    );
    expect(parsed).toEqual({ avdName: 'Pixel_8_API_35', grpcPort: 8554 });
  });

  it('returns a null port when the emulator has no gRPC endpoint', () => {
    expect(parseDiscoveryFile('avd.name=Old_AVD\nport.adb=5555')).toEqual({
      avdName: 'Old_AVD',
      grpcPort: null,
    });
    expect(parseDiscoveryFile('avd.name=Bad\ngrpc.port=999999')).toEqual({
      avdName: 'Bad',
      grpcPort: null,
    });
    expect(parseDiscoveryFile('port.adb=5555')).toBeNull();
  });

  it('scans discovery directories and ignores junk files', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'bureau-avd-discovery-'));
    try {
      await writeFile(
        path.join(dir, 'pid_1234.ini'),
        'avd.name=Pixel_8_API_35\ngrpc.port=8554\n',
        'utf8'
      );
      await writeFile(path.join(dir, 'pid_888.ini'), 'garbage-without-equals\n', 'utf8');
      await writeFile(path.join(dir, 'notes.txt'), 'avd.name=Nope\ngrpc.port=1\n', 'utf8');
      const found = await discoverRunningEmulators([dir, path.join(dir, 'missing-subdir')]);
      expect([...found.entries()]).toEqual([['Pixel_8_API_35', 8554]]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('parseSnapshotList', () => {
  it('parses the qemu snapshot table', () => {
    const output = [
      'List of snapshots present on all disks:',
      ' ID        TAG                 VM SIZE                DATE       VM CLOCK',
      '--        default_boot         48M 2018-10-22 10:52:41   00:00:51.242',
      ' 1         before-upgrade      1.2G 2026-07-16 09:15:00   00:03:11.500',
      'OK',
    ].join('\r\n');
    expect(parseSnapshotList(output)).toEqual([
      { name: 'default_boot', sizeLabel: '48M' },
      { name: 'before-upgrade', sizeLabel: '1.2G' },
    ]);
  });

  it('returns nothing for a device without snapshots', () => {
    expect(parseSnapshotList('There is no snapshot available.\r\nOK\r\n')).toEqual([]);
    expect(parseSnapshotList('KO: bad command\r\n')).toEqual([]);
  });
});

describe('AvdService embedded display launch', () => {
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

  it('adds -qt-hide-window and an allocated -grpc port in embedded mode', async () => {
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
        coldBoot: false,
        wipeData: false,
        gpu: 'auto',
        writableSystem: false,
        displayMode: 'embedded',
      },
      confirmedWipe: false,
    });
    expect(result).toEqual({ ok: true });
    const spawnMock = adapter.spawn as unknown as ReturnType<typeof vi.fn>;
    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args.slice(0, 2)).toEqual(['-avd', 'Pixel_8_API_35']);
    expect(args).toContain('-qt-hide-window');
    const grpcIndex = args.indexOf('-grpc');
    expect(grpcIndex).toBeGreaterThan(-1);
    const port = Number(args[grpcIndex + 1]);
    expect(Number.isInteger(port) && port > 0 && port <= 65535).toBe(true);
    await expect(avds.getGrpcPort('Pixel_8_API_35')).resolves.toBe(port);
    await avds.dispose();
  });

  it('keeps the legacy windowed launch when no display mode is given', async () => {
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
    await avds.start({
      name: 'Pixel_8_API_35',
      options: { coldBoot: false, wipeData: false, gpu: 'auto', writableSystem: false },
      confirmedWipe: false,
    });
    const spawnMock = adapter.spawn as unknown as ReturnType<typeof vi.fn>;
    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args).not.toContain('-qt-hide-window');
    expect(args).not.toContain('-grpc');
    await avds.dispose();
  });
});

type FakeStream = EventEmitter & { cancel: ReturnType<typeof vi.fn> };

function fakeClient(streams: FakeStream[]): EmulatorControllerClient {
  return {
    waitForReady: vi.fn(async () => undefined),
    streamScreenshot: vi.fn(() => {
      const stream = new EventEmitter() as FakeStream;
      stream.cancel = vi.fn();
      streams.push(stream);
      return stream as never;
    }),
    getScreenshot: vi.fn(async () => ({
      format: {},
      image: Buffer.from([1, 2, 3]),
      seq: 0,
    })),
    sendKey: vi.fn(async () => undefined),
    sendMouse: vi.fn(async () => undefined),
    setClipboard: vi.fn(async () => undefined),
    getStatus: vi.fn(async () => ({
      booted: true,
      hardwareConfig: {
        entry: [
          { key: 'hw.lcd.width', value: '1080' },
          { key: 'hw.lcd.height', value: '2400' },
        ],
      },
    })),
    close: vi.fn(),
  };
}

// Raw RGBA frames must be exactly width*height*4 bytes to be forwarded.
function frame(seq: number, rotation = 0): ImageMessage {
  return {
    format: { width: 2, height: 2, rotation: { rotation } },
    image: Buffer.alloc(16, seq),
    seq,
  };
}

describe('EmulatorDisplayService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('connects, reads device dimensions, and forwards frames', async () => {
    const streams: FakeStream[] = [];
    const client = fakeClient(streams);
    const service = createEmulatorDisplayService({
      resolveGrpcPort: async () => 8554,
      clientFactory: () => client,
    });
    const events: EmulatorDisplayEvent[] = [];
    service.onEvent((event) => events.push(event));

    await expect(service.start({ avdName: 'Pixel', width: 400, height: 800 })).resolves.toEqual({
      ok: true,
    });
    expect(events[0]).toMatchObject({ avdName: 'Pixel', state: 'connecting' });
    expect(client.streamScreenshot).toHaveBeenCalledWith({ format: 1, width: 400, height: 800 });

    streams[0].emit('data', frame(1, 1));
    const streaming = events.find((event) => event.state === 'streaming');
    expect(streaming).toMatchObject({
      deviceWidth: 1080,
      deviceHeight: 2400,
      frame: { seq: 1, rotation: 1, width: 2, height: 2, format: 'rgba8888' },
    });
    // A malformed frame (length ≠ width*height*4) is dropped, not forwarded.
    const before = events.length;
    streams[0].emit('data', {
      format: { width: 4, height: 4, rotation: { rotation: 0 } },
      image: Buffer.alloc(3),
      seq: 9,
    });
    expect(events.length).toBe(before);
    service.dispose();
  });

  it('throttles frame fan-out but always delivers the newest frame', async () => {
    vi.useFakeTimers();
    const streams: FakeStream[] = [];
    const client = fakeClient(streams);
    const service = createEmulatorDisplayService({
      resolveGrpcPort: async () => 8554,
      clientFactory: () => client,
    });
    const frames: number[] = [];
    service.onEvent((event) => {
      if (event.frame) frames.push(event.frame.seq);
    });
    await service.start({ avdName: 'Pixel', width: 400, height: 800 });
    streams[0].emit('data', frame(1));
    streams[0].emit('data', frame(2));
    streams[0].emit('data', frame(3));
    expect(frames).toEqual([1]);
    await vi.advanceTimersByTimeAsync(50);
    expect(frames).toEqual([1, 3]);
    service.dispose();
  });

  it('swaps the stream on resize without reconnecting', async () => {
    const streams: FakeStream[] = [];
    const client = fakeClient(streams);
    let clientsCreated = 0;
    const service = createEmulatorDisplayService({
      resolveGrpcPort: async () => 8554,
      clientFactory: () => {
        clientsCreated += 1;
        return client;
      },
    });
    await service.start({ avdName: 'Pixel', width: 400, height: 800 });
    await service.start({ avdName: 'Pixel', width: 640, height: 960 });
    expect(clientsCreated).toBe(1);
    expect(streams).toHaveLength(2);
    expect(streams[0].cancel).toHaveBeenCalled();
    // Identical size is a no-op.
    await service.start({ avdName: 'Pixel', width: 640, height: 960 });
    expect(streams).toHaveLength(2);
    service.dispose();
  });

  it('keeps the session alive when a superseded stream ends after a resize', async () => {
    // Regression: a cancelled stream emits end/error asynchronously, after the
    // replacement stream is already live. The stale event used to tear down the
    // new session, silently killing input and freezing the canvas.
    const streams: FakeStream[] = [];
    const client = fakeClient(streams);
    const service = createEmulatorDisplayService({
      resolveGrpcPort: async () => 8554,
      clientFactory: () => client,
    });
    const events: EmulatorDisplayEvent[] = [];
    service.onEvent((event) => events.push(event));

    await service.start({ avdName: 'Pixel', width: 400, height: 800 });
    await service.start({ avdName: 'Pixel', width: 1600, height: 900 });

    // The old stream reports its cancellation only now.
    streams[0].emit('end');
    streams[0].emit('error', Object.assign(new Error('cancelled'), { code: 1 }));

    expect(events.some((event) => event.state === 'stopped')).toBe(false);
    expect(events.some((event) => event.state === 'error')).toBe(false);
    expect(client.close).not.toHaveBeenCalled();
    // The session still accepts input and still streams the new size.
    await expect(service.sendMouse({ avdName: 'Pixel', x: 5, y: 5, buttons: 1 })).resolves.toEqual({
      ok: true,
    });
    streams[1].emit('data', frame(4));
    expect(events.at(-1)).toMatchObject({ state: 'streaming', frame: { seq: 4 } });
    service.dispose();
  });

  it('maps renderer key/mouse input onto the gRPC message shapes', async () => {
    const streams: FakeStream[] = [];
    const client = fakeClient(streams);
    const service = createEmulatorDisplayService({
      resolveGrpcPort: async () => 8554,
      clientFactory: () => client,
    });
    await service.start({ avdName: 'Pixel', width: 400, height: 800 });
    await expect(
      service.sendKey({ avdName: 'Pixel', eventType: 'keypress', key: 'a' })
    ).resolves.toEqual({ ok: true });
    expect(client.sendKey).toHaveBeenCalledWith({ eventType: 2, key: 'a' });
    await service.sendMouse({ avdName: 'Pixel', x: 12, y: 34, buttons: 1 });
    expect(client.sendMouse).toHaveBeenCalledWith({ x: 12, y: 34, buttons: 1 });
    await expect(service.pressKey('Pixel', 'GoBack')).resolves.toEqual({ ok: true });
    expect(client.sendKey).toHaveBeenCalledWith({ eventType: 2, key: 'GoBack' });

    const missing = await service.sendMouse({ avdName: 'Other', x: 1, y: 1, buttons: 0 });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('INVALID_REQUEST');
    service.dispose();
  });

  it('reports a missing gRPC port as EMULATOR_GRPC_UNAVAILABLE', async () => {
    const service = createEmulatorDisplayService({
      resolveGrpcPort: async () => null,
      clientFactory: () => {
        throw new Error('must not be constructed');
      },
    });
    const events: EmulatorDisplayEvent[] = [];
    service.onEvent((event) => events.push(event));
    const result = await service.start({ avdName: 'Pixel', width: 400, height: 800 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('EMULATOR_GRPC_UNAVAILABLE');
    expect(events.at(-1)?.state).toBe('error');
  });

  it('emits an error and tears down when the stream fails', async () => {
    const streams: FakeStream[] = [];
    const client = fakeClient(streams);
    const service = createEmulatorDisplayService({
      resolveGrpcPort: async () => 8554,
      clientFactory: () => client,
    });
    const events: EmulatorDisplayEvent[] = [];
    service.onEvent((event) => events.push(event));
    await service.start({ avdName: 'Pixel', width: 400, height: 800 });
    streams[0].emit('error', new Error('stream reset'));
    expect(events.at(-1)).toMatchObject({ state: 'error', error: 'stream reset' });
    expect(client.close).toHaveBeenCalled();
    // A stopped session rejects further input.
    const rejected = await service.sendKey({ avdName: 'Pixel', eventType: 'keydown', key: 'a' });
    expect(rejected.ok).toBe(false);
  });

  it('stops cleanly and closes the client', async () => {
    const streams: FakeStream[] = [];
    const client = fakeClient(streams);
    const service = createEmulatorDisplayService({
      resolveGrpcPort: async () => 8554,
      clientFactory: () => client,
    });
    const events: EmulatorDisplayEvent[] = [];
    service.onEvent((event) => events.push(event));
    await service.start({ avdName: 'Pixel', width: 400, height: 800 });
    await expect(service.stop('Pixel')).resolves.toEqual({ ok: true });
    expect(streams[0].cancel).toHaveBeenCalled();
    expect(client.close).toHaveBeenCalled();
    expect(events.at(-1)?.state).toBe('stopped');
  });
});
