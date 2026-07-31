import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiWorkspace } from '@renderer/features/api/ApiWorkspace';
import { useApiStore } from '@renderer/store/apiStore';
import { useAppStore } from '@renderer/store/appStore';
import type {
  ApiRunEvent,
  ApiScripts,
  ApiWorkspaceSnapshot,
} from '@shared/contracts/apiWorkbench';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const COLLECTION_ID = '33333333-3333-4333-8333-333333333333';
const RUN_ID = '55555555-5555-4555-8555-555555555555';
const NOW = '2026-07-30T12:00:00.000Z';

function snapshot(scripts: ApiScripts = {}): ApiWorkspaceSnapshot {
  return {
    summary: { workspaceId: WORKSPACE_ID, name: 'Payments', createdAt: NOW, updatedAt: NOW, revision: 4 },
    variables: [],
    auth: { kind: 'none' },
    collections: [
      {
        collectionId: COLLECTION_ID,
        workspaceId: WORKSPACE_ID,
        parentId: null,
        kind: 'request',
        name: 'Health',
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
        name: 'Health',
        protocol: 'http',
        urlTemplate: 'https://api.test/health',
        method: 'GET',
        query: [],
        headers: [],
        auth: { kind: 'none' },
        body: { kind: 'none' },
        protocolOptions: {},
        scripts,
        settings: {},
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
  };
}

let runListener: ((event: ApiRunEvent) => void) | null = null;

function install(overrides: Record<string, unknown> = {}, scripts: ApiScripts = {}) {
  const api = {
    getStatus: vi.fn().mockResolvedValue({ ready: true, secretStorageAvailable: true }),
    listWorkspaces: vi.fn().mockResolvedValue({ workspaces: [snapshot().summary] }),
    getWorkspace: vi.fn().mockResolvedValue({ ok: true, snapshot: snapshot(scripts) }),
    listSecrets: vi.fn().mockResolvedValue({ secrets: [] }),
    listHistory: vi.fn().mockResolvedValue({ items: [] }),
    onSessionEvent: vi.fn(() => () => undefined),
    onOAuthEvent: vi.fn(() => () => undefined),
    onRunEvent: vi.fn((listener: (event: ApiRunEvent) => void) => {
      runListener = listener;
      return () => {
        runListener = null;
      };
    }),
    setDirtyDraftCount: vi.fn().mockResolvedValue(undefined),
    saveRequest: vi.fn().mockResolvedValue({ ok: true, revision: 2 }),
    validateScript: vi.fn().mockResolvedValue({ ok: true }),
    listScriptLocations: vi.fn().mockResolvedValue({
      ok: true,
      locations: [
        {
          holder: { kind: 'request', id: REQUEST_ID, name: 'Health' },
          phases: ['post-response'],
          enabled: false,
          origin: 'imported',
          path: 'Health',
        },
      ],
    }),
    approveScripts: vi.fn().mockResolvedValue({ ok: true, changed: 1 }),
    startRun: vi.fn().mockResolvedValue({ ok: true, runId: RUN_ID }),
    cancelRun: vi.fn().mockResolvedValue({ ok: true }),
    loadRunData: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        dataSetId: '66666666-6666-4666-8666-666666666666',
        fileName: 'users.csv',
        rowCount: 3,
        columns: ['user_id'],
        warnings: [],
      },
    }),
    clearRunData: vi.fn().mockResolvedValue(undefined),
    exportRunReport: vi.fn().mockResolvedValue({ ok: true, written: true }),
    getRunReport: vi.fn(),
    ...overrides,
  };
  Object.defineProperty(window, 'bureau', { configurable: true, value: { api } });
  return api;
}

beforeEach(() => {
  runListener = null;
  useAppStore.setState({
    projects: [],
    settings: {
      layout: { paneWidths: { files: 340, commit: 280, filesExplorer: 280, apiSidebar: 280 } },
      api: { scriptsEnabled: true },
    } as ReturnType<typeof useAppStore.getState>['settings'],
  });
  useApiStore.getState().reset();
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'bureau');
  vi.restoreAllMocks();
});

/** Opens the request document and switches to its Scripts editor tab. */
async function openScriptsTab(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => {
    expect(screen.getByRole('tree', { name: 'API collections' })).toBeInTheDocument();
  });
  const tree = screen.getByRole('tree', { name: 'API collections' });
  await user.click(within(tree).getByRole('treeitem', { name: /Health/i }));
  const tab = await screen.findByRole('tab', { name: /^Scripts/ });
  await user.click(tab);
}

