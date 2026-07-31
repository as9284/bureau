import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { executeHttpTransport } from '@main/api/HttpTransport';
import { createSseParser, type SseEvent } from '@main/api/SseTransport';

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('condition not met within timeout');
}

describe('SSE over the HTTP transport', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
    );
    servers.length = 0;
  });

  function listen(
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
  ): Promise<{ origin: string }> {
    return new Promise((resolve) => {
      const server = http.createServer(handler);
      servers.push(server);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as AddressInfo;
        resolve({ origin: `http://127.0.0.1:${address.port}` });
      });
    });
  }

  async function listenProxy(): Promise<{ port: number; requests: string[] }> {
    const requests: string[] = [];
    const proxy = http.createServer((request, response) => {
      requests.push(request.url ?? '');
      const target = new URL(request.url ?? '');
      const upstream = http.request(
        { host: target.hostname, port: target.port, path: `${target.pathname}${target.search}`, method: request.method, headers: request.headers },
        (upstreamResponse) => {
          response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
          upstreamResponse.pipe(response);
        }
      );
      upstream.on('error', () => response.end());
      request.pipe(upstream);
    });
    const port = await new Promise<number>((resolve) => {
      servers.push(proxy);
      proxy.listen(0, '127.0.0.1', () => resolve((proxy.address() as AddressInfo).port));
    });
    return { port, requests };
  }

  const base = {
    method: 'GET',
    headers: [{ name: 'Accept', value: 'text/event-stream' }],
    timeoutMs: 0,
    maxRedirects: 0,
    followRedirects: false,
    // Streaming mode must never accumulate the body.
    persistResponseBytes: 0,
    displayResponseBytes: 0,
  };

  function streamTo(events: SseEvent[]) {
    const parser = createSseParser({
      onEvent: (event) => events.push(event),
      onComment: () => undefined,
      onRetry: () => undefined,
      onId: () => undefined,
    });
    return parser;
  }

  it('parses events delivered across separate chunks and writes', async () => {
    const server = await listen((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      // Deliberately split a single event across writes.
      res.write('event: tick\ndata: {"n"');
      setTimeout(() => res.write(':1}\n\n'), 20);
      setTimeout(() => res.write('data: second\n\n'), 40);
      setTimeout(() => res.end(), 60);
    });

    const events: SseEvent[] = [];
    const parser = streamTo(events);
    let contentType: string | undefined;

    const result = await executeHttpTransport({
      ...base,
      url: `${server.origin}/events`,
      onResponseStart: (info) => {
        contentType = info.contentType;
      },
      onBodyChunk: (chunk) => parser.push(chunk.toString('utf8')),
    });
    parser.end();

    expect(contentType).toContain('text/event-stream');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ eventName: 'tick', data: '{"n":1}' });
    expect(events[1].data).toBe('second');
    // Streaming mode leaves the accumulated body empty by design.
    expect(result.body.byteLength).toBe(0);
    expect(result.wireBytes).toBeGreaterThan(0);
  });

  it('sends Last-Event-ID when resuming', async () => {
    let receivedLastEventId: string | undefined;
    const server = await listen((req, res) => {
      receivedLastEventId = req.headers['last-event-id'] as string | undefined;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('id: 7\ndata: resumed\n\n');
      res.end();
    });

    const events: SseEvent[] = [];
    const parser = streamTo(events);
    await executeHttpTransport({
      ...base,
      url: `${server.origin}/events`,
      headers: [...base.headers, { name: 'Last-Event-ID', value: '6' }],
      onBodyChunk: (chunk) => parser.push(chunk.toString('utf8')),
    });
    parser.end();

    expect(receivedLastEventId).toBe('6');
    expect(events[0]).toMatchObject({ data: 'resumed', eventId: '7' });
  });

  it('streams SSE through the selected HTTP proxy', async () => {
    const server = await listen((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: proxied\n\n');
    });
    const proxy = await listenProxy();
    const events: SseEvent[] = [];
    const parser = streamTo(events);
    const result = await executeHttpTransport({
      ...base,
      url: `${server.origin}/events`,
      proxy: { kind: 'http', host: '127.0.0.1', port: proxy.port, source: 'profile' },
      onBodyChunk: (chunk) => parser.push(chunk.toString('utf8')),
    });
    parser.end();
    expect(result.status).toBe(200);
    expect(events[0]?.data).toBe('proxied');
    expect(proxy.requests).toEqual([`${server.origin}/events`]);
  });

  it('cancels an endless stream and releases the socket', async () => {
    let closed = false;
    const server = await listen((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const timer = setInterval(() => res.write('data: tick\n\n'), 10);
      res.on('close', () => {
        closed = true;
        clearInterval(timer);
      });
    });

    const events: SseEvent[] = [];
    const parser = streamTo(events);
    const controller = new AbortController();

    const pending = executeHttpTransport({
      ...base,
      url: `${server.origin}/endless`,
      signal: controller.signal,
      onBodyChunk: (chunk) => parser.push(chunk.toString('utf8')),
    });

    await waitFor(() => events.length >= 2);
    controller.abort();

    const result = await pending;
    expect(result.errorCode).toBe('API_CANCELLED');
    await waitFor(() => closed);
  });

  it('still opens when the endpoint returns the wrong content type', async () => {
    const server = await listen((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('data: not-a-stream\n\n');
    });

    let seenContentType: string | undefined;
    const events: SseEvent[] = [];
    const parser = streamTo(events);
    await executeHttpTransport({
      ...base,
      url: `${server.origin}/events`,
      onResponseStart: (info) => {
        seenContentType = info.contentType;
      },
      onBodyChunk: (chunk) => parser.push(chunk.toString('utf8')),
    });
    parser.end();

    // The caller decides how to warn; the transport still surfaces what arrived.
    expect(seenContentType).toBe('text/plain');
    expect(events[0].data).toBe('not-a-stream');
  });
});
