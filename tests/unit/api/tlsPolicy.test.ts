import { describe, expect, it } from 'vitest';
import { hostHasCertificateException, tlsOptionsForHost } from '@main/api/TlsPolicy';
import type { ApiTlsProfile } from '@shared/contracts/apiWorkbench';

function profile(hosts: string[]): ApiTlsProfile {
  return {
    profileId: '11111111-1111-4111-8111-111111111111',
    workspaceId: '22222222-2222-4222-8222-222222222222',
    name: 'test',
    allowInvalidCertificateHosts: hosts,
    enabled: true,
    revision: 1,
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
  };
}

describe('TLS policy', () => {
  it('verifies strictly when there is no profile', () => {
    expect(tlsOptionsForHost(new URL('https://example.com'), null, {}).rejectUnauthorized).toBe(true);
  });

  it('verifies strictly when the profile lists no exceptions', () => {
    const options = tlsOptionsForHost(new URL('https://example.com'), profile([]), {});
    expect(options.rejectUnauthorized).toBe(true);
  });

  it('applies an exception only to the exact host', () => {
    const tls = profile(['internal.example.com']);
    expect(hostHasCertificateException(new URL('https://internal.example.com/x'), tls)).toBe(true);
    // Neither a parent domain nor a sibling subdomain inherits the exception.
    expect(hostHasCertificateException(new URL('https://example.com'), tls)).toBe(false);
    expect(hostHasCertificateException(new URL('https://evil.internal.example.com'), tls)).toBe(false);
    expect(hostHasCertificateException(new URL('https://internal.example.com.evil.test'), tls)).toBe(
      false
    );
  });

  it('scopes a host:port entry to that port only', () => {
    const tls = profile(['staging.example.com:8443']);
    expect(hostHasCertificateException(new URL('https://staging.example.com:8443/'), tls)).toBe(true);
    expect(hostHasCertificateException(new URL('https://staging.example.com/'), tls)).toBe(false);
    expect(hostHasCertificateException(new URL('https://staging.example.com:9443/'), tls)).toBe(false);
  });

  it('lets a bare-host entry cover any port on that host', () => {
    const tls = profile(['internal.example.com']);
    expect(hostHasCertificateException(new URL('https://internal.example.com:8443/'), tls)).toBe(true);
  });

  it('matches case-insensitively', () => {
    const tls = profile(['Internal.Example.COM']);
    expect(hostHasCertificateException(new URL('https://internal.example.com'), tls)).toBe(true);
  });

  it('does not carry an exception to a redirect target on another host', () => {
    const tls = profile(['first.example.com']);
    // Each hop is evaluated with its own URL, so the second host verifies strictly.
    expect(tlsOptionsForHost(new URL('https://first.example.com'), tls, {}).rejectUnauthorized).toBe(
      false
    );
    expect(tlsOptionsForHost(new URL('https://second.example.com'), tls, {}).rejectUnauthorized).toBe(
      true
    );
  });

  it('passes CA, client certificate, and key material through', () => {
    const tls: ApiTlsProfile = {
      ...profile([]),
      caPem: 'CA',
      clientCertPem: 'CERT',
      minVersion: 'TLSv1.3',
    };
    const options = tlsOptionsForHost(new URL('https://example.com'), tls, {
      clientKeyPem: 'KEY',
      passphrase: 'pass',
    });
    expect(options).toMatchObject({
      ca: 'CA',
      cert: 'CERT',
      key: 'KEY',
      passphrase: 'pass',
      minVersion: 'TLSv1.3',
      rejectUnauthorized: true,
    });
  });
});
