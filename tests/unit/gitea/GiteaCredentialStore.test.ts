import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createGiteaCredentialStore,
  createGiteaCredentialStoreSource,
  type GiteaCredentialStore,
  type SecretCipher,
} from '../../../src/main/gitea/GiteaCredentialStore';

/** Stands in for Electron's safeStorage; reversible so round-trips are assertable. */
function fakeCipher(available = true): SecretCipher {
  return {
    available: () => available,
    encrypt: (plain) => Buffer.from(`enc:${plain}`, 'utf8').toString('base64'),
    decrypt: (cipher) => {
      const decoded = Buffer.from(cipher, 'base64').toString('utf8');
      if (!decoded.startsWith('enc:')) throw new Error('bad ciphertext');
      return decoded.slice(4);
    },
  };
}

let directory: string;
let filePath: string;

async function makeStore(cipher: SecretCipher): Promise<GiteaCredentialStore> {
  const source = createGiteaCredentialStoreSource(filePath);
  await source.load();
  return createGiteaCredentialStore(source, cipher);
}

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bureau-gitea-'));
  filePath = path.join(directory, 'gitea.v1.json');
});

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

describe('GiteaCredentialStore', () => {
  it('reports nothing configured before a connection is saved', async () => {
    const store = await makeStore(fakeCipher());
    expect(store.getHostUrl()).toBeUndefined();
    expect(store.getToken()).toBeUndefined();
  });

  it('round-trips a connection through the cipher', async () => {
    const store = await makeStore(fakeCipher());
    await store.save({ hostUrl: 'https://gitea.example.com', account: 'ana', token: 's3cret' });

    expect(store.getHostUrl()).toBe('https://gitea.example.com');
    expect(store.getAccount()).toBe('ana');
    expect(store.getToken()).toEqual({
      hostUrl: 'https://gitea.example.com',
      account: 'ana',
      token: 's3cret',
    });
  });

  it('never writes the raw token to disk', async () => {
    const store = await makeStore(fakeCipher());
    await store.save({ hostUrl: 'https://gitea.example.com', account: 'ana', token: 's3cret' });

    const onDisk = await fs.readFile(filePath, 'utf8');
    expect(onDisk).not.toContain('s3cret');
    expect(JSON.parse(onDisk).connection.tokenCipher).toBeTruthy();
  });

  it('refuses to persist when the OS keyring is unavailable, rather than storing plaintext', async () => {
    const store = await makeStore(fakeCipher(false));
    expect(store.canPersist()).toBe(false);
    await expect(
      store.save({ hostUrl: 'https://gitea.example.com', account: 'ana', token: 's3cret' })
    ).rejects.toThrow(/Encrypted storage is unavailable/);
    await expect(fs.readFile(filePath, 'utf8')).rejects.toThrow();
  });

  it('treats an undecryptable ciphertext as no connection (keyring key changed)', async () => {
    const store = await makeStore(fakeCipher());
    await store.save({ hostUrl: 'https://gitea.example.com', account: 'ana', token: 's3cret' });

    const reopened = await makeStore({
      available: () => true,
      encrypt: () => 'x',
      decrypt: () => {
        throw new Error('decrypt failed');
      },
    });
    expect(reopened.getToken()).toBeUndefined();
    // The host stays visible so the UI can say "reconnect" instead of "not set up".
    expect(reopened.getHostUrl()).toBe('https://gitea.example.com');
  });

  it('clears the stored connection', async () => {
    const store = await makeStore(fakeCipher());
    await store.save({ hostUrl: 'https://gitea.example.com', account: 'ana', token: 's3cret' });
    await store.clear();

    expect(store.getHostUrl()).toBeUndefined();
    expect(await fs.readFile(filePath, 'utf8')).not.toContain('s3cret');
  });

  it('survives a corrupt file by falling back to no connection', async () => {
    await fs.writeFile(filePath, '{ not json', 'utf8');
    const store = await makeStore(fakeCipher());
    expect(store.getHostUrl()).toBeUndefined();
  });
});
