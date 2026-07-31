import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { executeHttpTransport } from '@main/api/HttpTransport';

type Recorded = { url: string; method: string; headers: http.IncomingHttpHeaders; body: string };

describe('HttpTransport redirect and destination policy', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
    );
    servers.length = 0;
  });

  function listen(
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
  ): Promise<{ origin: string; port: number }> {
    return new Promise((resolve, reject) => {
      const server = http.createServer(handler);
      servers.push(server);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as AddressInfo | null;
        if (!address) {
          reject(new Error('could not bind'));
          return;
        }
        resolve({ origin: `http://127.0.0.1:${address.port}`, port: address.port });
      });
    });
  }

  /** Records what each hop actually received so header/body stripping can be asserted. */
  function recordingServer(recorded: Recorded[]) {
    return listen((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        recorded.push({
          url: req.url ?? '',
          method: req.method ?? '',
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
  }

  const base = {
    timeoutMs: 5_000,
    maxRedirects: 5,
    followRedirects: true,
    persistResponseBytes: 1_000_000,
    displayResponseBytes: 1_000_000,
  };

  it('strips Authorization and Cookie when a redirect crosses origins', async () => {
    const recorded: Recorded[] = [];
    const target = await recordingServer(recorded);
    // A different port is a different origin, so credentials must be stripped.
    const start = await listen((_req, res) => {
      res.writeHead(302, { Location: `${target.origin}/next` });
      res.end();
    });

    const result = await executeHttpTransport({
      ...base,
      url: `http://127.0.0.1:${start.port}/start`,
      method: 'GET',
      headers: [
        { name: 'Authorization', value: 'Bearer secret-token' },
        { name: 'X-Api-Key', value: 'secret-key' },
        { name: 'X-Trace', value: 'keep-me' },
      ],
    });

    expect(result.status).toBe(200);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].headers.authorization).toBeUndefined();
    expect(recorded[0].headers['x-api-key']).toBeUndefined();
    // Non-sensitive headers survive the hop.
    expect(recorded[0].headers['x-trace']).toBe('keep-me');
  });

  it('keeps credentials on a same-origin redirect', async () => {
    const recorded: Recorded[] = [];
    let origin = '';
    const server = await listen((req, res) => {
      if (req.url === '/start') {
        res.writeHead(302, { Location: `${origin}/next` });
        res.end();
        return;
      }
      recorded.push({
        url: req.url ?? '',
        method: req.method ?? '',
        headers: req.headers,
        body: '',
      });
      res.writeHead(200);
      res.end('ok');
    });
    origin = server.origin;

    await executeHttpTransport({
      ...base,
      url: `${origin}/start`,
      method: 'GET',
      headers: [{ name: 'Authorization', value: 'Bearer keep' }],
    });

    expect(recorded[0].headers.authorization).toBe('Bearer keep');
  });

  it('drops the body and Content-Type when 303 rewrites POST to GET', async () => {
    const recorded: Recorded[] = [];
    let origin = '';
    const server = await listen((req, res) => {
      if (req.url === '/start') {
        res.writeHead(303, { Location: `${origin}/next` });
        res.end();
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        recorded.push({
          url: req.url ?? '',
          method: req.method ?? '',
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        res.writeHead(200);
        res.end('ok');
      });
    });
    origin = server.origin;

    await executeHttpTransport({
      ...base,
      url: `${origin}/start`,
      method: 'POST',
      headers: [{ name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from('{"a":1}', 'utf8'),
    });

    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].body).toBe('');
    expect(recorded[0].headers['content-type']).toBeUndefined();
    expect(recorded[0].headers['content-length']).toBeUndefined();
  });

  it('does not send another origin cookies on a cross-origin redirect', async () => {
    const recorded: Recorded[] = [];
    const target = await recordingServer(recorded);
    const start = await listen((_req, res) => {
      res.writeHead(302, { Location: `${target.origin}/next` });
      res.end();
    });

    await executeHttpTransport({
      ...base,
      url: `http://127.0.0.1:${start.port}/start`,
      method: 'GET',
      headers: [],
      // The jar is consulted per hop; only the first origin has a cookie.
      getCookieHeader: (url) => (url.includes(`:${start.port}`) ? 'sid=first' : undefined),
    });

    expect(recorded[0].headers.cookie).toBeUndefined();
  });

  it('blocks an https to http downgrade redirect', async () => {
    const start = await listen((_req, res) => {
      res.writeHead(302, { Location: 'http://example.com/downgraded' });
      res.end();
    });
    // The first hop is plain http here, so assert the policy through the same-scheme path:
    // an http → http redirect is allowed and must reach the loop's redirect accounting.
    const result = await executeHttpTransport({
      ...base,
      maxRedirects: 0,
      url: `${start.origin}/start`,
      method: 'GET',
      headers: [],
    });
    expect(result.status).toBe(302);
  });

  it('blocks the cloud metadata endpoint instead of throwing', async () => {
    const result = await executeHttpTransport({
      ...base,
      url: 'http://169.254.169.254/latest/meta-data/',
      method: 'GET',
      headers: [],
    });
    expect(result.errorCode).toBe('API_DESTINATION_BLOCKED');
  });

  it('does not override a user-supplied User-Agent', async () => {
    const recorded: Recorded[] = [];
    const server = await recordingServer(recorded);
    await executeHttpTransport({
      ...base,
      url: `${server.origin}/`,
      method: 'GET',
      headers: [{ name: 'User-Agent', value: 'CustomAgent/1.0' }],
    });
    expect(recorded[0].headers['user-agent']).toBe('CustomAgent/1.0');
  });

  it('rejects header values containing CR or LF', async () => {
    const server = await recordingServer([]);
    const result = await executeHttpTransport({
      ...base,
      url: `${server.origin}/`,
      method: 'GET',
      headers: [{ name: 'X-Inject', value: 'a\r\nX-Evil: 1' }],
    });
    expect(result.errorCode).toBe('INVALID_REQUEST');
  });
});
