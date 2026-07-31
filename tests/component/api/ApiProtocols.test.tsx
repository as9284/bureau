import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiWorkspace } from '@renderer/features/api/ApiWorkspace';
import { useApiStore } from '@renderer/store/apiStore';
import { useAppStore } from '@renderer/store/appStore';
import type {
  ApiProtocol,
  ApiSessionEvent,
  ApiWorkspaceSnapshot,
} from '@shared/contracts/apiWorkbench';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const COLLECTION_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const OAUTH_ID = '55555555-5555-4555-8555-555555555555';
const TLS_ID = '66666666-6666-4666-8666-666666666666';

const NOW = '2026-07-29T12:00:00.000Z';

function makeSnapshot(protocol: ApiProtocol, extra?: Partial<ApiWorkspaceSnapshot>): ApiWorkspaceSnapshot {
  return {
    summary: {
      workspaceId: WORKSPACE_ID,
      name: 'My workspace',
      createdAt: NOW,
      updatedAt: NOW,
      revision: 1,
    },
    variables: [],
    auth: { kind: 'none' },
    collections: [
      {
        collectionId: COLLECTION_ID,
        workspaceId: WORKSPACE_ID,
        parentId: null,
        kind: 'request',
        name: 'Live feed',
        order: 0,
        requestId: REQUEST_ID,
        variables: [],
        revision: 1,
      },
    ],
    requests: [
      {
        requestId: REQUEST_ID,
        workspaceId: WORKSPACE_ID,
        collectionId: COLLECTION_ID,
        name: 'Live feed',
        protocol,
        urlTemplate: protocol === 'websocket' ? 'wss://example.com/socket' : 'https://example.com/x',
        method: 'GET',
        query: [],
        headers: [],
        auth: { kind: 'none' },
        body: { kind: 'none' },
        protocolOptions:
          protocol === 'websocket'
            ? { websocket: { subprotocols: [] } }
            : protocol === 'sse'
              ? { sse: { reconnect: false } }
              : protocol === 'graphql'
                ? { graphql: { query: 'query { viewer { id } }', variables: '{}', transport: 'POST' } }
                : {},
        scripts: {},
        settings: { followRedirects: true },
        variables: [],
        revision: 1,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    environments: [],
    tlsProfiles: [],
    proxyProfiles: [],
    oauthProfiles: [],
    oauthTokens: [],
    ...extra,
  };
}

function createMockApi(snapshot: ApiWorkspaceSnapshot, overrides: Record<string, unknown> = {}) {
  let sessionListener: ((event: ApiSessionEvent) => void) | null = null;

  const api = {
    getStatus: vi.fn().mockResolvedValue({ ready: true, secretStorageAvailable: true }),
    listWorkspaces: vi.fn().mockResolvedValue({ workspaces: [snapshot.summary] }),
    getWorkspace: vi.fn().mockResolvedValue({ ok: true, snapshot }),
    createWorkspace: vi.fn().mockResolvedValue({ ok: true, workspaceId: WORKSPACE_ID }),
    updateWorkspace: vi.fn().mockResolvedValue({ ok: true, revision: 2 }),
    deleteWorkspace: vi.fn().mockResolvedValue({ ok: true }),
    createCollection: vi.fn().mockResolvedValue({ ok: true, collectionId: COLLECTION_ID }),
    updateCollection: vi.fn().mockResolvedValue({ ok: true, revision: 2 }),
    deleteCollection: vi.fn().mockResolvedValue({ ok: true }),
    saveRequest: vi.fn().mockResolvedValue({ ok: true, revision: 2 }),
    deleteRequest: vi.fn().mockResolvedValue({ ok: true }),
    createEnvironment: vi.fn().mockResolvedValue({ ok: true, environmentId: 'env-1' }),
    updateEnvironment: vi.fn().mockResolvedValue({ ok: true, revision: 2 }),
    deleteEnvironment: vi.fn().mockResolvedValue({ ok: true }),
    listSecrets: vi.fn().mockResolvedValue({ secrets: [] }),
    saveSecret: vi.fn().mockResolvedValue({ ok: true, secretId: 'secret-1' }),
    deleteSecret: vi.fn().mockResolvedValue({ ok: true }),
    listHistory: vi.fn().mockResolvedValue({ items: [] }),
    getHistoryEntry: vi.fn().mockResolvedValue({ ok: true, entry: {} }),
    sendRequest: vi.fn().mockResolvedValue({ ok: true, sessionId: SESSION_ID }),
    cancelRequest: vi.fn().mockResolvedValue({ ok: true }),
    openStream: vi.fn().mockResolvedValue({ ok: true, sessionId: SESSION_ID }),
    sendStreamMessage: vi.fn().mockResolvedValue({ ok: true }),
    closeStream: vi.fn().mockResolvedValue({ ok: true }),
    setStreamPaused: vi.fn().mockResolvedValue({ ok: true }),
    getStreamSnapshot: vi.fn().mockResolvedValue({ ok: true, entries: [], dropped: 0, status: 'open' }),
    introspectGraphql: vi.fn().mockResolvedValue({
      ok: true,
      schema: { endpoint: '', fetchedAt: NOW, types: [{ name: 'Query', kind: 'OBJECT', fields: [] }] },
    }),
    saveTlsProfile: vi.fn().mockResolvedValue({ ok: true, profileId: TLS_ID }),
    deleteTlsProfile: vi.fn().mockResolvedValue({ ok: true }),
    saveOAuthProfile: vi.fn().mockResolvedValue({ ok: true, profileId: OAUTH_ID }),
    deleteOAuthProfile: vi.fn().mockResolvedValue({ ok: true }),
    authorizeOAuth: vi.fn().mockResolvedValue({ ok: true }),
    cancelOAuth: vi.fn().mockResolvedValue({ ok: true }),
    clearOAuthToken: vi.fn().mockResolvedValue({ ok: true }),
    onSessionEvent: vi.fn((listener: (event: ApiSessionEvent) => void) => {
      sessionListener = listener;
      return () => {
        sessionListener = null;
      };
    }),
    onOAuthEvent: vi.fn(() => () => undefined),
    setDirtyDraftCount: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  return { api, emit: (event: ApiSessionEvent) => sessionListener?.(event) };
}

function install(snapshot: ApiWorkspaceSnapshot, overrides: Record<string, unknown> = {}) {
  const mock = createMockApi(snapshot, overrides);
  Object.defineProperty(window, 'bureau', { configurable: true, value: { api: mock.api } });
  return mock;
}

async function openRequest() {
  await waitFor(() => {
    expect(screen.getByRole('tree', { name: 'API collections' })).toBeInTheDocument();
  });
  const tree = screen.getByRole('tree', { name: 'API collections' });
  await userEvent.setup().click(within(tree).getByRole('treeitem', { name: /Live feed/i }));
}

beforeEach(() => {
  useAppStore.setState({
    projects: [],
    settings: {
      layout: { paneWidths: { files: 340, commit: 280, filesExplorer: 280, apiSidebar: 280 } },
    } as ReturnType<typeof useAppStore.getState>['settings'],
  });
  useApiStore.getState().reset();
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'bureau');
  vi.restoreAllMocks();
});

describe('WebSocket composer', () => {
  it('connects, shows the transcript, and sends a message', async () => {
    const { api, emit } = install(makeSnapshot('websocket'));
    render(<ApiWorkspace />);
    await openRequest();

    const user = userEvent.setup();
    // A stream request offers Connect, never Send.
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Connect' })[0]);

    await waitFor(() => expect(api.openStream).toHaveBeenCalled());

    emit({
      type: 'stream-open',
      sessionId: SESSION_ID,
      workspaceId: WORKSPACE_ID,
      requestId: REQUEST_ID,
      seq: 1,
      protocol: 'websocket',
      status: 'open',
      url: 'wss://example.com/socket',
      subprotocol: 'bureau.v1',
    });

    await waitFor(() => expect(screen.getByText('Connected')).toBeInTheDocument());
    expect(screen.getByText(/subprotocol: bureau\.v1/)).toBeInTheDocument();

    emit({
      type: 'stream-entries',
      sessionId: SESSION_ID,
      workspaceId: WORKSPACE_ID,
      requestId: REQUEST_ID,
      seq: 2,
      dropped: 0,
      entries: [
        {
          entryId: 'e1',
          seq: 1,
          at: NOW,
          direction: 'in',
          kind: 'message',
          text: 'hello from server',
          byteLength: 17,
        },
      ],
    });

    await waitFor(() => expect(screen.getByText('hello from server')).toBeInTheDocument());

    const messageField = screen.getByLabelText('Message');
    await user.type(messageField, 'ping');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() =>
      expect(api.sendStreamMessage).toHaveBeenCalledWith({
        sessionId: SESSION_ID,
        format: 'text',
        payload: 'ping',
      })
    );
  });

  it('pauses display without disconnecting and reports dropped events', async () => {
    const { api, emit } = install(makeSnapshot('websocket'));
    render(<ApiWorkspace />);
    await openRequest();

    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: 'Connect' })[0]);
    emit({
      type: 'stream-open',
      sessionId: SESSION_ID,
      workspaceId: WORKSPACE_ID,
      requestId: REQUEST_ID,
      seq: 1,
      protocol: 'websocket',
      status: 'open',
      url: 'wss://example.com/socket',
    });
    await waitFor(() => expect(screen.getByText('Connected')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Pause display' }));
    await waitFor(() =>
      expect(api.setStreamPaused).toHaveBeenCalledWith({ sessionId: SESSION_ID, paused: true })
    );
    expect(screen.getByText(/Display paused/)).toBeInTheDocument();
    // Still connected: the socket keeps reading.
    expect(screen.getByText('Connected')).toBeInTheDocument();

    emit({
      type: 'stream-entries',
      sessionId: SESSION_ID,
      workspaceId: WORKSPACE_ID,
      requestId: REQUEST_ID,
      seq: 2,
      dropped: 12,
      entries: [],
    });
    await waitFor(() => expect(screen.getByText('12 dropped')).toBeInTheDocument());
  });

  it('shows a close code and reason when the socket closes', async () => {
    const { emit } = install(makeSnapshot('websocket'));
    render(<ApiWorkspace />);
    await openRequest();
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Connect' })[0]);

    emit({
      type: 'stream-status',
      sessionId: SESSION_ID,
      workspaceId: WORKSPACE_ID,
      requestId: REQUEST_ID,
      seq: 1,
      status: 'closed',
      code: 1011,
      reason: 'server error',
    });

    await waitFor(() => expect(screen.getByText('Disconnected')).toBeInTheDocument());
    expect(screen.getByText(/close 1011 · server error/)).toBeInTheDocument();
  });
});

