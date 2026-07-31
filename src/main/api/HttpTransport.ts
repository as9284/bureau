import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import type {
  ApiRedirectHop,
  ApiTimingPhases,
  ApiTlsProfile,
} from '@shared/contracts/apiWorkbench';
import { isApiDestinationBlocked } from '@shared/net/isApiDestinationBlocked';
import { hostHasCertificateException, tlsOptionsForHost } from './TlsPolicy';
import { createTunnelAgent, type ResolvedProxy } from './ProxyPolicy';

const brotliDecompress = promisify(zlib.brotliDecompress);
const gunzip = promisify(zlib.gunzip);
const inflate = promisify(zlib.inflate);

/**
 * Rejects CR, LF, NUL, and every other C0/DEL control character — the header and
 * request-line injection guard. Written as a code-point scan rather than a regex so the
 * dangerous characters never appear literally in source.
 */
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** Headers Bureau computes itself; a manual copy would produce an invalid request. */
const COMPUTED_HEADERS = new Set(['content-length', 'host', 'connection', 'transfer-encoding']);

export type HttpTransportTls = {
  profile: ApiTlsProfile | null;
  clientKeyPem?: string;
  passphrase?: string;
};

export type HttpTransportRequest = {
  url: string;
  method: string;
  headers: Array<{ name: string; value: string }>;
  body?: Buffer;
  timeoutMs: number;
  maxRedirects: number;
  followRedirects: boolean;
  persistResponseBytes: number;
  displayResponseBytes: number;
  signal?: AbortSignal;
  tls?: HttpTransportTls;
  /** Already-resolved for this request; `resolveProxy` runs in the service, not the transport. */
  proxy?: ResolvedProxy;
  /** Cookie header for a specific hop URL. Called per hop so a redirect never reuses another origin's cookies. */
  getCookieHeader?: (url: string) => string | undefined;
  /** Records Set-Cookie for the hop that produced them, including intermediate redirects. */
  onSetCookies?: (url: string, headers: string[]) => void;
  onProgress?: (phase: 'dns' | 'connect' | 'tls' | 'upload' | 'headers' | 'download') => void;
  /**
   * Streaming mode. When present the body is delivered incrementally and is NOT accumulated
   * for the final result — used by SSE, which must never buffer an unbounded response.
   */
  onBodyChunk?: (chunk: Buffer) => void;
  /** Called once response headers are known, before any chunk. Streaming callers use this to gate parsing. */
  onResponseStart?: (info: {
    status: number;
    headers: Array<{ name: string; value: string }>;
    contentType?: string;
    url: string;
  }) => void;
};

export type HttpTransportResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  url: string;
  method: string;
  headers: Array<{ name: string; value: string }>;
  body: Buffer;
  wireBytes: number;
  decodedBytes: number;
  truncated: boolean;
  contentType?: string;
  encoding?: string;
  redirects: ApiRedirectHop[];
  timings: ApiTimingPhases;
  setCookieHeaders: string[];
  /** True when this hop's host carried an explicit invalid-certificate exception. */
  tlsExceptionApplied: boolean;
  errorCode?: string;
  errorMessage?: string;
};

/** Builds a failure envelope. Cancellation and network faults are results, never exceptions. */
function failure(
  base: { url: string; method: string; redirects: ApiRedirectHop[]; startedAt: number },
  errorCode: string,
  errorMessage: string,
  extra?: Partial<HttpTransportResponse>
): HttpTransportResponse {
  return {
    ok: false,
    status: 0,
    statusText: '',
    url: base.url,
    method: base.method,
    headers: [],
    body: Buffer.alloc(0),
    wireBytes: 0,
    decodedBytes: 0,
    truncated: false,
    redirects: base.redirects,
    timings: { totalMs: Date.now() - base.startedAt },
    setCookieHeaders: [],
    tlsExceptionApplied: false,
    errorCode,
    errorMessage,
    ...extra,
  };
}

function validateHeaders(headers: Array<{ name: string; value: string }>): string | null {
  for (const header of headers) {
    if (hasControlCharacter(header.name) || hasControlCharacter(header.value)) {
      return 'Header names and values must not contain CR, LF, or NUL characters.';
    }
  }
  return null;
}

