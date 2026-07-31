import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ApiSecretSummary } from '@shared/contracts/apiWorkbench';
import type { SecretCipher } from '../gitea/GiteaCredentialStore';
import type { AtomicJsonStore } from '../storage/AtomicJsonStore';
import { toBureauError } from '../ipc/errors';

type SecretDiskRecord = {
  secretId: string;
  label: string;
  tokenCipher?: string;
  updatedAt: string;
};

type SecretsFileV1 = {
  schemaVersion: 1;
  secrets: SecretDiskRecord[];
  updatedAt: string;
};

const secretsFileSchema = z.object({
  schemaVersion: z.literal(1),
  secrets: z.array(
    z.object({
      secretId: z.string(),
      label: z.string(),
      tokenCipher: z.string().optional(),
      updatedAt: z.string(),
    })
  ),
  updatedAt: z.string(),
});

type SessionSecret = {
  label: string;
  value: string;
  updatedAt: string;
};

export type ApiSecretStore = {
  list(): ApiSecretSummary[];
  save(input: { secretId?: string; label: string; value: string; persist: boolean }): Promise<
    | { ok: true; summary: ApiSecretSummary }
    | { ok: false; error: ReturnType<typeof toBureauError> }
  >;
  delete(secretId: string): Promise<{ ok: true } | { ok: false; error: ReturnType<typeof toBureauError> }>;
  getPlaintext(secretId: string): string | undefined;
  canPersist(): boolean;
};

export function createApiSecretStore(
  store: AtomicJsonStore<SecretsFileV1>,
  cipher: SecretCipher
): ApiSecretStore {
  const sessionSecrets = new Map<string, SessionSecret>();

  function readFile(): SecretsFileV1 {
    const value = store.read();
    const parsed = secretsFileSchema.safeParse(value);
    if (parsed.success) return parsed.data;
    return { schemaVersion: 1, secrets: [], updatedAt: new Date().toISOString() };
  }

  function canPersist(): boolean {
    return cipher.available();
  }

  function list(): ApiSecretSummary[] {
    const file = readFile();
    const summaries: ApiSecretSummary[] = file.secrets.map((record) => ({
      secretId: record.secretId,
      label: record.label,
      hasValue: Boolean(record.tokenCipher),
      persisted: true,
      updatedAt: record.updatedAt,
    }));
    for (const [secretId, record] of sessionSecrets) {
      summaries.push({
        secretId,
        label: record.label,
        hasValue: record.value.length > 0,
        persisted: false,
        updatedAt: record.updatedAt,
      });
    }
    return summaries.sort((a, b) => a.label.localeCompare(b.label));
  }

  function getPlaintext(secretId: string): string | undefined {
    const session = sessionSecrets.get(secretId);
    if (session) return session.value;
    const file = readFile();
    const record = file.secrets.find((entry) => entry.secretId === secretId);
    if (!record?.tokenCipher || !cipher.available()) return undefined;
    try {
      return cipher.decrypt(record.tokenCipher);
    } catch {
      return undefined;
    }
  }

  async function save(input: {
    secretId?: string;
    label: string;
    value: string;
    persist: boolean;
  }): Promise<
    | { ok: true; summary: ApiSecretSummary }
    | { ok: false; error: ReturnType<typeof toBureauError> }
  > {
    const secretId = input.secretId ?? randomUUID();
    const updatedAt = new Date().toISOString();

    if (input.persist) {
      if (!cipher.available()) {
        return {
          ok: false,
          error: toBureauError({
            code: 'API_SECRET_STORAGE_UNAVAILABLE',
            message: 'Encrypted storage is unavailable, so the secret cannot be saved.',
            operation: 'api.saveSecret',
            retryable: false,
          }),
        };
      }
      const tokenCipher = cipher.encrypt(input.value);
      await store.update((current) => {
        const file = secretsFileSchema.safeParse(current).success
          ? (current as SecretsFileV1)
          : { schemaVersion: 1 as const, secrets: [], updatedAt };
        const secrets = file.secrets.filter((entry) => entry.secretId !== secretId);
        secrets.push({ secretId, label: input.label, tokenCipher, updatedAt });
        sessionSecrets.delete(secretId);
        return { schemaVersion: 1, secrets, updatedAt };
      });
      return {
        ok: true,
        summary: {
          secretId,
          label: input.label,
          hasValue: input.value.length > 0,
          persisted: true,
          updatedAt,
        },
      };
    }

    sessionSecrets.set(secretId, { label: input.label, value: input.value, updatedAt });
    return {
      ok: true,
      summary: {
        secretId,
        label: input.label,
        hasValue: input.value.length > 0,
        persisted: false,
        updatedAt,
      },
    };
  }

  async function deleteSecret(
    secretId: string
  ): Promise<{ ok: true } | { ok: false; error: ReturnType<typeof toBureauError> }> {
    sessionSecrets.delete(secretId);
    await store.update((current) => {
      const file = secretsFileSchema.safeParse(current).success
        ? (current as SecretsFileV1)
        : { schemaVersion: 1 as const, secrets: [], updatedAt: new Date().toISOString() };
      return {
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        secrets: file.secrets.filter((entry) => entry.secretId !== secretId),
      };
    });
    return { ok: true };
  }

  return {
    list,
    save,
    delete: deleteSecret,
    getPlaintext,
    canPersist,
  };
}
