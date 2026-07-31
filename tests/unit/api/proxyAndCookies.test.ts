import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { basicProxyAuthorization, bypassesProxy, resolveProxy } from '@main/api/ProxyPolicy';
import { createCookieJar, createCookieJarRegistry } from '@main/api/CookieJar';
import {
  connectionInit,
  graphqlEventToEntry,
  parseGraphqlWsMessage,
  subscribeMessage,
} from '@main/api/GraphqlSubscription';
import type { ApiProxyProfile } from '@shared/contracts/apiWorkbench';

function profile(patch: Partial<ApiProxyProfile>): ApiProxyProfile {
  return {
    profileId: randomUUID(),
    workspaceId: randomUUID(),
    name: 'Corp',
    mode: 'http',
    host: 'proxy.corp',
    port: 8080,
    bypass: [],
    enabled: true,
    revision: 1,
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    ...patch,
  };
}

describe('proxy bypass matching', () => {
  it('matches an exact host, a dotted suffix, a bare domain, and the wildcard', () => {
    expect(bypassesProxy('api.test', ['api.test'])).toBe(true);
    expect(bypassesProxy('a.api.test', ['.api.test'])).toBe(true);
    expect(bypassesProxy('api.test', ['.api.test'])).toBe(true);
    expect(bypassesProxy('a.api.test', ['api.test'])).toBe(true);
    expect(bypassesProxy('anything', ['*'])).toBe(true);
  });

  it('does not match a different host that merely shares a suffix string', () => {
    // `evilapi.test` ends with `api.test` as a *string* but is a different domain.
    expect(bypassesProxy('evilapi.test', ['api.test'])).toBe(false);
    expect(bypassesProxy('api.test.evil', ['api.test'])).toBe(false);
  });

  it('ignores blank entries', () => {
    expect(bypassesProxy('api.test', ['', '   '])).toBe(false);
  });
});