function sameOrigin(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.host === b.host;
}

const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization', 'x-api-key']);

function stripSensitiveHeaders(
  headers: Array<{ name: string; value: string }>
): Array<{ name: string; value: string }> {
  return headers.filter((header) => !SENSITIVE_HEADERS.has(header.name.toLowerCase()));
}

type ResolvedDestination = { address: string; family: 4 | 6 };

/**
 * Resolves and vets the destination. Returns an error code rather than throwing so a blocked
 * host or DNS failure still produces a completed session instead of an unhandled rejection.
 */
async function resolveDestination(
  hostname: string
): Promise<{ ok: true; destination: ResolvedDestination } | { ok: false; code: string; message: string }> {
  const bare = hostname.replace(/^\[|\]$/g, '');
  const literalFamily = net.isIP(bare);
  if (literalFamily) {
    if (isApiDestinationBlocked(bare)) {
      return { ok: false, code: 'API_DESTINATION_BLOCKED', message: 'The destination address is blocked.' };
    }
    return { ok: true, destination: { address: bare, family: literalFamily === 6 ? 6 : 4 } };
  }
  let records: dns.LookupAddress[];
  try {
    records = await dns.promises.lookup(bare, { all: true, verbatim: true });
  } catch {
    return { ok: false, code: 'API_DNS_FAILED', message: 'The host could not be resolved.' };
  }
  const record = records[0];
  if (!record) {
    return { ok: false, code: 'API_DNS_FAILED', message: 'The host could not be resolved.' };
  }
  // Every resolved address is vetted, so a DNS answer cannot smuggle in a metadata endpoint.
  for (const candidate of records) {
    if (isApiDestinationBlocked(candidate.address)) {
      return { ok: false, code: 'API_DESTINATION_BLOCKED', message: 'The destination address is blocked.' };
    }
  }
  return { ok: true, destination: { address: record.address, family: record.family as 4 | 6 } };
}

async function decompressBody(
  encoding: string | undefined,
  body: Buffer
): Promise<{ body: Buffer; encoding?: string }> {
  const normalized = encoding?.toLowerCase();
  if (!normalized || normalized === 'identity') return { body };
  try {
    if (normalized.includes('gzip')) return { body: await gunzip(body), encoding: 'gzip' };
    if (normalized.includes('deflate')) return { body: await inflate(body), encoding: 'deflate' };
    if (normalized.includes('br')) return { body: await brotliDecompress(body), encoding: 'br' };
  } catch {
    // A truncated body cannot be inflated; fall back to the wire bytes and keep the truncation flag.
    return { body };
  }
  return { body };
}

function collectHeaders(response: http.IncomingMessage): Array<{ name: string; value: string }> {
  const headers: Array<{ name: string; value: string }> = [];
  for (const [name, value] of Object.entries(response.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.push({ name, value: item });
    } else {
      headers.push({ name, value });
    }
  }
  return headers;
}

/** Standard method rewriting: 303 always becomes GET; 301/302 rewrite POST to GET. */
function rewriteMethod(status: number, method: string): string {
  if (status === 303) return method === 'HEAD' ? 'HEAD' : 'GET';
  if ((status === 301 || status === 302) && method === 'POST') return 'GET';
  return method;
}

type HopState = {
  url: URL;
  method: string;
  headers: Array<{ name: string; value: string }>;
  /** Dropped once a redirect rewrites the method — a GET must not carry the original payload. */
  body?: Buffer;
};

