import { describe, expect, it } from 'vitest';
import { createCookieJar } from '@main/api/CookieJar';

describe('CookieJar domain scoping', () => {
  it('stores a host-only cookie when no Domain attribute is present', () => {
    const jar = createCookieJar();
    jar.setFromResponse('https://app.example.com/', ['sid=1; Path=/']);
    expect(jar.cookieHeader('https://app.example.com/')).toBe('sid=1');
  });

  it('accepts a Domain the response is itself under', () => {
    const jar = createCookieJar();
    jar.setFromResponse('https://app.example.com/', ['sid=1; Domain=example.com; Path=/']);
    expect(jar.cookieHeader('https://other.example.com/')).toBe('sid=1');
  });

  it('rejects a Domain the response is not under', () => {
    const jar = createCookieJar();
    // A response from evil.test must not be able to set a cookie for a bank.
    jar.setFromResponse('https://evil.test/', ['sid=stolen; Domain=bank.example.com; Path=/']);
    expect(jar.cookieHeader('https://bank.example.com/')).toBeUndefined();
    expect(jar.cookieHeader('https://evil.test/')).toBeUndefined();
  });

  it('rejects a bare TLD as a cookie domain', () => {
    const jar = createCookieJar();
    jar.setFromResponse('https://evil.com/', ['tracker=1; Domain=com; Path=/']);
    expect(jar.cookieHeader('https://unrelated.com/')).toBeUndefined();
  });

  it('does not let a suffix-similar host claim the domain', () => {
    const jar = createCookieJar();
    jar.setFromResponse('https://notexample.com/', ['sid=1; Domain=example.com']);
    expect(jar.cookieHeader('https://example.com/')).toBeUndefined();
  });

  it('honours the leading dot form of Domain', () => {
    const jar = createCookieJar();
    jar.setFromResponse('https://app.example.com/', ['sid=1; Domain=.example.com']);
    expect(jar.cookieHeader('https://api.example.com/')).toBe('sid=1');
  });

  it('withholds a Secure cookie from a plain http request', () => {
    const jar = createCookieJar();
    jar.setFromResponse('https://app.example.com/', ['sid=1; Secure; Path=/']);
    expect(jar.cookieHeader('http://app.example.com/')).toBeUndefined();
  });

  it('scopes cookies by path', () => {
    const jar = createCookieJar();
    jar.setFromResponse('https://app.example.com/', ['scoped=1; Path=/admin']);
    expect(jar.cookieHeader('https://app.example.com/admin/users')).toBe('scoped=1');
    expect(jar.cookieHeader('https://app.example.com/public')).toBeUndefined();
  });

  it('drops expired cookies', () => {
    const jar = createCookieJar();
    jar.setFromResponse('https://app.example.com/', ['gone=1; Max-Age=-1']);
    expect(jar.cookieHeader('https://app.example.com/')).toBeUndefined();
  });
});
