import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createOAuthService } from '@main/api/OAuthService';
import { createAtomicJsonStore } from '@main/storage/AtomicJsonStore';
import type { ApiOAuthProfile } from '@shared/contracts/apiWorkbench';

type TokenRequest = { body: URLSearchParams; authorization?: string };

/** Reversible stand-in for safeStorage so tests can assert what was persisted. */
const cipher = {
  available: () => true,
  encrypt: (plain: string) => Buffer.from(`enc:${plain}`, 'utf8').toString('base64'),
  decrypt: (text: string) => Buffer.from(text, 'base64').toString('utf8').replace(/^enc:/, ''),
};

async function makeStore(dir: string) {
  const store = createAtomicJsonStore<never>({
    filePath: path.join(dir, 'oauth-tokens.v1.json'),
    schemaVersion: 1,
    defaultValue: { schemaVersion: 1, tokens: [], updatedAt: new Date().toISOString() } as never,
    validate: (value) => value as never,
  });
  await store.load();
  return store;
}

describe('OAuthService against a local authorization server', () => {
  const servers: http.Server[] = [];
  const tempDirs: string[] = [];
  const disposers: Array<() => void> = [];

  afterEach(async () => {
    for (const dispose of disposers) dispose();
    disposers.length = 0;
    await Promise.all(
      servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
    );
    servers.length = 0;
    await Promise.all(tempDirs.map((dir) => fsp.rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  async function tempDir(): Promise<string> {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bureau-oauth-'));
    tempDirs.push(dir);
    return dir;
  }

  /** Token endpoint fixture. `respond` decides what each call returns. */
  function tokenServer(
    respond: (request: TokenRequest, callIndex: number) => { status: number; body: unknown }
  ): Promise<{ origin: string; calls: TokenRequest[] }> {
    const calls: TokenRequest[] = [];
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const request: TokenRequest = {
            body: new URLSearchParams(Buffer.concat(chunks).toString('utf8')),
            authorization: req.headers.authorization,
          };
          calls.push(request);
          const result = respond(request, calls.length - 1);
          res.writeHead(result.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result.body));
        });
      });
      servers.push(server);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as AddressInfo;
        resolve({ origin: `http://127.0.0.1:${address.port}`, calls });
      });
    });
  }

  function profile(overrides: Partial<ApiOAuthProfile>): ApiOAuthProfile {
    return {
      profileId: '11111111-1111-4111-8111-111111111111',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      name: 'fixture',
      grant: 'authorization_code',
      tokenUrl: '',
      clientId: 'client-abc',
      revision: 1,
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T00:00:00.000Z',
      ...overrides,
    };
  }

  it('completes the client credentials grant and encrypts the token', async () => {
    const dir = await tempDir();
    const store = await makeStore(dir);
    const token = await tokenServer(() => ({
      status: 200,
      body: { access_token: 'access-1', token_type: 'Bearer', expires_in: 3600 },
    }));

    const service = createOAuthService(store, cipher, { openExternal: async () => undefined });
    disposers.push(() => service.dispose());

    const result = await service.authorize(
      profile({ grant: 'client_credentials', tokenUrl: `${token.origin}/token`, scope: 'read' }),
      'client-secret',
      () => undefined
    );
    expect(result.ok).toBe(true);

    expect(token.calls[0].body.get('grant_type')).toBe('client_credentials');
    expect(token.calls[0].body.get('scope')).toBe('read');
    expect(token.calls[0].body.get('client_secret')).toBe('client-secret');

    // The token is usable in memory…
    expect(service.cachedAccessToken('11111111-1111-4111-8111-111111111111')).toBe('access-1');
    // …and only ciphertext reached the disk.
    const onDisk = await fsp.readFile(path.join(dir, 'oauth-tokens.v1.json'), 'utf8');
    expect(onDisk).not.toContain('access-1');
    expect(onDisk).toContain(cipher.encrypt('access-1'));
  });

  it('runs the authorization code flow with PKCE S256 and a loopback listener', async () => {
    const dir = await tempDir();
    const store = await makeStore(dir);
    const token = await tokenServer(() => ({
      status: 200,
      body: { access_token: 'access-pkce', refresh_token: 'refresh-1', expires_in: 3600 },
    }));

    let authorizeUrl: URL | null = null;
    const service = createOAuthService(store, cipher, {
      openExternal: async (url) => {
        authorizeUrl = new URL(url);
        // Stand in for the browser: hit the loopback callback with the returned state.
        const redirectUri = new URL(authorizeUrl.searchParams.get('redirect_uri')!);
        redirectUri.searchParams.set('code', 'auth-code-1');
        redirectUri.searchParams.set('state', authorizeUrl.searchParams.get('state')!);
        await fetch(redirectUri.toString()).catch(() => undefined);
      },
    });
    disposers.push(() => service.dispose());

    const result = await service.authorize(
      profile({ authorizationUrl: 'https://provider.example/authorize', tokenUrl: `${token.origin}/token` }),
      undefined,
      () => undefined
    );
    expect(result.ok).toBe(true);

    const url = authorizeUrl! as URL;
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    // The listener is loopback-only.
    expect(url.searchParams.get('redirect_uri')).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/bureau\/oauth\/callback$/
    );

    // The verifier sent to the token endpoint must hash to the advertised challenge.
    const verifier = token.calls[0].body.get('code_verifier')!;
    const expected = createHash('sha256').update(verifier).digest('base64url');
    expect(expected).toBe(url.searchParams.get('code_challenge'));
    expect(token.calls[0].body.get('grant_type')).toBe('authorization_code');
    expect(token.calls[0].body.get('code')).toBe('auth-code-1');
  });

  it('rejects a callback whose state does not match', async () => {
    const dir = await tempDir();
    const store = await makeStore(dir);
    const token = await tokenServer(() => ({ status: 200, body: { access_token: 'never' } }));

    const service = createOAuthService(store, cipher, {
      openExternal: async (url) => {
        const authorize = new URL(url);
        const redirectUri = new URL(authorize.searchParams.get('redirect_uri')!);
        redirectUri.searchParams.set('code', 'auth-code-1');
        redirectUri.searchParams.set('state', 'forged-state');
        await fetch(redirectUri.toString()).catch(() => undefined);
      },
    });
    disposers.push(() => service.dispose());

    const result = await service.authorize(
      profile({ authorizationUrl: 'https://provider.example/authorize', tokenUrl: `${token.origin}/token` }),
      undefined,
      () => undefined
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('API_OAUTH_STATE_MISMATCH');
    // No code was ever exchanged.
    expect(token.calls).toHaveLength(0);
  });

  it('closes the loopback listener after the flow settles', async () => {
    const dir = await tempDir();
    const store = await makeStore(dir);
    const token = await tokenServer(() => ({ status: 200, body: { access_token: 'a' } }));

    let redirectUri = '';
    const service = createOAuthService(store, cipher, {
      openExternal: async (url) => {
        const authorize = new URL(url);
        redirectUri = authorize.searchParams.get('redirect_uri')!;
        const callback = new URL(redirectUri);
        callback.searchParams.set('code', 'c');
        callback.searchParams.set('state', authorize.searchParams.get('state')!);
        await fetch(callback.toString()).catch(() => undefined);
      },
    });
    disposers.push(() => service.dispose());

    await service.authorize(
      profile({ authorizationUrl: 'https://provider.example/authorize', tokenUrl: `${token.origin}/token` }),
      undefined,
      () => undefined
    );

    // The port must no longer accept connections.
    await expect(fetch(redirectUri)).rejects.toThrow();
  });

  it('refreshes once for concurrent callers and rotates the refresh token', async () => {
    const dir = await tempDir();
    const store = await makeStore(dir);
    const token = await tokenServer((_request, index) => ({
      status: 200,
      body:
        index === 0
          ? { access_token: 'first', refresh_token: 'refresh-1', expires_in: 1 }
          : { access_token: 'second', refresh_token: 'refresh-2', expires_in: 3600 },
    }));

    const service = createOAuthService(store, cipher, { openExternal: async () => undefined });
    disposers.push(() => service.dispose());

    const clientCreds = profile({ grant: 'client_credentials', tokenUrl: `${token.origin}/token` });
    await service.authorize(clientCreds, undefined, () => undefined);
    // expires_in of 1s is inside the skew window, so the token is already considered stale.

    const [a, b, c] = await Promise.all([
      service.ensureAccessToken(clientCreds, undefined),
      service.ensureAccessToken(clientCreds, undefined),
      service.ensureAccessToken(clientCreds, undefined),
    ]);

    expect(a).toEqual({ ok: true, accessToken: 'second' });
    expect(b).toEqual({ ok: true, accessToken: 'second' });
    expect(c).toEqual({ ok: true, accessToken: 'second' });
    // One authorize call plus exactly one refresh, not three.
    expect(token.calls).toHaveLength(2);
    expect(token.calls[1].body.get('grant_type')).toBe('refresh_token');
    expect(token.calls[1].body.get('refresh_token')).toBe('refresh-1');

    const onDisk = await fsp.readFile(path.join(dir, 'oauth-tokens.v1.json'), 'utf8');
    expect(onDisk).toContain(cipher.encrypt('refresh-2'));
    expect(onDisk).not.toContain(cipher.encrypt('refresh-1'));
  });

  it('does not surface the provider response body when the token request fails', async () => {
    const dir = await tempDir();
    const store = await makeStore(dir);
    const token = await tokenServer(() => ({
      status: 400,
      body: { error: 'invalid_grant', error_description: 'code was abc123 and is expired' },
    }));

    const service = createOAuthService(store, cipher, { openExternal: async () => undefined });
    disposers.push(() => service.dispose());

    const result = await service.authorize(
      profile({ grant: 'client_credentials', tokenUrl: `${token.origin}/token` }),
      undefined,
      () => undefined
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('invalid_grant');
      // The description could echo a code or token, so it must not be relayed.
      expect(result.error.message).not.toContain('abc123');
    }
  });

  it('keeps tokens in memory only when encrypted storage is unavailable', async () => {
    const dir = await tempDir();
    const store = await makeStore(dir);
    const token = await tokenServer(() => ({ status: 200, body: { access_token: 'session-only' } }));
    const unavailable = { ...cipher, available: () => false };

    const service = createOAuthService(store, unavailable, { openExternal: async () => undefined });
    disposers.push(() => service.dispose());

    const clientCreds = profile({ grant: 'client_credentials', tokenUrl: `${token.origin}/token` });
    await service.authorize(clientCreds, undefined, () => undefined);

    expect(service.cachedAccessToken(clientCreds.profileId)).toBe('session-only');
    // Nothing was written at all; if a file does exist it must not hold the token.
    const onDisk = await fsp
      .readFile(path.join(dir, 'oauth-tokens.v1.json'), 'utf8')
      .catch(() => null);
    if (onDisk !== null) {
      expect(onDisk).not.toContain('session-only');
      expect(JSON.parse(onDisk).tokens).toEqual([]);
    }
  });

  it('clears a stored token on request', async () => {
    const dir = await tempDir();
    const store = await makeStore(dir);
    const token = await tokenServer(() => ({ status: 200, body: { access_token: 'gone-soon' } }));
    const service = createOAuthService(store, cipher, { openExternal: async () => undefined });
    disposers.push(() => service.dispose());

    const clientCreds = profile({ grant: 'client_credentials', tokenUrl: `${token.origin}/token` });
    await service.authorize(clientCreds, undefined, () => undefined);
    await service.clearToken(clientCreds.profileId);

    expect(service.cachedAccessToken(clientCreds.profileId)).toBeUndefined();
    expect(service.tokenStatuses([clientCreds.profileId])[0].hasAccessToken).toBe(false);
  });
});
