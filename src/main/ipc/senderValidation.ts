import type { IpcMainInvokeEvent } from 'electron';

export class InvalidSenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSenderError';
  }
}

export function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const frame = event.senderFrame;
  if (!frame) {
    throw new InvalidSenderError('IPC sender has no frame');
  }

  const url = frame.url;
  if (!url) {
    throw new InvalidSenderError('IPC sender frame has no URL');
  }

  if (process.env.NODE_ENV === 'development') {
    if (!url.startsWith('http://localhost:')) {
      throw new InvalidSenderError(`Untrusted development sender URL: ${url}`);
    }
    return;
  }

  if (!url.startsWith('file://')) {
    throw new InvalidSenderError(`Untrusted packaged sender URL: ${url}`);
  }
}
