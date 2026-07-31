import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import type { ApiProxyProfile } from '@shared/contracts/apiWorkbench';

/**
 * Proxy selection and CONNECT tunnelling.
 *
 * Written here rather than pulled in as a proxy-agent package for the same reason the OpenAPI reader
 * was: the security-relevant part is *which* host gets contacted and with what credentials, and that
 * stays legible when the CONNECT handshake is fifty lines in this file.
 *
 * SOCKS5 uses the CONNECT command only. Bureau has no UDP transport, so it deliberately does not
 * expose SOCKS UDP ASSOCIATE: advertising a mode the request engines cannot use safely would be a
 * rather efficient way to create a false sense of coverage.
 */

export type ResolvedProxy =
  | { kind: 'direct' }
  | {
      kind: 'http' | 'https' | 'socks5';
      host: string;
      port: number;
      /** Pre-encoded `Proxy-Authorization` value, or undefined. Never logged. */
      authorization?: string;
      /** SOCKS5 username/password negotiation. Kept out of logs and never stored in a profile. */
      credentials?: { username: string; password: string };
      /** Where the selection came from, so the UI can say "system proxy" honestly. */
      source: 'profile' | 'environment';
    };

/** Proxy environment variables, read only when a profile explicitly selects `system`. */
export type ProxyEnvironment = {
  HTTP_PROXY?: string;
  HTTPS_PROXY?: string;
  NO_PROXY?: string;
};

/**
 * A bypass entry matches a host exactly, or as a suffix when written with a leading dot
 * (`.example.com`). `*` bypasses everything. Deliberately not a glob: a half-understood wildcard in a
 * proxy bypass list is how traffic escapes a corporate proxy by accident.
 */
export function bypassesProxy(hostname: string, bypass: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  for (const raw of bypass) {
    const entry = raw.trim().toLowerCase();
    if (!entry) continue;
    if (entry === '*') return true;
    if (entry.startsWith('.')) {
      if (host === entry.slice(1) || host.endsWith(entry)) return true;
      continue;
    }
    if (host === entry) return true;
    // A bare domain also covers its subdomains, matching curl and the NO_PROXY convention.
    if (host.endsWith(`.${entry}`)) return true;
  }
  return false;
}

function parseProxyUrl(
  value: string
): {
  kind: 'http' | 'https' | 'socks5';
  host: string;
  port: number;
  authorization?: string;
  credentials?: { username: string; password: string };
} | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  // `example.com:8080` with no scheme is the common environment-variable spelling.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'socks5:') return null;
  if (!url.hostname) return null;
  const kind = url.protocol === 'https:' ? 'https' : url.protocol === 'socks5:' ? 'socks5' : 'http';
  const port = url.port ? Number(url.port) : kind === 'https' ? 443 : kind === 'socks5' ? 1080 : 80;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  const authorization =
    url.username || url.password
      ? `Basic ${Buffer.from(
          `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`
        ).toString('base64')}`
      : undefined;
  const username = url.username ? decodeURIComponent(url.username) : '';
  const password = url.password ? decodeURIComponent(url.password) : '';
  return {
    kind,
    host: url.hostname,
    port,
    authorization,
    credentials: kind === 'socks5' && (username || password) ? { username, password } : undefined,
  };
}

