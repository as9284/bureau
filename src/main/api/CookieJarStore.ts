import { z } from 'zod';
import type { SecretCipher } from '../gitea/GiteaCredentialStore';
import type { AtomicJsonStore } from '../storage/AtomicJsonStore';
import {
  createCookieJarRegistry,
  type CookieJarRegistry,
  type CookieJarSnapshot,
  type CookieRecord,
} from './CookieJar';

type CookieJarDiskRecord = { key: string; cipher: string };
type CookieJarsFileV1 = { schemaVersion: 1; jars: CookieJarDiskRecord[]; updatedAt: string };

const cookieRecordSchema = z.object({
  name: z.string().min(1).max(256),
  value: z.string().max(8192),
  domain: z.string().max(255).optional(),
  path: z.string().min(1).max(1024),
  secure: z.boolean(),
  httpOnly: z.boolean(),
  expires: z.number().finite().optional(),
  hostOnly: z.boolean(),
  sameSite: z.enum(['strict', 'lax', 'none']),
});

const fileSchema = z.object({
  schemaVersion: z.literal(1),
  jars: z.array(z.object({ key: z.string().min(1).max(128), cipher: z.string().min(1) })).max(1000),
  updatedAt: z.string(),
});

function readFile(store: AtomicJsonStore<unknown>): CookieJarsFileV1 {
  const parsed = fileSchema.safeParse(store.read());
  return parsed.success ? parsed.data : { schemaVersion: 1, jars: [], updatedAt: new Date().toISOString() };
}

/**
 * Persists complete jars encrypted with the platform keychain. Cookies are credentials in practice,
 * so this intentionally follows the secret-store rule: no keychain means session-only, never a
 * plaintext convenience file.
 */
export type PersistentCookieJarRegistry = CookieJarRegistry & {
  ready: Promise<void>;
  flush(): Promise<void>;
};

export function createPersistentCookieJarRegistry(
  store: AtomicJsonStore<unknown>,
  cipher: SecretCipher
): PersistentCookieJarRegistry {
  let hydrating = true;
  let pending: Promise<void> = Promise.resolve();
  const registry = createCookieJarRegistry({
    onChanged: () => {
      if (!hydrating) void scheduleWrite();
    },
  });

  async function write(): Promise<void> {
    if (!cipher.available()) return;
    const jars = registry
      .snapshot()
      .filter((entry) => entry.cookies.length > 0)
      .map((entry) => ({
        key: entry.key,
        cipher: cipher.encrypt(JSON.stringify(entry.cookies)),
      }));
    await store.update(() => ({ schemaVersion: 1, jars, updatedAt: new Date().toISOString() }));
  }

  function scheduleWrite(): Promise<void> {
    pending = pending.then(write, write);
    return pending;
  }

  const ready = (async () => {
    try {
      if (!cipher.available()) return;
      const recovered: CookieJarSnapshot = [];
      for (const entry of readFile(store).jars) {
        try {
          const decoded: unknown = JSON.parse(cipher.decrypt(entry.cipher));
          const cookies = z.array(cookieRecordSchema).max(5000).safeParse(decoded);
          if (cookies.success) recovered.push({ key: entry.key, cookies: cookies.data as CookieRecord[] });
        } catch {
          // A keychain migration or a corrupt record invalidates that jar only, never the workspace.
        }
      }
      registry.replaceAll(recovered);
    } finally {
      hydrating = false;
    }
  })();

  return Object.assign(registry, {
    ready,
    flush: async () => {
      await ready;
      await pending;
    },
  });
}
