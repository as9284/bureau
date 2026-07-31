export type CookieRecord = {
  name: string;
  value: string;
  domain?: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expires?: number;
  /**
   * True when the response set no `Domain`. A host-only cookie goes back to that exact host and to
   * no subdomain of it — the distinction RFC 6265 draws and the one a jar that stores only a domain
   * string silently loses.
   */
  hostOnly: boolean;
  sameSite: 'strict' | 'lax' | 'none';
};

/**
 * A response may only widen a cookie to a domain it is itself under. Without this a response
 * from `evil.example` could set `Domain=com` (or any unrelated host) and have the jar attach
 * that cookie to every later request.
 */
function isAcceptableCookieDomain(requestHost: string, domain: string): boolean {
  const host = requestHost.toLowerCase();
  const dom = domain.toLowerCase().replace(/^\./, '');
  if (!dom || dom.includes('/') || dom.includes(':')) return false;
  // A bare TLD (or any single label) is never an acceptable cookie scope.
  if (!dom.includes('.')) return false;
  return host === dom || host.endsWith(`.${dom}`);
}

function parseSetCookieHeader(header: string, requestUrl: URL): CookieRecord | null {
  const parts = header.split(';').map((part) => part.trim());
  const [nameValue, ...attrs] = parts;
  if (!nameValue || !nameValue.includes('=')) return null;
  const eq = nameValue.indexOf('=');
  const name = nameValue.slice(0, eq).trim();
  const value = nameValue.slice(eq + 1);
  if (!name) return null;

  let domain = requestUrl.hostname;
  let cookiePath = '/';
  let secure = requestUrl.protocol === 'https:';
  let httpOnly = false;
  let expires: number | undefined;
  let hostOnly = true;
  // RFC 6265bis: absent SameSite defaults to Lax.
  let sameSite: CookieRecord['sameSite'] = 'lax';

  for (const attr of attrs) {
    const lower = attr.toLowerCase();
    if (lower.startsWith('domain=')) {
      const requested = attr.slice('domain='.length).trim().replace(/^\./, '');
      // Reject the whole cookie rather than silently narrowing it to the request host.
      if (!isAcceptableCookieDomain(requestUrl.hostname, requested)) return null;
      domain = requested;
      hostOnly = false;
    } else if (lower.startsWith('path=')) {
      cookiePath = attr.slice('path='.length).trim() || '/';
    } else if (lower === 'secure') {
      secure = true;
    } else if (lower === 'httponly') {
      httpOnly = true;
    } else if (lower.startsWith('expires=')) {
      const date = Date.parse(attr.slice('expires='.length).trim());
      if (Number.isFinite(date)) expires = date;
    } else if (lower.startsWith('max-age=')) {
      const seconds = Number(attr.slice('max-age='.length).trim());
      if (Number.isFinite(seconds)) expires = Date.now() + seconds * 1000;
    } else if (lower.startsWith('samesite=')) {
      const requested = lower.slice('samesite='.length).trim();
      if (requested === 'strict' || requested === 'lax' || requested === 'none') sameSite = requested;
    }
  }

  // `SameSite=None` without `Secure` is rejected by browsers; a jar that kept it would send a
  // cookie over plaintext that the server asked to be cross-site and secure.
  if (sameSite === 'none' && !secure) return null;
  return { name, value, domain, path: cookiePath, secure, httpOnly, expires, hostOnly, sameSite };
}

function domainMatches(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase();
  const dom = domain.toLowerCase();
  return host === dom || host.endsWith(`.${dom}`);
}

export type CookieJar = {
  setFromResponse(url: string, setCookieHeaders: string[]): void;
  cookieHeader(url: string): string | undefined;
  clear(): void;
  delete(name: string, url?: string): void;
  /** Everything currently held, expired entries pruned. Values are sensitive — see the inspector. */
  list(): CookieRecord[];
  /** Removes one exact cookie identified by its name/domain/path triple. */
  remove(name: string, domain: string | undefined, path: string): boolean;
  /** Replaces the whole contents, used by jar restore. */
  replaceAll(records: CookieRecord[]): void;
  /** Adds or replaces one exact name/domain/path record from the inspector. */
  upsert(record: CookieRecord): void;
};