export function basicProxyAuthorization(username: string, password: string): string | undefined {
  if (!username && !password) return undefined;
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

/**
 * Chooses the proxy for one URL.
 *
 * Bureau's own launch environment never silently applies (§11.3): `HTTP_PROXY` and friends are read
 * only when the selected profile is `system`, so a shell that happens to export a proxy cannot
 * redirect a request the user configured as direct.
 */
export function resolveProxy(
  url: URL,
  profile: ApiProxyProfile | null,
  environment: ProxyEnvironment = {}
): ResolvedProxy {
  if (!profile || !profile.enabled || profile.mode === 'direct') return { kind: 'direct' };
  if (bypassesProxy(url.hostname, profile.bypass)) return { kind: 'direct' };

  if (profile.mode === 'system') {
    const noProxy = (environment.NO_PROXY ?? '').split(',');
    if (bypassesProxy(url.hostname, noProxy)) return { kind: 'direct' };
    const raw =
      url.protocol === 'https:'
        ? (environment.HTTPS_PROXY ?? environment.HTTP_PROXY)
        : (environment.HTTP_PROXY ?? environment.HTTPS_PROXY);
    const parsed = raw ? parseProxyUrl(raw) : null;
    if (!parsed) return { kind: 'direct' };
    return { ...parsed, source: 'environment' };
  }

  if (
    (profile.mode !== 'http' && profile.mode !== 'https' && profile.mode !== 'socks5') ||
    !profile.host ||
    !profile.port
  ) {
    return { kind: 'direct' };
  }
  return {
    kind: profile.mode,
    host: profile.host,
    port: profile.port,
    source: 'profile',
  };
}

export type ProxyConnectOptions = {
  proxy: Exclude<ResolvedProxy, { kind: 'direct' }>;
  /** Vetted address for the *proxy*, so its hostname is not re-resolved after the check. */
  proxyAddress: { address: string; family: number };
  targetHost: string;
  targetPort: number;
  timeoutMs: number;
  signal?: AbortSignal;
};

/**
 * Opens a CONNECT tunnel to `targetHost:targetPort` through the proxy and resolves with the raw
 * socket. The caller TLS-wraps it for an https target.
 */
export function openProxyTunnel(options: ProxyConnectOptions): Promise<net.Socket> {
  if (options.proxy.kind === 'socks5') return openSocks5Tunnel(options);
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (error: Error | null, socket?: net.Socket): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (error) {
        socket?.destroy();
        reject(error);
        return;
      }
      resolve(socket!);
    };

    const socket =
      options.proxy.kind === 'https'
        ? tls.connect({
            host: options.proxyAddress.address,
            port: options.proxy.port,
            // The certificate is presented for the proxy's own name, not the target's.
            servername: options.proxy.host,
          })
        : net.connect({ host: options.proxyAddress.address, port: options.proxy.port });

    const timer = setTimeout(() => {
      done(new Error('The proxy did not complete the tunnel in time.'), socket);
    }, options.timeoutMs);
    timer.unref?.();

    const onAbort = (): void => done(new Error('The request was cancelled.'), socket);
    if (options.signal?.aborted) {
      done(new Error('The request was cancelled.'), socket);
      return;
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });

    socket.once('error', (error: Error) => done(error, socket));

    const onReady = (): void => {
      // An IPv6 literal must stay bracketed in the request line.
      const authority = options.targetHost.includes(':')
        ? `[${options.targetHost}]:${options.targetPort}`
        : `${options.targetHost}:${options.targetPort}`;
      const lines = [`CONNECT ${authority} HTTP/1.1`, `Host: ${authority}`];
      if (options.proxy.authorization) {
        lines.push(`Proxy-Authorization: ${options.proxy.authorization}`);
      }
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    };

    if (options.proxy.kind === 'https') socket.once('secureConnect', onReady);
    else socket.once('connect', onReady);

    let buffer = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf('\r\n\r\n');
      if (end < 0) {
        // A proxy that never finishes its header block must not grow this buffer without bound.
        if (buffer.byteLength > 64 * 1024) {
          done(new Error('The proxy sent an oversized response to CONNECT.'), socket);
        }
        return;
      }
      socket.off('data', onData);
      const head = buffer.subarray(0, end).toString('latin1');
      const status = Number(/^HTTP\/\d\.\d (\d{3})/.exec(head)?.[1] ?? 0);
      if (status !== 200) {
        const reason = head.split('\r\n')[0] ?? 'the proxy refused the tunnel';
        done(
          new Error(
            status === 407
              ? 'The proxy requires authentication (407).'
              : `The proxy refused the tunnel: ${reason}`
          ),
          socket
        );
        return;
      }
      // Anything after the header block is already tunnel payload; push it back for the TLS layer.
      const rest = buffer.subarray(end + 4);
      if (rest.byteLength > 0) socket.unshift(rest);
      done(null, socket);
    };
    socket.on('data', onData);
  });
}

function socksAddress(targetHost: string): Buffer | null {
  const bare = targetHost.replace(/^\[|\]$/g, '');
  const family = net.isIP(bare);
  if (family === 4) return Buffer.concat([Buffer.from([0x01]), Buffer.from(bare.split('.').map(Number))]);
  if (family === 6) {
    const sections = bare.split('::');
    if (sections.length > 2) return null;
    const left = sections[0] ? sections[0].split(':') : [];
    const right = sections[1] ? sections[1].split(':') : [];
    const groups = [...left, ...Array.from({ length: 8 - left.length - right.length }, () => '0'), ...right];
    if (groups.length !== 8) return null;
    const bytes = Buffer.alloc(16);
    for (let index = 0; index < groups.length; index += 1) {
      const value = Number.parseInt(groups[index]!, 16);
      if (!Number.isInteger(value) || value < 0 || value > 0xffff) return null;
      bytes.writeUInt16BE(value, index * 2);
    }
    return Buffer.concat([Buffer.from([0x04]), bytes]);
  }
  const hostname = Buffer.from(bare, 'utf8');
  if (hostname.byteLength === 0 || hostname.byteLength > 255) return null;
  return Buffer.concat([Buffer.from([0x03, hostname.byteLength]), hostname]);
}

