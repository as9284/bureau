import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAppServices, type AppBootstrap } from '@main/services/createAppServices';

/**
 * Phase 3 journey through the real services bootstrap: import a collection, verify it landed,
 * export it back out, and re-import the result.
 */
describe('API workspace Phase 3 interchange journey', () => {
  let userData: string;
  let exportDir: string;
  let boot: AppBootstrap;
  /** Path the stubbed save dialog will return, so no real picker is ever opened. */
  let savePath: string | undefined;
  let openPath: string | undefined;

  beforeEach(async () => {
    userData = await fs.mkdtemp(path.join(os.tmpdir(), 'bureau-e2e-api-p3-'));
    exportDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bureau-e2e-api-p3-out-'));
    savePath = undefined;
    openPath = undefined;
    boot = await createAppServices(userData, {
      openExternal: async () => undefined,
      dialogAdapter: {
        showOpenDirectoryDialog: async () => undefined,
        showOpenFileDialog: async () => openPath,
        showSaveFileDialog: async () => savePath,
      },
    });
  });

  afterEach(async () => {
    boot.services.api.dispose();
    await boot.supervisor.stopAll();
    await fs.rm(userData, { recursive: true, force: true });
    await fs.rm(exportDir, { recursive: true, force: true });
  });

  const POSTMAN = JSON.stringify({
    info: { name: 'Payments', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    variable: [
      { key: 'base_url', value: 'https://api.test' },
      { key: 'api_token', value: 'live-secret-value', type: 'secret' },
    ],
    item: [
      {
        name: 'Users',
        item: [
          {
            name: 'List users',
            request: {
              method: 'GET',
              url: 'https://api.test/users',
              header: [{ key: 'Accept', value: 'application/json' }],
            },
            event: [{ listen: 'test', script: { exec: ['bureau.test("ok", () => {})'] } }],
          },
          {
            name: 'Create user',
            request: {
              method: 'POST',
              url: 'https://api.test/users',
              body: { mode: 'raw', raw: '{"name":"ada"}', options: { raw: { language: 'json' } } },
            },
          },
        ],
      },
    ],
  });

  it('imports a Postman collection atomically and leaves scripts disabled', async () => {
    const { services } = boot;
    const created = await services.api.createWorkspace({ name: 'Payments' });
    const workspaceId = created.summary.workspaceId;

    const inspected = await services.api.inspectImport({
      workspaceId,
      format: 'auto',
      text: POSTMAN,
    });
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    expect(inspected.preview.format).toBe('postman');
    expect(inspected.preview.counts.requests).toBe(2);
    expect(inspected.preview.counts.scripts).toBe(1);

    // Inspecting must not have written anything yet.
    const beforeCommit = await services.api.getWorkspace(workspaceId);
    expect(beforeCommit!.requests.filter((r) => r.name === 'List users')).toHaveLength(0);

    const committed = await services.api.commitImport({
      workspaceId,
      previewId: inspected.preview.previewId,
      parentId: null,
      conflictStrategy: 'rename',
      acknowledgeScripts: true,
    });
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    expect(committed.report.createdRequests).toBe(2);
    expect(committed.report.scriptsImportedDisabled).toBe(1);

    const snapshot = await services.api.getWorkspace(workspaceId);
    const names = snapshot!.collections.map((node) => node.name);
    expect(names).toContain('Payments');
    expect(names).toContain('Users');
    expect(names).toContain('List users');

    // The secret variable arrived with no value, and no plaintext reached disk.
    const environment = snapshot!.environments.find((env) => env.name.includes('variables'))!;
    const token = environment.variables.find((v) => v.name === 'api_token')!;
    expect(token.secret).toBe(true);
    expect(token.value).toBeUndefined();

    const apiDir = path.join(userData, 'api');
    for (const entry of await fs.readdir(apiDir, { recursive: true })) {
      const full = path.join(apiDir, String(entry));
      if (!(await fs.stat(full)).isFile()) continue;
      expect(await fs.readFile(full, 'utf8')).not.toContain('live-secret-value');
    }
  });

  it('reports omissions before writing and only writes on commit', async () => {
    const { services } = boot;
    const created = await services.api.createWorkspace({ name: 'Payments' });
    const workspaceId = created.summary.workspaceId;

    const inspected = await services.api.inspectImport({ workspaceId, format: 'auto', text: POSTMAN });
    if (!inspected.ok) return;
    await services.api.commitImport({
      workspaceId,
      previewId: inspected.preview.previewId,
      parentId: null,
      conflictStrategy: 'rename',
      acknowledgeScripts: true,
    });

    const planned = await services.api.planExport({
      workspaceId,
      format: 'openapi',
      scope: { kind: 'workspace' },
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.includesSecrets).toBe(false);
    expect(planned.plan.omissions.some((o) => o.code === 'lossy-format')).toBe(true);

    // Planning writes nothing.
    expect(await fs.readdir(exportDir)).toEqual([]);

    // A cancelled save dialog is a no-op, not a failure.
    savePath = undefined;
    const cancelled = await services.api.commitExport({
      workspaceId,
      format: 'bureau',
      scope: { kind: 'workspace' },
    });
    expect(cancelled).toMatchObject({ ok: true, written: false });
    expect(await fs.readdir(exportDir)).toEqual([]);
  });

  it('round-trips a workspace through the native format on disk', async () => {
    const { services } = boot;
    const created = await services.api.createWorkspace({ name: 'Payments' });
    const workspaceId = created.summary.workspaceId;

    const inspected = await services.api.inspectImport({ workspaceId, format: 'auto', text: POSTMAN });
    if (!inspected.ok) return;
    await services.api.commitImport({
      workspaceId,
      previewId: inspected.preview.previewId,
      parentId: null,
      conflictStrategy: 'rename',
      acknowledgeScripts: true,
    });

    savePath = path.join(exportDir, 'payments.bureau-api.json');
    const exported = await services.api.commitExport({
      workspaceId,
      format: 'bureau',
      scope: { kind: 'workspace' },
    });
    expect(exported).toMatchObject({ ok: true, written: true });

    const written = await fs.readFile(savePath, 'utf8');
    expect(JSON.parse(written)).toMatchObject({ format: 'bureau-api', secretPolicy: 'omitted' });

    // Re-import the exported file through the picker path into a second workspace.
    const second = await services.api.createWorkspace({ name: 'Restored' });
    openPath = savePath;
    const reimported = await services.api.inspectImport({
      workspaceId: second.summary.workspaceId,
      format: 'auto',
      fromFile: true,
    });
    expect(reimported.ok).toBe(true);
    if (!reimported.ok) return;
    expect(reimported.preview.sourceLabel).toBe('payments.bureau-api.json');
    // Two imported requests plus the default request every new workspace is seeded with.
    expect(reimported.preview.counts.requests).toBe(3);

    const restored = await services.api.commitImport({
      workspaceId: second.summary.workspaceId,
      previewId: reimported.preview.previewId,
      parentId: null,
      conflictStrategy: 'rename',
      acknowledgeScripts: true,
    });
    expect(restored.ok).toBe(true);

    const snapshot = await services.api.getWorkspace(second.summary.workspaceId);
    const restoredRequest = snapshot!.requests.find((r) => r.name === 'Create user')!;
    expect(restoredRequest.body).toEqual({ kind: 'json', text: '{"name":"ada"}' });
  });

  it('never executes an imported request', async () => {
    const { services } = boot;
    const created = await services.api.createWorkspace({ name: 'Quiet' });
    const workspaceId = created.summary.workspaceId;

    let sessionEvents = 0;
    services.api.onSessionEvent(() => {
      sessionEvents += 1;
    });

    const inspected = await services.api.inspectImport({ workspaceId, format: 'auto', text: POSTMAN });
    if (!inspected.ok) return;
    await services.api.commitImport({
      workspaceId,
      previewId: inspected.preview.previewId,
      parentId: null,
      conflictStrategy: 'rename',
      acknowledgeScripts: true,
    });

    // Import is entirely offline: no transport session is ever created.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sessionEvents).toBe(0);
  });

  it('rejects an import that targets a workspace that does not exist', async () => {
    const result = await boot.services.api.inspectImport({
      workspaceId: '99999999-9999-4999-8999-999999999999',
      format: 'auto',
      text: POSTMAN,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('API_WORKSPACE_NOT_FOUND');
  });
});
