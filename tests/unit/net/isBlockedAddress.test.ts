import { describe, expect, it } from 'vitest';
import { isBlockedAddress } from '@shared/net/isBlockedAddress';

describe('isBlockedAddress', () => {
  it('blocks loopback, private, link-local, CGNAT, and reserved IPv4 ranges', () => {
    expect(isBlockedAddress('127.0.0.1')).toBe(true);
    expect(isBlockedAddress('0.0.0.0')).toBe(true);
    expect(isBlockedAddress('10.0.0.1')).toBe(true);
    expect(isBlockedAddress('172.16.5.4')).toBe(true);
    expect(isBlockedAddress('192.168.1.10')).toBe(true);
    expect(isBlockedAddress('169.254.169.254')).toBe(true);
    expect(isBlockedAddress('100.64.1.1')).toBe(true);
    expect(isBlockedAddress('224.0.0.1')).toBe(true);
  });

  it('allows public IPv4 addresses', () => {
    expect(isBlockedAddress('8.8.8.8')).toBe(false);
    expect(isBlockedAddress('1.1.1.1')).toBe(false);
    expect(isBlockedAddress('93.184.216.34')).toBe(false);
  });

  it('blocks loopback, ULA, link-local, and mapped private IPv6', () => {
    expect(isBlockedAddress('::1')).toBe(true);
    expect(isBlockedAddress('::')).toBe(true);
    expect(isBlockedAddress('fc00::1')).toBe(true);
    expect(isBlockedAddress('fd12:3456:789a::1')).toBe(true);
    expect(isBlockedAddress('fe80::1')).toBe(true);
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedAddress('::ffff:192.168.0.1')).toBe(true);
  });

  it('allows public IPv6 addresses', () => {
    expect(isBlockedAddress('2001:4860:4860::8888')).toBe(false);
  });
});
