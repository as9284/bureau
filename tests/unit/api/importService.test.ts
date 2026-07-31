import { describe, expect, it, beforeEach } from 'vitest';
import { createImportService, uniqueName } from '@main/api/import/ImportService';
import { DEFAULT_API_SETTINGS } from '@shared/contracts/settings';
import type { ApiWorkspaceFileV1 } from '@main/api/ApiWorkspaceStore';
import type { NativeDialogAdapter } from '@main/system/dialogAdapter';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-07-29T00:00:00.000Z';

/** A dialog that always cancels: no test may ever open a real picker. */
const cancellingDialog: NativeDialogAdapter = {
  showOpenDirectoryDialog: async () => undefined,
  showOpenFileDialog: async () => undefined,
  showSaveFileDialog: async () => undefined,
};

function emptyWorkspace(): ApiWorkspaceFileV1 {
  return {
    schemaVersion: 1,
    summary: {
      workspaceId: WORKSPACE_ID,
      name: 'Payments',
      createdAt: NOW,
      updatedAt: NOW,
      revision: 1,
    },
    variables: [],
    auth: { kind: 'none' },
    collections: [],
    requests: [],
    environments: [],
    updatedAt: NOW,
  };
}

const POSTMAN = JSON.stringify({
  info: { name: 'Imported', schema: 'v2.1' },
  item: [
    { name: 'Ping', request: { method: 'GET', url: 'https://api.test/ping' } },
    { name: 'Pong', request: { method: 'GET', url: 'https://api.test/pong' } },
  ],
});

describe('uniqueName', () => {
  it('suffixes until the name is free', () => {
    expect(uniqueName('Ping', [])).toBe('Ping');
    expect(uniqueName('Ping', ['Ping'])).toBe('Ping (2)');
    expect(uniqueName('Ping', ['Ping', 'Ping (2)'])).toBe('Ping (3)');
  });
});

