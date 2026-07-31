import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createAppServices, type AppBootstrap } from '@main/services/createAppServices';
import { API_SIDEBAR_DEFAULT_WIDTH } from '@shared/contracts/settings';
import type { ApiSessionEvent } from '@shared/contracts/apiWorkbench';

function waitFor(
  check: () => boolean,
  timeoutMs = 10_000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const timer = setInterval(() => {
      if (check()) {
        clearInterval(timer);
        resolve();
      } else if (performance.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error('waitFor timed out'));
      }
    }, 25);
  });
}

describe('API workspace Phase 1 journey', () => {
  let userData: string;
  let projectDir: string;
  let boot: AppBootstrap;
  const servers: http.Server[] = [];

  beforeEach(async () => {
    userData = await fs.mkdtemp(path.join(os.tmpdir(), 'bureau-e2e-api-'));
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bureau-e2e-api-proj-'));
    await fs.writeFile(
      path.join(projectDir, 'package.json'),
      JSON.stringify({ name: 'api-linked', scripts: { dev: 'echo hi' } })
    );
    boot = await createAppServices(userData);
  });

  afterEach(async () => {
    boot.services.api.dispose();
    await boot.supervisor.stopAll();
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          })
      )
    );
    servers.length = 0;
    await fs.rm(userData, { recursive: true, force: true });
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  function listen(
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = http.createServer(handler);
      servers.push(server);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Could not bind test server'));
          return;
        }
        resolve(`http://127.0.0.1:${address.port}`);
      });
    });
  }

  it('boots with API settings defaults and an empty workspace index', async () => {
    const { services } = boot;
    const settings = await services.settings.get();
    expect(settings.api.requestTimeoutMs).toBe(30_000);
    expect(settings.api.importedScriptsDefaultEnabled).toBe(false);
    expect(settings.layout.paneWidths.apiSidebar).toBe(API_SIDEBAR_DEFAULT_WIDTH);

    await expect(services.api.getStatus()).resolves.toMatchObject({ ready: true });
    await expect(services.api.listWorkspaces()).resolves.toEqual({ workspaces: [] });
    await expect(services.projects.list()).resolves.toEqual([]);
  });

  it('persists API settings patches without enabling imported scripts by default', async () => {
    const updated = await boot.services.settings.update({
      api: { requestTimeoutMs: 60_000, lineWrap: true },
    });
    expect(updated.api.requestTimeoutMs).toBe(60_000);
    expect(updated.api.lineWrap).toBe(true);
    expect(updated.api.importedScriptsDefaultEnabled).toBe(false);

    const reloaded = await createAppServices(userData);
    try {
      const settings = await reloaded.services.settings.get();
      expect(settings.api.requestTimeoutMs).toBe(60_000);
      expect(settings.api.lineWrap).toBe(true);
    } finally {
      reloaded.services.api.dispose();
      await reloaded.supervisor.stopAll();
    }
  });

  it('creates, sends, records history, cancels, and survives project unlink', async () => {
    const { services } = boot;
    const baseUrl = await listen((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ hello: 'bureau' }));
    });

    const events: ApiSessionEvent[] = [];
    const unsubscribe = services.api.onSessionEvent((event) => {
      events.push(event);
    });

    const snapshot = await services.api.createWorkspace({ name: 'Payments' });
    const workspaceId = snapshot.summary.workspaceId;
    const request = snapshot.requests[0];
    expect(request).toBeTruthy();

    const saved = await services.api.saveRequest({
      workspaceId,
      requestId: request.requestId,
      expectedRevision: request.revision,
      patch: {
        name: 'Health',
        urlTemplate: `${baseUrl}/health`,
        method: 'GET',
      },
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const sent = await services.api.sendRequest({
      workspaceId,
      requestId: request.requestId,
    });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;

    await waitFor(() => events.some((event) => event.type === 'complete'));
    const complete = events.find((event) => event.type === 'complete');
    expect(complete?.type).toBe('complete');
    if (complete?.type === 'complete') {
      expect(complete.response.status).toBe(200);
      expect(complete.response.bodyText).toContain('bureau');
    }

    const history = services.api.listHistory(workspaceId);
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0]?.url).toContain('/health');

    const hangUrl = await listen((_req, res) => {
      // Leave the connection open until cancelled.
      void res;
    });
    const hangSave = await services.api.saveRequest({
      workspaceId,
      requestId: request.requestId,
      expectedRevision: saved.snapshot.requests[0]!.revision,
      patch: { urlTemplate: `${hangUrl}/hang` },
    });
    expect(hangSave.ok).toBe(true);
    if (!hangSave.ok) return;

    const hangEvents: ApiSessionEvent[] = [];
    const hangUnsub = services.api.onSessionEvent((event) => hangEvents.push(event));
    const hangSend = await services.api.sendRequest({
      workspaceId,
      requestId: request.requestId,
    });
    expect(hangSend.ok).toBe(true);
    if (!hangSend.ok) return;

    await waitFor(() => hangEvents.some((event) => event.type === 'progress'));
    const cancelled = await services.api.cancelRequest({ sessionId: hangSend.sessionId });
    expect(cancelled.ok).toBe(true);
    await waitFor(() => hangEvents.some((event) => event.type === 'complete'));
    const cancelledComplete = hangEvents.find((event) => event.type === 'complete');
    expect(cancelledComplete?.type).toBe('complete');
    if (cancelledComplete?.type === 'complete') {
      expect(cancelledComplete.response.errorMessage).toMatch(/cancel/i);
    }
    hangUnsub();

    // Session-only secret never touches disk plaintext.
    const secret = await services.api.saveSecret({
      label: 'token',
      value: 'super-secret-value',
      persist: false,
    });
    expect(secret.ok).toBe(true);
    const secretsDir = path.join(userData, 'api');
    const disk = await fs.readdir(secretsDir, { recursive: true });
    for (const entry of disk) {
      const full = path.join(secretsDir, String(entry));
      const stat = await fs.stat(full);
      if (!stat.isFile()) continue;
      const text = await fs.readFile(full, 'utf8');
      expect(text).not.toContain('super-secret-value');
    }

    // Linked project deletion unlinks but keeps the workspace.
    const added = await services.projects.add({ path: projectDir });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const linked = await services.api.updateWorkspace({
      workspaceId,
      expectedRevision: hangSave.snapshot.summary.revision,
      linkedProjectId: added.project.projectId,
    });
    expect(linked.ok).toBe(true);

    await services.projects.remove({ projectId: added.project.projectId });
    const afterRemove = await services.api.getWorkspace(workspaceId);
    expect(afterRemove).toBeTruthy();
    expect(afterRemove?.summary.linkedProjectId).toBeUndefined();
    expect((await services.api.listWorkspaces()).workspaces).toHaveLength(1);

    services.api.setDirtyDraftCount(2);
    expect(services.api.dirtyDraftCount()).toBe(2);
    services.api.setDirtyDraftCount(0);

    unsubscribe();
  });
});
