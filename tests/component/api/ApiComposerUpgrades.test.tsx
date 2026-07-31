import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiWorkspace } from '@renderer/features/api/ApiWorkspace';
import { useApiStore } from '@renderer/store/apiStore';
import { useAppStore } from '@renderer/store/appStore';
import type { ApiWorkspaceSnapshot } from '@shared/contracts/apiWorkbench';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const COLLECTION_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const ENVIRONMENT_ID = '77777777-7777-4777-8777-777777777777';
const NOW = '2026-07-31T12:00:00.000Z';

/** A request whose URL depends on a variable, so resolution has something to report. */
function makeSnapshot(overrides: Partial<ApiWorkspaceSnapshot> = {}): ApiWorkspaceSnapshot {
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
        name: 'List users',
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
        name: 'List users',
        protocol: 'http',
        urlTemplate: '{{baseUrl}}/v1/users',
        method: 'GET',
        query: [],
        headers: [
          { id: 'h1', name: 'Accept', value: 'application/json', enabled: true },
          { id: 'h2', name: 'X-Debug', value: '1', enabled: false },
        ],
        auth: { kind: 'none' },
        body: { kind: 'none' },
        protocolOptions: {},
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
    ...overrides,
  };
}

function withEnvironment(value: string): ApiWorkspaceSnapshot {
  return makeSnapshot({
    environments: [
      {
        environmentId: ENVIRONMENT_ID,
        workspaceId: WORKSPACE_ID,
        name: 'Staging',
        variables: [
          { variableId: 'v1', name: 'baseUrl', value, enabled: true, secret: false },
        ],
        revision: 1,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    summary: { ...makeSnapshot().summary, activeEnvironmentId: ENVIRONMENT_ID },
  });
}

function install(snapshot: ApiWorkspaceSnapshot, overrides: Record<string, unknown> = {}) {
  const api = {
    getStatus: vi.fn().mockResolvedValue({ ready: true, secretStorageAvailable: true }),
    listWorkspaces: vi.fn().mockResolvedValue({ workspaces: [snapshot.summary] }),
    getWorkspace: vi.fn().mockImplementation(async () => ({
      ok: true,
      snapshot: structuredClone(snapshot),
    })),
    updateWorkspace: vi.fn().mockResolvedValue({ ok: true, revision: 2 }),
    createCollection: vi.fn().mockResolvedValue({ ok: true, collectionId: COLLECTION_ID }),
    updateCollection: vi.fn().mockResolvedValue({ ok: true, revision: 2 }),
    deleteCollection: vi.fn().mockResolvedValue({ ok: true }),
    saveRequest: vi.fn().mockResolvedValue({ ok: true, revision: 2 }),
    createEnvironment: vi.fn().mockResolvedValue({ ok: true, environmentId: ENVIRONMENT_ID }),
    updateEnvironment: vi.fn().mockResolvedValue({ ok: true, revision: 2 }),
    deleteEnvironment: vi.fn().mockResolvedValue({ ok: true }),
    listSecrets: vi.fn().mockResolvedValue({ secrets: [] }),
    listHistory: vi.fn().mockResolvedValue({ items: [] }),
    sendRequest: vi.fn().mockResolvedValue({ ok: true, sessionId: SESSION_ID }),
    cancelRequest: vi.fn().mockResolvedValue({ ok: true }),
    onSessionEvent: vi.fn(() => () => undefined),
    onOAuthEvent: vi.fn(() => () => undefined),
    setDirtyDraftCount: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  Object.defineProperty(window, 'bureau', { configurable: true, value: { api } });
  return api;
}

async function openRequest() {
  const tree = await screen.findByRole('tree', { name: 'API collections' });
  await userEvent.setup().click(within(tree).getByRole('treeitem', { name: /List users/i }));
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

describe('Variable resolution in the composer', () => {
  it('names the unresolved variable instead of letting the request look sendable', async () => {
    install(makeSnapshot());
    render(<ApiWorkspace />);
    await openRequest();

    expect(await screen.findByText('Unresolved variable:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'baseUrl' })).toBeInTheDocument();
    expect(screen.queryByText('Sends')).not.toBeInTheDocument();
  });

  it('previews what the request will actually send once the variable resolves', async () => {
    install(withEnvironment('https://staging.example.com'));
    render(<ApiWorkspace />);
    await openRequest();

    expect(await screen.findByText('Sends')).toBeInTheDocument();
    expect(screen.getByTitle('https://staging.example.com/v1/users')).toBeInTheDocument();
  });

  it('sends an unresolved name to the active environment, seeded and ready to fill in', async () => {
    const api = install(withEnvironment('https://staging.example.com'));
    render(<ApiWorkspace />);
    await openRequest();

    // Retarget the URL at a variable the environment does not define.
    const url = await screen.findByLabelText('URL');
    const user = userEvent.setup();
    await user.clear(url);
    // `type` reads braces as key descriptors, so the template is pasted verbatim instead.
    await user.click(url);
    await user.paste('{{token}}');

    await user.click(await screen.findByRole('button', { name: 'token' }));

    await waitFor(() => {
      expect(api.updateEnvironment).toHaveBeenCalledWith(
        expect.objectContaining({
          environmentId: ENVIRONMENT_ID,
          variables: expect.arrayContaining([expect.objectContaining({ name: 'token' })]),
        })
      );
    });
    // The environment opens as its own tab rather than replacing the request.
    expect(await screen.findByRole('tab', { name: 'Staging' })).toBeInTheDocument();
  });
});

describe('Composer affordances', () => {
  it('reports what each editor tab holds without opening it', async () => {
    install(makeSnapshot());
    render(<ApiWorkspace />);
    await openRequest();

    // One of the two headers is disabled, so the badge counts what will be sent.
    expect(await screen.findByRole('tab', { name: 'Headers 1' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Params' })).toBeInTheDocument();
  });

  it('opens a request by name with Ctrl+P', async () => {
    install(makeSnapshot());
    render(<ApiWorkspace />);
    await screen.findByRole('tree', { name: 'API collections' });

    const user = userEvent.setup();
    await user.keyboard('{Control>}p{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Open request' });
    await user.type(within(dialog).getByRole('textbox'), 'users');
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('tab', { name: /List users/ })).toBeInTheDocument();
  });

  it('sends the open request with Ctrl+Enter', async () => {
    const api = install(withEnvironment('https://staging.example.com'));
    render(<ApiWorkspace />);
    await openRequest();

    await userEvent.setup().keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(api.sendRequest).toHaveBeenCalled());
  });

  it('gates closing a dirty tab behind a themed confirmation, not window.confirm', async () => {
    install(makeSnapshot());
    const confirmSpy = vi.spyOn(window, 'confirm');
    render(<ApiWorkspace />);
    await openRequest();

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('URL'), '?page=2');
    await user.click(screen.getByRole('button', { name: /Close List users/ }));

    const dialog = await screen.findByRole('dialog', { name: 'Discard unsaved changes?' });
    expect(confirmSpy).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Discard and close' }));
    await waitFor(() => {
      expect(screen.queryByRole('tab', { name: /List users/ })).not.toBeInTheDocument();
    });
  });
});