describe('ImportService', () => {
  let service: ReturnType<typeof createImportService>;

  beforeEach(() => {
    service = createImportService(cancellingDialog);
  });

  async function inspect(text: string, file = emptyWorkspace()) {
    return service.inspect({
      workspaceId: WORKSPACE_ID,
      format: 'auto',
      text,
      settings: DEFAULT_API_SETTINGS,
      existingNames: (parentId) =>
        file.collections.filter((node) => node.parentId === parentId).map((node) => node.name),
      existingEnvironmentNames: () => file.environments.map((environment) => environment.name),
    });
  }

  it('previews without writing anything', async () => {
    const file = emptyWorkspace();
    const result = await inspect(POSTMAN, file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.counts.requests).toBe(2);
    // The workspace is untouched until commit.
    expect(file.collections).toHaveLength(0);
    expect(file.requests).toHaveLength(0);
  });

  it('commits the whole tree in one pass', async () => {
    const result = await inspect(POSTMAN);
    if (!result.ok) return;

    const committed = service.commit({
      previewId: result.preview.previewId,
      workspaceId: WORKSPACE_ID,
      parentId: null,
      conflictStrategy: 'rename',
      file: emptyWorkspace(),
    });
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;

    expect(committed.report.createdFolders).toBe(1);
    expect(committed.report.createdRequests).toBe(2);
    expect(committed.file.collections).toHaveLength(3);
    expect(committed.file.requests).toHaveLength(2);

    // Every created node carries a fresh identity and the right parent.
    const folder = committed.file.collections.find((node) => node.kind === 'folder')!;
    const children = committed.file.collections.filter((node) => node.parentId === folder.collectionId);
    expect(children).toHaveLength(2);
  });

  it('refuses to commit the same preview twice', async () => {
    const result = await inspect(POSTMAN);
    if (!result.ok) return;
    const first = service.commit({
      previewId: result.preview.previewId,
      workspaceId: WORKSPACE_ID,
      parentId: null,
      conflictStrategy: 'rename',
      file: emptyWorkspace(),
    });
    expect(first.ok).toBe(true);

    const second = service.commit({
      previewId: result.preview.previewId,
      workspaceId: WORKSPACE_ID,
      parentId: null,
      conflictStrategy: 'rename',
      file: emptyWorkspace(),
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.message).toMatch(/expired/i);
  });

  it('rejects a preview belonging to another workspace', async () => {
    const result = await inspect(POSTMAN);
    if (!result.ok) return;
    const committed = service.commit({
      previewId: result.preview.previewId,
      workspaceId: '99999999-9999-4999-8999-999999999999',
      parentId: null,
      conflictStrategy: 'rename',
      file: emptyWorkspace(),
    });
    expect(committed.ok).toBe(false);
  });

  describe('conflict strategies', () => {
    function workspaceWithImported(): ApiWorkspaceFileV1 {
      const file = emptyWorkspace();
      file.collections.push({
        collectionId: 'existing-folder',
        workspaceId: WORKSPACE_ID,
        parentId: null,
        kind: 'folder',
        name: 'Imported',
        order: 0,
        variables: [],
        revision: 1,
      });
      file.collections.push({
        collectionId: 'existing-child',
        workspaceId: WORKSPACE_ID,
        parentId: 'existing-folder',
        kind: 'request',
        name: 'Old request',
        order: 0,
        requestId: 'existing-request',
        variables: [],
        revision: 1,
      });
      file.requests.push({
        requestId: 'existing-request',
        workspaceId: WORKSPACE_ID,
        collectionId: 'existing-child',
        name: 'Old request',
        protocol: 'http',
        urlTemplate: 'https://api.test/old',
        method: 'GET',
        query: [],
        headers: [],
        auth: { kind: 'none' },
        body: { kind: 'none' },
        protocolOptions: {},
        scripts: {},
        settings: {},
        variables: [],
        revision: 1,
        createdAt: NOW,
        updatedAt: NOW,
      });
      return file;
    }

    async function commitWith(strategy: 'rename' | 'skip' | 'replace') {
      const file = workspaceWithImported();
      const result = await inspect(POSTMAN, file);
      if (!result.ok) throw new Error('inspect failed');
      const committed = service.commit({
        previewId: result.preview.previewId,
        workspaceId: WORKSPACE_ID,
        parentId: null,
        conflictStrategy: strategy,
        file,
      });
      if (!committed.ok) throw new Error('commit failed');
      return committed;
    }

    it('flags the collision in the preview', async () => {
      const file = workspaceWithImported();
      const result = await inspect(POSTMAN, file);
      if (!result.ok) return;
      const root = result.preview.nodes.find((node) => node.parentTempId === null)!;
      expect(root.conflict).toBe(true);
    });

    it('rename keeps both', async () => {
      const committed = await commitWith('rename');
      const names = committed.file.collections.map((node) => node.name);
      expect(names).toContain('Imported');
      expect(names).toContain('Imported (2)');
      expect(committed.report.renamed).toBe(1);
      // The existing subtree survives untouched.
      expect(committed.file.requests.some((r) => r.name === 'Old request')).toBe(true);
    });

    it('skip drops the imported item and everything under it', async () => {
      const committed = await commitWith('skip');
      expect(committed.report.createdFolders).toBe(0);
      expect(committed.report.createdRequests).toBe(0);
      // Children of a skipped parent are skipped, not re-homed at the root.
      expect(committed.file.collections).toHaveLength(2);
      expect(committed.report.skipped).toBeGreaterThan(0);
    });

    it('replace removes the existing subtree', async () => {
      const committed = await commitWith('replace');
      expect(committed.report.replaced).toBe(1);
      expect(committed.file.requests.some((r) => r.name === 'Old request')).toBe(false);
      expect(committed.file.collections.filter((n) => n.name === 'Imported')).toHaveLength(1);
      expect(committed.report.createdRequests).toBe(2);
    });
  });

  it('imports scripts disabled and counts them', async () => {
    const withScript = JSON.stringify({
      info: { name: 'S', schema: 'v2.1' },
      item: [
        {
          name: 'Scripted',
          request: { method: 'GET', url: 'https://api.test/x' },
          event: [{ listen: 'test', script: { exec: ['console.log(1)'] } }],
        },
      ],
    });
    const result = await inspect(withScript);
    if (!result.ok) return;
    expect(result.preview.counts.scripts).toBe(1);

    const committed = service.commit({
      previewId: result.preview.previewId,
      workspaceId: WORKSPACE_ID,
      parentId: null,
      conflictStrategy: 'rename',
      file: emptyWorkspace(),
    });
    if (!committed.ok) return;
    expect(committed.report.scriptsImportedDisabled).toBe(1);
    // The source is retained so the user can review it before enabling.
    const scripted = committed.file.requests.find((r) => r.name === 'Scripted')!;
    expect(scripted.scripts.postResponse).toContain('console.log(1)');
  });

  it('rejects an oversized paste before parsing it', async () => {
    const service2 = createImportService(cancellingDialog);
    const huge = `curl https://api.test/${'x'.repeat(2000)}`;
    const result = await service2.inspect({
      workspaceId: WORKSPACE_ID,
      format: 'auto',
      text: huge,
      settings: { ...DEFAULT_API_SETTINGS, importFileBytes: 100 },
      existingNames: () => [],
      existingEnvironmentNames: () => [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('API_IMPORT_LIMIT_EXCEEDED');
  });

  it('cancelling the file picker is not an error state that writes anything', async () => {
    const result = await service.inspect({
      workspaceId: WORKSPACE_ID,
      format: 'auto',
      fromFile: true,
      settings: DEFAULT_API_SETTINGS,
      existingNames: () => [],
      existingEnvironmentNames: () => [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('API_CANCELLED');
  });

  it('discards a preview on request', async () => {
    const result = await inspect(POSTMAN);
    if (!result.ok) return;
    service.discard(result.preview.previewId);
    const committed = service.commit({
      previewId: result.preview.previewId,
      workspaceId: WORKSPACE_ID,
      parentId: null,
      conflictStrategy: 'rename',
      file: emptyWorkspace(),
    });
    expect(committed.ok).toBe(false);
  });
});
