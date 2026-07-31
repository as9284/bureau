import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import type {
  ApiOAuthProfile,
  ApiOAuthTokenStatus,
  ApiEntityId,
} from '@shared/contracts/apiWorkbench';
import type { AtomicJsonStore } from '../storage/AtomicJsonStore';
import type { SecretCipher } from '../gitea/GiteaCredentialStore';
import { toBureauError } from '../ipc/errors';
import { executeHttpTransport } from './HttpTransport';

/**
 * Persisted token record. Access and refresh tokens are stored as ciphertext only; when OS
 * encryption is unavailable the tokens stay in memory for the session and are never written.
 */
type OAuthTokenRecord = {
  profileId: string;
  accessCipher?: string;
  refreshCipher?: string;
  expiresAt?: string;
  tokenType?: string;
  scope?: string;
  obtainedAt: string;
};

type OAuthTokensFileV1 = {
  schemaVersion: 1;
  tokens: OAuthTokenRecord[];
  updatedAt: string;
};

const tokensFileSchema = z.object({
  schemaVersion: z.literal(1),
  tokens: z.array(
    z.object({
      profileId: z.string(),
      accessCipher: z.string().optional(),
      refreshCipher: z.string().optional(),
      expiresAt: z.string().optional(),
      tokenType: z.string().optional(),
      scope: z.string().optional(),
      obtainedAt: z.string(),
    })
  ),
  updatedAt: z.string(),
});

/** The token endpoint is untrusted input: parse defensively and ignore unknown fields. */
const tokenResponseSchema = z.object({
  access_token: z.string().min(1).max(8192),
  token_type: z.string().max(64).optional(),
  expires_in: z.number().finite().optional(),
  refresh_token: z.string().min(1).max(8192).optional(),
  scope: z.string().max(4096).optional(),
});

type SessionToken = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
  obtainedAt: number;
};

/** Refresh a little early so a request never races the server's expiry. */
const EXPIRY_SKEW_MS = 30_000;
const CALLBACK_TIMEOUT_MS = 5 * 60_000;
const CALLBACK_PATH = '/bureau/oauth/callback';

export type OAuthAuthorizeDeps = {
  /** Opens the system browser. Never an embedded privileged view (RFC 8252). */
  openExternal(url: string): Promise<void>;
};

export type OAuthService = {
  tokenStatuses(profileIds: string[]): ApiOAuthTokenStatus[];
  /** Valid access token for a profile, refreshing first when needed. */
  ensureAccessToken(
    profile: ApiOAuthProfile,
    clientSecret: string | undefined
  ): Promise<{ ok: true; accessToken: string } | { ok: false; error: ReturnType<typeof toBureauError> }>;
  /** Cached token without any network round-trip; used by the synchronous request compiler. */
  cachedAccessToken(profileId: string): string | undefined;
  authorize(
    profile: ApiOAuthProfile,
    clientSecret: string | undefined,
    onPhase: (phase: 'awaiting-callback' | 'exchanging') => void
  ): Promise<{ ok: true; status: ApiOAuthTokenStatus } | { ok: false; error: ReturnType<typeof toBureauError> }>;
  cancelAuthorize(profileId: string): boolean;
  clearToken(profileId: string): Promise<void>;
  dispose(): void;
};

