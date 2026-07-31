import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createAppServices, type AppBootstrap } from '@main/services/createAppServices';
import type { ApiSessionEvent } from '@shared/contracts/apiWorkbench';

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
 * Phase 5 journey: a request through a real proxy, the cookie inspector over a real Set-Cookie, and
 * a backup that restores into a fresh Bureau.
 */
describe('API workspace Phase 5 network journey', () => {
  let userData: string;
  let boot: AppBootstrap;
  let savePath: string | undefined;
  let openPath: string | undefined;
  const servers: Array<http.Server | net.Server> = [];
  const liveSockets = new Set<net.Socket>();

  beforeEach(async () => {
    userData = await fs.mkdtemp(path.join(os.tmpdir(), 'bureau-e2e-api-p5-'));
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
    for (const socket of liveSockets) socket.destroy();
    liveSockets.clear();
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            if ('closeAllConnections' in server) server.closeAllConnections();
            server.close(() => resolve());
          })
      )
    );
    servers.length = 0;
    await fs.rm(userData, { recursive: true, force: true });
  });

  function listen(server: http.Server | net.Server): Promise<number> {
    servers.push(server);
    server.on('connection', (socket: net.Socket) => {
      liveSockets.add(socket);
      socket.on('close', () => liveSockets.delete(socket));
    });
    return new Promise((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('could not bind'));
          return;
        }
        resolve(address.port);
      });
    });
  }

  async function setupWorkspace(url: string) {
    const created = await boot.services.api.createWorkspace({ name: 'Networked' });
    const workspaceId = created.summary.workspaceId;
    const request = created.requests[0];
    await boot.services.api.saveRequest({
      workspaceId,
      requestId: request.requestId,
      expectedRevision: request.revision,
      patch: { name: 'Fetch', urlTemplate: url, method: 'GET' },
    });
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

  it('routes a request through a configured proxy and reports which one carried it', async () => {
    const originPort = await listen(
      http.createServer((_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end('{"ok":true}');
      })
    );
    const seenByProxy: string[] = [];
    const proxyPort = await listen(
      http.createServer((req, res) => {
        seenByProxy.push(req.url ?? '');
        const target = new URL(req.url ?? '');
        const upstream = http.request(
          {
            host: target.hostname,
            port: target.port,
            path: target.pathname,
            method: req.method,
            headers: { ...req.headers, host: target.host },
          },
          (upstreamResponse) => {
            res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
            upstreamResponse.pipe(res);
          }
        );
        upstream.on('error', () => {
          res.statusCode = 502;
          res.end();
        });
        req.pipe(upstream);
      })
    );

    const { workspaceId, requestId } = await setupWorkspace(`http://127.0.0.1:${originPort}/thing`);

    // With no profile the request goes direct.
    const direct = await sendAndWait(workspaceId, requestId);
    expect(direct.status).toBe(200);
    expect(direct.proxyUsed).toBeUndefined();
    expect(seenByProxy).toEqual([]);

    const saved = await boot.services.api.saveProxyProfile({
      workspaceId,
      name: 'Local proxy',
      mode: 'http',
      host: '127.0.0.1',
      port: proxyPort,
      bypass: [],
      enabled: true,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const snapshot = await boot.services.api.getWorkspace(workspaceId);
    await boot.services.api.updateWorkspace({
      workspaceId,
      expectedRevision: snapshot!.summary.revision,
      defaultProxyProfileId: saved.profileId,
    });

    const proxied = await sendAndWait(workspaceId, requestId);
    expect(proxied.status).toBe(200);
    expect(proxied.proxyUsed).toBe(`127.0.0.1:${proxyPort}`);
    expect(seenByProxy).toEqual([`http://127.0.0.1:${originPort}/thing`]);
  });

  it('honours the bypass list and a disabled profile', async () => {
    const originPort = await listen(
      http.createServer((_req, res) => res.end('{"ok":true}'))
    );
    const seenByProxy: string[] = [];
    const proxyPort = await listen(
      http.createServer((req, res) => {
        seenByProxy.push(req.url ?? '');
        res.statusCode = 502;
        res.end();
      })
    );

    const { workspaceId, requestId } = await setupWorkspace(`http://127.0.0.1:${originPort}/x`);
    const saved = await boot.services.api.saveProxyProfile({
      workspaceId,
      name: 'Bypassed',
      mode: 'http',
      host: '127.0.0.1',
      port: proxyPort,
      // The origin is on the bypass list, so it must go direct despite the profile.
      bypass: ['127.0.0.1'],
      enabled: true,
    });
    if (!saved.ok) return;
    const snapshot = await boot.services.api.getWorkspace(workspaceId);
    await boot.services.api.updateWorkspace({
      workspaceId,
      expectedRevision: snapshot!.summary.revision,
      defaultProxyProfileId: saved.profileId,
    });

    const bypassed = await sendAndWait(workspaceId, requestId);
    expect(bypassed.status).toBe(200);
    expect(bypassed.proxyUsed).toBeUndefined();
    expect(seenByProxy).toEqual([]);

    // A disabled profile is kept but never applied.
    const current = await boot.services.api.getWorkspace(workspaceId);
    const profile = current!.proxyProfiles[0];
    await boot.services.api.saveProxyProfile({
      workspaceId,
      profileId: profile.profileId,
      expectedRevision: profile.revision,
      name: profile.name,
      mode: 'http',
      host: '127.0.0.1',
      port: proxyPort,
      bypass: [],
      enabled: false,
    });
    const disabled = await sendAndWait(workspaceId, requestId);
    expect(disabled.proxyUsed).toBeUndefined();
    expect(seenByProxy).toEqual([]);
  });

  it('records cookies from a response and exposes them to the inspector', async () => {
    const originPort = await listen(
      http.createServer((req, res) => {
        if (req.url === '/login') {
          res.setHeader('Set-Cookie', ['session=abc123; Path=/', 'tracking=1; Path=/; SameSite=Strict']);
          res.end('{"ok":true}');
          return;
        }
        // Echo what the client sent, so cookie replay is observable.
        res.end(JSON.stringify({ cookie: req.headers.cookie ?? null }));
      })
    );

    const { workspaceId, requestId } = await setupWorkspace(`http://127.0.0.1:${originPort}/login`);
    await sendAndWait(workspaceId, requestId);

    const cookies = boot.services.api.listCookies({ workspaceId });
    expect(cookies.map((cookie) => [cookie.name, cookie.sameSite, cookie.hostOnly])).toEqual([
      ['session', 'lax', true],
      ['tracking', 'strict', true],
    ]);
    expect(boot.services.api.listCookieJars(workspaceId)).toEqual([
      { jarId: '', name: 'Default', cookieCount: 2 },
    ]);

    // The next request replays them.
    const snapshot = await boot.services.api.getWorkspace(workspaceId);
    const request = snapshot!.requests[0];
    await boot.services.api.saveRequest({
      workspaceId,
      requestId,
      expectedRevision: request.revision,
      patch: { urlTemplate: `http://127.0.0.1:${originPort}/echo` },
    });
    const echoed = await sendAndWait(workspaceId, requestId);
    expect(JSON.parse(echoed.bodyText!).cookie).toContain('session=abc123');

    // Deleting one leaves the other.
    expect(
      boot.services.api.deleteCookie({ workspaceId, name: 'tracking', domain: '127.0.0.1', path: '/' })
    ).toEqual({ ok: true });
    expect(boot.services.api.listCookies({ workspaceId }).map((c) => c.name)).toEqual(['session']);

    boot.services.api.clearCookies({ workspaceId });
    expect(boot.services.api.listCookies({ workspaceId })).toEqual([]);
  });

  it('keeps a named jar separate from the default', async () => {
    const originPort = await listen(
      http.createServer((_req, res) => {
        res.setHeader('Set-Cookie', 'who=named; Path=/');
        res.end('{}');
      })
    );
    const { workspaceId, requestId } = await setupWorkspace(`http://127.0.0.1:${originPort}/`);

    const snapshot = await boot.services.api.getWorkspace(workspaceId);
    await boot.services.api.updateWorkspace({
      workspaceId,
      expectedRevision: snapshot!.summary.revision,
      activeCookieJarId: 'second-identity',
    });
    await sendAndWait(workspaceId, requestId);

    expect(boot.services.api.listCookies({ workspaceId, jarId: 'second-identity' })).toHaveLength(1);
    // The default jar never saw it.
    expect(boot.services.api.listCookies({ workspaceId })).toEqual([]);
  });

  it('backs up every workspace and restores it into a fresh Bureau', async () => {
    const first = await boot.services.api.createWorkspace({ name: 'Alpha' });
    const second = await boot.services.api.createWorkspace({ name: 'Beta' });
    const request = first.requests[0];
    await boot.services.api.saveRequest({
      workspaceId: first.summary.workspaceId,
      requestId: request.requestId,
      expectedRevision: request.revision,
      patch: { name: 'Backed up', urlTemplate: 'https://api.test/backed-up' },
    });

    savePath = path.join(userData, 'backup.json');
    const written = await boot.services.api.backupWorkspaces();
    expect(written).toMatchObject({ ok: true, written: true });

    const document = JSON.parse(await fs.readFile(savePath, 'utf8'));
    expect(document).toMatchObject({ format: 'bureau-api-backup', secretPolicy: 'omitted' });
    expect(document.workspaces).toHaveLength(2);

    // Restore into a second, empty Bureau.
    const otherData = await fs.mkdtemp(path.join(os.tmpdir(), 'bureau-e2e-api-p5-restore-'));
    let restoreOpenPath: string | undefined = savePath;
    const restored = await createAppServices(otherData, {
      openExternal: async () => undefined,
      dialogAdapter: {
        showOpenDirectoryDialog: async () => undefined,
        showOpenFileDialog: async () => restoreOpenPath,
        showSaveFileDialog: async () => undefined,
      },
    });
    try {
      await expect(restored.services.api.listWorkspaces()).resolves.toEqual({ workspaces: [] });

      const planned = await restored.services.api.planRestore();
      expect(planned.ok).toBe(true);
      if (!planned.ok || !planned.plan) return;
      expect(planned.plan.sourceLabel).toBe('backup.json');
      expect(planned.plan.workspaces.map((entry) => entry.name).sort()).toEqual(['Alpha', 'Beta']);
      expect(planned.plan.workspaces.every((entry) => entry.conflict)).toBe(false);
      // Planning writes nothing.
      await expect(restored.services.api.listWorkspaces()).resolves.toEqual({ workspaces: [] });

      const committed = await restored.services.api.commitRestore({
        restoreId: planned.plan.restoreId,
        mode: 'merge',
      });
      expect(committed).toMatchObject({ ok: true, report: { restored: 2, replaced: 0, skipped: 0 } });

      const index = await restored.services.api.listWorkspaces();
      expect(index.workspaces.map((entry) => entry.name).sort()).toEqual(['Alpha', 'Beta']);
      const alpha = await restored.services.api.getWorkspace(first.summary.workspaceId);
      expect(alpha!.requests[0].urlTemplate).toBe('https://api.test/backed-up');

      // A committed plan cannot be replayed.
      const replay = await restored.services.api.commitRestore({
        restoreId: planned.plan.restoreId,
        mode: 'replace',
      });
      expect(replay.ok).toBe(false);

      // Restoring the same backup again: merge keeps what is there, replace overwrites it.
      restoreOpenPath = savePath;
      const second2 = await restored.services.api.planRestore();
      if (!second2.ok || !second2.plan) return;
      expect(second2.plan.workspaces.every((entry) => entry.conflict)).toBe(true);
      const merged = await restored.services.api.commitRestore({
        restoreId: second2.plan.restoreId,
        mode: 'merge',
      });
      expect(merged).toMatchObject({ ok: true, report: { restored: 0, replaced: 0, skipped: 2 } });
    } finally {
      restored.services.api.dispose();
      await restored.supervisor.stopAll();
      await fs.rm(otherData, { recursive: true, force: true });
    }
    expect(second.summary.name).toBe('Beta');
  });

  it('refuses a file that is not a Bureau backup', async () => {
    const bogus = path.join(userData, 'not-a-backup.json');
    await fs.writeFile(bogus, JSON.stringify({ hello: 'world' }), 'utf8');
    openPath = bogus;
    const planned = await boot.services.api.planRestore();
    expect(planned.ok).toBe(false);
    if (!planned.ok) expect(planned.error.code).toBe('API_IMPORT_INVALID');
  });

  it('treats a cancelled backup picker as a no-op', async () => {
    savePath = undefined;
    await expect(boot.services.api.backupWorkspaces()).resolves.toMatchObject({
      ok: true,
      written: false,
    });
    openPath = undefined;
    await expect(boot.services.api.planRestore()).resolves.toMatchObject({ ok: true, plan: null });
  });
});
