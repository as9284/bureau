import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApiPersistence } from '@main/api/ApiPersistence';
import { createApiWorkspaceStore } from '@main/api/ApiWorkspaceStore';

describe('ApiWorkspaceStore', () => {
  let userData: string;

  beforeEach(async () => {
    userData = await fs.mkdtemp(path.join(os.tmpdir(), 'bureau-api-ws-'));
  });

  afterEach(async () => {
    await fs.rm(userData, { recursive: true, force: true });
  });

  it('creates a workspace with a default request node', async () => {
    const persistence = await createApiPersistence(userData);
    const store = createApiWorkspaceStore(persistence);

    const file = await store.createWorkspace({ name: 'Payments API' });
    expect(file.summary.name).toBe('Payments API');
    expect(file.collections).toHaveLength(1);
    expect(file.collections[0].kind).toBe('request');
    expect(file.requests).toHaveLength(1);
    expect(file.requests[0].method).toBe('GET');

    const summaries = store.listSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0].workspaceId).toBe(file.summary.workspaceId);
  });

  it('returns STALE_STATE when expectedRevision mismatches', async () => {
    const persistence = await createApiPersistence(userData);
    const store = createApiWorkspaceStore(persistence);
    const file = await store.createWorkspace({ name: 'Stale test' });
    const revision = file.summary.revision;

    const stale = await store.updateWorkspace({
      workspaceId: file.summary.workspaceId,
      expectedRevision: revision + 99,
      name: 'Renamed',
    });

    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.error.code).toBe('STALE_STATE');
    }

    const ok = await store.updateWorkspace({
      workspaceId: file.summary.workspaceId,
      expectedRevision: revision,
      name: 'Renamed',
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.file.summary.name).toBe('Renamed');
      expect(ok.file.summary.revision).toBe(revision + 1);
    }
  });

  it('creates an additional request collection node', async () => {
    const persistence = await createApiPersistence(userData);
    const store = createApiWorkspaceStore(persistence);
    const file = await store.createWorkspace({ name: 'Collections' });

    const created = await store.createDefaultRequestNode({
      workspaceId: file.summary.workspaceId,
      parentId: null,
      name: 'Health check',
    });

    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.file.requests).toHaveLength(2);
      expect(created.file.collections).toHaveLength(2);
      expect(created.requestId).toBeTruthy();
    }
  });
});

describe('unknown workspace ids', () => {
  it('returns null instead of a phantom empty workspace', async () => {
    // The per-workspace store falls back to a default value whose summary carries the
    // requested id, so without an index check any UUID would look like a real workspace.
    const dataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'bureau-api-phantom-'));
    try {
      const persistence = await createApiPersistence(dataPath);
      const store = createApiWorkspaceStore(persistence);

      const unknown = '99999999-9999-4999-8999-999999999999';
      expect(await store.getFile(unknown)).toBeNull();
      expect(await store.getSnapshot(unknown, {})).toBeNull();

      // Mutating an unknown workspace must not bring it into existence.
      const mutated = await store.mutateWorkspace(unknown, null, (file) => file);
      expect(mutated.ok).toBe(false);
      if (!mutated.ok) expect(mutated.error.code).toBe('API_WORKSPACE_NOT_FOUND');
      expect(store.listSummaries()).toHaveLength(0);

      // A real workspace still resolves.
      const created = await store.createWorkspace({ name: 'Real' });
      expect(await store.getFile(created.summary.workspaceId)).not.toBeNull();
    } finally {
      await fs.rm(dataPath, { recursive: true, force: true });
    }
  });
});
