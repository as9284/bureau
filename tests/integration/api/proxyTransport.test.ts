import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { executeHttpTransport } from '@main/api/HttpTransport';
import { openProxyTunnel } from '@main/api/ProxyPolicy';

/**
 * Real sockets through a real proxy. The CONNECT handshake is hand-written, so it is exercised
 * against an actual proxy process rather than a mock that would agree with whatever we wrote.
 */
describe('proxying through a real HTTP proxy', () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(closers.map((close) => close()));
    closers.length = 0;
  });

  function track(server: http.Server | net.Server): void {
    // `close()` alone waits for live sockets, and a tunnel test deliberately leaves one half-open.
    // `closeAllConnections` only exists on http.Server, so raw net servers track their own sockets.
    const live = new Set<net.Socket>();
    server.on('connection', (socket: net.Socket) => {
      live.add(socket);
      socket.on('close', () => live.delete(socket));
    });
    closers.push(
      () =>
        new Promise<void>((resolve) => {
          for (const socket of live) socket.destroy();
          live.clear();
          if ('closeAllConnections' in server) server.closeAllConnections();
          server.close(() => resolve());
        })
    );
  }

  function listen(server: http.Server | net.Server): Promise<number> {
    return new Promise((resolve, reject) => {
      track(server);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('could not bind'));
          return;
        }
        resolve(address.port);
      });
    });
  }

  /** An origin server that reports what it was asked for. */
  async function originServer(): Promise<number> {
    return listen(
      http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ url: req.url, host: req.headers.host }));
      })
    );
  }

  type ProxyLog = {
    absoluteFormRequests: string[];
    connects: string[];
    authorizations: Array<string | undefined>;
  };

  /**
   * A minimal forward proxy: absolute-form requests for plain HTTP, CONNECT for tunnels.
   * `requireAuth` makes it answer 407 unless credentials arrive.
   */
  async function proxyServer(options: { requireAuth?: boolean } = {}): Promise<{
    port: number;
    log: ProxyLog;
  }> {
    const log: ProxyLog = { absoluteFormRequests: [], connects: [], authorizations: [] };
    const server = http.createServer((req, res) => {
      log.absoluteFormRequests.push(req.url ?? '');
      log.authorizations.push(req.headers['proxy-authorization'] as string | undefined);
      if (options.requireAuth && !req.headers['proxy-authorization']) {
        res.statusCode = 407;
        res.end('proxy auth required');
        return;
      }
      // Forward the absolute-form request to the origin it names.
      const target = new URL(req.url ?? '');
      const upstream = http.request(
        {
          host: target.hostname,
          port: target.port,
          path: `${target.pathname}${target.search}`,
          method: req.method,
          headers: { ...req.headers, host: target.host },
        },
        (upstreamResponse) => {
          res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
          upstreamResponse.pipe(res);
        }
      );
      upstream.on('error', () => {
        res.statusCode = 502;
        res.end('bad gateway');
      });
      req.pipe(upstream);
    });

    server.on('connect', (req, clientSocket, head) => {
      log.connects.push(req.url ?? '');
      log.authorizations.push(req.headers['proxy-authorization'] as string | undefined);
      if (options.requireAuth && !req.headers['proxy-authorization']) {
        clientSocket.write('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
        clientSocket.end();
        return;
      }
      const [host, port] = (req.url ?? '').split(':');
      const upstream = net.connect({ host, port: Number(port) }, () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head?.length) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });
      upstream.on('error', () => clientSocket.destroy());
      clientSocket.on('error', () => upstream.destroy());
    });

    const port = await listen(server);
    return { port, log };
  }

  /** Minimal SOCKS5 CONNECT proxy. It is deliberately real socket plumbing, not a mocked agent. */
  async function socksServer(): Promise<{ port: number; connects: string[] }> {
    const connects: string[] = [];
    const server = net.createServer((client) => {
      let stage: 'greeting' | 'connect' | 'piping' = 'greeting';
      let buffer = Buffer.alloc(0);
      client.on('data', (chunk) => {
        if (stage === 'piping') return;
        buffer = Buffer.concat([buffer, chunk]);
        if (stage === 'greeting') {
          if (buffer.byteLength < 2 + buffer[1]!) return;
          buffer = buffer.subarray(2 + buffer[1]!);
          client.write(Buffer.from([0x05, 0x00]));
          stage = 'connect';
        }
        if (stage !== 'connect' || buffer.byteLength < 5) return;
        const atyp = buffer[3];
        const addressBytes = atyp === 0x01 ? 4 : atyp === 0x03 ? (buffer[4] ?? 255) + 1 : -1;
        if (addressBytes < 0 || buffer.byteLength < 4 + addressBytes + 2) {
          client.destroy();
          return;
        }
        const address =
          atyp === 0x01
            ? [...buffer.subarray(4, 8)].join('.')
            : buffer.subarray(5, 5 + buffer[4]!).toString('utf8');
        const portOffset = 4 + addressBytes;
        const targetPort = buffer.readUInt16BE(portOffset);
        const rest = buffer.subarray(portOffset + 2);
        connects.push(`${address}:${targetPort}`);
        const upstream = net.connect({ host: address, port: targetPort }, () => {
          client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          if (rest.byteLength) upstream.write(rest);
          upstream.pipe(client);
          client.pipe(upstream);
          stage = 'piping';
        });
        upstream.on('error', () => client.destroy());
      });
    });
    return { port: await listen(server), connects };
  }

  const baseRequest = {
    method: 'GET',
    headers: [],
    timeoutMs: 5_000,
    maxRedirects: 3,
    followRedirects: true,
    persistResponseBytes: 1024 * 1024,
    displayResponseBytes: 1024 * 1024,
  };

  it('sends a plain HTTP request to the proxy in absolute form', async () => {
    const originPort = await originServer();
    const proxy = await proxyServer();

    const result = await executeHttpTransport({
      ...baseRequest,
      url: `http://127.0.0.1:${originPort}/users?a=1`,
      proxy: { kind: 'http', host: '127.0.0.1', port: proxy.port, source: 'profile' },
    });

    expect(result.status).toBe(200);
    expect(JSON.parse(result.body.toString('utf8'))).toEqual({
      url: '/users?a=1',
      host: `127.0.0.1:${originPort}`,
    });
    // The proxy saw the absolute URI, which is what makes it a proxy request rather than a direct one.
    expect(proxy.log.absoluteFormRequests).toEqual([`http://127.0.0.1:${originPort}/users?a=1`]);
  });

  it('attaches proxy credentials and surfaces a 407 rather than hanging', async () => {
    const originPort = await originServer();
    const proxy = await proxyServer({ requireAuth: true });
    const authorization = `Basic ${Buffer.from('u:p').toString('base64')}`;

    const denied = await executeHttpTransport({
      ...baseRequest,
      url: `http://127.0.0.1:${originPort}/x`,
      proxy: { kind: 'http', host: '127.0.0.1', port: proxy.port, source: 'profile' },
    });
    expect(denied.status).toBe(407);

    const allowed = await executeHttpTransport({
      ...baseRequest,
      url: `http://127.0.0.1:${originPort}/x`,
      proxy: { kind: 'http', host: '127.0.0.1', port: proxy.port, authorization, source: 'profile' },
    });
    expect(allowed.status).toBe(200);
    expect(proxy.log.authorizations).toContain(authorization);
  });

  it('opens a CONNECT tunnel and speaks end-to-end through it', async () => {
    const originPort = await originServer();
    const proxy = await proxyServer();

    const socket = await openProxyTunnel({
      proxy: { kind: 'http', host: '127.0.0.1', port: proxy.port, source: 'profile' },
      proxyAddress: { address: '127.0.0.1', family: 4 },
      targetHost: '127.0.0.1',
      targetPort: originPort,
      timeoutMs: 5_000,
    });

    expect(proxy.log.connects).toEqual([`127.0.0.1:${originPort}`]);

    // The tunnel is a plain byte pipe to the origin, so an HTTP request over it just works.
    const body = await new Promise<string>((resolve, reject) => {
      let received = '';
      socket.on('data', (chunk: Buffer) => {
        received += chunk.toString('utf8');
        if (received.includes('\r\n\r\n') && received.includes('}')) resolve(received);
      });
      socket.on('error', reject);
      socket.write(`GET /tunnelled HTTP/1.1\r\nHost: 127.0.0.1:${originPort}\r\nConnection: close\r\n\r\n`);
    });
    socket.destroy();

    expect(body).toContain('200 OK');
    expect(body).toContain('/tunnelled');
  });

  it('sends a plain HTTP request through a SOCKS5 CONNECT tunnel', async () => {
    const originPort = await originServer();
    const proxy = await socksServer();
    const result = await executeHttpTransport({
      ...baseRequest,
      url: `http://127.0.0.1:${originPort}/socks`,
      proxy: { kind: 'socks5', host: '127.0.0.1', port: proxy.port, source: 'profile' },
    });
    expect(result.status).toBe(200);
    expect(proxy.connects).toEqual([`127.0.0.1:${originPort}`]);
    expect(result.body.toString('utf8')).toContain('/socks');
  });

  it('reports a refused tunnel instead of leaving the socket open', async () => {
    const proxy = await proxyServer({ requireAuth: true });

    await expect(
      openProxyTunnel({
        proxy: { kind: 'http', host: '127.0.0.1', port: proxy.port, source: 'profile' },
        proxyAddress: { address: '127.0.0.1', family: 4 },
        targetHost: '127.0.0.1',
        targetPort: 1,
        timeoutMs: 5_000,
      })
    ).rejects.toThrow(/authentication/i);
  });

  it('gives up on a proxy that accepts the socket but never answers CONNECT', async () => {
    // A silent proxy is the case a naive implementation hangs on forever.
    const silent = net.createServer();
    const port = await listen(silent);

    const startedAt = Date.now();
    await expect(
      openProxyTunnel({
        proxy: { kind: 'http', host: '127.0.0.1', port, source: 'profile' },
        proxyAddress: { address: '127.0.0.1', family: 4 },
        targetHost: '127.0.0.1',
        targetPort: 80,
        timeoutMs: 300,
      })
    ).rejects.toThrow(/in time/);
    expect(Date.now() - startedAt).toBeLessThan(3_000);
  });

  it('cancels a pending tunnel when the signal aborts', async () => {
    const silent = net.createServer();
    const port = await listen(silent);
    const controller = new AbortController();

    const pending = openProxyTunnel({
      proxy: { kind: 'http', host: '127.0.0.1', port, source: 'profile' },
      proxyAddress: { address: '127.0.0.1', family: 4 },
      targetHost: '127.0.0.1',
      targetPort: 80,
      timeoutMs: 10_000,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelled/i);
  });

  it('still refuses a blocked destination when a proxy is configured', async () => {
    const proxy = await proxyServer();
    // A proxy must not become a way around the metadata block.
    const result = await executeHttpTransport({
      ...baseRequest,
      url: 'http://169.254.169.254/latest/meta-data/',
      proxy: { kind: 'http', host: '127.0.0.1', port: proxy.port, source: 'profile' },
    });
    expect(result.errorCode).toBe('API_DESTINATION_BLOCKED');
    expect(proxy.log.absoluteFormRequests).toEqual([]);
  });
});
