import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { executeHttpTransport } from '@main/api/HttpTransport';
import { isApiDestinationBlocked } from '@shared/net/isApiDestinationBlocked';

describe('isApiDestinationBlocked', () => {
  it('blocks cloud metadata endpoints', () => {
    expect(isApiDestinationBlocked('169.254.169.254')).toBe(true);
    expect(isApiDestinationBlocked('fd00:ec2::254')).toBe(true);
  });

  it('allows loopback and RFC1918 addresses', () => {
    expect(isApiDestinationBlocked('127.0.0.1')).toBe(false);
    expect(isApiDestinationBlocked('192.168.1.10')).toBe(false);
  });
});

describe('HttpTransport', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          })
      )
    );
    servers.length = 0;
  });

  function listen(
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
  ): Promise<{ url: string; port: number }> {
    return new Promise((resolve, reject) => {
      const server = http.createServer(handler);
      servers.push(server);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Could not bind test server'));
          return;
        }
        resolve({ url: `http://127.0.0.1:${address.port}`, port: address.port });
      });
    });
  }

  it('fetches JSON from a local server', async () => {
    const { url } = await listen((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });

    const response = await executeHttpTransport({
      url: `${url}/hello`,
      method: 'GET',
      headers: [],
      timeoutMs: 5_000,
      maxRedirects: 0,
      followRedirects: true,
      persistResponseBytes: 1024 * 1024,
      displayResponseBytes: 1024 * 1024,
    });

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    expect(response.body.toString('utf8')).toContain('"ok":true');
  });

  it('strips authorization on cross-origin redirects', async () => {
    let sawAuth = false;
    const target = await listen((req, res) => {
      sawAuth = Boolean(req.headers.authorization);
      res.statusCode = 200;
      res.end('done');
    });
    const origin = await listen((_req, res) => {
      res.statusCode = 302;
      res.setHeader('Location', `${target.url}/final`);
      res.end();
    });

    const response = await executeHttpTransport({
      url: `${origin.url}/start`,
      method: 'GET',
      headers: [{ name: 'Authorization', value: 'Bearer secret' }],
      timeoutMs: 5_000,
      maxRedirects: 5,
      followRedirects: true,
      persistResponseBytes: 1024 * 1024,
      displayResponseBytes: 1024 * 1024,
    });

    expect(response.ok).toBe(true);
    expect(sawAuth).toBe(false);
  });

  it('cancels in-flight requests', async () => {
    const { url } = await listen((_req, res) => {
      setTimeout(() => {
        res.statusCode = 200;
        res.end('late');
      }, 500);
    });

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    const response = await executeHttpTransport({
      url,
      method: 'GET',
      headers: [],
      timeoutMs: 5_000,
      maxRedirects: 0,
      followRedirects: true,
      persistResponseBytes: 1024 * 1024,
      displayResponseBytes: 1024 * 1024,
      signal: controller.signal,
    });

    expect(response.errorCode).toBe('API_CANCELLED');
  });

  it('truncates oversized response bodies', async () => {
    const { url } = await listen((_req, res) => {
      res.end('x'.repeat(20_000));
    });

    const response = await executeHttpTransport({
      url,
      method: 'GET',
      headers: [],
      timeoutMs: 5_000,
      maxRedirects: 0,
      followRedirects: true,
      persistResponseBytes: 1_024,
      displayResponseBytes: 512,
    });

    expect(response.truncated).toBe(true);
    expect(response.body.byteLength).toBeLessThanOrEqual(512);
    expect(response.wireBytes).toBeGreaterThan(1_024);
  });
});