describe('SSE composer', () => {
  it('renders parsed events and offers no message composer', async () => {
    const { emit } = install(makeSnapshot('sse'));
    render(<ApiWorkspace />);
    await openRequest();

    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Connect' })[0]);
    emit({
      type: 'stream-open',
      sessionId: SESSION_ID,
      workspaceId: WORKSPACE_ID,
      requestId: REQUEST_ID,
      seq: 1,
      protocol: 'sse',
      status: 'open',
      url: 'https://example.com/events',
    });
    emit({
      type: 'stream-entries',
      sessionId: SESSION_ID,
      workspaceId: WORKSPACE_ID,
      requestId: REQUEST_ID,
      seq: 2,
      dropped: 0,
      entries: [
        {
          entryId: 'e1',
          seq: 1,
          at: NOW,
          direction: 'in',
          kind: 'sse-event',
          eventName: 'tick',
          eventId: '1',
          text: '{"n":1}',
        },
      ],
    });

    await waitFor(() => expect(screen.getByText('{"n":1}')).toBeInTheDocument());
    expect(screen.getByText('tick')).toBeInTheDocument();
    // SSE is receive-only.
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();
  });

  it('caps the transcript so a flood cannot grow renderer memory without bound', async () => {
    const { emit } = install(makeSnapshot('sse'));
    render(<ApiWorkspace />);
    await openRequest();
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Connect' })[0]);

    emit({
      type: 'stream-open',
      sessionId: SESSION_ID,
      workspaceId: WORKSPACE_ID,
      requestId: REQUEST_ID,
      seq: 1,
      protocol: 'sse',
      status: 'open',
      url: 'https://example.com/events',
    });

    // Deliver more than the renderer cap across several batches.
    for (let batch = 0; batch < 3; batch += 1) {
      emit({
        type: 'stream-entries',
        sessionId: SESSION_ID,
        workspaceId: WORKSPACE_ID,
        requestId: REQUEST_ID,
        seq: 2 + batch,
        dropped: 0,
        entries: Array.from({ length: 2000 }, (_unused, index) => ({
          entryId: `b${batch}-${index}`,
          seq: batch * 2000 + index,
          at: NOW,
          direction: 'in' as const,
          kind: 'sse-event' as const,
          text: `${batch}-${index}`,
        })),
      });
    }

    await waitFor(() => {
      const session = Object.values(useApiStore.getState().sessions)[0];
      expect(session.entries!.length).toBe(5000);
      // The newest entries are the ones retained.
      expect(session.entries!.at(-1)!.entryId).toBe('b2-1999');
    });
  });
});

