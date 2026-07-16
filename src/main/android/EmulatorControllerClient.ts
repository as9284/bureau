import {
  Client,
  credentials,
  makeGenericClientConstructor,
  status as grpcStatus,
  type ClientReadableStream,
  type ServiceDefinition,
  type ServiceError,
} from '@grpc/grpc-js';
import protobuf from 'protobufjs';
import protoSource from './proto/emulator_controller.proto?raw';

// Subset of the emulator's gRPC surface used by the embedded display.
// Message shapes mirror android.emulation.control (see proto/emulator_controller.proto).

export const IMG_FORMAT_PNG = 0;
export const IMG_FORMAT_RGBA8888 = 1;
export const KEY_EVENT_TYPE = { keydown: 0, keyup: 1, keypress: 2 } as const;

export type ImageFormatMessage = {
  format?: number;
  width?: number;
  height?: number;
  display?: number;
  rotation?: { rotation?: number };
};
export type ImageMessage = {
  format: ImageFormatMessage;
  image: Buffer;
  seq: number;
};
export type KeyboardEventMessage = { eventType: number; key?: string; text?: string };
export type MouseEventMessage = { x: number; y: number; buttons: number; display?: number };
export type EmulatorStatusMessage = {
  booted: boolean;
  hardwareConfig?: { entry?: { key: string; value: string }[] };
};

export type EmulatorControllerClient = {
  waitForReady(timeoutMs: number): Promise<void>;
  streamScreenshot(format: ImageFormatMessage): ClientReadableStream<ImageMessage>;
  getScreenshot(format: ImageFormatMessage, timeoutMs?: number): Promise<ImageMessage>;
  sendKey(event: KeyboardEventMessage): Promise<void>;
  sendMouse(event: MouseEventMessage): Promise<void>;
  setClipboard(text: string): Promise<void>;
  getStatus(timeoutMs?: number): Promise<EmulatorStatusMessage>;
  close(): void;
};

export function isCancelledError(error: unknown): boolean {
  return (error as ServiceError | null)?.code === grpcStatus.CANCELLED;
}

const PACKAGE = 'android.emulation.control';
const METHODS = [
  'streamScreenshot',
  'getScreenshot',
  'sendKey',
  'sendMouse',
  'setClipboard',
  'getStatus',
] as const;

let cachedDefinition: ServiceDefinition | null = null;

/** Exported so tests can host an in-process server speaking the same wire format. */
export function loadServiceDefinition(): ServiceDefinition {
  if (cachedDefinition) return cachedDefinition;
  // The vendored proto's only import is google/protobuf/empty.proto; substitute a
  // local Empty message so protobufjs can parse the source standalone.
  const patched =
    protoSource
      .replace(/^import\s+"google\/protobuf\/empty\.proto";\s*$/m, '')
      .replace(/google\.protobuf\.Empty/g, 'Empty') + '\nmessage Empty {}\n';
  const { root } = protobuf.parse(patched, { keepCase: true });
  root.resolveAll();
  const service = root.lookupService(`${PACKAGE}.EmulatorController`);
  const definition: Record<string, ServiceDefinition[string]> = {};
  for (const name of METHODS) {
    const method = service.methods[name];
    method.resolve();
    const requestType = method.resolvedRequestType;
    const responseType = method.resolvedResponseType;
    if (!requestType || !responseType) throw new Error(`Unresolved gRPC method ${name}`);
    definition[name] = {
      path: `/${PACKAGE}.EmulatorController/${name}`,
      requestStream: false,
      responseStream: Boolean(method.responseStream),
      requestSerialize: (value: unknown) =>
        Buffer.from(requestType.encode(requestType.fromObject(value as object)).finish()),
      requestDeserialize: (bytes: Buffer) =>
        requestType.toObject(requestType.decode(bytes), { defaults: true, longs: Number }),
      responseSerialize: (value: unknown) =>
        Buffer.from(responseType.encode(responseType.fromObject(value as object)).finish()),
      responseDeserialize: (bytes: Buffer) =>
        responseType.toObject(responseType.decode(bytes), { defaults: true, longs: Number }),
    };
  }
  cachedDefinition = definition as ServiceDefinition;
  return cachedDefinition;
}

type GenericClient = Client & Record<string, (...args: unknown[]) => unknown>;

export function createEmulatorControllerClient(
  host: string,
  port: number
): EmulatorControllerClient {
  const definition = loadServiceDefinition();
  const Ctor = makeGenericClientConstructor(definition, 'EmulatorController');
  const client = new Ctor(`${host}:${port}`, credentials.createInsecure(), {
    // Frames at panel size are small, but full-resolution screenshots are not.
    'grpc.max_receive_message_length': 64 * 1024 * 1024,
  }) as unknown as GenericClient;

  function unary<TRequest, TResponse>(
    method: string,
    request: TRequest,
    timeoutMs = 10_000
  ): Promise<TResponse> {
    return new Promise<TResponse>((resolve, reject) => {
      client[method](
        request,
        { deadline: Date.now() + timeoutMs },
        (error: ServiceError | null, response: TResponse) => {
          if (error) reject(error);
          else resolve(response);
        }
      );
    });
  }

  return {
    waitForReady: (timeoutMs) =>
      new Promise<void>((resolve, reject) => {
        client.waitForReady(Date.now() + timeoutMs, (error?: Error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
    streamScreenshot: (format) =>
      client.streamScreenshot(format) as ClientReadableStream<ImageMessage>,
    getScreenshot: (format, timeoutMs = 20_000) =>
      unary<ImageFormatMessage, ImageMessage>('getScreenshot', format, timeoutMs),
    sendKey: async (event) => {
      await unary('sendKey', event, 5_000);
    },
    sendMouse: async (event) => {
      await unary('sendMouse', event, 5_000);
    },
    setClipboard: async (text) => {
      await unary('setClipboard', { text }, 5_000);
    },
    getStatus: (timeoutMs = 10_000) =>
      unary<Record<string, never>, EmulatorStatusMessage>('getStatus', {}, timeoutMs),
    close: () => client.close(),
  };
}
