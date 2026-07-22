import { z } from 'zod';
import type { AtomicJsonStore } from '../storage/AtomicJsonStore';
import { createAtomicJsonStore } from '../storage/AtomicJsonStore';

/**
 * Encrypts the personal access token at rest. Backed by Electron's `safeStorage`
 * in the app; injected so the service is unit-testable without Electron.
 */
export type SecretCipher = {
  available(): boolean;
  encrypt(plain: string): string;
  decrypt(cipher: string): string;
};

export type GiteaConnectionRecord = {
  hostUrl: string;
  account: string;
  /** base64 ciphertext — never the raw token. */
  tokenCipher: string;
};

export type GiteaConnectionsFileV1 = {
  schemaVersion: 1;
  updatedAt: string;
  connection: GiteaConnectionRecord | null;
};

const connectionSchema = z.object({
  hostUrl: z.string().min(1).max(2048),
  account: z.string().min(1).max(128),
  tokenCipher: z.string().min(1).max(8192),
});

const fileSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.string(),
  connection: connectionSchema.nullable().catch(null),
});

export function createDefaultGiteaConnections(): GiteaConnectionsFileV1 {
  return { schemaVersion: 1, updatedAt: new Date().toISOString(), connection: null };
}

export function validateGiteaConnections(value: unknown): GiteaConnectionsFileV1 {
  const parsed = fileSchema.safeParse(value);
  return parsed.success ? parsed.data : createDefaultGiteaConnections();
}

export function createGiteaCredentialStoreSource(
  filePath: string
): AtomicJsonStore<GiteaConnectionsFileV1> {
  return createAtomicJsonStore<GiteaConnectionsFileV1>({
    filePath,
    schemaVersion: 1,
    defaultValue: createDefaultGiteaConnections(),
    validate: validateGiteaConnections,
  });
}

export type GiteaCredentialStore = {
  /** Host of the stored connection, without decrypting the token. */
  getHostUrl(): string | undefined;
  getAccount(): string | undefined;
  /** Returns undefined when nothing is stored or the ciphertext cannot be read. */
  getToken(): { hostUrl: string; account: string; token: string } | undefined;
  save(input: { hostUrl: string; account: string; token: string }): Promise<void>;
  clear(): Promise<void>;
  /** False when the OS keyring is unavailable, so a token must not be persisted. */
  canPersist(): boolean;
};

export function createGiteaCredentialStore(
  store: AtomicJsonStore<GiteaConnectionsFileV1>,
  cipher: SecretCipher
): GiteaCredentialStore {
  function record(): GiteaConnectionRecord | undefined {
    return store.read().connection ?? undefined;
  }

  function getToken(): { hostUrl: string; account: string; token: string } | undefined {
    const current = record();
    if (!current || !cipher.available()) return undefined;
    try {
      return {
        hostUrl: current.hostUrl,
        account: current.account,
        token: cipher.decrypt(current.tokenCipher),
      };
    } catch {
      // The keyring key changed (OS reinstall, different user) — the stored
      // ciphertext is unreadable and the operator must reconnect.
      return undefined;
    }
  }

  async function save(input: {
    hostUrl: string;
    account: string;
    token: string;
  }): Promise<void> {
    if (!cipher.available()) {
      throw new Error('Encrypted storage is unavailable, so the token cannot be saved.');
    }
    const tokenCipher = cipher.encrypt(input.token);
    await store.update((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      connection: { hostUrl: input.hostUrl, account: input.account, tokenCipher },
    }));
  }

  async function clear(): Promise<void> {
    await store.update((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      connection: null,
    }));
  }

  return {
    getHostUrl: () => record()?.hostUrl,
    getAccount: () => record()?.account,
    getToken,
    save,
    clear,
    canPersist: () => cipher.available(),
  };
}