describe('Script editors', () => {
  it('lets an authored script be enabled and saves the source in the draft', async () => {
    const api = install();
    const user = userEvent.setup();
    render(<ApiWorkspace />);
    await openScriptsTab(user);

    const toggle = screen.getByRole('checkbox', { name: /Run these scripts/ });
    // Nothing to run yet, so enabling is meaningless.
    expect(toggle).toBeDisabled();

    // `type` reads braces as key descriptors, so the source is pasted verbatim instead.
    await user.click(screen.getByLabelText('Tests script'));
    await user.paste('bureau.test("x", () => bureau.expect(1).toBe(1));');
    await waitFor(() => expect(api.validateScript).toHaveBeenCalled());
    expect(api.validateScript).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'post-response' })
    );

    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /Run these scripts/ })).toBeEnabled()
    );
  });

  it('refuses to enable an imported script inline and sends the user to the review dialog', async () => {
    const api = install({}, { postResponse: 'imported()', enabled: false, origin: 'imported' });
    const user = userEvent.setup();
    render(<ApiWorkspace />);
    await openScriptsTab(user);

    expect(screen.getByRole('checkbox', { name: /Run these scripts/ })).toBeDisabled();
    expect(screen.getByText(/Imported script\./)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Review scripts…' }));
    await waitFor(() => expect(api.listScriptLocations).toHaveBeenCalled());
    const dialog = await screen.findByRole('dialog', { name: 'Scripts in Payments' });
    expect(within(dialog).getByText(/came from an import/)).toBeInTheDocument();
  });

  it('shows a syntax error against the editor without running anything', async () => {
    install({
      validateScript: vi.fn().mockResolvedValue({ ok: false, message: 'unexpected token', line: 2 }),
    });
    const user = userEvent.setup();
    render(<ApiWorkspace />);
    await openScriptsTab(user);

    await user.type(screen.getByLabelText('Pre-request script'), 'const =');
    expect(await screen.findByText('Line 2: unexpected token')).toBeInTheDocument();
  });

  it('says so when scripts are turned off for the installation', async () => {
    install();
    useAppStore.setState({
      ...useAppStore.getState(),
      settings: {
        layout: { paneWidths: { files: 340, commit: 280, filesExplorer: 280, apiSidebar: 280 } },
        api: { scriptsEnabled: false },
      } as ReturnType<typeof useAppStore.getState>['settings'],
    });
    const user = userEvent.setup();
    render(<ApiWorkspace />);
    await openScriptsTab(user);

    expect(screen.getByText(/Scripts are turned off for this installation/)).toBeInTheDocument();
  });
});

describe('Script approval dialog', () => {
  it('approves against the revision the reviewed list was read at', async () => {
    const api = install({}, { postResponse: 'imported()', enabled: false, origin: 'imported' });
    const user = userEvent.setup();
    render(<ApiWorkspace />);
    await openScriptsTab(user);

    await user.click(screen.getByRole('button', { name: 'Review scripts…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Scripts in Payments' });
    await user.click(within(dialog).getByRole('button', { name: /Enable 1 script/ }));

    await waitFor(() => expect(api.approveScripts).toHaveBeenCalled());
    expect(api.approveScripts).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      collectionId: null,
      enabled: true,
      expectedRevision: 4,
    });
  });

  it('lists each script with its provenance and state', async () => {
    install({}, { postResponse: 'imported()', enabled: false, origin: 'imported' });
    const user = userEvent.setup();
    render(<ApiWorkspace />);
    await openScriptsTab(user);
    await user.click(screen.getByRole('button', { name: 'Review scripts…' }));

    const dialog = await screen.findByRole('dialog', { name: 'Scripts in Payments' });
    expect(within(dialog).getByText('Imported')).toBeInTheDocument();
    expect(within(dialog).getByText('Disabled')).toBeInTheDocument();
    expect(within(dialog).getByText('Tests')).toBeInTheDocument();
  });
});

