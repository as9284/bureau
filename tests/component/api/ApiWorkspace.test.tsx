import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiWorkspace } from '@renderer/features/api/ApiWorkspace';
import { ContextMenu } from '@renderer/components/ContextMenu';
import { useApiStore } from '@renderer/store/apiStore';
import { useAppStore } from '@renderer/store/appStore';
import type {
  ApiResponsePreview,
  ApiSessionCompleteEvent,
  ApiWorkspaceSnapshot,
} from '@shared/contracts/apiWorkbench';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_WORKSPACE_ID = '99999999-9999-4999-8999-999999999999';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const COLLECTION_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const FOLDER_ID = '55555555-5555-4555-8555-555555555555';

function makeSnapshot(): ApiWorkspaceSnapshot {
  const now = '2026-07-29T12:00:00.000Z';
  return {
    summary: {
      workspaceId: WORKSPACE_ID,
      name: 'My workspace',
      createdAt: now,
      updatedAt: now,
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
        name: 'Health check',
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
        name: 'Health check',
        protocol: 'http',
        urlTemplate: 'https://example.com/health',
        method: 'GET',
        query: [],
        headers: [],
        auth: { kind: 'none' },
        body: { kind: 'none' },
        protocolOptions: {},
        scripts: {},
        settings: { followRedirects: true },
        variables: [],
        revision: 1,
        createdAt: now,
        updatedAt: now,
      },
    ],
    environments: [],
  tlsProfiles: [],
  proxyProfiles: [],
  oauthProfiles: [],
  oauthTokens: [],
  };
}

function makeNestedSnapshot(): ApiWorkspaceSnapshot {
  const snapshot = makeSnapshot();
  const nestedRequestId = '66666666-6666-4666-8666-666666666666';
  const now = '2026-07-29T12:00:00.000Z';
  snapshot.collections = [
    {
      collectionId: FOLDER_ID,
      workspaceId: WORKSPACE_ID,
      parentId: null,
      kind: 'folder',
      name: 'Users',
      order: 0,
      variables: [],
      revision: 1,
    },
    ...snapshot.collections.map((node) => ({ ...node, order: 1 })),
    {
      collectionId: '77777777-7777-4777-8777-777777777777',
      workspaceId: WORKSPACE_ID,
      parentId: FOLDER_ID,
      kind: 'request',
      name: 'List users',
      order: 0,
      requestId: nestedRequestId,
      variables: [],
      revision: 1,
    },
  ];
  snapshot.requests.push({
    requestId: nestedRequestId,
    workspaceId: WORKSPACE_ID,
    collectionId: '77777777-7777-4777-8777-777777777777',
    name: 'List users',
    protocol: 'http',
    urlTemplate: 'https://example.com/users',
    method: 'GET',
    query: [],
    headers: [],
    auth: { kind: 'none' },
    body: { kind: 'none' },
    protocolOptions: {},
    scripts: {},
    settings: { followRedirects: true },
    variables: [],
    revision: 1,
    createdAt: now,
    updatedAt: now,
  });
  return snapshot;
}

function makeSecondWorkspaceSnapshot(): ApiWorkspaceSnapshot {
  const snapshot = makeNestedSnapshot();
  snapshot.summary = { ...snapshot.summary, workspaceId: SECOND_WORKSPACE_ID, name: 'Second workspace' };
  snapshot.collections = snapshot.collections.map((node) => ({ ...node, workspaceId: SECOND_WORKSPACE_ID }));
  snapshot.requests = snapshot.requests.map((request) => ({ ...request, workspaceId: SECOND_WORKSPACE_ID }));
  return snapshot;
}

function makeResponse(): ApiResponsePreview {
  return {
    sessionId: SESSION_ID,
    workspaceId: WORKSPACE_ID,
    requestId: REQUEST_ID,
    ok: true,
    status: 200,
    statusText: 'OK',
    url: 'https://example.com/health',
    method: 'GET',
    headers: [{ name: 'content-type', value: 'application/json' }],
    timings: { totalMs: 42 },
    redirects: [],
    wireBytes: 18,
    decodedBytes: 18,
    truncated: false,
    bodyText: '{"ok":true}',
    bodyIsBinary: false,
  };
}

