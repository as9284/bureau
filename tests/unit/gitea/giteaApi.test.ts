import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, afterEach } from 'vitest';
import {
  giteaErrorMessage,
  giteaRequest,
  isSameGiteaHost,
  isUnderGiteaHost,
  normalizeHostUrl,
} from '../../../src/main/gitea/giteaApi';

type Received = { method?: string; url?: string; headers: http.IncomingHttpHeaders; body: string };

let server: http.Server | undefined;

async function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse, received: Received) => void
): Promise<{ hostUrl: string; received: Received }> {
  const received: Received = { headers: {}, body: '' };
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      received.method = req.method;
      received.url = req.url;
      received.headers = req.headers;
      received.body = Buffer.concat(chunks).toString('utf8');
      handler(req, res, received);
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { hostUrl: `http://127.0.0.1:${port}`, received };
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  }
});

describe('normalizeHostUrl', () => {
  it('strips trailing slashes so API paths never double up', () => {
    expect(normalizeHostUrl('https://gitea.example.com/')).toBe('https://gitea.example.com');
    expect(normalizeHostUrl('https://gitea.example.com///')).toBe('https://gitea.example.com');
  });

  it('preserves a subpath install', () => {
    expect(normalizeHostUrl('https://example.com/gitea/')).toBe('https://example.com/gitea');
  });
});

describe('isSameGiteaHost', () => {
  it('matches an origin regardless of trailing slash or case', () => {
    expect(isSameGiteaHost('https://Gitea.example.com/', 'https://gitea.example.com')).toBe(true);
  });

  it('does not match a different origin or port', () => {
    expect(isSameGiteaHost('https://evil.example.com', 'https://gitea.example.com')).toBe(false);
    expect(isSameGiteaHost('http://127.0.0.1:3000', 'http://127.0.0.1:3001')).toBe(false);
  });

  it('returns false for a non-URL remote (SCP-style ssh remote)', () => {
    expect(isSameGiteaHost('git@gitea.example.com:me/repo.git', 'https://gitea.example.com')).toBe(
      false
    );
  });
});

describe('isUnderGiteaHost — the external-link allowlist', () => {
  it('allows a repository page on the connected instance', () => {
    expect(isUnderGiteaHost('https://gitea.example.com/me/repo', 'https://gitea.example.com')).toBe(
      true
    );
  });

  it('rejects another origin', () => {
    expect(isUnderGiteaHost('https://evil.example.com/me/repo', 'https://gitea.example.com')).toBe(
      false
    );
  });

  it('rejects a sibling path that merely shares the subpath prefix', () => {
    expect(isUnderGiteaHost('https://example.com/gitea-evil/x', 'https://example.com/gitea')).toBe(
      false
    );
    expect(isUnderGiteaHost('https://example.com/gitea/me/repo', 'https://example.com/gitea')).toBe(
      true
    );
  });
});

describe('giteaRequest', () => {
  it('reaches a loopback instance — a self-hosted Gitea is normally not public', async () => {
    const { hostUrl, received } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ login: 'ana' }));
    });

    const result = await giteaRequest({ hostUrl, token: 'tok', method: 'GET', path: '/user' });
    expect(result).toEqual({ ok: true, status: 200, body: { login: 'ana' } });
    expect(received.url).toBe('/api/v1/user');
    expect(received.headers.authorization).toBe('token tok');
  });

  it('sends a JSON body on POST', async () => {
    const { hostUrl, received } = await startServer((_req, res) => {
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ clone_url: 'http://x/y.git' }));
    });

    const result = await giteaRequest({
      hostUrl,
      token: 'tok',
      method: 'POST',
      path: '/user/repos',
      body: { name: 'demo', private: true },
    });
    expect(result.ok && result.status).toBe(201);
    expect(received.method).toBe('POST');
    expect(JSON.parse(received.body)).toEqual({ name: 'demo', private: true });
  });

  it('refuses to follow a redirect, which would replay the token to another origin', async () => {
    const { hostUrl } = await startServer((_req, res) => {
      res.writeHead(302, { location: 'https://evil.example.com/api/v1/user' });
      res.end();
    });

    const result = await giteaRequest({ hostUrl, token: 'tok', method: 'GET', path: '/user' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/redirected/i);
  });

  it('reports a non-JSON response instead of throwing (host is not Gitea)', async () => {
    const { hostUrl } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>login</html>');
    });

    const result = await giteaRequest({ hostUrl, token: 'tok', method: 'GET', path: '/user' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/JSON/i);
  });

  it('surfaces a 401 as a normal result so the caller can explain it', async () => {
    const { hostUrl } = await startServer((_req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'token does not have scope' }));
    });

    const result = await giteaRequest({ hostUrl, token: 'tok', method: 'GET', path: '/user' });
    expect(result.ok && result.status).toBe(401);
  });

  it('rejects a host URL carrying credentials', async () => {
    const result = await giteaRequest({
      hostUrl: 'http://user:pass@127.0.0.1:1',
      token: 'tok',
      method: 'GET',
      path: '/user',
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/credentials/i);
  });
});

describe('giteaErrorMessage', () => {
  it("prefers Gitea's own message", () => {
    expect(giteaErrorMessage(422, { message: 'repo already exists' }, 'Failed.')).toBe(
      'repo already exists'
    );
  });

  it('falls back to the status code when the body has no message', () => {
    expect(giteaErrorMessage(500, undefined, 'Failed.')).toBe('Failed. (HTTP 500)');
  });
});
