/**
 * The single audited module allowed to weaken TLS verification.
 *
 * Strict certificate and hostname verification is always the default. An exception is
 * exact-host (optionally host:port) scoped, never global, and never carried across a
 * redirect to a different host — `tlsOptionsForHost` is called per hop with that hop's
 * own URL, so a redirect simply does not match the exception list.
 *
 * `scripts/check-forbidden-apis.mjs` allows `rejectUnauthorized: false` in this file only.
 */
import type { ApiTlsProfile } from '@shared/contracts/apiWorkbench';

export type TlsConnectionOptions = {
  ca?: string;
  cert?: string;
  key?: string;
  passphrase?: string;
  minVersion?: 'TLSv1.2' | 'TLSv1.3';
  rejectUnauthorized: boolean;
};

/** Normalises `host` / `host:port` for exact comparison. IPv6 brackets are stripped. */
function normalizeHostKey(value: string): string {
  return value.trim().toLowerCase().replace(/^\[|\]$/g, '');
}

/**
 * True when `url` exactly matches one of the profile's invalid-certificate exceptions.
 * A bare-host entry matches any port on that host; a `host:port` entry matches only that port.
 * Never wildcards, never suffix-matches — `evil.example.com` must not inherit `example.com`.
 */
export function hostHasCertificateException(url: URL, profile: ApiTlsProfile | null): boolean {
  if (!profile || profile.allowInvalidCertificateHosts.length === 0) return false;
  const host = normalizeHostKey(url.hostname);
  const hostPort = url.port ? `${host}:${url.port}` : host;
  for (const raw of profile.allowInvalidCertificateHosts) {
    const entry = normalizeHostKey(raw);
    if (!entry) continue;
    if (entry === host || entry === hostPort) return true;
  }
  return false;
}

/**
 * Builds the per-hop TLS options. `rejectUnauthorized` is true unless this exact host
 * carries an explicit, user-confirmed exception.
 */
export function tlsOptionsForHost(
  url: URL,
  profile: ApiTlsProfile | null,
  secrets: { clientKeyPem?: string; passphrase?: string }
): TlsConnectionOptions {
  const exempt = hostHasCertificateException(url, profile);
  return {
    ca: profile?.caPem || undefined,
    cert: profile?.clientCertPem || undefined,
    key: secrets.clientKeyPem || undefined,
    passphrase: secrets.passphrase || undefined,
    minVersion: profile?.minVersion,
    // Strict unless an audited exact-host exception applies.
    rejectUnauthorized: !exempt,
  };
}