export function createOAuthService(
  store: AtomicJsonStore<OAuthTokensFileV1>,
  cipher: SecretCipher,
  deps: OAuthAuthorizeDeps
): OAuthService {
  /** Decrypted tokens, and the only home for tokens when safeStorage is unavailable. */
  const memory = new Map<string, SessionToken>();
  /** Single-flight refresh per profile: concurrent requests await the same promise. */
  const refreshInFlight = new Map<string, Promise<SessionToken | null>>();
  const pendingAuthorizations = new Map<string, { server: http.Server; abort: () => void }>();

  function readFile(): OAuthTokensFileV1 {
    const parsed = tokensFileSchema.safeParse(store.read());
    if (parsed.success) return parsed.data;
    return { schemaVersion: 1, tokens: [], updatedAt: new Date().toISOString() };
  }

  function load(profileId: string): SessionToken | undefined {
    const cached = memory.get(profileId);
    if (cached) return cached;
    if (!cipher.available()) return undefined;
    const record = readFile().tokens.find((entry) => entry.profileId === profileId);
    if (!record) return undefined;
    try {
      const token: SessionToken = {
        accessToken: record.accessCipher ? cipher.decrypt(record.accessCipher) : undefined,
        refreshToken: record.refreshCipher ? cipher.decrypt(record.refreshCipher) : undefined,
        expiresAt: record.expiresAt ? Date.parse(record.expiresAt) : undefined,
        tokenType: record.tokenType,
        scope: record.scope,
        obtainedAt: Date.parse(record.obtainedAt),
      };
      memory.set(profileId, token);
      return token;
    } catch {
      return undefined;
    }
  }

  async function persist(profileId: string, token: SessionToken): Promise<void> {
    memory.set(profileId, token);
    if (!cipher.available()) return; // session-only; never write plaintext.
    const record: OAuthTokenRecord = {
      profileId,
      accessCipher: token.accessToken ? cipher.encrypt(token.accessToken) : undefined,
      refreshCipher: token.refreshToken ? cipher.encrypt(token.refreshToken) : undefined,
      expiresAt: token.expiresAt ? new Date(token.expiresAt).toISOString() : undefined,
      tokenType: token.tokenType,
      scope: token.scope,
      obtainedAt: new Date(token.obtainedAt).toISOString(),
    };
    // Rotated refresh tokens replace the old ciphertext in one atomic write.
    await store.update((current) => {
      const parsed = tokensFileSchema.safeParse(current);
      const tokens = parsed.success ? parsed.data.tokens : [];
      return {
        schemaVersion: 1,
        tokens: [...tokens.filter((entry) => entry.profileId !== profileId), record],
        updatedAt: new Date().toISOString(),
      };
    });
  }

  function statusOf(profileId: string): ApiOAuthTokenStatus {
    const token = load(profileId);
    return {
      profileId,
      hasAccessToken: Boolean(token?.accessToken),
      hasRefreshToken: Boolean(token?.refreshToken),
      expiresAt: token?.expiresAt ? new Date(token.expiresAt).toISOString() : undefined,
      tokenType: token?.tokenType,
      scope: token?.scope,
      obtainedAt: token?.obtainedAt ? new Date(token.obtainedAt).toISOString() : undefined,
    };
  }

  function isExpired(token: SessionToken): boolean {
    if (!token.expiresAt) return false;
    return Date.now() >= token.expiresAt - EXPIRY_SKEW_MS;
  }

  function oauthError(
    code: 'API_OAUTH_FAILED' | 'API_OAUTH_STATE_MISMATCH',
    message: string,
    operation: string,
    subjectId?: string
  ) {
    return toBureauError({ code, message, operation, subjectId, retryable: false });
  }

  /**
   * Posts to the token endpoint. Errors deliberately carry only the provider's `error` code —
   * never the response body, which may echo the code, verifier, or a token.
   */
  async function postToken(
    profile: ApiOAuthProfile,
    body: URLSearchParams,
    operation: string
  ): Promise<{ ok: true; token: SessionToken } | { ok: false; error: ReturnType<typeof toBureauError> }> {
    const response = await executeHttpTransport({
      url: profile.tokenUrl,
      method: 'POST',
      headers: [
        { name: 'Content-Type', value: 'application/x-www-form-urlencoded' },
        { name: 'Accept', value: 'application/json' },
      ],
      body: Buffer.from(body.toString(), 'utf8'),
      timeoutMs: 30_000,
      maxRedirects: 0,
      followRedirects: false,
      persistResponseBytes: 512 * 1024,
      displayResponseBytes: 512 * 1024,
    });

    if (response.errorCode) {
      return {
        ok: false,
        error: oauthError('API_OAUTH_FAILED', 'The token request failed.', operation, profile.profileId),
      };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(response.body.toString('utf8'));
    } catch {
      return {
        ok: false,
        error: oauthError(
          'API_OAUTH_FAILED',
          'The token endpoint did not return JSON.',
          operation,
          profile.profileId
        ),
      };
    }

    const parsed = tokenResponseSchema.safeParse(payload);
    if (!parsed.success) {
      const providerError =
        payload && typeof payload === 'object' && 'error' in payload
          ? String((payload as { error: unknown }).error).slice(0, 64)
          : undefined;
      return {
        ok: false,
        error: oauthError(
          'API_OAUTH_FAILED',
          providerError
            ? `The token endpoint returned an error: ${providerError}.`
            : 'The token endpoint returned an unusable response.',
          operation,
          profile.profileId
        ),
      };
    }

    const data = parsed.data;
    return {
      ok: true,
      token: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt:
          data.expires_in !== undefined && data.expires_in > 0
            ? Date.now() + data.expires_in * 1000
            : undefined,
        tokenType: data.token_type ?? 'Bearer',
        scope: data.scope,
        obtainedAt: Date.now(),
      },
    };
  }

  async function refresh(
    profile: ApiOAuthProfile,
    clientSecret: string | undefined,
    current: SessionToken
  ): Promise<SessionToken | null> {
    if (!current.refreshToken) return null;
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
      client_id: profile.clientId,
    });
    if (profile.scope) body.set('scope', profile.scope);
    if (clientSecret) body.set('client_secret', clientSecret);

    const result = await postToken(profile, body, 'api.oauth.refresh');
    if (!result.ok) return null;
    const next: SessionToken = {
      ...result.token,
      // Providers that do not rotate omit the refresh token; keep the existing one.
      refreshToken: result.token.refreshToken ?? current.refreshToken,
    };
    await persist(profile.profileId, next);
    return next;
  }

  async function clientCredentials(
    profile: ApiOAuthProfile,
    clientSecret: string | undefined
  ): Promise<{ ok: true; token: SessionToken } | { ok: false; error: ReturnType<typeof toBureauError> }> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: profile.clientId,
    });
    if (profile.scope) body.set('scope', profile.scope);
    if (profile.audience) body.set('audience', profile.audience);
    if (clientSecret) body.set('client_secret', clientSecret);
    const result = await postToken(profile, body, 'api.oauth.clientCredentials');
    if (!result.ok) return result;
    await persist(profile.profileId, result.token);
    return result;
  }

  /**
 * Fully releases the loopback listener. `close()` alone only stops new connections — a
 * keep-alive socket from the browser would keep the port answering after the flow settled.
 */
