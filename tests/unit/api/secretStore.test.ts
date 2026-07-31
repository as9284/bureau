import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApiApplicationService } from '@main/api/ApiApplicationService';
import { validateSettings } from '@main/storage/schemas';
import { DEFAULT_API_SETTINGS } from '@shared/contracts/settings';

describe('ApiSecretStore encryption', () => {
  let dataPath: string;

  beforeEach(async () => {
    dataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'bureau-api-secret-'));
  });

  afterEach(async () => {
    await fs.rm(dataPath, { recursive: true, force: true });
  });

  it('stores ciphertext on disk and never plaintext', async () => {
    const plaintext = 'never-write-me-plain';
    const cipher = {
      available: () => true,
      encrypt: (plain: string) => Buffer.from(`enc:${plain}`, 'utf8').toString('base64'),
      decrypt: (cipherText: string) =>
        Buffer.from(cipherText, 'base64').toString('utf8').replace(/^enc:/, ''),
    };
    const settingsStore = {
      get: () => ({ ...validateSettings({}), api: { ...DEFAULT_API_SETTINGS } }),
    };
    const api = await createApiApplicationService({
      dataPath,
      cipher,
      settingsStore: settingsStore as never,
      catalogue: { get: () => undefined } as never,
      openExternal: async () => undefined,
    dialog: {
      showOpenDirectoryDialog: async () => undefined,
      showOpenFileDialog: async () => undefined,
      showSaveFileDialog: async () => undefined,
    },
    });

    try {
      const saved = await api.saveSecret({
        label: 'prod token',
        value: plaintext,
        persist: true,
      });
      expect(saved.ok).toBe(true);

      const secretsPath = path.join(dataPath, 'api', 'secrets.v1.json');
      const onDisk = await fs.readFile(secretsPath, 'utf8');
      expect(onDisk).not.toContain(plaintext);
      expect(onDisk).toContain('tokenCipher');

      const listed = api.listSecrets();
      expect(listed).toHaveLength(1);
      expect(listed[0]?.hasValue).toBe(true);
      expect(listed[0]?.persisted).toBe(true);
    } finally {
      api.dispose();
    }
  });
});