describe('proxy resolution', () => {
  const url = new URL('https://api.test/users');

  it('goes direct with no profile, a disabled profile, or direct mode', () => {
    expect(resolveProxy(url, null)).toEqual({ kind: 'direct' });
    expect(resolveProxy(url, profile({ enabled: false }))).toEqual({ kind: 'direct' });
    expect(resolveProxy(url, profile({ mode: 'direct' }))).toEqual({ kind: 'direct' });
  });

  it('uses an explicit http proxy', () => {
    expect(resolveProxy(url, profile({}))).toEqual({
      kind: 'http',
      host: 'proxy.corp',
      port: 8080,
      source: 'profile',
    });
  });

  it('honours the profile bypass list before anything else', () => {
    expect(resolveProxy(url, profile({ bypass: ['.test'] }))).toEqual({ kind: 'direct' });
  });

  it('never reads the launch environment unless the profile asks for system mode', () => {
    const environment = { HTTPS_PROXY: 'http://env.proxy:3128' };
    // A shell that exports a proxy must not redirect a request configured as direct.
    expect(resolveProxy(url, profile({ mode: 'direct' }), environment)).toEqual({ kind: 'direct' });
    expect(resolveProxy(url, null, environment)).toEqual({ kind: 'direct' });
    expect(resolveProxy(url, profile({}), environment)).toMatchObject({ host: 'proxy.corp' });

    expect(resolveProxy(url, profile({ mode: 'system' }), environment)).toEqual({
      kind: 'http',
      host: 'env.proxy',
      port: 3128,
      authorization: undefined,
      source: 'environment',
    });
  });

  it('reads NO_PROXY and the scheme-specific variable in system mode', () => {
    const system = profile({ mode: 'system' });
    expect(
      resolveProxy(url, system, { HTTPS_PROXY: 'http://env.proxy:3128', NO_PROXY: 'api.test' })
    ).toEqual({ kind: 'direct' });
    expect(
      resolveProxy(new URL('http://api.test/x'), system, {
        HTTP_PROXY: 'plain.proxy:80',
        HTTPS_PROXY: 'http://secure.proxy:443',
      })
    ).toMatchObject({ host: 'plain.proxy', port: 80 });
  });

  it('carries credentials embedded in an environment proxy URL', () => {
    const resolved = resolveProxy(url, profile({ mode: 'system' }), {
      HTTPS_PROXY: 'http://user:p%40ss@env.proxy:3128',
    });
    expect(resolved).toMatchObject({ host: 'env.proxy' });
    if (resolved.kind === 'direct') throw new Error('expected a proxy');
    expect(resolved.authorization).toBe(`Basic ${Buffer.from('user:p@ss').toString('base64')}`);
  });

  it('accepts SOCKS5 and falls back to direct for an unparseable proxy URL', () => {
    const system = profile({ mode: 'system' });
    expect(resolveProxy(url, system, { HTTPS_PROXY: 'socks5://user:pass@x:1080' })).toMatchObject({
      kind: 'socks5',
      host: 'x',
      port: 1080,
      credentials: { username: 'user', password: 'pass' },
    });
    expect(resolveProxy(url, system, { HTTPS_PROXY: ':::' })).toEqual({ kind: 'direct' });
  });

  it('uses an explicit SOCKS5 profile', () => {
    expect(resolveProxy(url, profile({ mode: 'socks5', port: 1080 }))).toEqual({
      kind: 'socks5',
      host: 'proxy.corp',
      port: 1080,
      source: 'profile',
    });
  });

  it('goes direct when an http/https profile is missing its host or port', () => {
    expect(resolveProxy(url, profile({ host: undefined }))).toEqual({ kind: 'direct' });
    expect(resolveProxy(url, profile({ port: undefined }))).toEqual({ kind: 'direct' });
  });

  it('builds a Basic credential only when there is something to send', () => {
    expect(basicProxyAuthorization('', '')).toBeUndefined();
    expect(basicProxyAuthorization('u', 'p')).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`);
  });
});

describe('cookie jar host-only and SameSite handling', () => {
  it('keeps a host-only cookie off subdomains', () => {
    const jar = createCookieJar();
    jar.setFromResponse('https://api.test/', ['session=1; Path=/']);
    expect(jar.cookieHeader('https://api.test/x')).toBe('session=1');
    // No `Domain` was set, so the cookie belongs to that exact host.
    expect(jar.cookieHeader('https://sub.api.test/x')).toBeUndefined();
  });

  it('sends a domain cookie to subdomains', () => {
    const jar = createCookieJar();
    jar.setFromResponse('https://api.test/', ['session=1; Path=/; Domain=api.test']);
    expect(jar.cookieHeader('https://sub.api.test/x')).toBe('session=1');
  });

  it('records SameSite and defaults it to Lax', () => {
    const jar = createCookieJar();
    jar.setFromResponse('https://api.test/', [
      'a=1; Path=/',
      'b=2; Path=/; SameSite=Strict',
      'c=3; Path=/; SameSite=None; Secure',
    ]);
    expect(jar.list().map((cookie) => [cookie.name, cookie.sameSite])).toEqual([
      ['a', 'lax'],
      ['b', 'strict'],
      ['c', 'none'],
    ]);
  });

  it('rejects SameSite=None without Secure, as browsers do', () => {
    const jar = createCookieJar();
    jar.setFromResponse('http://api.test/', ['a=1; Path=/; SameSite=None']);
    expect(jar.list()).toEqual([]);
  });

  it('lists, removes one exact cookie, and clears', () => {
    const jar = createCookieJar();
    jar.setFromResponse('https://api.test/', ['a=1; Path=/', 'b=2; Path=/api']);
    expect(jar.list()).toHaveLength(2);

    expect(jar.remove('b', 'api.test', '/api')).toBe(true);
    expect(jar.remove('b', 'api.test', '/api')).toBe(false);
    expect(jar.list().map((cookie) => cookie.name)).toEqual(['a']);

    jar.clear();
    expect(jar.list()).toEqual([]);
  });

  it('prunes an expired cookie out of the listing', () => {
    const jar = createCookieJar();
    jar.setFromResponse('https://api.test/', ['a=1; Path=/; Max-Age=-1']);
    expect(jar.list()).toEqual([]);
  });
});

describe('named cookie jars', () => {
  it('keeps a named jar separate from the default and from other workspaces', () => {
    const registry = createCookieJarRegistry();
    const workspace = randomUUID();
    const other = randomUUID();

    registry.forWorkspace(workspace).setFromResponse('https://api.test/', ['who=default; Path=/']);
    registry.forWorkspace(workspace, 'second').setFromResponse('https://api.test/', ['who=named; Path=/']);
    registry.forWorkspace(other).setFromResponse('https://api.test/', ['who=other; Path=/']);

    expect(registry.forWorkspace(workspace).cookieHeader('https://api.test/')).toBe('who=default');
    expect(registry.forWorkspace(workspace, 'second').cookieHeader('https://api.test/')).toBe(
      'who=named'
    );
    expect(registry.forWorkspace(other).cookieHeader('https://api.test/')).toBe('who=other');
  });

  it('drops every jar a workspace owns when it is cleared', () => {
    const registry = createCookieJarRegistry();
    const workspace = randomUUID();
    registry.forWorkspace(workspace).setFromResponse('https://api.test/', ['a=1; Path=/']);
    registry.forWorkspace(workspace, 'second').setFromResponse('https://api.test/', ['a=2; Path=/']);
    expect(registry.jarIds(workspace)).toHaveLength(2);

    registry.clearWorkspace(workspace);
    expect(registry.jarIds(workspace)).toEqual([]);
    // A fresh jar for the same workspace starts empty rather than resurrecting the old one.
    expect(registry.forWorkspace(workspace, 'second').list()).toEqual([]);
  });
});

describe('graphql-transport-ws protocol', () => {
  const id = 'sub-1';

  it('builds connection_init and subscribe frames', () => {
    expect(connectionInit()).toEqual({ type: 'connection_init' });
    expect(subscribeMessage(id, 'subscription { ticks }', { a: 1 }, 'Ticks')).toEqual({
      type: 'subscribe',
      id,
      payload: { query: 'subscription { ticks }', variables: { a: 1 }, operationName: 'Ticks' },
    });
    // Omitted rather than sent as null, which some servers reject.
    expect(subscribeMessage(id, 'q', undefined)).toEqual({
      type: 'subscribe',
      id,
      payload: { query: 'q' },
    });
  });

  it('parses acknowledgement, payloads, errors, and completion', () => {
    expect(parseGraphqlWsMessage('{"type":"connection_ack"}', id)).toEqual({ kind: 'ack' });
    expect(parseGraphqlWsMessage(`{"type":"next","id":"${id}","payload":{"data":{"t":1}}}`, id)).toEqual({
      kind: 'next',
      data: { data: { t: 1 } },
    });
    expect(parseGraphqlWsMessage(`{"type":"error","id":"${id}","payload":[{"message":"bad"}]}`, id)).toEqual({
      kind: 'errors',
      errors: [{ message: 'bad' }],
    });
    expect(parseGraphqlWsMessage(`{"type":"complete","id":"${id}"}`, id)).toEqual({ kind: 'complete' });
    expect(parseGraphqlWsMessage('{"type":"ping"}', id)).toEqual({ kind: 'ping', payload: undefined });
  });

  it('ignores a frame addressed to another subscription', () => {
    // A server draining a previous subscription must not be reported against the current one.
    expect(parseGraphqlWsMessage('{"type":"next","id":"other","payload":{}}', id)).toBeNull();
    expect(parseGraphqlWsMessage('{"type":"complete","id":"other"}', id)).toBeNull();
  });

  it('reports a malformed or unknown frame as a protocol error', () => {
    expect(parseGraphqlWsMessage('not json', id)).toMatchObject({ kind: 'protocol-error' });
    expect(parseGraphqlWsMessage('{"nope":1}', id)).toMatchObject({ kind: 'protocol-error' });
    expect(parseGraphqlWsMessage('{"type":"weird"}', id)).toMatchObject({ kind: 'protocol-error' });
  });

  it('renders payloads as transcript rows and hides keep-alives', () => {
    expect(graphqlEventToEntry({ kind: 'next', data: { a: 1 } }, 1000)).toMatchObject({
      direction: 'in',
      kind: 'sse-event',
      eventName: 'next',
    });
    expect(graphqlEventToEntry({ kind: 'ping' }, 1000)).toBeNull();
    expect(graphqlEventToEntry({ kind: 'pong' }, 1000)).toBeNull();
    expect(graphqlEventToEntry({ kind: 'complete' }, 1000)).toMatchObject({ kind: 'close' });
  });

  it('truncates an oversized payload rather than shipping it whole', () => {
    const entry = graphqlEventToEntry({ kind: 'next', data: { a: 'x'.repeat(5000) } }, 100);
    expect(entry?.truncated).toBe(true);
    expect(entry?.text).toHaveLength(100);
  });
});
