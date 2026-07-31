import { describe, expect, it } from 'vitest';
import { isApiDestinationBlocked } from '@shared/net/isApiDestinationBlocked';

describe('isApiDestinationBlocked', () => {
  it('allows public, LAN, and loopback addresses', () => {
    expect(isApiDestinationBlocked('8.8.8.8')).toBe(false);
    expect(isApiDestinationBlocked('10.0.0.1')).toBe(false);
    expect(isApiDestinationBlocked('192.168.1.1')).toBe(false);
    expect(isApiDestinationBlocked('127.0.0.1')).toBe(false);
    expect(isApiDestinationBlocked('::1')).toBe(false);
  });

  it('blocks cloud metadata / link-local credential endpoints', () => {
    expect(isApiDestinationBlocked('169.254.169.254')).toBe(true);
    expect(isApiDestinationBlocked('169.254.169.253')).toBe(true);
    expect(isApiDestinationBlocked('fd00:ec2::254')).toBe(true);
  });
});