describe('GraphQL composer', () => {
  it('exposes a Query tab instead of Body and validates variables JSON', async () => {
    install(makeSnapshot('graphql'));
    render(<ApiWorkspace />);
    await openRequest();

    const user = userEvent.setup();
    expect(screen.queryByRole('tab', { name: /^Body/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /^Query/ }));

    const variables = screen.getByLabelText('Variables (JSON)');
    await user.clear(variables);
    await user.type(variables, '{{not json');

    await waitFor(() =>
      expect(screen.getByText('Variables are not valid JSON.')).toBeInTheDocument()
    );
  });

  it('introspects only when the user asks', async () => {
    const { api } = install(makeSnapshot('graphql'));
    render(<ApiWorkspace />);
    await openRequest();

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /^Query/ }));
    // Simply opening the tab must not hit the network.
    expect(api.introspectGraphql).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Introspect schema' }));
    await waitFor(() => expect(api.introspectGraphql).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('1 types cached')).toBeInTheDocument());
  });
});

describe('TLS profile dialog', () => {
  it('requires an explicit acknowledgement before saving a weakened profile', async () => {
    const { api } = install(makeSnapshot('http'));
    render(<ApiWorkspace />);
    await openRequest();

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /^Settings/ }));
    await user.click(screen.getByRole('button', { name: 'New TLS profile' }));

    const dialog = await screen.findByRole('dialog', { name: 'New TLS profile' });
    const hosts = within(dialog).getByLabelText('Allow invalid certificates for these hosts');
    await user.type(hosts, 'internal.example.com');

    // The danger banner names the host and blocks Save until acknowledged.
    expect(
      within(dialog).getByText('This profile disables certificate verification')
    ).toBeInTheDocument();
    const save = within(dialog).getByRole('button', { name: 'Save profile' });
    expect(save).toBeDisabled();

    await user.click(within(dialog).getByLabelText(/I understand the risk for 1 host/));
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() =>
      expect(api.saveTlsProfile).toHaveBeenCalledWith(
        expect.objectContaining({ allowInvalidCertificateHosts: ['internal.example.com'] })
      )
    );
  });

  it('rejects a wildcard host', async () => {
    install(makeSnapshot('http'));
    render(<ApiWorkspace />);
    await openRequest();

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /^Settings/ }));
    await user.click(screen.getByRole('button', { name: 'New TLS profile' }));

    const dialog = await screen.findByRole('dialog', { name: 'New TLS profile' });
    await user.type(
      within(dialog).getByLabelText('Allow invalid certificates for these hosts'),
      '*.example.com'
    );

    expect(within(dialog).getByText(/Not exact hosts: \*\.example\.com/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save profile' })).toBeDisabled();
  });

  it('warns in the composer when the selected profile weakens verification', async () => {
    const snapshot = makeSnapshot('http', {
      tlsProfiles: [
        {
          profileId: TLS_ID,
          workspaceId: WORKSPACE_ID,
          name: 'Internal',
          allowInvalidCertificateHosts: ['internal.example.com'],
          enabled: true,
          revision: 1,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    });
    snapshot.requests[0].protocolOptions = { tlsProfileId: TLS_ID };
    install(snapshot);

    render(<ApiWorkspace />);
    await openRequest();
    await userEvent.setup().click(screen.getByRole('tab', { name: /^Settings/ }));

    expect(screen.getByText('Certificate verification is disabled')).toBeInTheDocument();
    expect(screen.getByText('internal.example.com')).toBeInTheDocument();
  });
});

