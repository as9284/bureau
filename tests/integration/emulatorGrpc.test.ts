import { Server, ServerCredentials } from '@grpc/grpc-js';
import type { ServerWritableStream, UntypedServiceImplementation } from '@grpc/grpc-js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createEmulatorControllerClient,
  IMG_FORMAT_PNG,
  loadServiceDefinition,
  type ImageFormatMessage,
  type ImageMessage,
} from '@main/android/EmulatorControllerClient';

// Hosts a real gRPC server speaking the vendored emulator_controller.proto wire
// format, then drives the production client against it. This proves the proto
// parses, the method paths resolve, and messages round-trip through protobuf
// encoding — everything short of a live emulator.

describe('EmulatorControllerClient against an in-process gRPC server', () => {
  let server: Server | null = null;

  afterEach(() => {
    server?.forceShutdown();
    server = null;
  });

  it('round-trips status, screenshots, a frame stream, and key events', async () => {
    const definition = loadServiceDefinition();
    const received: { key?: unknown; mouse?: unknown; clipboard?: unknown } = {};
    server = new Server();
    server.addService(definition, {
      getStatus: (_call: unknown, callback: (error: null, value: unknown) => void) =>
        callback(null, {
          booted: true,
          hardwareConfig: {
            entry: [
              { key: 'hw.lcd.width', value: '1080' },
              { key: 'hw.lcd.height', value: '2400' },
            ],
          },
        }),
      getScreenshot: (
        call: ServerWritableStream<ImageFormatMessage, ImageMessage> & {
          request: ImageFormatMessage;
        },
        callback: (error: null, value: unknown) => void
      ) =>
        callback(null, {
          format: { format: call.request.format, width: call.request.width },
          image: Buffer.from([137, 80, 78, 71]),
          seq: 7,
        }),
      streamScreenshot: (call: ServerWritableStream<ImageFormatMessage, ImageMessage>) => {
        call.write({
          format: {
            width: call.request.width,
            height: call.request.height,
            rotation: { rotation: 1 },
          },
          image: Buffer.from([1, 2, 3]),
          seq: 1,
        } as ImageMessage);
        call.write({
          format: { width: call.request.width, height: call.request.height },
          image: Buffer.from([4, 5, 6]),
          seq: 2,
        } as ImageMessage);
        call.end();
      },
      sendKey: (call: { request: unknown }, callback: (error: null, value: unknown) => void) => {
        received.key = call.request;
        callback(null, {});
      },
      sendMouse: (call: { request: unknown }, callback: (error: null, value: unknown) => void) => {
        received.mouse = call.request;
        callback(null, {});
      },
      setClipboard: (
        call: { request: unknown },
        callback: (error: null, value: unknown) => void
      ) => {
        received.clipboard = call.request;
        callback(null, {});
      },
    } as unknown as UntypedServiceImplementation);

    const port = await new Promise<number>((resolve, reject) => {
      server?.bindAsync('127.0.0.1:0', ServerCredentials.createInsecure(), (error, bound) => {
        if (error) reject(error);
        else resolve(bound);
      });
    });

    const client = createEmulatorControllerClient('127.0.0.1', port);
    try {
      await client.waitForReady(5_000);

      const status = await client.getStatus();
      expect(status.booted).toBe(true);
      expect(status.hardwareConfig?.entry).toEqual([
        { key: 'hw.lcd.width', value: '1080' },
        { key: 'hw.lcd.height', value: '2400' },
      ]);

      const screenshot = await client.getScreenshot({ format: IMG_FORMAT_PNG, width: 320 });
      expect(screenshot.seq).toBe(7);
      expect(Buffer.from(screenshot.image)).toEqual(Buffer.from([137, 80, 78, 71]));

      const frames: ImageMessage[] = [];
      await new Promise<void>((resolve, reject) => {
        const stream = client.streamScreenshot({ format: IMG_FORMAT_PNG, width: 320, height: 640 });
        stream.on('data', (image: ImageMessage) => frames.push(image));
        stream.on('end', resolve);
        stream.on('error', reject);
      });
      expect(frames).toHaveLength(2);
      expect(frames[0].format.rotation?.rotation).toBe(1);
      expect(frames[0].format.width).toBe(320);
      expect(Buffer.from(frames[1].image)).toEqual(Buffer.from([4, 5, 6]));

      await client.sendKey({ eventType: 2, key: 'GoBack' });
      expect(received.key).toMatchObject({ eventType: 2, key: 'GoBack' });

      await client.sendMouse({ x: 12, y: 34, buttons: 1 });
      expect(received.mouse).toMatchObject({ x: 12, y: 34, buttons: 1 });

      await client.setClipboard('hello from bureau');
      expect(received.clipboard).toMatchObject({ text: 'hello from bureau' });
    } finally {
      client.close();
    }
  });
});
