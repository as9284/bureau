import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApiPersistence } from '@main/api/ApiPersistence';
import { createPersistentCookieJarRegistry } from '@main/api/CookieJarStore';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const cipher = {
  available: () => true,
  encrypt: (value: string) => Buffer.from(`sealed:${value}`, 'utf8').toString('base64'),
  decrypt: (value: string) => Buffer.from(value, 'base64').toString('utf8').slice('sealed:'.length),
};

describe('persistent cookie jars', () => {
  it('restores encrypted cookies after a service restart without writing values in plaintext', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bureau-api-cookies-'));
    roots.push(root);
    const persistence = await createApiPersistence(root);
    const first = createPersistentCookieJarRegistry(persistence.cookiesStore, cipher);
    await first.ready;
    first.forWorkspace('workspace', 'account-a').setFromResponse('https://api.test/', ['sid=very-secret; Path=/']);
    await first.flush();

    const onDisk = await fs.readFile(persistence.cookiesPath, 'utf8');
    expect(onDisk).not.toContain('very-secret');

    const secondPersistence = await createApiPersistence(root);
    const second = createPersistentCookieJarRegistry(secondPersistence.cookiesStore, cipher);
    await second.ready;
    expect(second.forWorkspace('workspace', 'account-a').cookieHeader('https://api.test/')).toBe('sid=very-secret');
  });

  it('keeps cookies session-only when encrypted storage is unavailable', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bureau-api-cookies-'));
    roots.push(root);
    const persistence = await createApiPersistence(root);
    const unavailable = { ...cipher, available: () => false };
    const first = createPersistentCookieJarRegistry(persistence.cookiesStore, unavailable);
    await first.ready;
    first.forWorkspace('workspace').setFromResponse('https://api.test/', ['sid=session-only; Path=/']);
    await first.flush();

    const second = createPersistentCookieJarRegistry(persistence.cookiesStore, unavailable);
    await second.ready;
    expect(second.forWorkspace('workspace').list()).toEqual([]);
  });
});
