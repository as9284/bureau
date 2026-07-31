import { describe, it, expect } from 'vitest';
import { createApiApplicationService } from '@main/api/ApiApplicationService';
import { validateSettings } from '@main/storage/schemas';
import { settingsPatchSchema } from '@shared/validation/requests';
import { apiEmptyRequestSchema } from '@shared/validation/apiWorkbench';
import { assertTrustedSender, InvalidSenderError } from '@main/ipc/senderValidation';
import type { IpcMainInvokeEvent } from 'electron';
import { DEFAULT_API_SETTINGS, API_SIDEBAR_DEFAULT_WIDTH } from '@shared/contracts/settings';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function createTempApiService() {
  const dataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'bureau-api-phase0-'));
  const cipher = {
    available: () => false,
    encrypt: (plain: string) => plain,
    decrypt: (cipherText: string) => cipherText,
  };
  const settingsStore = {
    get: () => ({ ...validateSettings({}), api: { ...DEFAULT_API_SETTINGS } }),
  };
  const catalogue = {
    get: () => undefined,
  };
  const api = await createApiApplicationService({
    dataPath,
    cipher,
    settingsStore: settingsStore as never,
    catalogue: catalogue as never,
    openExternal: async () => undefined,
    dialog: {
      showOpenDirectoryDialog: async () => undefined,
      showOpenFileDialog: async () => undefined,
      showSaveFileDialog: async () => undefined,
    },
  });
  return { api, dataPath };
}

describe('ApiApplicationService (Phase 1 bootstrap)', () => {
  it('returns a ready status and starts with an empty workspace index', async () => {
    const { api, dataPath } = await createTempApiService();
    try {
      await expect(api.getStatus()).resolves.toEqual({
        ready: true,
        secretStorageAvailable: false,
      });
      await expect(api.listWorkspaces()).resolves.toEqual({ workspaces: [] });
    } finally {
      api.dispose();
      await fs.rm(dataPath, { recursive: true, force: true });
    }
  });

  it('keeps a request collection label in sync when the request is renamed', async () => {
    const { api, dataPath } = await createTempApiService();
    try {
      const workspace = await api.createWorkspace({ name: 'Fixture workspace' });
      const created = await api.createCollection({
        workspaceId: workspace.summary.workspaceId,
        parentId: null,
        kind: 'request',
        name: 'Original request',
      });
      if (!created.ok || !created.requestId) throw new Error('Expected a request fixture.');
      const request = created.snapshot.requests.find((entry) => entry.requestId === created.requestId);
      expect(request).toBeDefined();

      const saved = await api.saveRequest({
        workspaceId: workspace.summary.workspaceId,
        requestId: created.requestId,
        expectedRevision: request!.revision,
        patch: { name: 'Renamed request' },
      });

      expect(saved.ok).toBe(true);
      if (!saved.ok) return;
      expect(saved.snapshot.requests.find((entry) => entry.requestId === created.requestId)?.name).toBe(
        'Renamed request'
      );
      expect(saved.snapshot.collections.find((entry) => entry.requestId === created.requestId)?.name).toBe(
        'Renamed request'
      );
    } finally {
      api.dispose();
      await fs.rm(dataPath, { recursive: true, force: true });
    }
  });

  it('keeps a request title in sync when its collection entry is renamed', async () => {
    const { api, dataPath } = await createTempApiService();
    try {
      const workspace = await api.createWorkspace({ name: 'Fixture workspace' });
      const created = await api.createCollection({
        workspaceId: workspace.summary.workspaceId,
        parentId: null,
        kind: 'request',
        name: 'Original request',
      });
      if (!created.ok || !created.requestId) throw new Error('Expected a request fixture.');
      const collection = created.snapshot.collections.find((entry) => entry.requestId === created.requestId);
      expect(collection).toBeDefined();

      const updated = await api.updateCollection({
        workspaceId: workspace.summary.workspaceId,
        collectionId: collection!.collectionId,
        expectedRevision: collection!.revision,
        name: 'Sidebar rename',
      });

      expect(updated.ok).toBe(true);
      if (!updated.ok) return;
      expect(updated.snapshot.collections.find((entry) => entry.collectionId === collection!.collectionId)?.name).toBe(
        'Sidebar rename'
      );
      expect(updated.snapshot.requests.find((entry) => entry.requestId === created.requestId)?.name).toBe(
        'Sidebar rename'
      );
    } finally {
      api.dispose();
      await fs.rm(dataPath, { recursive: true, force: true });
    }
  });
});

describe('API settings schema', () => {
  it('fills API defaults for legacy settings files without an api section', () => {
    const settings = validateSettings({});
    expect(settings.api).toEqual(DEFAULT_API_SETTINGS);
    expect(settings.layout.paneWidths.apiSidebar).toBe(API_SIDEBAR_DEFAULT_WIDTH);
  });

  it('forces importedScriptsDefaultEnabled to false even if a file claims true', () => {
    const settings = validateSettings({
      api: { importedScriptsDefaultEnabled: true as unknown as false },
    });
    expect(settings.api.importedScriptsDefaultEnabled).toBe(false);
  });

  it('accepts a partial api settings patch and rejects enabling imported scripts', () => {
    expect(settingsPatchSchema.parse({ api: { requestTimeoutMs: 60_000 } })).toEqual({
      api: { requestTimeoutMs: 60_000 },
    });
    expect(() =>
      settingsPatchSchema.parse({ api: { importedScriptsDefaultEnabled: true } })
    ).toThrow();
  });
});

describe('API IPC validation', () => {
  it('accepts an empty object payload for Phase 0 invokes', () => {
    expect(apiEmptyRequestSchema.parse({})).toEqual({});
  });

  it('rejects unexpected keys', () => {
    expect(() => apiEmptyRequestSchema.parse({ unexpected: true })).toThrow();
  });

  it('rejects untrusted senders before handlers run', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const event = {
        senderFrame: { url: 'https://evil.example/' },
      } as unknown as IpcMainInvokeEvent;
      expect(() => assertTrustedSender(event)).toThrow(InvalidSenderError);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('allows the trusted packaged file:// sender', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const event = {
        senderFrame: { url: 'file:///app/index.html' },
      } as unknown as IpcMainInvokeEvent;
      expect(() => assertTrustedSender(event)).not.toThrow();
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
