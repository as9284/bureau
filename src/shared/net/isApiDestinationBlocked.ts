/**
 * Returns true when a resolved destination is a cloud metadata or equivalent
 * credential endpoint. RFC 1918, ULA, and loopback are permitted.
 */
export function isApiDestinationBlocked(address: string): boolean {
  const normalized = address.toLowerCase();

  if (normalized === '169.254.169.254') return true;
  if (normalized === '169.254.169.253') return true;
  if (normalized === 'fd00:ec2::254') return true;
  if (normalized === '::ffff:169.254.169.254') return true;

  return false;
}