function closeListener(server: http.Server): void {
  server.closeAllConnections();
  server.close();
}

/** Constant-time comparison so a callback cannot probe `state` byte by byte. */
  function stateMatches(expected: string, received: string): boolean {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(received, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  async function authorizationCode(
    profile: ApiOAuthProfile,
    clientSecret: string | undefined,
    onPhase: (phase: 'awaiting-callback' | 'exchanging') => void
  ): Promise<{ ok: true; token: SessionToken } | { ok: false; error: ReturnType<typeof toBureauError> }> {
    const operation = 'api.oauth.authorize';
    if (!profile.authorizationUrl) {
      return {
        ok: false,
        error: oauthError(
          'API_OAUTH_FAILED',
          'The profile has no authorization URL.',
          operation,
          profile.profileId
        ),
      };
    }

    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(32).toString('base64url');

    const listen = await new Promise<
      { ok: true; server: http.Server; port: number } | { ok: false; message: string }
    >((resolve) => {
      const server = http.createServer();
      server.on('error', (error: NodeJS.ErrnoException) => {
        resolve({
          ok: false,
          message:
            error.code === 'EADDRINUSE'
              ? `Loopback port ${profile.redirectPort} is already in use.`
              : 'The loopback callback listener could not start.',
        });
      });
      // 127.0.0.1 only — never 0.0.0.0, and never a non-loopback interface (RFC 8252).
      server.listen(profile.redirectPort ?? 0, '127.0.0.1', () => {
        resolve({ ok: true, server, port: (server.address() as AddressInfo).port });
      });
    });

    if (!listen.ok) {
      return { ok: false, error: oauthError('API_OAUTH_FAILED', listen.message, operation, profile.profileId) };
    }

    const { server, port } = listen;
    const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;

    const authorizeUrl = new URL(profile.authorizationUrl);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', profile.clientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('code_challenge', challenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    if (profile.scope) authorizeUrl.searchParams.set('scope', profile.scope);
    if (profile.audience) authorizeUrl.searchParams.set('audience', profile.audience);

    const callback = await new Promise<
      { ok: true; code: string } | { ok: false; code: 'API_OAUTH_FAILED' | 'API_OAUTH_STATE_MISMATCH'; message: string }
    >((resolve) => {
      let settled = false;
      const finish = (result: Parameters<typeof resolve>[0]) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        pendingAuthorizations.delete(profile.profileId);
        closeListener(server);
        resolve(result);
      };

      const timer = setTimeout(() => {
        finish({ ok: false, code: 'API_OAUTH_FAILED', message: 'The authorization timed out.' });
      }, CALLBACK_TIMEOUT_MS);
      timer.unref?.();

      pendingAuthorizations.set(profile.profileId, {
        server,
        abort: () =>
          finish({ ok: false, code: 'API_OAUTH_FAILED', message: 'The authorization was cancelled.' }),
      });

      server.on('request', (request, response) => {
        const requestUrl = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
        if (requestUrl.pathname !== CALLBACK_PATH) {
          response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          response.end('Not found');
          return;
        }
        // One-time use: the first hit on the callback path settles the flow either way.
        if (settled) {
          response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
          response.end('This authorization has already completed.');
          return;
        }

        const received = requestUrl.searchParams.get('state') ?? '';
        const code = requestUrl.searchParams.get('code');
        const error = requestUrl.searchParams.get('error');

        const reply = (status: number, message: string) => {
          response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
          response.end(message);
        };

        if (!stateMatches(state, received)) {
          reply(400, 'Authorization failed: state mismatch. You can close this tab.');
          finish({
            ok: false,
            code: 'API_OAUTH_STATE_MISMATCH',
            message: 'The authorization callback state did not match.',
          });
          return;
        }
        if (error || !code) {
          reply(400, 'Authorization failed. You can close this tab.');
          finish({
            ok: false,
            code: 'API_OAUTH_FAILED',
            // The provider's error identifier only; never the full callback URL.
            message: error
              ? `The provider reported: ${error.slice(0, 64)}.`
              : 'The provider did not return an authorization code.',
          });
          return;
        }
        reply(200, 'Authorization complete. You can close this tab and return to Bureau.');
        finish({ ok: true, code });
      });

      onPhase('awaiting-callback');
      void deps.openExternal(authorizeUrl.toString()).catch(() => {
        finish({
          ok: false,
          code: 'API_OAUTH_FAILED',
          message: 'The system browser could not be opened.',
        });
      });
    });

    if (!callback.ok) {
      return { ok: false, error: oauthError(callback.code, callback.message, operation, profile.profileId) };
    }

    onPhase('exchanging');
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: callback.code,
      redirect_uri: redirectUri,
      client_id: profile.clientId,
      code_verifier: verifier,
    });
    if (clientSecret) body.set('client_secret', clientSecret);

    const result = await postToken(profile, body, operation);
    if (!result.ok) return result;
    await persist(profile.profileId, result.token);
    return result;
  }

  return {
    tokenStatuses(profileIds) {
      return profileIds.map(statusOf);
    },

    cachedAccessToken(profileId) {
      const token = load(profileId);
      if (!token?.accessToken) return undefined;
      return isExpired(token) ? undefined : token.accessToken;
    },

    async ensureAccessToken(profile, clientSecret) {
      const operation = 'api.oauth.ensureAccessToken';
      const current = load(profile.profileId);

      if (current?.accessToken && !isExpired(current)) {
        return { ok: true, accessToken: current.accessToken };
      }

      if (current?.refreshToken) {
        // Single-flight: a second caller joins the in-flight refresh instead of racing it.
        let flight = refreshInFlight.get(profile.profileId);
        if (!flight) {
          flight = refresh(profile, clientSecret, current).finally(() => {
            refreshInFlight.delete(profile.profileId);
          });
          refreshInFlight.set(profile.profileId, flight);
        }
        const refreshed = await flight;
        if (refreshed?.accessToken) return { ok: true, accessToken: refreshed.accessToken };
        // A failed refresh must not discard a still-valid token.
        if (current.accessToken && !isExpired(current)) {
          return { ok: true, accessToken: current.accessToken };
        }
        return {
          ok: false,
          error: oauthError(
            'API_OAUTH_FAILED',
            'The token could not be refreshed. Reauthorize the profile.',
            operation,
            profile.profileId
          ),
        };
      }

      if (profile.grant === 'client_credentials') {
        const result = await clientCredentials(profile, clientSecret);
        if (!result.ok) return result;
        return { ok: true, accessToken: result.token.accessToken! };
      }

      return {
        ok: false,
        error: oauthError(
          'API_OAUTH_FAILED',
          'No access token yet. Authorize the profile first.',
          operation,
          profile.profileId
        ),
      };
    },

    async authorize(profile, clientSecret, onPhase) {
      const result =
        profile.grant === 'client_credentials'
          ? await clientCredentials(profile, clientSecret)
          : await authorizationCode(profile, clientSecret, onPhase);
      if (!result.ok) return result;
      return { ok: true, status: statusOf(profile.profileId) };
    },

    cancelAuthorize(profileId) {
      const pending = pendingAuthorizations.get(profileId);
      if (!pending) return false;
      pending.abort();
      return true;
    },

    async clearToken(profileId) {
      memory.delete(profileId);
      await store.update((current) => {
        const parsed = tokensFileSchema.safeParse(current);
        const tokens = parsed.success ? parsed.data.tokens : [];
        return {
          schemaVersion: 1,
          tokens: tokens.filter((entry) => entry.profileId !== profileId),
          updatedAt: new Date().toISOString(),
        };
      });
    },

    dispose() {
      for (const pending of pendingAuthorizations.values()) {
        closeListener(pending.server);
      }
      pendingAuthorizations.clear();
      refreshInFlight.clear();
      memory.clear();
    },
  };
}

export type { OAuthTokensFileV1 };
export const OAUTH_CALLBACK_PATH = CALLBACK_PATH;
export function newProfileId(): ApiEntityId {
  return randomUUID();
}