function createMockApi(overrides: Partial<Window['bureau']['api']> = {}) {
  let sessionListener: ((event: ApiSessionCompleteEvent) => void) | null = null;
  const snapshot = makeSnapshot();

  const api = {
    getStatus: vi.fn().mockResolvedValue({ ready: true, secretStorageAvailable: true }),
    listWorkspaces: vi.fn().mockResolvedValue({
      workspaces: [snapshot.summary],
    }),
    // The real IPC boundary deserializes every snapshot. Returning a fresh copy here prevents
    // an in-place test mutation from disguising a renderer refresh as the same Zustand value.
    getWorkspace: vi.fn().mockImplementation(async () => ({ ok: true, snapshot: structuredClone(snapshot) })),
    createWorkspace: vi.fn().mockResolvedValue({ ok: true, workspaceId: WORKSPACE_ID }),
    updateWorkspace: vi.fn().mockResolvedValue({ ok: true, revision: 2 }),
    deleteWorkspace: vi.fn().mockResolvedValue({ ok: true }),
    createCollection: vi.fn().mockResolvedValue({
      ok: true,
      collectionId: COLLECTION_ID,
      requestId: REQUEST_ID,
    }),
    updateCollection: vi.fn().mockImplementation(async (input) => {
      const collection = snapshot.collections.find((entry) => entry.collectionId === input.collectionId);
      if (!collection) return { ok: false, error: { code: 'API_REQUEST_NOT_FOUND', message: 'Missing collection.' } };
      Object.assign(collection, input, { revision: collection.revision + 1 });
      if (input.name !== undefined && collection.requestId) {
        const request = snapshot.requests.find((entry) => entry.requestId === collection.requestId);
        if (request) Object.assign(request, { name: input.name, revision: request.revision + 1 });
      }
      return { ok: true, revision: collection.revision };
    }),
    deleteCollection: vi.fn().mockResolvedValue({ ok: true }),
    saveRequest: vi.fn().mockImplementation(async (input) => {
      const request = snapshot.requests.find((entry) => entry.requestId === input.requestId);
      if (!request) return { ok: false, error: { code: 'API_REQUEST_NOT_FOUND', message: 'Missing request.' } };
      Object.assign(request, input.patch, { revision: request.revision + 1 });
      if (input.patch.name !== undefined) {
        const collection = snapshot.collections.find((entry) => entry.requestId === input.requestId);
        if (collection) Object.assign(collection, { name: input.patch.name, revision: collection.revision + 1 });
      }
      return { ok: true, revision: request.revision };
    }),
    deleteRequest: vi.fn().mockResolvedValue({ ok: true }),
    createEnvironment: vi.fn().mockResolvedValue({ ok: true, environmentId: 'env-1' }),
    updateEnvironment: vi.fn().mockResolvedValue({ ok: true, revision: 2 }),
    deleteEnvironment: vi.fn().mockResolvedValue({ ok: true }),
    listSecrets: vi.fn().mockResolvedValue({ secrets: [] }),
    saveSecret: vi.fn().mockResolvedValue({ ok: true, secretId: 'secret-1' }),
    deleteSecret: vi.fn().mockResolvedValue({ ok: true }),
    listHistory: vi.fn().mockResolvedValue({ items: [] }),
    getHistoryEntry: vi.fn().mockResolvedValue({ ok: true, entry: {} }),
    sendRequest: vi.fn().mockImplementation(async () => {
      const response = makeResponse();
      queueMicrotask(() => {
        sessionListener?.({
          type: 'complete',
          sessionId: SESSION_ID,
          workspaceId: WORKSPACE_ID,
          requestId: REQUEST_ID,
          seq: 1,
          response,
        });
      });
      return { ok: true, sessionId: SESSION_ID };
    }),
    cancelRequest: vi.fn().mockResolvedValue({ ok: true }),
    onSessionEvent: vi.fn((listener: (event: ApiSessionCompleteEvent) => void) => {
      sessionListener = listener;
      return () => {
        sessionListener = null;
      };
    }),
    setDirtyDraftCount: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  return api;
}

beforeEach(() => {
  useAppStore.setState({
    projects: [
      {
        projectId: 'proj-1',
        name: 'Demo',
        path: '/tmp/demo',
        canonicalPath: '/tmp/demo',
        stack: [],
        addedAt: '2026-07-29T12:00:00.000Z',
        pinned: false,
      },
    ],
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

/** Accepts the themed confirmation the store gates every destructive API action behind. */
async function confirmDestructive() {
  const dialog = await screen.findByRole('dialog');
  const confirm = within(dialog)
    .getAllByRole('button')
    .find((button) => button.textContent !== 'Cancel');
  await userEvent.setup().click(confirm!);
}

describe('ApiWorkspace', () => {
  it('creates a workspace from the empty state', async () => {
    const api = createMockApi({
      listWorkspaces: vi
        .fn()
        .mockResolvedValueOnce({ workspaces: [] })
        .mockResolvedValue({ workspaces: [makeSnapshot().summary] }),
    });
    Object.defineProperty(window, 'bureau', { configurable: true, value: { api } });

    render(<ApiWorkspace />);
    await waitFor(() => {
      expect(screen.getByText('No API workspaces yet')).toBeInTheDocument();
    });

    await userEvent.setup().click(screen.getByRole('button', { name: 'Create workspace' }));
    await waitFor(() => {
      expect(api.createWorkspace).toHaveBeenCalledWith({ name: 'My workspace' });
    });
  });

  it('opens a request, edits the URL, and shows a mocked response', async () => {
    const api = createMockApi();
    Object.defineProperty(window, 'bureau', { configurable: true, value: { api } });

    render(<ApiWorkspace />);

    await waitFor(() => {
      expect(screen.getByRole('tree', { name: 'API collections' })).toBeInTheDocument();
    });

    const tree = screen.getByRole('tree', { name: 'API collections' });
    await userEvent.setup().click(within(tree).getByRole('treeitem', { name: /Health check/i }));

    const urlField = await screen.findByLabelText('URL');
    await userEvent.setup().clear(urlField);
    await userEvent.setup().type(urlField, 'https://example.com/v2/health');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(api.sendRequest).toHaveBeenCalled();
      expect(screen.getByText(/200\s+OK/)).toBeInTheDocument();
      expect(screen.getByText(/"ok"\s*:\s*true/)).toBeInTheDocument();
    });

    const responsePanel = document.querySelector<HTMLElement>('.api-response__body');
    if (!responsePanel) throw new Error('Expected the response panel.');
    expect(responsePanel.querySelector('pre')?.textContent).toBe('{\n  "ok": true\n}');
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Raw' }));
    expect(screen.getByRole('tab', { name: 'Raw' })).toHaveAttribute('aria-selected', 'true');
    expect(responsePanel.querySelector('pre')?.textContent).toBe('{"ok":true}');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Focus response' }));
    expect(screen.queryByLabelText('Request name')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exit response focus (Esc)' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.getByLabelText('Request name')).toBeInTheDocument());
  });

  it('saves a renamed request with Ctrl+S and refreshes its collection label', async () => {
    const api = createMockApi();
    Object.defineProperty(window, 'bureau', { configurable: true, value: { api } });

    render(<ApiWorkspace />);
    const tree = await screen.findByRole('tree', { name: 'API collections' });
    await userEvent.setup().click(within(tree).getByRole('treeitem', { name: /Health check/i }));

    const name = await screen.findByLabelText('Request name');
    await userEvent.setup().clear(name);
    await userEvent.setup().type(name, 'Renamed request');
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    await waitFor(() => {
      expect(api.saveRequest).toHaveBeenCalledWith(
        expect.objectContaining({ patch: expect.objectContaining({ name: 'Renamed request' }) })
      );
      expect(screen.getByRole('treeitem', { name: /Renamed request/i })).toBeInTheDocument();
    });
  });

  it('renames a request from the sidebar context menu', async () => {
    const api = createMockApi();
    Object.defineProperty(window, 'bureau', { configurable: true, value: { api } });

    render(
      <>
        <ApiWorkspace />
        <ContextMenu />
      </>
    );
    const tree = await screen.findByRole('tree', { name: 'API collections' });
    fireEvent.contextMenu(within(tree).getByRole('treeitem', { name: /Health check/i }));
    await userEvent.setup().click(await screen.findByRole('menuitem', { name: 'Rename…' }));

    const dialog = await screen.findByRole('dialog', { name: 'Rename request' });
    const name = within(dialog).getByLabelText('Name');
    await userEvent.setup().clear(name);
    await userEvent.setup().type(name, 'Sidebar rename');
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Rename' }));

    await waitFor(() => {
      expect(api.updateCollection).toHaveBeenCalledWith(
        expect.objectContaining({ collectionId: COLLECTION_ID, name: 'Sidebar rename' })
      );
      expect(screen.getByRole('treeitem', { name: /Sidebar rename/i })).toBeInTheDocument();
    });
  });

  it('collapses folders and switches sidebar sections from the rail', async () => {
    const snapshot = makeNestedSnapshot();
    const api = createMockApi({
      getWorkspace: vi.fn().mockResolvedValue({ ok: true, snapshot }),
    });
    Object.defineProperty(window, 'bureau', { configurable: true, value: { api } });

    render(<ApiWorkspace />);
    const tree = await screen.findByRole('tree', { name: 'API collections' });
    expect(within(tree).getByRole('treeitem', { name: /List users/ })).toBeInTheDocument();

    await userEvent.setup().click(within(tree).getByRole('treeitem', { name: 'Users' }));
    expect(within(tree).queryByRole('treeitem', { name: /List users/ })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Expand Users' }));
    expect(within(tree).getByRole('treeitem', { name: /List users/ })).toBeInTheDocument();
    expect(useApiStore.getState().expandedCollectionIdsByWorkspace[WORKSPACE_ID]).toContain(FOLDER_ID);
    await useApiStore.getState().refreshActiveWorkspace();
    expect(useApiStore.getState().expandedCollectionIdsByWorkspace[WORKSPACE_ID]).toContain(FOLDER_ID);
    expect(within(tree).getByRole('treeitem', { name: /List users/ })).toBeInTheDocument();

    // The rail shows exactly one section at a time, so the tree never competes for height.
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Environments/ }));
    expect(screen.getByRole('button', { name: /Environments/ })).toHaveAttribute(
      'aria-current',
      'true'
    );
    await user.click(screen.getByRole('button', { name: /History/ }));
    expect(screen.getByRole('button', { name: /History/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /Environments/ })).not.toHaveAttribute('aria-current');
    expect(screen.queryByRole('tree', { name: 'API collections' })).not.toBeInTheDocument();
  });

  it('keeps folder expansion choices scoped to each workspace', async () => {
    const firstSnapshot = makeNestedSnapshot();
    const secondSnapshot = makeSecondWorkspaceSnapshot();
    const api = createMockApi({
      listWorkspaces: vi.fn().mockResolvedValue({
        workspaces: [firstSnapshot.summary, secondSnapshot.summary],
      }),
      getWorkspace: vi.fn().mockImplementation(async ({ workspaceId }: { workspaceId: string }) => ({
        ok: true,
        snapshot: structuredClone(workspaceId === SECOND_WORKSPACE_ID ? secondSnapshot : firstSnapshot),
      })),
    });
    Object.defineProperty(window, 'bureau', { configurable: true, value: { api } });

    render(<ApiWorkspace />);
    const tree = await screen.findByRole('tree', { name: 'API collections' });
    await userEvent.setup().click(within(tree).getByRole('treeitem', { name: 'Users' }));
    expect(within(tree).queryByRole('treeitem', { name: /List users/ })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Expand Users' }));
    expect(useApiStore.getState().expandedCollectionIdsByWorkspace[WORKSPACE_ID]).toContain(FOLDER_ID);

    useApiStore.getState().setActiveWorkspace(SECOND_WORKSPACE_ID);
    await waitFor(() => expect(useApiStore.getState().activeWorkspaceId).toBe(SECOND_WORKSPACE_ID));
    const secondTree = await screen.findByRole('tree', { name: 'API collections' });
    await userEvent.setup().click(within(secondTree).getByRole('treeitem', { name: 'Users' }));
    expect(useApiStore.getState().expandedCollectionIdsByWorkspace[SECOND_WORKSPACE_ID]).toEqual([]);

    useApiStore.getState().setActiveWorkspace(WORKSPACE_ID);
    await waitFor(() => expect(useApiStore.getState().activeWorkspaceId).toBe(WORKSPACE_ID));
    const firstTree = await screen.findByRole('tree', { name: 'API collections' });
    expect(within(firstTree).getByRole('treeitem', { name: /List users/ })).toBeInTheDocument();
    expect(useApiStore.getState().expandedCollectionIdsByWorkspace[WORKSPACE_ID]).toContain(FOLDER_ID);
  });

  it('closes an open request tab when deleting it from the sidebar', async () => {
    const api = createMockApi();
    Object.defineProperty(window, 'bureau', { configurable: true, value: { api } });

    render(
      <>
        <ApiWorkspace />
        <ContextMenu />
      </>
    );
    const tree = await screen.findByRole('tree', { name: 'API collections' });
    await userEvent.setup().click(within(tree).getByRole('treeitem', { name: /Health check/i }));
    expect(screen.getByRole('tab', { name: /Health check/i })).toBeInTheDocument();

    fireEvent.contextMenu(within(tree).getByRole('treeitem', { name: /Health check/i }));
    await userEvent.setup().click(await screen.findByRole('menuitem', { name: 'Delete request' }));
    await confirmDestructive();

    await waitFor(() => {
      expect(screen.queryByRole('tab', { name: /Health check/i })).not.toBeInTheDocument();
    });
  });

  it('closes an open request tab when deleting it from the tab menu', async () => {
    const api = createMockApi();
    Object.defineProperty(window, 'bureau', { configurable: true, value: { api } });

    render(
      <>
        <ApiWorkspace />
        <ContextMenu />
      </>
    );
    const tree = await screen.findByRole('tree', { name: 'API collections' });
    await userEvent.setup().click(within(tree).getByRole('treeitem', { name: /Health check/i }));
    const tab = screen.getByRole('tab', { name: /Health check/i });
    fireEvent.contextMenu(tab);
    await userEvent.setup().click(await screen.findByRole('menuitem', { name: 'Delete request' }));
    await confirmDestructive();

    await waitFor(() => {
      expect(screen.queryByRole('tab', { name: /Health check/i })).not.toBeInTheDocument();
    });
  });

  it('leaves the request tab open when deletion fails', async () => {
    const api = createMockApi({
      deleteCollection: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: 'COMMAND_FAILED', message: 'Deletion failed', retryable: true },
      }),
    });
    Object.defineProperty(window, 'bureau', { configurable: true, value: { api } });

    render(
      <>
        <ApiWorkspace />
        <ContextMenu />
      </>
    );
    const tree = await screen.findByRole('tree', { name: 'API collections' });
    await userEvent.setup().click(within(tree).getByRole('treeitem', { name: /Health check/i }));
    fireEvent.contextMenu(within(tree).getByRole('treeitem', { name: /Health check/i }));
    await userEvent.setup().click(await screen.findByRole('menuitem', { name: 'Delete request' }));
    await confirmDestructive();

    expect(screen.getByRole('tab', { name: /Health check/i })).toBeInTheDocument();
    await waitFor(() => expect(api.deleteCollection).toHaveBeenCalledTimes(1));
  });

  it('keeps an environment name focused while its change refreshes the workspace', async () => {
    const snapshot = makeSnapshot();
    snapshot.environments = [
      {
        environmentId: 'env-1',
        workspaceId: WORKSPACE_ID,
        name: 'New environment',
        variables: [],
        revision: 1,
        createdAt: '2026-07-29T12:00:00.000Z',
        updatedAt: '2026-07-29T12:00:00.000Z',
      },
    ];
    const api = createMockApi({
      getWorkspace: vi.fn().mockResolvedValue({ ok: true, snapshot }),
    });
    Object.defineProperty(window, 'bureau', { configurable: true, value: { api } });

    render(<ApiWorkspace />);
    await userEvent.setup().click(await screen.findByRole('button', { name: /Environments/ }));
    await userEvent.setup().click(await screen.findByRole('button', { name: /New environment.*0 variables/i }));

    const name = await screen.findByLabelText('Environment name');
    await userEvent.setup().clear(name);

    expect(name).toHaveFocus();
    await waitFor(() => {
      expect(api.updateEnvironment).toHaveBeenCalledWith(
        expect.objectContaining({ environmentId: 'env-1', name: '' })
      );
    });
  });

  it('opens the context menu on an environment row, whose whole surface is a button', async () => {
    const snapshot = makeSnapshot();
    snapshot.environments = [
      {
        environmentId: 'env-1',
        workspaceId: WORKSPACE_ID,
        name: 'Staging',
        variables: [],
        revision: 1,
        createdAt: '2026-07-29T12:00:00.000Z',
        updatedAt: '2026-07-29T12:00:00.000Z',
      },
    ];
    const api = createMockApi({
      getWorkspace: vi.fn().mockResolvedValue({ ok: true, snapshot }),
    });
    Object.defineProperty(window, 'bureau', { configurable: true, value: { api } });

    render(
      <>
        <ApiWorkspace />
        <ContextMenu />
      </>
    );
    await userEvent.setup().click(await screen.findByRole('button', { name: /Environments/ }));
    fireEvent.contextMenu(await screen.findByRole('button', { name: /Staging.*0 variables/i }));

    expect(await screen.findByRole('menuitem', { name: 'Set as active' })).toBeInTheDocument();
  });
});
