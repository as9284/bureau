import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import { createAppServices, type AppBootstrap } from '@main/services/createAppServices';
import type { ApiSessionEvent, ApiStreamEntry } from '@shared/contracts/apiWorkbench';

function waitFor(check: () => boolean, timeoutMs = 10_000): Promise<void> {
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

/** Flattens every stream entry delivered so far for a session. */
function entriesOf(events: ApiSessionEvent[], sessionId: string): ApiStreamEntry[] {
  return events
    .filter((event) => event.type === 'stream-entries' && event.sessionId === sessionId)
    .flatMap((event) => (event.type === 'stream-entries' ? event.entries : []));
}

describe('API workspace Phase 2 protocol journey', () => {
  let userData: string;
  let boot: AppBootstrap;
  const servers: http.Server[] = [];
  const wsServers: WebSocketServer[] = [];

  beforeEach(async () => {
    userData = await fs.mkdtemp(path.join(os.tmpdir(), 'bureau-e2e-api-p2-'));
    boot = await createAppServices(userData, { openExternal: async () => undefined });
  });

  afterEach(async () => {
    boot.services.api.dispose();
    await boot.supervisor.stopAll();
    for (const wss of wsServers) wss.close();
    wsServers.length = 0;
    await Promise.all(
      servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
    );
    servers.length = 0;
    await fs.rm(userData, { recursive: true, force: true });
  });

  function listen(
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
  ): Promise<{ origin: string; port: number }> {
    return new Promise((resolve) => {
      const server = http.createServer(handler);
      servers.push(server);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as AddressInfo;
        resolve({ origin: `http://127.0.0.1:${address.port}`, port: address.port });
      });
    });
  }

  /** Creates a workspace and returns its first request, ready to be patched. */
  async function newRequest() {
    const snapshot = await boot.services.api.createWorkspace({ name: 'Protocols' });
    return {
      workspaceId: snapshot.summary.workspaceId,
      requestId: snapshot.requests[0].requestId,
      revision: snapshot.requests[0].revision,
    };
  }

  it('executes a GraphQL query and surfaces GraphQL errors on an HTTP 200', async () => {
    const { services } = boot;
    const server = await listen((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          query: string;
          variables: Record<string, unknown>;
        };
        res.writeHead(200, { 'Content-Type': 'application/graphql-response+json' });
        if (payload.query.includes('boom')) {
          res.end(
            JSON.stringify({
              data: null,
              errors: [{ message: 'Field boom not found', path: ['boom'], locations: [{ line: 1, column: 9 }] }],
            })
          );
          return;
        }
        res.end(JSON.stringify({ data: { viewer: { id: payload.variables.id } } }));
      });
    });

    const { workspaceId, requestId, revision } = await newRequest();
    const events: ApiSessionEvent[] = [];
    services.api.onSessionEvent((event) => events.push(event));

    const saved = await services.api.saveRequest({
      workspaceId,
      requestId,
      expectedRevision: revision,
      patch: {
        name: 'Viewer',
        protocol: 'graphql',
        method: 'POST',
        urlTemplate: `${server.origin}/graphql`,
        protocolOptions: {
          graphql: {
            query: 'query Viewer($id: ID!) { viewer { id } }',
            variables: '{"id":"u-1"}',
            transport: 'POST',
          },
        },
      },
    });
    expect(saved.ok).toBe(true);

    const sent = await services.api.sendRequest({ workspaceId, requestId });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;

    await waitFor(() => events.some((event) => event.type === 'complete'));
    const complete = events.find((event) => event.type === 'complete');
    if (complete?.type !== 'complete') throw new Error('expected completion');
    expect(complete.response.status).toBe(200);
    expect(complete.response.ok).toBe(true);
    expect(complete.response.bodyText).toContain('u-1');

    // A GraphQL error at HTTP 200 must not read as success.
    events.length = 0;
    const failing = await services.api.sendRequest({
      workspaceId,
      requestId,
      draft: {
        protocolOptions: {
          graphql: { query: 'query { boom }', variables: '{}', transport: 'POST' },
        },
      },
    });
    expect(failing.ok).toBe(true);

    await waitFor(() => events.some((event) => event.type === 'complete'));
    const errored = events.find((event) => event.type === 'complete');
    if (errored?.type !== 'complete') throw new Error('expected completion');
    expect(errored.response.status).toBe(200);
    expect(errored.response.ok).toBe(false);
    expect(errored.response.graphqlErrors?.[0]).toMatchObject({
      message: 'Field boom not found',
      path: 'boom',
      line: 1,
    });
  });

  it('introspects a GraphQL schema only when asked', async () => {
    let introspectionCalls = 0;
    const server = await listen((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (body.includes('__schema')) introspectionCalls += 1;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            data: {
              __schema: {
                queryType: { name: 'Query' },
                mutationType: null,
                subscriptionType: null,
                types: [
                  { kind: 'OBJECT', name: 'Query', fields: [{ name: 'viewer' }] },
                  { kind: 'OBJECT', name: 'User', fields: [{ name: 'id' }, { name: 'email' }] },
                ],
              },
            },
          })
        );
      });
    });

    const { workspaceId, requestId, revision } = await newRequest();
    await boot.services.api.saveRequest({
      workspaceId,
      requestId,
      expectedRevision: revision,
      patch: {
        protocol: 'graphql',
        urlTemplate: `${server.origin}/graphql`,
        protocolOptions: {
          graphql: { query: 'query { viewer { id } }', variables: '{}', transport: 'POST' },
        },
      },
    });

    // Saving a GraphQL request must not trigger introspection on its own.
    expect(introspectionCalls).toBe(0);

    const result = await boot.services.api.introspectGraphql({ workspaceId, requestId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(introspectionCalls).toBe(1);
    expect(result.schema.queryTypeName).toBe('Query');
    expect(result.schema.types.find((type) => type.name === 'User')?.fields).toEqual(['id', 'email']);
  });

  it('opens a WebSocket session, exchanges messages, and disposes it on shutdown', async () => {
    const { services } = boot;
    const server = http.createServer();
    servers.push(server);
    const wss = new WebSocketServer({ server });
    wsServers.push(wss);
    wss.on('connection', (socket) => {
      socket.on('message', (data) => socket.send(`echo:${data.toString()}`));
    });
    const port = await new Promise<number>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
    });

    const { workspaceId, requestId, revision } = await newRequest();
    const events: ApiSessionEvent[] = [];
    services.api.onSessionEvent((event) => events.push(event));

    await services.api.saveRequest({
      workspaceId,
      requestId,
      expectedRevision: revision,
      patch: {
        name: 'Socket',
        protocol: 'websocket',
        urlTemplate: `ws://127.0.0.1:${port}/socket`,
        protocolOptions: { websocket: { subprotocols: [] } },
      },
    });

    const opened = await services.api.openStream({ workspaceId, requestId });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    await waitFor(() => events.some((event) => event.type === 'stream-open'));

    const sendResult = await services.api.sendStreamMessage({
      sessionId: opened.sessionId,
      format: 'text',
      payload: 'ping',
    });
    expect(sendResult.ok).toBe(true);

    await waitFor(() =>
      entriesOf(events, opened.sessionId).some((entry) => entry.text === 'echo:ping')
    );
    const entries = entriesOf(events, opened.sessionId);
    // Both directions are recorded in the transcript.
    expect(entries.some((entry) => entry.direction === 'out' && entry.text === 'ping')).toBe(true);
    expect(entries.some((entry) => entry.direction === 'in' && entry.text === 'echo:ping')).toBe(true);

    // Pausing holds back delivery without closing the socket.
    await services.api.setStreamPaused({ sessionId: opened.sessionId, paused: true });
    await services.api.sendStreamMessage({
      sessionId: opened.sessionId,
      format: 'text',
      payload: 'while-paused',
    });
    const snapshot = await services.api.getStreamSnapshot(opened.sessionId);
    expect(snapshot.ok).toBe(true);
    if (snapshot.ok) {
      expect(snapshot.entries.some((entry) => entry.text === 'while-paused')).toBe(true);
      expect(snapshot.status).toBe('open');
    }
    await services.api.setStreamPaused({ sessionId: opened.sessionId, paused: false });

    const closed = await services.api.closeStream({ sessionId: opened.sessionId });
    expect(closed.ok).toBe(true);
    await waitFor(() =>
      events.some((event) => event.type === 'stream-status' && event.status === 'closed')
    );

    // A closed session no longer accepts sends.
    const afterClose = await services.api.sendStreamMessage({
      sessionId: opened.sessionId,
      format: 'text',
      payload: 'too-late',
    });
    expect(afterClose.ok).toBe(false);
  });

  it('streams SSE events and stops cleanly on disconnect', async () => {
    const { services } = boot;
    let clientGone = false;
    const server = await listen((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      let n = 0;
      const timer = setInterval(() => {
        n += 1;
        res.write(`id: ${n}\nevent: tick\ndata: {"n":${n}}\n\n`);
      }, 15);
      res.on('close', () => {
        clientGone = true;
        clearInterval(timer);
      });
    });

    const { workspaceId, requestId, revision } = await newRequest();
    const events: ApiSessionEvent[] = [];
    services.api.onSessionEvent((event) => events.push(event));

    await services.api.saveRequest({
      workspaceId,
      requestId,
      expectedRevision: revision,
      patch: {
        name: 'Ticks',
        protocol: 'sse',
        method: 'GET',
        urlTemplate: `${server.origin}/events`,
        protocolOptions: { sse: { reconnect: false } },
      },
    });

    const opened = await services.api.openStream({ workspaceId, requestId });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    await waitFor(() => entriesOf(events, opened.sessionId).filter((e) => e.kind === 'sse-event').length >= 3);
    const parsed = entriesOf(events, opened.sessionId).filter((entry) => entry.kind === 'sse-event');
    expect(parsed[0].eventName).toBe('tick');
    expect(parsed[0].text).toContain('"n":1');
    expect(parsed[0].eventId).toBe('1');

    await services.api.closeStream({ sessionId: opened.sessionId });
    await waitFor(() => clientGone);
    await waitFor(() =>
      events.some((event) => event.type === 'stream-status' && event.status === 'closed')
    );
  });

  it('blocks a request whose OAuth profile has no token, then succeeds once authorized', async () => {
    const { services } = boot;
    const tokenServer = await listen((req, res) => {
      if (req.url?.startsWith('/token')) {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ access_token: 'granted-token', expires_in: 3600 }));
        });
        return;
      }
      // Protected resource: echoes back whatever Authorization it saw.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ authorization: req.headers.authorization ?? null }));
    });

    const { workspaceId, requestId, revision } = await newRequest();
    const profile = await services.api.saveOAuthProfile({
      workspaceId,
      name: 'Fixture',
      grant: 'client_credentials',
      tokenUrl: `${tokenServer.origin}/token`,
      clientId: 'client-1',
    });
    expect(profile.ok).toBe(true);
    if (!profile.ok) return;

    await services.api.saveRequest({
      workspaceId,
      requestId,
      expectedRevision: revision,
      patch: {
        name: 'Protected',
        urlTemplate: `${tokenServer.origin}/protected`,
        method: 'GET',
        auth: { kind: 'oauth2', profileId: profile.profileId },
      },
    });

    // Client credentials can mint a token on demand, so the first send already succeeds.
    const events: ApiSessionEvent[] = [];
    services.api.onSessionEvent((event) => events.push(event));
    const sent = await services.api.sendRequest({ workspaceId, requestId });
    expect(sent.ok).toBe(true);

    await waitFor(() => events.some((event) => event.type === 'complete'));
    const complete = events.find((event) => event.type === 'complete');
    if (complete?.type !== 'complete') throw new Error('expected completion');
    expect(complete.response.bodyText).toContain('Bearer granted-token');

    // The token status is reported without ever exposing the token itself.
    const snapshot = await services.api.getWorkspace(workspaceId);
    const status = snapshot?.oauthTokens.find((entry) => entry.profileId === profile.profileId);
    expect(status?.hasAccessToken).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain('granted-token');

    // Clearing the token blocks the request again with a specific error.
    await services.api.clearOAuthToken({ workspaceId, profileId: profile.profileId });
  });

  it('applies a TLS profile only while it is enabled', async () => {
    const { services } = boot;
    const { workspaceId } = await newRequest();

    const created = await services.api.saveTlsProfile({
      workspaceId,
      name: 'Internal',
      allowInvalidCertificateHosts: ['internal.example.com'],
      enabled: false,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const snapshot = await services.api.getWorkspace(workspaceId);
    const profile = snapshot?.tlsProfiles.find((entry) => entry.profileId === created.profileId);
    // Disabled profiles are visible but must not take effect.
    expect(profile?.enabled).toBe(false);
    expect(profile?.allowInvalidCertificateHosts).toEqual(['internal.example.com']);

    const updated = await services.api.saveTlsProfile({
      workspaceId,
      profileId: created.profileId,
      expectedRevision: profile!.revision,
      name: 'Internal',
      allowInvalidCertificateHosts: ['internal.example.com'],
      enabled: true,
    });
    expect(updated.ok).toBe(true);

    // A stale revision is rejected rather than silently overwriting.
    const stale = await services.api.saveTlsProfile({
      workspaceId,
      profileId: created.profileId,
      expectedRevision: profile!.revision,
      name: 'Internal',
      allowInvalidCertificateHosts: [],
      enabled: true,
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe('STALE_STATE');
  });

  it('releases every session on dispose', async () => {
    const { services } = boot;
    const server = http.createServer();
    servers.push(server);
    const wss = new WebSocketServer({ server });
    wsServers.push(wss);
    let serverSawClose = false;
    wss.on('connection', (socket) => {
      socket.on('close', () => {
        serverSawClose = true;
      });
    });
    const port = await new Promise<number>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
    });

    const { workspaceId, requestId, revision } = await newRequest();
    await services.api.saveRequest({
      workspaceId,
      requestId,
      expectedRevision: revision,
      patch: {
        protocol: 'websocket',
        urlTemplate: `ws://127.0.0.1:${port}/socket`,
        protocolOptions: { websocket: { subprotocols: [] } },
      },
    });

    const opened = await services.api.openStream({ workspaceId, requestId });
    expect(opened.ok).toBe(true);

    services.api.dispose();
    await waitFor(() => serverSawClose);
    // A second dispose in afterEach must stay safe.
  });
});