/** SOCKS5 CONNECT with optional RFC 1929 username/password authentication. */
function openSocks5Tunnel(options: ProxyConnectOptions): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const proxy = options.proxy;
    if (proxy.kind !== 'socks5') {
      reject(new Error('The proxy is not a SOCKS5 proxy.'));
      return;
    }
    const target = socksAddress(options.targetHost);
    if (!target) {
      reject(new Error('The target host is not valid for SOCKS5.'));
      return;
    }
    const credentials = proxy.credentials;
    if (credentials && (Buffer.byteLength(credentials.username) > 255 || Buffer.byteLength(credentials.password) > 255)) {
      reject(new Error('SOCKS5 credentials are too long.'));
      return;
    }

    let settled = false;
    let stage: 'greeting' | 'auth' | 'connect' = 'greeting';
    let buffer = Buffer.alloc(0);
    const socket = net.connect({ host: options.proxyAddress.address, port: proxy.port });
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      socket.removeListener('data', onData);
      if (error) {
        socket.destroy();
        reject(error);
      } else {
        resolve(socket);
      }
    };
    const onAbort = (): void => finish(new Error('The request was cancelled.'));
    const timer = setTimeout(() => finish(new Error('The SOCKS5 proxy did not complete the tunnel in time.')), options.timeoutMs);
    timer.unref?.();
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });
    socket.once('error', (error) => finish(error));

    const sendConnect = (): void => {
      const port = Buffer.alloc(2);
      port.writeUInt16BE(options.targetPort, 0);
      socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00]), target, port]));
      stage = 'connect';
    };
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.byteLength > 1024) {
        finish(new Error('The SOCKS5 proxy sent an oversized response.'));
        return;
      }
      if (stage === 'greeting') {
        if (buffer.byteLength < 2) return;
        const reply = buffer.subarray(0, 2);
        buffer = buffer.subarray(2);
        if (reply[0] !== 0x05 || reply[1] === 0xff) {
          finish(new Error('The SOCKS5 proxy rejected authentication.'));
          return;
        }
        if (reply[1] === 0x02) {
          if (!credentials) {
            finish(new Error('The SOCKS5 proxy requires username/password authentication.'));
            return;
          }
          const username = Buffer.from(credentials.username, 'utf8');
          const password = Buffer.from(credentials.password, 'utf8');
          socket.write(Buffer.concat([Buffer.from([0x01, username.byteLength]), username, Buffer.from([password.byteLength]), password]));
          stage = 'auth';
          return;
        }
        if (reply[1] !== 0x00) {
          finish(new Error('The SOCKS5 proxy selected an unsupported authentication method.'));
          return;
        }
        sendConnect();
      }
      if (stage === 'auth') {
        if (buffer.byteLength < 2) return;
        const reply = buffer.subarray(0, 2);
        buffer = buffer.subarray(2);
        if (reply[0] !== 0x01 || reply[1] !== 0x00) {
          finish(new Error('The SOCKS5 proxy rejected the supplied credentials.'));
          return;
        }
        sendConnect();
      }
      if (stage === 'connect') {
        if (buffer.byteLength < 5) return;
        const atyp = buffer[3];
        const addressBytes = atyp === 0x01 ? 4 : atyp === 0x04 ? 16 : atyp === 0x03 ? (buffer[4] ?? 256) + 1 : -1;
        if (addressBytes < 0) {
          finish(new Error('The SOCKS5 proxy returned an invalid address.'));
          return;
        }
        const length = 4 + addressBytes + 2;
        if (buffer.byteLength < length) return;
        const reply = buffer.subarray(0, length);
        const rest = buffer.subarray(length);
        if (reply[0] !== 0x05 || reply[1] !== 0x00) {
          finish(new Error(`The SOCKS5 proxy refused the connection (reply ${reply[1] ?? 255}).`));
          return;
        }
        if (rest.byteLength > 0) socket.unshift(rest);
        finish();
      }
    };
    socket.on('data', onData);
    socket.once('connect', () => socket.write(Buffer.from([0x05, credentials ? 0x02 : 0x01, 0x00, ...(credentials ? [0x02] : [])])));
  });
}

/**
 * An agent that routes every connection through a CONNECT tunnel. A TLS option wraps the tunnel for
 * an HTTPS target; a SOCKS5 or HTTPS proxy carrying a plain HTTP target keeps the raw socket.
 */
export function createTunnelAgent(
  options: Omit<ProxyConnectOptions, 'targetHost' | 'targetPort'> & {
    tlsOptions?: tls.ConnectionOptions;
    targetHost: string;
    targetPort: number;
  }
): http.Agent {
  const agent = new http.Agent({ keepAlive: false, maxSockets: 1 });
  // Node calls this instead of opening its own socket; returning the TLS socket over the tunnel is
  // what makes `https.request` speak end-to-end TLS with the target rather than with the proxy.
  (agent as unknown as { createConnection: unknown }).createConnection = (
    _connectOptions: unknown,
    callback: (error: Error | null, socket?: net.Socket | tls.TLSSocket) => void
  ): void => {
    openProxyTunnel(options).then(
      (socket) => {
        if (!options.tlsOptions) {
          callback(null, socket);
          return;
        }
        const secure = tls.connect({
          ...options.tlsOptions,
          socket,
          servername: options.tlsOptions?.servername ?? options.targetHost,
        });
        secure.once('error', (error) => callback(error));
        secure.once('secureConnect', () => callback(null, secure));
      },
      (error: Error) => callback(error)
    );
  };
  return agent;
}
