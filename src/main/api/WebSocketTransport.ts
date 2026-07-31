import net from 'node:net';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import WebSocket from 'ws';
import type { ApiTlsProfile } from '@shared/contracts/apiWorkbench';
import { isApiDestinationBlocked } from '@shared/net/isApiDestinationBlocked';
import { tlsOptionsForHost } from './TlsPolicy';
import { createTunnelAgent, type ResolvedProxy } from './ProxyPolicy';

export type WebSocketOpenInput = {
  url: string;
  headers: Array<{ name: string; value: string }>;
  subprotocols: string[];
  cookieHeader?: string;
  handshakeTimeoutMs: number;
  maxPayloadBytes: number;
  tls?: { profile: ApiTlsProfile | null; clientKeyPem?: string; passphrase?: string };
  /** Resolved in the application service, so this transport never reads profile secrets. */
  proxy?: ResolvedProxy;
};

export type WebSocketHandlers = {
  onOpen(info: { subprotocol: string; httpStatus?: number }): void;
  onMessage(data: Buffer, isBinary: boolean): void;
  onPing(): void;
  onPong(): void;
  onClose(code: number, reason: string): void;
  onError(code: string, message: string): void;
};

export type WebSocketSession = {
  sendText(text: string): void;
  sendBinary(data: Buffer): void;
  close(code?: number, reason?: string): void;
  /** Immediate teardown for shutdown and cancellation — no close handshake. */
  destroy(): void;
};

/** Headers the RFC 6455 handshake computes; a manual copy would corrupt it. */
const RESERVED_HANDSHAKE_HEADERS = new Set([
  'sec-websocket-key',
  'sec-websocket-version',
  'sec-websocket-accept',
  'sec-websocket-protocol',
  'sec-websocket-extensions',
  'upgrade',
  'connection',
  'host',
]);

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** Applies the same destination policy as HTTP: no metadata endpoints, resolved address vetted. */
async function vetDestination(
  hostname: string
): Promise<{ ok: true; address: { address: string; family: 4 | 6 } } | { ok: false; message: string }> {
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(bare)) {
    return isApiDestinationBlocked(bare)
      ? { ok: false, message: 'The destination address is blocked.' }
      : { ok: true, address: { address: bare, family: net.isIP(bare) === 6 ? 6 : 4 } };
  }
  let records: dns.LookupAddress[];
  try {
    records = await dns.promises.lookup(bare, { all: true, verbatim: true });
  } catch {
    return { ok: false, message: 'The host could not be resolved.' };
  }
  if (records.length === 0) return { ok: false, message: 'The host could not be resolved.' };
  for (const record of records) {
    if (isApiDestinationBlocked(record.address)) {
      return { ok: false, message: 'The destination address is blocked.' };
    }
  }
  const first = records[0]!;
  return { ok: true, address: { address: first.address, family: first.family as 4 | 6 } };
}

export async function openWebSocketSession(
  input: WebSocketOpenInput,
  handlers: WebSocketHandlers
): Promise<{ ok: true; session: WebSocketSession } | { ok: false; code: string; message: string }> {
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return { ok: false, code: 'INVALID_REQUEST', message: 'The WebSocket URL is not valid.' };
  }
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    return { ok: false, code: 'API_PROTOCOL_ERROR', message: 'Only ws: and wss: URLs are supported.' };
  }

  const destination = await vetDestination(url.hostname);
  if (!destination.ok) {
    const code = destination.message.includes('resolved') ? 'API_DNS_FAILED' : 'API_DESTINATION_BLOCKED';
    return { ok: false, code, message: destination.message };
  }

  const headers: Record<string, string> = {};
  for (const header of input.headers) {
    if (RESERVED_HANDSHAKE_HEADERS.has(header.name.toLowerCase())) continue;
    if (hasControlCharacter(header.name) || hasControlCharacter(header.value)) {
      return {
        ok: false,
        code: 'INVALID_REQUEST',
        message: 'Header names and values must not contain CR, LF, or NUL characters.',
      };
    }
    headers[header.name] = header.value;
  }
  if (input.cookieHeader) headers.Cookie = input.cookieHeader;

  const secure = url.protocol === 'wss:';
  const tls = secure
    ? tlsOptionsForHost(url, input.tls?.profile ?? null, {
        clientKeyPem: input.tls?.clientKeyPem,
        passphrase: input.tls?.passphrase,
      })
    : {};

  const proxy = input.proxy && input.proxy.kind !== 'direct' ? input.proxy : null;
  let agent: http.Agent | https.Agent;
  if (proxy) {
    const proxyDestination = await vetDestination(proxy.host);
    if (!proxyDestination.ok) {
      const code = proxyDestination.message.includes('resolved') ? 'API_DNS_FAILED' : 'API_DESTINATION_BLOCKED';
      return { ok: false, code, message: proxyDestination.message };
    }
    agent = createTunnelAgent({
      proxy,
      proxyAddress: proxyDestination.address,
      targetHost: url.hostname,
      targetPort: Number(url.port || (secure ? 443 : 80)),
      timeoutMs: input.handshakeTimeoutMs,
      tlsOptions: secure ? { ...tls, servername: url.hostname } : undefined,
    }) as unknown as http.Agent | https.Agent;
  } else {
    const lookup = (
      _hostname: string,
      options: { all?: boolean },
      callback: (
        error: Error | null,
        address: string | Array<{ address: string; family: number }>,
        family?: number
      ) => void
    ): void => {
      if (options?.all) callback(null, [destination.address]);
      else callback(null, destination.address.address, destination.address.family);
    };
    agent = secure
      ? new https.Agent({ lookup: lookup as never })
      : new http.Agent({ lookup: lookup as never });
  }

  const socket = new WebSocket(url, input.subprotocols, {
    headers,
    handshakeTimeout: input.handshakeTimeoutMs,
    maxPayload: input.maxPayloadBytes,
    followRedirects: false,
    agent,
    ...tls,
  });

  return await new Promise((resolve) => {
    let settled = false;
    let httpStatus: number | undefined;

    socket.on('unexpected-response', (_request, response) => {
      httpStatus = response.statusCode;
      response.resume();
      if (settled) return;
      settled = true;
      socket.terminate();
      resolve({
        ok: false,
        code: 'API_PROTOCOL_ERROR',
        message: `The server rejected the WebSocket upgrade (HTTP ${response.statusCode ?? 0}).`,
      });
    });

    socket.on('error', (error: Error) => {
      const message = error.message || 'The WebSocket connection failed.';
      if (settled) {
        handlers.onError('API_PROTOCOL_ERROR', message);
        return;
      }
      settled = true;
      resolve({ ok: false, code: 'API_CONNECT_FAILED', message });
    });

    socket.on('open', () => {
      if (settled) return;
      settled = true;
      handlers.onOpen({ subprotocol: socket.protocol, httpStatus });
      resolve({
        ok: true,
        session: {
          sendText(text) {
            if (socket.readyState === WebSocket.OPEN) socket.send(text);
          },
          sendBinary(data) {
            if (socket.readyState === WebSocket.OPEN) socket.send(data, { binary: true });
          },
          close(code, reason) {
            if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
              socket.close(code ?? 1000, reason);
            }
          },
          destroy() {
            socket.removeAllListeners();
            socket.terminate();
          },
        },
      });
    });

    socket.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      const buffer = Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data);
      handlers.onMessage(buffer, isBinary);
    });
    socket.on('ping', () => handlers.onPing());
    socket.on('pong', () => handlers.onPong());
    socket.on('close', (code: number, reason: Buffer) => {
      handlers.onClose(code, reason.toString('utf8'));
    });
  });
}
