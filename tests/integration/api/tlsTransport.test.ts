import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { executeHttpTransport } from '@main/api/HttpTransport';
import type { ApiTlsProfile } from '@shared/contracts/apiWorkbench';

const FIXTURES = path.join(__dirname, '../../fixtures/tls');
const localhostCert = fs.readFileSync(path.join(FIXTURES, 'localhost-cert.pem'), 'utf8');
const localhostKey = fs.readFileSync(path.join(FIXTURES, 'localhost-key.pem'), 'utf8');
const wrongHostCert = fs.readFileSync(path.join(FIXTURES, 'wronghost-cert.pem'), 'utf8');
const wrongHostKey = fs.readFileSync(path.join(FIXTURES, 'wronghost-key.pem'), 'utf8');

function tlsProfile(overrides: Partial<ApiTlsProfile>): ApiTlsProfile {
  return {
    profileId: '11111111-1111-4111-8111-111111111111',
    workspaceId: '22222222-2222-4222-8222-222222222222',
    name: 'fixture',
    allowInvalidCertificateHosts: [],
    enabled: true,
    revision: 1,
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
    ...overrides,
  };
}

const base = {
  method: 'GET',
  headers: [] as Array<{ name: string; value: string }>,
  timeoutMs: 5_000,
  maxRedirects: 5,
  followRedirects: true,
  persistResponseBytes: 1_000_000,
  displayResponseBytes: 1_000_000,
};

describe('HttpTransport TLS policy (real HTTPS servers)', () => {
  const servers: Array<http.Server | https.Server> = [];

  afterEach(async () => {
    await Promise.all(
      servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
    );
    servers.length = 0;
  });

  function listenHttps(cert: string, key: string): Promise<{ origin: string; port: number }> {
    return new Promise((resolve) => {
      const server = https.createServer({ cert, key }, (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"secure":true}');
      });
      servers.push(server);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as AddressInfo;
        resolve({ origin: `https://127.0.0.1:${address.port}`, port: address.port });
      });
    });
  }

  it('rejects a self-signed certificate by default', async () => {
    const server = await listenHttps(localhostCert, localhostKey);
    const result = await executeHttpTransport({ ...base, url: `${server.origin}/` });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('API_TLS_FAILED');
    expect(result.tlsExceptionApplied).toBe(false);
  });

  it('accepts a self-signed certificate when the exact host has an exception', async () => {
    const server = await listenHttps(localhostCert, localhostKey);
    const result = await executeHttpTransport({
      ...base,
      url: `${server.origin}/`,
      tls: { profile: tlsProfile({ allowInvalidCertificateHosts: ['127.0.0.1'] }) },
    });
    expect(result.status).toBe(200);
    // The response chrome must be able to warn about the weakened connection.
    expect(result.tlsExceptionApplied).toBe(true);
  });

  it('does not apply an exception granted to a different host', async () => {
    const server = await listenHttps(localhostCert, localhostKey);
    const result = await executeHttpTransport({
      ...base,
      url: `${server.origin}/`,
      tls: { profile: tlsProfile({ allowInvalidCertificateHosts: ['other.example.com'] }) },
    });
    expect(result.errorCode).toBe('API_TLS_FAILED');
  });

  it('scopes an exception to the exact port when one is given', async () => {
    const server = await listenHttps(localhostCert, localhostKey);
    const result = await executeHttpTransport({
      ...base,
      url: `${server.origin}/`,
      tls: {
        profile: tlsProfile({ allowInvalidCertificateHosts: [`127.0.0.1:${server.port + 1}`] }),
      },
    });
    expect(result.errorCode).toBe('API_TLS_FAILED');
  });

  it('trusts a self-signed certificate supplied as a custom CA, without weakening verification', async () => {
    const server = await listenHttps(localhostCert, localhostKey);
    const result = await executeHttpTransport({
      ...base,
      url: `${server.origin}/`,
      tls: { profile: tlsProfile({ caPem: localhostCert }) },
    });
    expect(result.status).toBe(200);
    // A trusted CA is not an exception: no warning should be raised.
    expect(result.tlsExceptionApplied).toBe(false);
  });

  it('rejects a certificate issued for the wrong host even with its CA trusted', async () => {
    const server = await listenHttps(wrongHostCert, wrongHostKey);
    const result = await executeHttpTransport({
      ...base,
      url: `${server.origin}/`,
      tls: { profile: tlsProfile({ caPem: wrongHostCert }) },
    });
    expect(result.errorCode).toBe('API_TLS_FAILED');
  });

  it('blocks an https to http downgrade redirect', async () => {
    const plain = await new Promise<{ origin: string }>((resolve) => {
      const server = http.createServer((_req, res) => {
        res.writeHead(200);
        res.end('downgraded');
      });
      servers.push(server);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as AddressInfo;
        resolve({ origin: `http://127.0.0.1:${address.port}` });
      });
    });

    const secure = await new Promise<{ origin: string }>((resolve) => {
      const server = https.createServer({ cert: localhostCert, key: localhostKey }, (_req, res) => {
        res.writeHead(302, { Location: `${plain.origin}/downgraded` });
        res.end();
      });
      servers.push(server);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as AddressInfo;
        resolve({ origin: `https://127.0.0.1:${address.port}` });
      });
    });

    const result = await executeHttpTransport({
      ...base,
      url: `${secure.origin}/start`,
      tls: { profile: tlsProfile({ caPem: localhostCert }) },
    });
    expect(result.errorCode).toBe('API_REDIRECT_BLOCKED');
    expect(result.errorMessage).toContain('downgrade');
  });

  it('does not carry a certificate exception to a redirect target it does not name', async () => {
    // The second hop presents an untrusted cert. The exception is scoped to the first hop's
    // exact host:port, so the redirect target must still verify strictly.
    const second = await listenHttps(wrongHostCert, wrongHostKey);
    const first = await new Promise<{ origin: string; port: number }>((resolve) => {
      const server = https.createServer({ cert: localhostCert, key: localhostKey }, (_req, res) => {
        res.writeHead(302, { Location: `https://127.0.0.1:${second.port}/next` });
        res.end();
      });
      servers.push(server);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as AddressInfo;
        resolve({ origin: `https://127.0.0.1:${address.port}`, port: address.port });
      });
    });

    const result = await executeHttpTransport({
      ...base,
      url: `${first.origin}/start`,
      tls: {
        profile: tlsProfile({ allowInvalidCertificateHosts: [`127.0.0.1:${first.port}`] }),
      },
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('API_TLS_FAILED');
    // The first hop was reached, so the failure is genuinely at the redirect target.
    expect(result.redirects).toHaveLength(1);
  });
});
