import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { isBlockedAddress } from '@shared/net/isBlockedAddress';

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal']);

export type PublicEndpoint = {
  url: URL;
  address: string;
  family: 4 | 6;
};

/**
 * Validates protocol/credentials, resolves the host, and rejects private,
 * loopback, link-local, ULA, and reserved destinations. Returns a pinned
 * address so the subsequent request cannot be DNS-rebound.
 */
export async function resolvePublicEndpoint(url: URL): Promise<PublicEndpoint | { error: string }> {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    return { error: 'Only credential-free HTTP and HTTPS image URLs are allowed.' };
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || BLOCKED_HOSTNAMES.has(hostname)) {
    return { error: 'Remote image hosts on the local or private network are not allowed.' };
  }

  const literalFamily = net.isIP(hostname);
  if (literalFamily) {
    if (isBlockedAddress(hostname)) {
      return { error: 'Remote image hosts on the local or private network are not allowed.' };
    }
    return { url, address: hostname, family: literalFamily as 4 | 6 };
  }

  let records: dns.LookupAddress[];
  try {
    records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch {
    return { error: 'The remote image host could not be resolved.' };
  }
  const publicRecord = records.find((record) => !isBlockedAddress(record.address));
  if (!publicRecord) {
    return { error: 'Remote image hosts on the local or private network are not allowed.' };
  }
  return { url, address: publicRecord.address, family: publicRecord.family as 4 | 6 };
}

type FetchPinnedResult = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Uint8Array;
};

/**
 * Performs an HTTP(S) GET pinned to a previously validated address so a
 * DNS rebinding between lookup and connect cannot reach a private target.
 */
export function fetchPinned(
  endpoint: PublicEndpoint,
  options: { signal?: AbortSignal; headers?: http.OutgoingHttpHeaders; maxBytes: number }
): Promise<FetchPinnedResult> {
  const transport = endpoint.url.protocol === 'https:' ? https : http;
  const agent = new transport.Agent({
    lookup(_hostname, _options, callback) {
      callback(null, endpoint.address, endpoint.family);
    },
  });

  return new Promise((resolve, reject) => {
    const request = transport.request(
      endpoint.url,
      {
        method: 'GET',
        agent,
        headers: options.headers,
        timeout: 10_000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let byteLength = 0;
        response.on('data', (chunk: Buffer) => {
          byteLength += chunk.byteLength;
          if (byteLength > options.maxBytes) {
            request.destroy();
            reject(Object.assign(new Error('FILE_TOO_LARGE'), { code: 'FILE_TOO_LARGE' }));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          });
        });
        response.on('error', reject);
      }
    );
    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('timeout'));
    });
    if (options.signal) {
      const onAbort = () => {
        request.destroy();
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      };
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener('abort', onAbort, { once: true });
    }
    request.end();
  });
}
