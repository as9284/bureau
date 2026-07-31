import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { openWebSocketSession, type WebSocketSession } from '@main/api/WebSocketTransport';

type Recorded = {
  messages: Array<{ text: string; binary: boolean }>;
  closes: Array<{ code: number; reason: string }>;
  errors: string[];
  opens: Array<{ subprotocol: string }>;
};

function handlers(recorded: Recorded) {
  return {
    onOpen: (info: { subprotocol: string }) => recorded.opens.push(info),
    onMessage: (data: Buffer, isBinary: boolean) =>
      recorded.messages.push({ text: data.toString(isBinary ? 'hex' : 'utf8'), binary: isBinary }),
    onPing: () => undefined,
    onPong: () => undefined,
    onClose: (code: number, reason: string) => recorded.closes.push({ code, reason }),
    onError: (_code: string, message: string) => recorded.errors.push(message),
  };
}

function empty(): Recorded {
  return { messages: [], closes: [], errors: [], opens: [] };
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('condition not met within timeout');
}

const baseInput = {
  headers: [] as Array<{ name: string; value: string }>,
  subprotocols: [] as string[],
  handshakeTimeoutMs: 3_000,
  maxPayloadBytes: 1_000_000,
};

describe('WebSocketTransport (real RFC 6455 server)', () => {
  const servers: http.Server[] = [];
  const wsServers: WebSocketServer[] = [];
  const sessions: WebSocketSession[] = [];

  afterEach(async () => {
    for (const session of sessions) session.destroy();
    sessions.length = 0;
    for (const wss of wsServers) wss.close();
    wsServers.length = 0;
    await Promise.all(
      servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
    );
    servers.length = 0;
  });

  function listen(
    onConnection: (socket: WsSocket, request: http.IncomingMessage) => void,
    options?: { handleProtocols?: (protocols: Set<string>) => string | false }
  ): Promise<{ url: string; port: number }> {
    return new Promise((resolve) => {
      const server = http.createServer();
      servers.push(server);
      const wss = new WebSocketServer({ server, ...options });
      wsServers.push(wss);
      wss.on('connection', onConnection);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as AddressInfo;
        resolve({ url: `ws://127.0.0.1:${address.port}`, port: address.port });
      });
    });
  }

  async function listenConnectProxy(): Promise<{ port: number; connects: string[] }> {
    const connects: string[] = [];
    const proxy = http.createServer();
    servers.push(proxy);
    proxy.on('connect', (request, client, head) => {
      connects.push(request.url ?? '');
      const [host, port] = (request.url ?? '').split(':');
      const upstream = net.connect({ host, port: Number(port) }, () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.byteLength) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      });
      upstream.on('error', () => client.destroy());
      client.on('error', () => upstream.destroy());
    });
    const port = await new Promise<number>((resolve) => {
      proxy.listen(0, '127.0.0.1', () => resolve((proxy.address() as AddressInfo).port));
    });
    return { port, connects };
  }

  it('connects, exchanges text, and receives a close frame', async () => {
    const recorded = empty();
    const server = await listen((socket) => {
      socket.on('message', (data) => socket.send(`echo:${data.toString()}`));
    });

    const opened = await openWebSocketSession({ ...baseInput, url: server.url }, handlers(recorded));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    sessions.push(opened.session);

    opened.session.sendText('hello');
    await waitFor(() => recorded.messages.length > 0);
    expect(recorded.messages[0]).toEqual({ text: 'echo:hello', binary: false });

    opened.session.close(1000, 'done');
    await waitFor(() => recorded.closes.length > 0);
    expect(recorded.closes[0].code).toBe(1000);
  });

  it('round-trips a binary frame', async () => {
    const recorded = empty();
    const server = await listen((socket) => {
      socket.on('message', (data, isBinary) => socket.send(data, { binary: isBinary }));
    });

    const opened = await openWebSocketSession({ ...baseInput, url: server.url }, handlers(recorded));
    if (!opened.ok) throw new Error('expected the socket to open');
    sessions.push(opened.session);

    opened.session.sendBinary(Buffer.from('deadbeef', 'hex'));
    await waitFor(() => recorded.messages.length > 0);
    expect(recorded.messages[0]).toEqual({ text: 'deadbeef', binary: true });
  });

  it('negotiates a subprotocol', async () => {
    const recorded = empty();
    const server = await listen(
      (socket) => socket.send('ready'),
      { handleProtocols: (protocols) => (protocols.has('bureau.v1') ? 'bureau.v1' : false) }
    );

    const opened = await openWebSocketSession(
      { ...baseInput, url: server.url, subprotocols: ['bureau.v1', 'other'] },
      handlers(recorded)
    );
    if (!opened.ok) throw new Error('expected the socket to open');
    sessions.push(opened.session);
    expect(recorded.opens[0].subprotocol).toBe('bureau.v1');
  });

  it('sends custom headers and cookies on the handshake', async () => {
    let received: http.IncomingHttpHeaders = {};
    const recorded = empty();
    const server = await listen((socket, request) => {
      received = request.headers;
      socket.send('ok');
    });

    const opened = await openWebSocketSession(
      {
        ...baseInput,
        url: server.url,
        headers: [{ name: 'X-Trace', value: 'abc' }],
        cookieHeader: 'sid=1',
      },
      handlers(recorded)
    );
    if (!opened.ok) throw new Error('expected the socket to open');
    sessions.push(opened.session);
    await waitFor(() => recorded.messages.length > 0);
    expect(received['x-trace']).toBe('abc');
    expect(received.cookie).toBe('sid=1');
  });

  it('upgrades through an HTTP CONNECT proxy', async () => {
    const recorded = empty();
    const server = await listen((socket) => socket.send('through-proxy'));
    const proxy = await listenConnectProxy();
    const opened = await openWebSocketSession(
      {
        ...baseInput,
        url: server.url,
        proxy: { kind: 'http', host: '127.0.0.1', port: proxy.port, source: 'profile' },
      },
      handlers(recorded)
    );
    if (!opened.ok) throw new Error(opened.message);
    sessions.push(opened.session);
    await waitFor(() => recorded.messages.length > 0);
    expect(proxy.connects).toEqual([`127.0.0.1:${server.port}`]);
    expect(recorded.messages[0]?.text).toBe('through-proxy');
  });

  it('rejects a header containing CRLF before connecting', async () => {
    const server = await listen((socket) => socket.send('ok'));
    const opened = await openWebSocketSession(
      { ...baseInput, url: server.url, headers: [{ name: 'X-Bad', value: 'a\r\nX-Evil: 1' }] },
      handlers(empty())
    );
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.code).toBe('INVALID_REQUEST');
  });

  it('rejects a non-ws scheme', async () => {
    const opened = await openWebSocketSession(
      { ...baseInput, url: 'https://example.com/socket' },
      handlers(empty())
    );
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.code).toBe('API_PROTOCOL_ERROR');
  });

  it('applies the destination policy to the metadata endpoint', async () => {
    const opened = await openWebSocketSession(
      { ...baseInput, url: 'ws://169.254.169.254/socket' },
      handlers(empty())
    );
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.code).toBe('API_DESTINATION_BLOCKED');
  });

  it('reports a rejected upgrade instead of hanging', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(403);
      res.end('nope');
    });
    servers.push(server);
    const port = await new Promise<number>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
    });

    const opened = await openWebSocketSession(
      { ...baseInput, url: `ws://127.0.0.1:${port}` },
      handlers(empty())
    );
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.message).toContain('403');
  });

  it('releases the socket on destroy so no listener survives', async () => {
    const recorded = empty();
    let serverSocket: WsSocket | null = null;
    const server = await listen((socket) => {
      serverSocket = socket;
    });

    const opened = await openWebSocketSession({ ...baseInput, url: server.url }, handlers(recorded));
    if (!opened.ok) throw new Error('expected the socket to open');
    opened.session.destroy();

    await waitFor(() => serverSocket !== null && serverSocket.readyState !== serverSocket.OPEN);
    // destroy() is a hard teardown, so no close entry is delivered to the (removed) handlers.
    expect(recorded.closes).toHaveLength(0);
  });
});