describe('Collection runner', () => {
  async function openRunner(user: ReturnType<typeof userEvent.setup>) {
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Run collection' })).toBeInTheDocument()
    );
    await user.click(screen.getByRole('button', { name: 'Run collection' }));
    return screen.findByRole('dialog', { name: 'Run' });
  }

  it('starts a run with the configured iterations, delay, and stop-on-failure', async () => {
    const api = install();
    const user = userEvent.setup();
    render(<ApiWorkspace />);
    const dialog = await openRunner(user);

    const iterations = within(dialog).getByLabelText('Iterations');
    await user.clear(iterations);
    await user.type(iterations, '3');
    await user.click(within(dialog).getByRole('checkbox', { name: /Stop on the first failure/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Start run' }));

    await waitFor(() => expect(api.startRun).toHaveBeenCalled());
    expect(api.startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        target: { kind: 'workspace' },
        iterations: 3,
        delayMs: 0,
        stopOnFailure: true,
      })
    );
  });

  it('shows progress as items land and warns when no script is enabled', async () => {
    install();
    const user = userEvent.setup();
    render(<ApiWorkspace />);
    const dialog = await openRunner(user);
    await user.click(within(dialog).getByRole('button', { name: 'Start run' }));
    await waitFor(() => expect(runListener).not.toBeNull());

    runListener!({
      type: 'run-started',
      runId: RUN_ID,
      workspaceId: WORKSPACE_ID,
      seq: 1,
      plannedItems: 2,
      iterations: 1,
      scriptsEnabled: false,
    });
    expect(await screen.findByText('No scripts are enabled')).toBeInTheDocument();
    expect(screen.getByText('0/2')).toBeInTheDocument();

    runListener!({
      type: 'run-item',
      runId: RUN_ID,
      workspaceId: WORKSPACE_ID,
      seq: 2,
      completed: 1,
      item: {
        itemId: 'i1',
        requestId: REQUEST_ID,
        name: 'Health',
        iteration: 1,
        method: 'GET',
        url: 'https://api.test/health',
        status: 500,
        ok: false,
        totalMs: 42,
        tests: [{ name: 'is ok', passed: false, message: 'Expected 500 to be 200' }],
        scripts: [],
      },
    });
    expect(await screen.findByText('1/2')).toBeInTheDocument();
    expect(screen.getByText('is ok: Expected 500 to be 200')).toBeInTheDocument();
  });

  it('ignores a stale run event', async () => {
    install();
    const user = userEvent.setup();
    render(<ApiWorkspace />);
    const dialog = await openRunner(user);
    await user.click(within(dialog).getByRole('button', { name: 'Start run' }));
    await waitFor(() => expect(runListener).not.toBeNull());

    runListener!({
      type: 'run-started',
      runId: RUN_ID,
      workspaceId: WORKSPACE_ID,
      seq: 5,
      plannedItems: 2,
      iterations: 1,
      scriptsEnabled: true,
    });
    // A lower seq is a duplicate main already superseded.
    runListener!({
      type: 'run-item',
      runId: RUN_ID,
      workspaceId: WORKSPACE_ID,
      seq: 3,
      completed: 9,
      item: {
        itemId: 'stale',
        requestId: REQUEST_ID,
        name: 'Stale',
        iteration: 1,
        method: 'GET',
        url: 'https://api.test/x',
        ok: true,
        totalMs: 1,
        tests: [],
        scripts: [],
      },
    });
    expect(await screen.findByText('0/2')).toBeInTheDocument();
    expect(screen.queryByText('Stale')).not.toBeInTheDocument();
  });

  it('offers report export only once the run has finished', async () => {
    const api = install();
    const user = userEvent.setup();
    render(<ApiWorkspace />);
    const dialog = await openRunner(user);
    await user.click(within(dialog).getByRole('button', { name: 'Start run' }));
    await waitFor(() => expect(runListener).not.toBeNull());

    runListener!({
      type: 'run-started',
      runId: RUN_ID,
      workspaceId: WORKSPACE_ID,
      seq: 1,
      plannedItems: 1,
      iterations: 1,
      scriptsEnabled: true,
    });
    await screen.findByText('Running');
    expect(screen.queryByRole('button', { name: 'Export JSON…' })).not.toBeInTheDocument();

    runListener!({
      type: 'run-complete',
      runId: RUN_ID,
      workspaceId: WORKSPACE_ID,
      seq: 2,
      report: {
        runId: RUN_ID,
        workspaceId: WORKSPACE_ID,
        status: 'completed',
        startedAt: NOW,
        finishedAt: NOW,
        iterations: 1,
        plannedItems: 1,
        items: [],
        totals: {
          requests: 1,
          failedRequests: 0,
          assertions: 1,
          failedAssertions: 0,
          scriptErrors: 0,
          totalMs: 42,
        },
        scriptsEnabled: true,
      },
    });

    await user.click(await screen.findByRole('button', { name: 'Export JSON…' }));
    await waitFor(() => expect(api.exportRunReport).toHaveBeenCalledWith({ runId: RUN_ID, format: 'json' }));
  });

  it('loads iteration data through the main-owned picker and never handles a path', async () => {
    const api = install();
    const user = userEvent.setup();
    render(<ApiWorkspace />);
    const dialog = await openRunner(user);

    await user.click(within(dialog).getByRole('button', { name: 'Choose file…' }));
    await waitFor(() => expect(api.loadRunData).toHaveBeenCalledWith({ workspaceId: WORKSPACE_ID }));
    expect(await screen.findByText('users.csv')).toBeInTheDocument();
    expect(screen.getByText(/3 rows · user_id/)).toBeInTheDocument();

    // Starting the run passes the id main handed back, not any file content.
    await user.click(within(dialog).getByRole('button', { name: 'Start run' }));
    await waitFor(() => expect(api.startRun).toHaveBeenCalled());
    expect(api.startRun).toHaveBeenCalledWith(
      expect.objectContaining({ dataSetId: '66666666-6666-4666-8666-666666666666' })
    );
  });
});
