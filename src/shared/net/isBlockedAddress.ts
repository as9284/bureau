import net from 'node:net';

/**
 * Returns true when an IPv4/IPv6 literal must not be contacted by main-process
 * remote fetches (SSRF guard for untrusted README remote-image URLs).
 */
export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true;
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // multicast / reserved / broadcast
  return false;
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  // IPv4-mapped / IPv4-compatible
  const mapped = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isBlockedIpv4(mapped[1]);
  const hexMapped = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const hi = Number.parseInt(hexMapped[1], 16);
    const lo = Number.parseInt(hexMapped[2], 16);
    return isBlockedIpv4(`${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`);
  }
  // Expand leading hextets enough to inspect prefixes.
  const [head] = expandIpv6(normalized);
  if (head === 0x0000 && expandIpv6(normalized).every((part, index) => index === 7 ? part === 1 : part === 0)) {
    return true; // ::1
  }
  if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((head & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (head === 0x2001 && expandIpv6(normalized)[1] === 0x0db8) return true; // documentation
  return false;
}

function expandIpv6(address: string): number[] {
  const [left, right = ''] = address.split('::');
  const leftParts = left ? left.split(':').filter(Boolean) : [];
  const rightParts = right ? right.split(':').filter(Boolean) : [];
  const missing = 8 - leftParts.length - rightParts.length;
  const parts = [
    ...leftParts,
    ...Array.from({ length: Math.max(0, missing) }, () => '0'),
    ...rightParts,
  ];
  while (parts.length < 8) parts.push('0');
  return parts.slice(0, 8).map((part) => Number.parseInt(part, 16) || 0);
}
