import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export type ResponseBodyMetadata = {
  bodyId: string;
  byteLength: number;
  mediaType?: string;
  encoding?: string;
  sha256: string;
  truncated: boolean;
  createdAt: string;
};

export type ResponseBodyStore = {
  writeBody(
    bodyId: string,
    data: Buffer,
    options: { mediaType?: string; encoding?: string; maxBytes: number }
  ): Promise<ResponseBodyMetadata>;
  readBody(bodyId: string): Promise<Buffer | null>;
  readBodyPreview(bodyId: string, maxBytes: number): Promise<Buffer | null>;
  deleteBody(bodyId: string): Promise<void>;
};

export function createResponseBodyStore(bodiesDir: string): ResponseBodyStore {
  function bodyPath(bodyId: string): string {
    return path.join(bodiesDir, `${bodyId}.bin`);
  }

  async function writeBody(
    bodyId: string,
    data: Buffer,
    options: { mediaType?: string; encoding?: string; maxBytes: number }
  ): Promise<ResponseBodyMetadata> {
    const truncated = data.byteLength > options.maxBytes;
    const toWrite = truncated ? data.subarray(0, options.maxBytes) : data;
    const sha256 = createHash('sha256').update(toWrite).digest('hex');
    await fs.writeFile(bodyPath(bodyId), toWrite);
    return {
      bodyId,
      byteLength: toWrite.byteLength,
      mediaType: options.mediaType,
      encoding: options.encoding,
      sha256,
      truncated,
      createdAt: new Date().toISOString(),
    };
  }

  async function readBody(bodyId: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(bodyPath(bodyId));
    } catch {
      return null;
    }
  }

  async function readBodyPreview(bodyId: string, maxBytes: number): Promise<Buffer | null> {
    const file = bodyPath(bodyId);
    try {
      const handle = await fs.open(file, 'r');
      try {
        const buffer = Buffer.alloc(maxBytes);
        const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
        return buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    } catch {
      return null;
    }
  }

  async function deleteBody(bodyId: string): Promise<void> {
    try {
      await fs.unlink(bodyPath(bodyId));
    } catch {
      // already gone
    }
  }

  return { writeBody, readBody, readBodyPreview, deleteBody };
}
