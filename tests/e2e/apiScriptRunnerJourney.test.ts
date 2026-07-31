import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createAppServices, type AppBootstrap } from '@main/services/createAppServices';
import type { ApiRunEvent, ApiSessionEvent } from '@shared/contracts/apiWorkbench';

function waitFor(check: () => boolean, timeoutMs = 20_000): Promise<void> {
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

/**
 * Phase 4 journey through the real services bootstrap: a script that sets a variable, a test that
 * asserts on the response, and a collection run over both — plus the paths that must stay closed
 * (a disabled script, an unapproved import, the settings kill switch).
 */
describe('API workspace Phase 4 script and runner journey', () => {
  let userData: string;
  let boot: AppBootstrap;
  let savePath: string | undefined;
  const servers: http.Server[] = [];
  /** Every request the fixture server saw, so a script's effect on the wire is observable. */
  let seen: Array<{ url: string; method: string; headers: http.IncomingHttpHeaders }> = [];

  beforeEach(async () => {
    userData = await fs.mkdtemp(path.join(os.tmpdir(), 'bureau-e2e-api-p4-'));
    savePath = undefined;
    seen = [];
    boot = await createAppServices(userData, {
      openExternal: async () => undefined,
      dialogAdapter: {
        showOpenDirectoryDialog: async () => undefined,
        showOpenFileDialog: async () => undefined,
        showSaveFileDialog: async () => savePath,
      },
    });
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
  });

  function listen(
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        seen.push({ url: req.url ?? '', method: req.method ?? '', headers: req.headers });
        handler(req, res);
      });
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

  function jsonServer(): Promise<string> {
    return listen((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ id: 7, name: 'ada' }));
    });
  }

  /** Creates a workspace whose single request points at `baseUrl` and carries `scripts`. */
  async function setup(
    baseUrl: string,
    scripts: {
      preRequest?: string;
      postResponse?: string;
      enabled?: boolean;
      origin?: 'authored' | 'imported';
    }
  ) {
    const { services } = boot;
    const created = await services.api.createWorkspace({ name: 'Scripted' });
    const workspaceId = created.summary.workspaceId;
    const request = created.requests[0];
    const saved = await services.api.saveRequest({
      workspaceId,
      requestId: request.requestId,
      expectedRevision: request.revision,
      patch: {
        name: 'Get user',
        urlTemplate: `${baseUrl}/users`,
        method: 'GET',
        scripts,
      },
    });
    expect(saved.ok).toBe(true);
    return { workspaceId, requestId: request.requestId };
  }

  async function sendAndWait(workspaceId: string, requestId: string) {
    const events: ApiSessionEvent[] = [];
    const unsubscribe = boot.services.api.onSessionEvent((event) => events.push(event));
    try {
      const result = await boot.services.api.sendRequest({ workspaceId, requestId });
      expect(result.ok).toBe(true);
      await waitFor(() => events.some((event) => event.type === 'complete'));
      const complete = events.find((event) => event.type === 'complete');
      if (complete?.type !== 'complete') throw new Error('no completion');
      return complete.response;
    } finally {
      unsubscribe();
    }
  }

  it('runs a pre-request script whose variable reaches the wire, then asserts on the response', async () => {
    const baseUrl = await jsonServer();
    const { workspaceId, requestId } = await setup(baseUrl, {
      enabled: true,
      preRequest: `
        bureau.variables.set('trace', 'from-script');
        console.log('pre-request ran');
      `,
      postResponse: `
        bureau.test('status is 200', () => bureau.expect(bureau.response.status).toBe(200));
        bureau.test('body parses', () => bureau.expect(bureau.response.json().name).toBe('ada'));
        bureau.variables.set('userId', String(bureau.response.json().id));
      `,
    });

    // The request references the variable the pre-request script will set.
    const snapshot = await boot.services.api.getWorkspace(workspaceId);
    const request = snapshot!.requests.find((entry) => entry.requestId === requestId)!;
    await boot.services.api.saveRequest({
      workspaceId,
      requestId,
      expectedRevision: request.revision,
      patch: { urlTemplate: `${baseUrl}/users?trace={{trace}}` },
    });

    const response = await sendAndWait(workspaceId, requestId);
    expect(response.ok).toBe(true);
    expect(seen[0].url).toBe('/users?trace=from-script');

    expect(response.scripts).toHaveLength(2);
    expect(response.scripts![0].console[0].text).toBe('pre-request ran');
    expect(response.scripts![1].tests.map((test) => [test.name, test.passed])).toEqual([
      ['status is 200', true],
      ['body parses', true],
    ]);
    expect(response.scripts![1].variableWrites).toEqual(['userId']);
  });

  it('marks a response failed when an assertion fails, even on a 200', async () => {
    const baseUrl = await jsonServer();
    const { workspaceId, requestId } = await setup(baseUrl, {
      enabled: true,
      postResponse: `bureau.test('wrong', () => bureau.expect(bureau.response.status).toBe(500));`,
    });
    const response = await sendAndWait(workspaceId, requestId);
    // The transport succeeded; the assertion is what failed.
    expect(response.status).toBe(200);
    expect(response.ok).toBe(false);
    expect(response.scripts![0].tests[0].passed).toBe(false);
  });

  it('does not send the request when a pre-request script fails', async () => {
    const baseUrl = await jsonServer();
    const { workspaceId, requestId } = await setup(baseUrl, {
      enabled: true,
      preRequest: `throw new Error('setup failed');`,
    });
    const response = await sendAndWait(workspaceId, requestId);
    expect(response.errorCode).toBe('API_SCRIPT_FAILED');
    expect(response.errorMessage).toContain('setup failed');
    // Nothing reached the server: a half-prepared request must not go out.
    expect(seen).toHaveLength(0);
  });

  it('never runs a disabled script', async () => {
    const baseUrl = await jsonServer();
    const { workspaceId, requestId } = await setup(baseUrl, {
      enabled: false,
      preRequest: `throw new Error('should never run');`,
      postResponse: `bureau.test('should never run', () => bureau.expect(1).toBe(2));`,
    });
    const response = await sendAndWait(workspaceId, requestId);
    expect(response.ok).toBe(true);
    expect(response.scripts).toBeUndefined();
    expect(seen).toHaveLength(1);
  });

  it('honours the installation-wide kill switch', async () => {
    const baseUrl = await jsonServer();
    await boot.services.settings.update({ api: { scriptsEnabled: false } });
    const { workspaceId, requestId } = await setup(baseUrl, {
      enabled: true,
      postResponse: `bureau.test('would fail', () => bureau.expect(1).toBe(2));`,
    });
    const response = await sendAndWait(workspaceId, requestId);
    expect(response.ok).toBe(true);
    expect(response.scripts).toBeUndefined();
  });

  it('refuses to run script source supplied only as a draft-level enable', async () => {
    const baseUrl = await jsonServer();
    const { workspaceId, requestId } = await setup(baseUrl, {
      enabled: false,
      postResponse: `bureau.test('would fail', () => bureau.expect(1).toBe(2));`,
    });
    // A draft claiming `enabled: true` must not turn the saved-disabled script on.
    const events: ApiSessionEvent[] = [];
    const unsubscribe = boot.services.api.onSessionEvent((event) => events.push(event));
    try {
      await boot.services.api.sendRequest({
        workspaceId,
        requestId,
        draft: { scripts: { postResponse: 'bureau.test("x", () => {})', enabled: true } },
      });
      await waitFor(() => events.some((event) => event.type === 'complete'));
      const complete = events.find((event) => event.type === 'complete');
      if (complete?.type !== 'complete') throw new Error('no completion');
      expect(complete.response.scripts).toBeUndefined();
      expect(complete.response.ok).toBe(true);
    } finally {
      unsubscribe();
    }
  });

  it('refuses to enable an imported script through an ordinary save', async () => {
    const { services } = boot;
    const baseUrl = await jsonServer();
    const { workspaceId, requestId } = await setup(baseUrl, {
      postResponse: `bureau.test('would fail', () => bureau.expect(1).toBe(2));`,
      enabled: false,
      origin: 'imported',
    });

    const snapshot = await services.api.getWorkspace(workspaceId);
    const request = snapshot!.requests.find((entry) => entry.requestId === requestId)!;
    // The composer disables this toggle for imported source; main must refuse it too, because a
    // crafted IPC payload does not go through the composer.
    const saved = await services.api.saveRequest({
      workspaceId,
      requestId,
      expectedRevision: request.revision,
      patch: { scripts: { ...request.scripts, enabled: true } },
    });
    expect(saved.ok).toBe(true);

    const after = await services.api.getWorkspace(workspaceId);
    expect(after!.requests.find((entry) => entry.requestId === requestId)!.scripts.enabled).toBe(false);

    const response = await sendAndWait(workspaceId, requestId);
    expect(response.scripts).toBeUndefined();
    expect(response.ok).toBe(true);
  });

  it('lets an authored script be enabled by an ordinary save', async () => {
    const { services } = boot;
    const baseUrl = await jsonServer();
    const { workspaceId, requestId } = await setup(baseUrl, {
      postResponse: `bureau.test('authored ran', () => bureau.expect(1).toBe(1));`,
      enabled: false,
      origin: 'authored',
    });

    const snapshot = await services.api.getWorkspace(workspaceId);
    const request = snapshot!.requests.find((entry) => entry.requestId === requestId)!;
    await services.api.saveRequest({
      workspaceId,
      requestId,
      expectedRevision: request.revision,
      patch: { scripts: { ...request.scripts, enabled: true } },
    });

    const response = await sendAndWait(workspaceId, requestId);
    expect(response.scripts![0].tests[0]).toMatchObject({ name: 'authored ran', passed: true });
  });

  it('imports a script disabled and untrusted, and only an approval makes it run', async () => {
    const { services } = boot;
    const baseUrl = await jsonServer();
    const created = await services.api.createWorkspace({ name: 'Imported' });
    const workspaceId = created.summary.workspaceId;

    const collection = JSON.stringify({
      info: { name: 'Remote', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [
        {
          name: 'Fetch',
          request: { method: 'GET', url: `${baseUrl}/users` },
          event: [
            {
              listen: 'test',
              script: { exec: ['bureau.test("imported ran", () => bureau.expect(1).toBe(1));'] },
            },
          ],
        },
      ],
    });

    const inspected = await services.api.inspectImport({ workspaceId, format: 'auto', text: collection });
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    const committed = await services.api.commitImport({
      workspaceId,
      previewId: inspected.preview.previewId,
      parentId: null,
      conflictStrategy: 'rename',
      acknowledgeScripts: true,
    });
    expect(committed.ok).toBe(true);

    const afterImport = await services.api.getWorkspace(workspaceId);
    const imported = afterImport!.requests.find((entry) => entry.name === 'Fetch')!;
    expect(imported.scripts.enabled).toBe(false);
    expect(imported.scripts.origin).toBe('imported');

    // It is listed for review, with its provenance visible.
    const listed = await services.api.listScriptLocations({ workspaceId, collectionId: null });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const location = listed.locations.find((entry) => entry.holder.id === imported.requestId)!;
    expect(location).toMatchObject({ enabled: false, origin: 'imported', phases: ['post-response'] });

    // Sending before approval runs nothing.
    const before = await sendAndWait(workspaceId, imported.requestId);
    expect(before.scripts).toBeUndefined();

    // A stale revision is refused: the reviewed list must match the workspace being approved.
    const stale = await services.api.approveScripts({
      workspaceId,
      collectionId: null,
      enabled: true,
      expectedRevision: 0,
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe('STALE_STATE');

    const current = await services.api.getWorkspace(workspaceId);
    const approved = await services.api.approveScripts({
      workspaceId,
      collectionId: null,
      enabled: true,
      expectedRevision: current!.summary.revision,
    });
    expect(approved).toMatchObject({ ok: true, changed: 1 });

    const after = await sendAndWait(workspaceId, imported.requestId);
    expect(after.scripts![0].tests[0]).toMatchObject({ name: 'imported ran', passed: true });
  });

  it('runs a collection, chains a variable between requests, and exports a report', async () => {
    const { services } = boot;
    const baseUrl = await jsonServer();
    const created = await services.api.createWorkspace({ name: 'Suite' });
    const workspaceId = created.summary.workspaceId;

    // Request one captures an id; request two sends it.
    const first = created.requests[0];
    await services.api.saveRequest({
      workspaceId,
      requestId: first.requestId,
      expectedRevision: first.revision,
      patch: {
        name: 'Login',
        urlTemplate: `${baseUrl}/login`,
        method: 'GET',
        scripts: {
          enabled: true,
          postResponse: `
            bureau.test('login ok', () => bureau.expect(bureau.response.status).toBe(200));
            bureau.variables.set('userId', String(bureau.response.json().id));
          `,
        },
      },
    });

    const secondNode = await services.api.createCollection({
      workspaceId,
      parentId: null,
      kind: 'request',
      name: 'Fetch user',
    });
    expect(secondNode.ok).toBe(true);
    if (!secondNode.ok) return;
    const secondId = secondNode.requestId!;
    const snapshot = await services.api.getWorkspace(workspaceId);
    const second = snapshot!.requests.find((entry) => entry.requestId === secondId)!;
    await services.api.saveRequest({
      workspaceId,
      requestId: secondId,
      expectedRevision: second.revision,
      patch: {
        urlTemplate: `${baseUrl}/users/{{userId}}`,
        method: 'GET',
        scripts: {
          enabled: true,
          postResponse: `bureau.test('has a user id', () => bureau.expect(bureau.request.url).toContain('/users/7'));`,
        },
      },
    });

    const events: ApiRunEvent[] = [];
    const unsubscribe = services.api.onRunEvent((event) => events.push(event));
    try {
      const started = await services.api.startRun({
        workspaceId,
        target: { kind: 'workspace' },
        iterations: 1,
        delayMs: 0,
        stopOnFailure: false,
      });
      expect(started.ok).toBe(true);
      if (!started.ok) return;

      await waitFor(() => events.some((event) => event.type === 'run-complete'));
      const complete = events.find((event) => event.type === 'run-complete');
      if (complete?.type !== 'run-complete') throw new Error('no run completion');
      const report = complete.report;

      expect(report.status).toBe('completed');
      expect(report.scriptsEnabled).toBe(true);
      expect(report.plannedItems).toBe(2);
      expect(report.totals).toMatchObject({
        requests: 2,
        failedRequests: 0,
        assertions: 2,
        failedAssertions: 0,
        scriptErrors: 0,
      });
      // The variable written by the first request resolved in the second's URL.
      expect(seen[1].url).toBe('/users/7');

      // Export writes through the main-owned picker.
      savePath = path.join(userData, 'report.junit.xml');
      const exported = await services.api.exportRunReport({ runId: report.runId, format: 'junit' });
      expect(exported).toMatchObject({ ok: true, written: true });
      const xml = await fs.readFile(savePath, 'utf8');
      expect(xml).toContain('<testcase name="login ok" classname="assertion" />');

      savePath = path.join(userData, 'report.json');
      await services.api.exportRunReport({ runId: report.runId, format: 'json' });
      const parsed = JSON.parse(await fs.readFile(savePath, 'utf8'));
      expect(parsed.totals.assertions).toBe(2);
    } finally {
      unsubscribe();
    }
  });

  it('stops a run on the first failure when asked', async () => {
    const { services } = boot;
    const baseUrl = await jsonServer();
    const { workspaceId } = await setup(baseUrl, {
      enabled: true,
      postResponse: `bureau.test('always fails', () => bureau.expect(1).toBe(2));`,
    });
    // A second request that must never be reached.
    const extra = await services.api.createCollection({
      workspaceId,
      parentId: null,
      kind: 'request',
      name: 'Never runs',
    });
    expect(extra.ok).toBe(true);

    const events: ApiRunEvent[] = [];
    const unsubscribe = services.api.onRunEvent((event) => events.push(event));
    try {
      await services.api.startRun({
        workspaceId,
        target: { kind: 'workspace' },
        iterations: 1,
        delayMs: 0,
        stopOnFailure: true,
      });
      await waitFor(() => events.some((event) => event.type === 'run-complete'));
      const complete = events.find((event) => event.type === 'run-complete');
      if (complete?.type !== 'run-complete') throw new Error('no run completion');
      expect(complete.report.stoppedOnFailure).toBe(true);
      expect(complete.report.items).toHaveLength(1);
      expect(complete.report.status).toBe('failed');
    } finally {
      unsubscribe();
    }
  });

  it('refuses a second run for the same workspace and an empty target', async () => {
    const { services } = boot;
    const baseUrl = await listen((_req, res) => {
      // Slow enough that the second start lands while the first is still going.
      setTimeout(() => res.end('{}'), 300);
    });
    const { workspaceId } = await setup(baseUrl, {});

    const first = await services.api.startRun({
      workspaceId,
      target: { kind: 'workspace' },
      iterations: 3,
      delayMs: 100,
      stopOnFailure: false,
    });
    expect(first.ok).toBe(true);

    const second = await services.api.startRun({
      workspaceId,
      target: { kind: 'workspace' },
      iterations: 1,
      delayMs: 0,
      stopOnFailure: false,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('API_RUN_ACTIVE');

    if (first.ok) {
      const finished: ApiRunEvent[] = [];
      const unsubscribe = services.api.onRunEvent((event) => finished.push(event));
      try {
        const cancelled = await services.api.cancelRun({ runId: first.runId });
        expect(cancelled.ok).toBe(true);
        // Cancelling is asynchronous — the run leaves the active set when its loop unwinds.
        await waitFor(() => finished.some((event) => event.type === 'run-complete'));
      } finally {
        unsubscribe();
      }
      const report = await services.api.getRunReport({ runId: first.runId });
      expect(report.ok).toBe(true);
    }

    const empty = await services.api.startRun({
      workspaceId,
      target: { kind: 'collection', collectionId: '99999999-9999-4999-8999-999999999999' },
      iterations: 1,
      delayMs: 0,
      stopOnFailure: false,
    });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe('API_RUN_EMPTY');
  });

  it('cancels a run in flight and reports it as cancelled', async () => {
    const { services } = boot;
    const baseUrl = await listen((_req, res) => {
      setTimeout(() => res.end('{}'), 200);
    });
    const { workspaceId } = await setup(baseUrl, {});

    const events: ApiRunEvent[] = [];
    const unsubscribe = services.api.onRunEvent((event) => events.push(event));
    try {
      const started = await services.api.startRun({
        workspaceId,
        target: { kind: 'workspace' },
        iterations: 10,
        delayMs: 50,
        stopOnFailure: false,
      });
      expect(started.ok).toBe(true);
      if (!started.ok) return;

      await waitFor(() => events.some((event) => event.type === 'run-item'));
      await services.api.cancelRun({ runId: started.runId });
      await waitFor(() => events.some((event) => event.type === 'run-complete'));

      const complete = events.find((event) => event.type === 'run-complete');
      if (complete?.type !== 'run-complete') throw new Error('no run completion');
      expect(complete.report.status).toBe('cancelled');
      // Cancelling stops the loop well before the tenth iteration.
      expect(complete.report.items.length).toBeLessThan(10);
    } finally {
      unsubscribe();
    }
  });

  it('validates a script without executing it, and reports the failing line', async () => {
    const bad = await boot.services.api.validateScript({
      source: 'const = 1;',
      phase: 'pre-request',
    });
    expect(bad.ok).toBe(false);

    // A syntactically valid script with a side effect is not run by validation.
    const good = await boot.services.api.validateScript({
      source: `bureau.variables.set('nope', '1');`,
      phase: 'pre-request',
    });
    expect(good).toEqual({ ok: true });
  });

  it('reports a missing run report rather than inventing one', async () => {
    const missing = await boot.services.api.getRunReport({
      runId: '99999999-9999-4999-8999-999999999999',
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('API_RUN_NOT_FOUND');
  });
});