describe('OAuth 2 auth', () => {
  it('reports that no token is stored and opens the profile dialog', async () => {
    const snapshot = makeSnapshot('http', {
      oauthProfiles: [
        {
          profileId: OAUTH_ID,
          workspaceId: WORKSPACE_ID,
          name: 'Provider',
          grant: 'authorization_code',
          authorizationUrl: 'https://provider.example/authorize',
          tokenUrl: 'https://provider.example/token',
          clientId: 'client-1',
          revision: 1,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      oauthTokens: [{ profileId: OAUTH_ID, hasAccessToken: false, hasRefreshToken: false }],
    });
    snapshot.requests[0].auth = { kind: 'oauth2', profileId: OAUTH_ID };
    const { api } = install(snapshot);

    render(<ApiWorkspace />);
    await openRequest();

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /^Auth/ }));
    expect(screen.getByText(/No access token yet/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Manage profile' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit OAuth 2 profile' });

    // The redirect URI is shown so it can be registered with the provider.
    expect(within(dialog).getByText(/127\.0\.0\.1:<port>\/bureau\/oauth\/callback/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Authorize' }));
    await waitFor(() =>
      expect(api.authorizeOAuth).toHaveBeenCalledWith({
        workspaceId: WORKSPACE_ID,
        profileId: OAUTH_ID,
      })
    );
  });

  it('never renders token material, only its status', async () => {
    const snapshot = makeSnapshot('http', {
      oauthProfiles: [
        {
          profileId: OAUTH_ID,
          workspaceId: WORKSPACE_ID,
          name: 'Provider',
          grant: 'client_credentials',
          tokenUrl: 'https://provider.example/token',
          clientId: 'client-1',
          revision: 1,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      oauthTokens: [
        {
          profileId: OAUTH_ID,
          hasAccessToken: true,
          hasRefreshToken: true,
          expiresAt: '2026-07-29T13:00:00.000Z',
        },
      ],
    });
    snapshot.requests[0].auth = { kind: 'oauth2', profileId: OAUTH_ID };
    install(snapshot);

    render(<ApiWorkspace />);
    await openRequest();
    await userEvent.setup().click(screen.getByRole('tab', { name: /^Auth/ }));

    expect(screen.getByText(/Access token stored/)).toBeInTheDocument();
    expect(screen.getByText(/expires 2026-07-29 13:00:00/)).toBeInTheDocument();
  });
});

describe('Secrets pane', () => {
  it('saves a secret and clears the field without ever revealing it', async () => {
    const { api } = install(makeSnapshot('http'));
    render(<ApiWorkspace />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Secrets/ })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    // The rail selects the section; the editor itself opens as a main-area tab.
    await user.click(screen.getByRole('button', { name: /Secrets/ }));
    await user.click(screen.getByRole('button', { name: 'Add a secret' }));

    await user.type(screen.getByLabelText('Label'), 'Staging key');
    const valueField = screen.getByLabelText('Value');
    await user.type(valueField, 'super-secret');
    // Values are masked; there is no reveal control.
    expect(valueField).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'Add secret' }));

    await waitFor(() =>
      expect(api.saveSecret).toHaveBeenCalledWith({
        label: 'Staging key',
        value: 'super-secret',
        persist: true,
      })
    );
    // The plaintext is dropped from local state as soon as it is handed to main.
    await waitFor(() => expect(screen.getByLabelText('Value')).toHaveValue(''));
  });

  it('warns and forces session-only storage when encryption is unavailable', async () => {
    install(makeSnapshot('http'), {
      getStatus: vi.fn().mockResolvedValue({ ready: true, secretStorageAvailable: false }),
    });
    render(<ApiWorkspace />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Secrets/ })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Secrets/ }));
    await user.click(screen.getByRole('button', { name: 'Add a secret' }));
    expect(screen.getByText('Encrypted storage unavailable')).toBeInTheDocument();
    expect(screen.getByLabelText('Save encrypted to disk')).toBeDisabled();
  });
});

