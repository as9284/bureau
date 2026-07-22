import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;

export type GiteaHttpResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; error: string };

export type GiteaRequest = {
  hostUrl: string;
  token: string;
  method: 'GET' | 'POST';
  /** API path below `/api/v1`, e.g. `/user` or `/orgs/acme/repos`. */
  path: string;
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
};

/** Strips a trailing slash so `${origin}/api/v1${path}` never doubles up. */
export function normalizeHostUrl(hostUrl: string): string {
  const parsed = new URL(hostUrl);
  const base = `${parsed.origin}${parsed.pathname}`;
  return base.replace(/\/+$/, '');
}

/** True when two host URLs address the same Gitea instance (origin + base path). */
export function isSameGiteaHost(a: string, b: string): boolean {
  try {
    return normalizeHostUrl(a).toLowerCase() === normalizeHostUrl(b).toLowerCase();
  } catch {
    return false;
  }
}

/**
 * True when `targetUrl` sits inside the configured Gitea instance — same origin,
 * and below its base path for subpath installs. Used to widen the external-link
 * allowlist to exactly the connected instance and nothing else.
 */
export function isUnderGiteaHost(targetUrl: string, hostUrl: string): boolean {
  try {
    const base = normalizeHostUrl(hostUrl);
    const target = new URL(targetUrl);
    const baseUrl = new URL(base);
    if (target.origin.toLowerCase() !== baseUrl.origin.toLowerCase()) return false;
    const basePath = baseUrl.pathname.replace(/\/+$/, '');
    return target.pathname === basePath || target.pathname.startsWith(`${basePath}/`);
  } catch {
    return false;
  }
}

/**
 * Performs a JSON request against a Gitea instance.
 *
 * Unlike `remoteImageFetch`, private and loopback addresses are permitted: a
 * self-hosted Gitea normally *is* on the LAN, and the host here comes from the
 * operator via settings rather than from repository content. The remaining
 * guards still apply — the address is resolved once and pinned for the connect
 * so DNS cannot be rebound mid-flight, redirects are never followed (a 3xx to
 * another origin would replay the token), and the body is size-capped.
 */
export async function giteaRequest(request: GiteaRequest): Promise<GiteaHttpResult> {
  let url: URL;
  try {
    // Credentials are checked on the raw host: `URL.origin` drops userinfo, so
    // normalising first would silently strip them instead of rejecting.
    const raw = new URL(request.hostUrl);
    if (raw.username || raw.password) {
      return { ok: false, error: 'The Gitea host URL must not contain credentials.' };
    }
    if (raw.protocol !== 'https:' && raw.protocol !== 'http:') {
      return { ok: false, error: 'The Gitea host must use HTTP or HTTPS.' };
    }
    url = new URL(`${normalizeHostUrl(request.hostUrl)}/api/v1${request.path}`);
  } catch {
    return { ok: false, error: 'The Gitea host URL is not valid.' };
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const literalFamily = net.isIP(hostname);
  let address = hostname;
  let family: 4 | 6 = literalFamily === 6 ? 6 : 4;
  if (!literalFamily) {
    try {
      const [record] = await dns.promises.lookup(hostname, { all: true, verbatim: true });
      if (!record) return { ok: false, error: 'The Gitea host could not be resolved.' };
      address = record.address;
      family = record.family as 4 | 6;
    } catch {
      return { ok: false, error: 'The Gitea host could not be resolved.' };
    }
  }

  const payload = request.body === undefined ? undefined : Buffer.from(JSON.stringify(request.body));
  const transport = url.protocol === 'https:' ? https : http;
  const agent = new transport.Agent({
    // Node enables `autoSelectFamily` by default, which calls a custom lookup
    // with `all: true` and expects an array of records. Answering with a bare
    // address makes it read `addresses[0].address` as `undefined` and fail with
    // `ERR_INVALID_IP_ADDRESS`.
    lookup(_hostname, options, callback) {
      if (options.all) callback(null, [{ address, family }]);
      else callback(null, address, family);
    },
  });

  return new Promise<GiteaHttpResult>((resolve) => {
    let settled = false;
    const finish = (result: GiteaHttpResult) => {
      if (settled) return;
      settled = true;
      agent.destroy();
      resolve(result);
    };

    const outgoing = transport.request(
      url,
      {
        method: request.method,
        agent,
        timeout: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        headers: {
          // Gitea's PAT scheme. `Bearer` also works on modern versions, but
          // `token` is accepted by every release that has the v1 API.
          Authorization: `token ${request.token}`,
          Accept: 'application/json',
          'User-Agent': 'Bureau',
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': payload.byteLength }
            : {}),
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.destroy();
          finish({ ok: false, error: 'The Gitea host redirected the request; check the host URL.' });
          return;
        }
        const chunks: Buffer[] = [];
        let byteLength = 0;
        response.on('data', (chunk: Buffer) => {
          byteLength += chunk.byteLength;
          if (byteLength > MAX_RESPONSE_BYTES) {
            outgoing.destroy();
            finish({ ok: false, error: 'The Gitea response was too large.' });
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (!text) {
            finish({ ok: true, status, body: undefined });
            return;
          }
          try {
            finish({ ok: true, status, body: JSON.parse(text) as unknown });
          } catch {
            // A login page or reverse proxy error is HTML, not JSON — the usual
            // sign that the host URL points at something that is not Gitea.
            finish({ ok: false, error: 'The Gitea host did not return a JSON response.' });
          }
        });
        response.on('error', () => finish({ ok: false, error: 'The Gitea response failed.' }));
      }
    );

    outgoing.on('error', (error) =>
      finish({ ok: false, error: error instanceof Error ? error.message : 'Request failed.' })
    );
    outgoing.on('timeout', () => {
      outgoing.destroy();
      finish({ ok: false, error: 'The Gitea host did not respond in time.' });
    });
    if (request.signal) {
      const onAbort = () => {
        outgoing.destroy();
        finish({ ok: false, error: 'The request was cancelled.' });
      };
      if (request.signal.aborted) onAbort();
      else request.signal.addEventListener('abort', onAbort, { once: true });
    }

    if (payload) outgoing.write(payload);
    outgoing.end();
  });
}

/** Extracts Gitea's `{ message }` error body, falling back to the status code. */
export function giteaErrorMessage(status: number, body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'message' in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }
  return `${fallback} (HTTP ${status})`;
}