export function createCookieJar(onChanged?: () => void): CookieJar {
  const cookies: CookieRecord[] = [];

  function pruneExpired(): void {
    const now = Date.now();
    for (let i = cookies.length - 1; i >= 0; i -= 1) {
      const cookie = cookies[i];
      if (cookie.expires !== undefined && cookie.expires <= now) {
        cookies.splice(i, 1);
      }
    }
  }

  function setFromResponse(url: string, setCookieHeaders: string[]): void {
    pruneExpired();
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return;
    }
    let changed = false;
    for (const header of setCookieHeaders) {
      const record = parseSetCookieHeader(header, parsedUrl);
      if (!record) continue;
      const index = cookies.findIndex(
        (existing) =>
          existing.name === record.name &&
          existing.domain === record.domain &&
          existing.path === record.path
      );
      if (index >= 0) cookies[index] = record;
      else cookies.push(record);
      changed = true;
    }
    if (changed) onChanged?.();
  }

  function cookieHeader(url: string): string | undefined {
    pruneExpired();
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return undefined;
    }
    const matches = cookies.filter((cookie) => {
      const cookieDomain = cookie.domain ?? parsedUrl.hostname;
      // A host-only cookie belongs to the exact host that set it, not to its subdomains.
      if (cookie.hostOnly) {
        if (parsedUrl.hostname.toLowerCase() !== cookieDomain.toLowerCase()) return false;
      } else if (!domainMatches(parsedUrl.hostname, cookieDomain)) return false;
      if (!parsedUrl.pathname.startsWith(cookie.path)) return false;
      if (cookie.secure && parsedUrl.protocol !== 'https:') return false;
      return true;
    });
    if (matches.length === 0) return undefined;
    return matches.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  }

  function clear(): void {
    if (cookies.length === 0) return;
    cookies.length = 0;
    onChanged?.();
  }

  function deleteCookie(name: string, url?: string): void {
    let changed = false;
    if (!url) {
      for (let i = cookies.length - 1; i >= 0; i -= 1) {
        if (cookies[i].name === name) {
          cookies.splice(i, 1);
          changed = true;
        }
      }
      if (changed) onChanged?.();
      return;
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return;
    }
    for (let i = cookies.length - 1; i >= 0; i -= 1) {
      const cookie = cookies[i];
      if (
        cookie.name === name &&
        domainMatches(parsedUrl.hostname, cookie.domain ?? parsedUrl.hostname) &&
        parsedUrl.pathname.startsWith(cookie.path)
      ) {
        cookies.splice(i, 1);
        changed = true;
      }
    }
    if (changed) onChanged?.();
  }

  function list(): CookieRecord[] {
    pruneExpired();
    return cookies.map((cookie) => ({ ...cookie }));
  }

  function remove(name: string, domain: string | undefined, path: string): boolean {
    const index = cookies.findIndex(
      (cookie) => cookie.name === name && cookie.domain === domain && cookie.path === path
    );
    if (index < 0) return false;
    cookies.splice(index, 1);
    onChanged?.();
    return true;
  }

  function replaceAll(records: CookieRecord[]): void {
    cookies.length = 0;
    cookies.push(...records.map((record) => ({ ...record })));
    onChanged?.();
  }

  function upsert(record: CookieRecord): void {
    const index = cookies.findIndex(
      (cookie) => cookie.name === record.name && cookie.domain === record.domain && cookie.path === record.path
    );
    if (index >= 0) cookies[index] = { ...record };
    else cookies.push({ ...record });
    onChanged?.();
  }

  return {
    setFromResponse,
    cookieHeader,
    clear,
    delete: deleteCookie,
    list,
    remove,
    replaceAll,
    upsert,
  };
}

export type CookieJarSnapshot = Array<{ key: string; cookies: CookieRecord[] }>;

export type CookieJarRegistry = {
  /** The workspace's active jar — its default unless a named jar is selected. */
  forWorkspace(workspaceId: string, jarId?: string): CookieJar;
  clearWorkspace(workspaceId: string): void;
  /** Named jars that currently hold state for a workspace, default first. */
  jarIds(workspaceId: string): string[];
  snapshot(): CookieJarSnapshot;
  replaceAll(snapshot: CookieJarSnapshot): void;
  dispose(): void;
};

/**
 * Jars are keyed by `workspaceId` plus an optional jar id, so cookies never cross a workspace — and
 * a named jar (a second logged-in identity against the same API, say) never sees the default jar's
 * cookies either. Nothing here is shared with Bureau's own session, the preview partition, or the
 * OAuth browser (§11.4).
 */
export function createCookieJarRegistry(options: { onChanged?: () => void } = {}): CookieJarRegistry {
  const jars = new Map<string, CookieJar>();
  const key = (workspaceId: string, jarId?: string): string =>
    jarId ? `${workspaceId}:${jarId}` : workspaceId;

  return {
    forWorkspace(workspaceId: string, jarId?: string) {
      const id = key(workspaceId, jarId);
      let jar = jars.get(id);
      if (!jar) {
        jar = createCookieJar(options.onChanged);
        jars.set(id, jar);
      }
      return jar;
    },
    clearWorkspace(workspaceId: string) {
      // Removing a workspace drops every one of its jars, named ones included.
      for (const id of [...jars.keys()]) {
        if (id === workspaceId || id.startsWith(`${workspaceId}:`)) jars.delete(id);
      }
      options.onChanged?.();
    },
    jarIds(workspaceId: string) {
      const ids: string[] = [];
      for (const id of jars.keys()) {
        if (id === workspaceId) ids.unshift('');
        else if (id.startsWith(`${workspaceId}:`)) ids.push(id.slice(workspaceId.length + 1));
      }
      return ids;
    },
    snapshot() {
      return [...jars.entries()].map(([key, jar]) => ({ key, cookies: jar.list() }));
    },
    replaceAll(snapshot) {
      jars.clear();
      for (const entry of snapshot) {
        const jar = createCookieJar(options.onChanged);
        jar.replaceAll(entry.cookies);
        jars.set(entry.key, jar);
      }
    },
    dispose() {
      jars.clear();
    },
  };
}