async function performRequest(
  request: HttpTransportRequest,
  hop: HopState,
  redirects: ApiRedirectHop[],
  startedAt: number,
  timings: Partial<ApiTimingPhases>
): Promise<HttpTransportResponse> {
  const base = { url: hop.url.toString(), method: hop.method, redirects, startedAt };

  if (request.signal?.aborted) {
    return failure(base, 'API_CANCELLED', 'The request was cancelled.');
  }
  if (hasControlCharacter(hop.method)) {
    return failure(base, 'INVALID_REQUEST', 'The HTTP method must not contain CR, LF, or NUL characters.');
  }
  const headerError = validateHeaders(hop.headers);
  if (headerError) return failure(base, 'INVALID_REQUEST', headerError);

  if (hop.url.protocol !== 'http:' && hop.url.protocol !== 'https:') {
    return failure(base, 'API_PROTOCOL_ERROR', 'Only HTTP and HTTPS are supported.');
  }

  request.onProgress?.('dns');
  const dnsStart = Date.now();
  const proxy = request.proxy && request.proxy.kind !== 'direct' ? request.proxy : null;

  // With a proxy in play it is the *proxy* whose address is vetted and pinned, because that is the
  // host this process actually connects to. The target is still checked when it happens to resolve
  // locally — a proxy must not become a way around the metadata block — but a name only the proxy
  // can resolve is not an error.
  const resolved = await resolveDestination(proxy ? proxy.host : hop.url.hostname);
  timings.dnsMs = (timings.dnsMs ?? 0) + (Date.now() - dnsStart);
  if (!resolved.ok) return failure(base, resolved.code, resolved.message);
  const destination = resolved.destination;

  if (proxy) {
    const target = await resolveDestination(hop.url.hostname);
    if (!target.ok && target.code === 'API_DESTINATION_BLOCKED') {
      return failure(base, target.code, target.message);
    }
  }

  const isHttps = hop.url.protocol === 'https:';
  const transport = isHttps ? https : http;
  // Every hop is revalidated through the same TLS policy, so an exception never follows a redirect.
  const tls = isHttps
    ? tlsOptionsForHost(hop.url, request.tls?.profile ?? null, {
        clientKeyPem: request.tls?.clientKeyPem,
        passphrase: request.tls?.passphrase,
      })
    : null;
  const tlsExceptionApplied = isHttps && hostHasCertificateException(hop.url, request.tls?.profile ?? null);

  const pinnedLookup: http.AgentOptions = {
    // The address is pinned to what we vetted, so DNS cannot be re-resolved to a blocked host.
    lookup(_hostname: string, options: { all?: boolean }, callback: unknown) {
      const done = callback as (
        error: Error | null,
        address: string | Array<{ address: string; family: number }>,
        family?: number
      ) => void;
      if (options.all) done(null, [{ address: destination.address, family: destination.family }]);
      else done(null, destination.address, destination.family);
    },
  } as http.AgentOptions;

  const tunnelThroughProxy = Boolean(proxy && (isHttps || proxy.kind !== 'http'));
  const agent =
    tunnelThroughProxy && proxy
      ? // CONNECT/SOCKS carries the destination socket. HTTPS then negotiates TLS *inside* that
        // socket, while a plain HTTP target keeps it raw.
        createTunnelAgent({
          proxy,
          proxyAddress: destination,
          targetHost: hop.url.hostname,
          targetPort: Number(hop.url.port || (isHttps ? 443 : 80)),
          timeoutMs: request.timeoutMs,
          signal: request.signal,
          tlsOptions: isHttps ? { ...(tls ?? {}), servername: hop.url.hostname } : undefined,
        })
      : new transport.Agent({ ...(tls ?? {}), ...pinnedLookup } as http.AgentOptions);

  const headerMap: Record<string, string | string[]> = {};
  for (const header of hop.headers) {
    if (COMPUTED_HEADERS.has(header.name.toLowerCase())) continue;
    const existing = headerMap[header.name];
    if (existing === undefined) headerMap[header.name] = header.value;
    else if (Array.isArray(existing)) existing.push(header.value);
    else headerMap[header.name] = [existing, header.value];
  }

  const cookieHeader = request.getCookieHeader?.(hop.url.toString());
  if (cookieHeader && !hop.headers.some((h) => h.name.toLowerCase() === 'cookie')) {
    headerMap.Cookie = cookieHeader;
  }
  if (hop.body) headerMap['Content-Length'] = String(hop.body.byteLength);
  if (!Object.keys(headerMap).some((name) => name.toLowerCase() === 'user-agent')) {
    headerMap['User-Agent'] = 'Bureau';
  }

  return new Promise<HttpTransportResponse>((resolve) => {
    let settled = false;
    let abortListener: (() => void) | undefined;

    const finish = (result: HttpTransportResponse) => {
      if (settled) return;
      settled = true;
      if (abortListener) request.signal?.removeEventListener('abort', abortListener);
      agent.destroy();
      resolve(result);
    };

    const connectStart = Date.now();
    request.onProgress?.(isHttps ? 'tls' : 'connect');

    // Plain HTTP may use absolute-form only with an HTTP proxy. HTTPS proxies and SOCKS5 both use
    // a tunnel even for a plaintext target, so their credentials never become target headers.
    const proxiedPlainHttp = proxy && !isHttps && proxy.kind === 'http';
    if (proxiedPlainHttp && proxy.authorization) {
      headerMap['Proxy-Authorization'] = proxy.authorization;
    }

    const requestOptions: http.RequestOptions = proxiedPlainHttp
      ? {
          protocol: 'http:',
          host: destination.address,
          port: proxy.port,
          // Absolute-form request URI: what an HTTP proxy expects instead of an origin-form path.
          path: hop.url.toString(),
          setHost: false,
          method: hop.method,
          agent,
          timeout: request.timeoutMs,
          headers: { ...headerMap, Host: hop.url.host },
        }
      : {
          protocol: hop.url.protocol,
          host: hop.url.hostname,
          port: hop.url.port || undefined,
          path: `${hop.url.pathname}${hop.url.search}`,
          method: hop.method,
          agent,
          timeout: request.timeoutMs,
          headers: headerMap,
        };

    const outgoing = transport.request(
      requestOptions,
      (response) => {
        timings.connectMs = (timings.connectMs ?? 0) + (Date.now() - connectStart);
        request.onProgress?.('headers');
        const status = response.statusCode ?? 0;
        const responseHeaders = collectHeaders(response);
        const setCookieHeaders = responseHeaders
          .filter((header) => header.name.toLowerCase() === 'set-cookie')
          .map((header) => header.value);
        // Recorded per hop so a redirect chain's cookies land before the next hop reads them.
        if (setCookieHeaders.length > 0) request.onSetCookies?.(hop.url.toString(), setCookieHeaders);

        if (
          request.followRedirects &&
          status >= 300 &&
          status < 400 &&
          response.headers.location &&
          redirects.length < request.maxRedirects
        ) {
          response.resume();
          response.destroy();
          let redirectUrl: URL;
          try {
            redirectUrl = new URL(response.headers.location, hop.url);
          } catch {
            finish(failure(base, 'API_REDIRECT_BLOCKED', 'The redirect location is not valid.', { status }));
            return;
          }

          if (hop.url.protocol === 'https:' && redirectUrl.protocol === 'http:') {
            finish(
              failure(base, 'API_REDIRECT_BLOCKED', 'HTTPS to HTTP downgrade redirects are blocked.', {
                status,
              })
            );
            return;
          }

          const nextMethod = rewriteMethod(status, hop.method);
          // Cross-origin hops lose credentials; the method rewrite also drops the payload.
          const crossOrigin = !sameOrigin(hop.url, redirectUrl);
          const nextHeaders = crossOrigin ? stripSensitiveHeaders(hop.headers) : hop.headers;
          const nextBody = nextMethod === hop.method ? hop.body : undefined;
          const nextHeadersFinal =
            nextBody === undefined && hop.body !== undefined
              ? nextHeaders.filter((header) => header.name.toLowerCase() !== 'content-type')
              : nextHeaders;

          void performRequest(
            request,
            { url: redirectUrl, method: nextMethod, headers: nextHeadersFinal, body: nextBody },
            [...redirects, { status, url: redirectUrl.toString(), method: nextMethod }],
            startedAt,
            timings
          ).then(finish);
          return;
        }

        const streaming = Boolean(request.onBodyChunk);
        request.onResponseStart?.({
          status,
          headers: responseHeaders,
          contentType:
            typeof response.headers['content-type'] === 'string'
              ? response.headers['content-type']
              : undefined,
          url: hop.url.toString(),
        });

        const chunks: Buffer[] = [];
        let wireBytes = 0;
        let stored = 0;
        let firstByteAt: number | undefined;

        response.on('data', (chunk: Buffer) => {
          if (firstByteAt === undefined) {
            firstByteAt = Date.now();
            timings.firstByteMs = (timings.firstByteMs ?? 0) + (firstByteAt - connectStart);
            request.onProgress?.('download');
          }
          wireBytes += chunk.byteLength;
          if (streaming) {
            request.onBodyChunk?.(chunk);
            return;
          }
          // Bounded accumulation: stop retaining bytes once the persistence cap is reached.
          if (stored < request.persistResponseBytes) {
            const room = request.persistResponseBytes - stored;
            const slice = chunk.byteLength <= room ? chunk : chunk.subarray(0, room);
            chunks.push(slice);
            stored += slice.byteLength;
          }
        });

        response.on('end', () => {
          void (async () => {
            const raw = Buffer.concat(chunks);
            const capExceeded = wireBytes > request.persistResponseBytes;
            const contentEncoding = response.headers['content-encoding'];
            const decompressed = await decompressBody(
              typeof contentEncoding === 'string' ? contentEncoding : undefined,
              raw
            );
            const displayCap = request.displayResponseBytes;
            const body =
              decompressed.body.byteLength > displayCap
                ? decompressed.body.subarray(0, displayCap)
                : decompressed.body;
            const downloadEnd = Date.now();
            timings.downloadMs = (timings.downloadMs ?? 0) + (downloadEnd - (firstByteAt ?? connectStart));
            finish({
              ok: status >= 200 && status < 300,
              status,
              statusText: response.statusMessage ?? '',
              url: hop.url.toString(),
              method: hop.method,
              headers: responseHeaders.filter((header) => header.name.toLowerCase() !== 'set-cookie'),
              body,
              wireBytes,
              decodedBytes: decompressed.body.byteLength,
              truncated: capExceeded || decompressed.body.byteLength > displayCap,
              contentType:
                typeof response.headers['content-type'] === 'string'
                  ? response.headers['content-type']
                  : undefined,
              encoding: decompressed.encoding,
              redirects,
              timings: { ...timings, totalMs: Date.now() - startedAt },
              setCookieHeaders,
              tlsExceptionApplied,
            });
          })();
        });

        response.on('error', (error) => {
          finish(
            failure(base, 'API_PROTOCOL_ERROR', error instanceof Error ? error.message : 'Response failed.', {
              status,
              headers: responseHeaders,
              tlsExceptionApplied,
            })
          );
        });
      }
    );

    outgoing.on('error', (error) => {
      const message = error instanceof Error ? error.message : 'Request failed.';
      const code = classifyTransportError(error, message);
      finish(failure(base, code, message, { tlsExceptionApplied }));
    });

    outgoing.on('timeout', () => {
      outgoing.destroy();
      finish(failure(base, 'API_TIMEOUT', 'The request timed out.', { tlsExceptionApplied }));
    });

    if (request.signal) {
      abortListener = () => {
        outgoing.destroy();
        finish(failure(base, 'API_CANCELLED', 'The request was cancelled.'));
      };
      if (request.signal.aborted) abortListener();
      else request.signal.addEventListener('abort', abortListener, { once: true });
    }

    if (hop.body) {
      request.onProgress?.('upload');
      outgoing.write(hop.body);
    }
    outgoing.end();
  });
}

const TLS_ERROR_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_SSL_WRONG_VERSION_NUMBER',
]);

function classifyTransportError(error: unknown, message: string): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (TLS_ERROR_CODES.has(code)) return 'API_TLS_FAILED';
  if (code === 'ETIMEDOUT' || message.toLowerCase().includes('timeout')) return 'API_TIMEOUT';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'API_DNS_FAILED';
  return 'API_CONNECT_FAILED';
}

export async function executeHttpTransport(
  request: HttpTransportRequest
): Promise<HttpTransportResponse> {
  const startedAt = Date.now();
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return failure(
      { url: request.url, method: request.method, redirects: [], startedAt },
      'INVALID_REQUEST',
      'The request URL is not valid.'
    );
  }

  return performRequest(
    request,
    { url, method: request.method, headers: request.headers, body: request.body },
    [],
    startedAt,
    {}
  );
}