describe('Protocol switching', () => {
  it('seeds protocol options and swaps the editor tabs', async () => {
    install(makeSnapshot('http'));
    render(<ApiWorkspace />);
    await openRequest();

    const user = userEvent.setup();
    expect(screen.getByRole('tab', { name: /^Body/ })).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'Protocol' }));
    await user.click(await screen.findByRole('option', { name: 'SSE' }));

    await waitFor(() => {
      // A stream request has no body, and Connect replaces Send.
      expect(screen.queryByRole('tab', { name: /^Body/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    });

    const draft = useApiStore.getState().documents[REQUEST_ID].draft;
    expect(draft.protocol).toBe('sse');
    expect(draft.protocolOptions.sse).toEqual({ reconnect: false });
  });
});

describe('Stale session events', () => {
  it('ignores an out-of-order progress event after completion', async () => {
    const { emit } = install(makeSnapshot('http'));
    render(<ApiWorkspace />);
    await openRequest();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Send' }));

    emit({
      type: 'complete',
      sessionId: SESSION_ID,
      workspaceId: WORKSPACE_ID,
      requestId: REQUEST_ID,
      seq: 5,
      response: {
        sessionId: SESSION_ID,
        workspaceId: WORKSPACE_ID,
        requestId: REQUEST_ID,
        ok: true,
        status: 200,
        statusText: 'OK',
        url: 'https://example.com/x',
        method: 'GET',
        headers: [],
        timings: { totalMs: 10 },
        redirects: [],
        wireBytes: 2,
        decodedBytes: 2,
        truncated: false,
        bodyText: '{}',
        bodyIsBinary: false,
      },
    });

    await waitFor(() => expect(screen.getByText(/200\s+OK/)).toBeInTheDocument());

    // A progress event that lost the race must not flip the pane back to "Sending".
    emit({
      type: 'progress',
      sessionId: SESSION_ID,
      workspaceId: WORKSPACE_ID,
      requestId: REQUEST_ID,
      seq: 3,
      phase: 'download',
    });

    expect(screen.getByText(/200\s+OK/)).toBeInTheDocument();
    expect(screen.queryByText(/Sending request/)).not.toBeInTheDocument();
    expect(useApiStore.getState().sessions[SESSION_ID].lastSeq).toBe(5);
  });
});
