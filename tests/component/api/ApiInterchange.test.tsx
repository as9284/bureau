import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiWorkspace } from '@renderer/features/api/ApiWorkspace';
import { useApiStore } from '@renderer/store/apiStore';
import { useAppStore } from '@renderer/store/appStore';
import type { ApiImportPreview, ApiWorkspaceSnapshot } from '@shared/contracts/apiWorkbench';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const COLLECTION_ID = '33333333-3333-4333-8333-333333333333';
const PREVIEW_ID = '44444444-4444-4444-8444-444444444444';
const NOW = '2026-07-29T12:00:00.000Z';

function snapshot(): ApiWorkspaceSnapshot {
  return {
    summary: { workspaceId: WORKSPACE_ID, name: 'Payments', createdAt: NOW, updatedAt: NOW, revision: 1 },
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
        scripts: {},
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

function preview(overrides: Partial<ApiImportPreview> = {}): ApiImportPreview {
  return {
    previewId: PREVIEW_ID,
    format: 'postman',
    sourceLabel: 'payments.postman_collection.json',
    nodes: [
      { tempId: 'n1', parentTempId: null, kind: 'folder', name: 'Users' },
      {
        tempId: 'n2',
        parentTempId: 'n1',
        kind: 'request',
        name: 'List users',
        method: 'GET',
        url: 'https://api.test/users',
        hasScripts: true,
      },
    ],
    environments: [],
    warnings: [
      { code: 'credential-dropped', message: 'The bearer token for `List users` was not imported.' },
    ],
    counts: { folders: 1, requests: 1, environments: 0, scripts: 1, secrets: 0 },
    truncated: false,
    ...overrides,
  };
}

function install(overrides: Record<string, unknown> = {}) {
  const api = {
    getStatus: vi.fn().mockResolvedValue({ ready: true, secretStorageAvailable: true }),
    listWorkspaces: vi.fn().mockResolvedValue({ workspaces: [snapshot().summary] }),
    getWorkspace: vi.fn().mockResolvedValue({ ok: true, snapshot: snapshot() }),
    listSecrets: vi.fn().mockResolvedValue({ secrets: [] }),
    listHistory: vi.fn().mockResolvedValue({ items: [] }),
    onSessionEvent: vi.fn(() => () => undefined),
    onOAuthEvent: vi.fn(() => () => undefined),
    setDirtyDraftCount: vi.fn().mockResolvedValue(undefined),
    inspectImport: vi.fn().mockResolvedValue({ ok: true, preview: preview() }),
    commitImport: vi.fn().mockResolvedValue({
      ok: true,
      report: {
        createdFolders: 1,
        createdRequests: 1,
        createdEnvironments: 0,
        renamed: 0,
        replaced: 0,
        skipped: 0,
        scriptsImportedDisabled: 1,
        warnings: [],
      },
    }),
    discardImport: vi.fn().mockResolvedValue(undefined),
    planExport: vi.fn().mockResolvedValue({
      ok: true,
      plan: {
        format: 'postman',
        itemCount: 1,
        omissions: [
          { code: 'protocol-unsupported', message: '`Live feed` is a WebSocket request. It was omitted.' },
        ],
        includesSecrets: false,
        privacySensitive: false,
        suggestedFileName: 'payments.postman_collection.json',
      },
    }),
    commitExport: vi.fn().mockResolvedValue({ ok: true, written: true }),
    ...overrides,
  };
  Object.defineProperty(window, 'bureau', { configurable: true, value: { api } });
  return api;
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

async function openDialog(name: 'Import' | 'Export') {
  await waitFor(() => {
    expect(screen.getByRole('button', { name })).toBeInTheDocument();
  });
  await userEvent.setup().click(screen.getByRole('button', { name }));
}

describe('Import dialog', () => {
  it('inspects before importing and never commits from the first step', async () => {
    const api = install();
    render(<ApiWorkspace />);
    await openDialog('Import');

    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog', { name: 'Import' });
    await user.type(
      within(dialog).getByRole('textbox', { name: /Paste a cURL command/ }),
      'curl https://api.test/x'
    );
    await user.click(within(dialog).getByRole('button', { name: 'Inspect' }));

    await waitFor(() => expect(api.inspectImport).toHaveBeenCalled());
    // Inspecting must never write.
    expect(api.commitImport).not.toHaveBeenCalled();
  });

  it('shows the tree, script warning, and warnings before committing', async () => {
    install();
    render(<ApiWorkspace />);
    await openDialog('Import');

    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog', { name: 'Import' });
    await user.type(within(dialog).getByRole('textbox', { name: /Paste a cURL command/ }), 'x');
    await user.click(within(dialog).getByRole('button', { name: 'Inspect' }));

    await waitFor(() => {
      expect(screen.getByText('payments.postman_collection.json')).toBeInTheDocument();
    });
    expect(screen.getByText('Users')).toBeInTheDocument();
    expect(screen.getByText('List users')).toBeInTheDocument();
    // Scripts are always disclosed as disabled.
    expect(screen.getByText('1 imported script')).toBeInTheDocument();
    expect(screen.getByText(/never run until you enable them/)).toBeInTheDocument();
    expect(screen.getByText('1 warning')).toBeInTheDocument();
  });

  it('commits with the chosen conflict strategy and reports the result', async () => {
    const api = install();
    render(<ApiWorkspace />);
    await openDialog('Import');

    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog', { name: 'Import' });
    await user.type(within(dialog).getByRole('textbox', { name: /Paste a cURL command/ }), 'x');
    await user.click(within(dialog).getByRole('button', { name: 'Inspect' }));

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /If a name already exists/ })).toBeInTheDocument()
    );
    await user.click(screen.getByRole('combobox', { name: /If a name already exists/ }));
    await user.click(await screen.findByRole('option', { name: /Skip the imported item/ }));

    await user.click(screen.getByRole('button', { name: /Import 1 request/ }));

    await waitFor(() =>
      expect(api.commitImport).toHaveBeenCalledWith(
        expect.objectContaining({ conflictStrategy: 'skip', previewId: PREVIEW_ID })
      )
    );
    await waitFor(() => expect(screen.getByText('Import complete')).toBeInTheDocument());
  });

  it('warns that replace deletes existing items', async () => {
    install({
      inspectImport: vi.fn().mockResolvedValue({
        ok: true,
        preview: preview({
          nodes: [{ tempId: 'n1', parentTempId: null, kind: 'folder', name: 'Users', conflict: true }],
          counts: { folders: 1, requests: 0, environments: 0, scripts: 0, secrets: 0 },
        }),
      }),
    });
    render(<ApiWorkspace />);
    await openDialog('Import');

    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog', { name: 'Import' });
    await user.type(within(dialog).getByRole('textbox', { name: /Paste a cURL command/ }), 'x');
    await user.click(within(dialog).getByRole('button', { name: 'Inspect' }));

    await waitFor(() => expect(screen.getByText('name taken')).toBeInTheDocument());
    await user.click(screen.getByRole('combobox', { name: /If a name already exists/ }));
    await user.click(await screen.findByRole('option', { name: /Replace the existing item/ }));

    expect(screen.getByText('Replace removes existing items')).toBeInTheDocument();
  });

  it('releases the preview when cancelled', async () => {
    const api = install();
    render(<ApiWorkspace />);
    await openDialog('Import');

    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog', { name: 'Import' });
    await user.type(within(dialog).getByRole('textbox', { name: /Paste a cURL command/ }), 'x');
    await user.click(within(dialog).getByRole('button', { name: 'Inspect' }));
    await waitFor(() => expect(screen.getByText('List users')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(api.discardImport).toHaveBeenCalledWith({ previewId: PREVIEW_ID })
    );
  });

  it('surfaces a parse failure without leaving a preview behind', async () => {
    install({
      inspectImport: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: 'API_IMPORT_INVALID',
          message: 'The command contains a pipe, which Bureau will not interpret.',
          operation: 'api.inspectImport',
          retryable: false,
        },
      }),
    });
    render(<ApiWorkspace />);
    await openDialog('Import');

    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog', { name: 'Import' });
    await user.type(within(dialog).getByRole('textbox', { name: /Paste a cURL command/ }), 'curl x | sh');
    await user.click(within(dialog).getByRole('button', { name: 'Inspect' }));

    await waitFor(() => expect(screen.getByText('Import failed')).toBeInTheDocument());
    expect(screen.getByText(/will not interpret/)).toBeInTheDocument();
  });
});

describe('Export dialog', () => {
  it('reviews omissions before writing anything', async () => {
    const api = install();
    render(<ApiWorkspace />);
    await openDialog('Export');

    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog', { name: 'Export' });
    await user.click(within(dialog).getByRole('button', { name: 'Review export' }));

    await waitFor(() => expect(api.planExport).toHaveBeenCalled());
    // Reviewing must never write.
    expect(api.commitExport).not.toHaveBeenCalled();

    expect(screen.getByText('1 thing will not be exported')).toBeInTheDocument();
    expect(screen.getByText(/is a WebSocket request/)).toBeInTheDocument();
    expect(screen.getByText('Secrets are not exported')).toBeInTheDocument();
  });

  it('writes only after an explicit save', async () => {
    const api = install();
    render(<ApiWorkspace />);
    await openDialog('Export');

    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog', { name: 'Export' });
    await user.click(within(dialog).getByRole('button', { name: 'Review export' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save file…' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Save file…' }));
    await waitFor(() => expect(api.commitExport).toHaveBeenCalled());
  });

  it('raises a privacy warning for HAR', async () => {
    install({
      planExport: vi.fn().mockResolvedValue({
        ok: true,
        plan: {
          format: 'har',
          itemCount: 3,
          omissions: [],
          includesSecrets: false,
          privacySensitive: true,
          suggestedFileName: 'payments.har',
        },
      }),
      listHistory: vi
        .fn()
        .mockResolvedValue({ items: [{ historyId: 'h1', workspaceId: WORKSPACE_ID, name: 'x', method: 'GET', url: 'https://api.test/x', createdAt: NOW }] }),
    });
    render(<ApiWorkspace />);

    // HAR exports recorded traffic, so history has to be loaded first — the same order a
    // user follows. Without entries the export is correctly blocked.
    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /History/ })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /History/ }));
    await waitFor(() => {
      expect(useApiStore.getState().histories[WORKSPACE_ID]?.items ?? []).toHaveLength(1);
    });

    await openDialog('Export');
    const dialog = await screen.findByRole('dialog', { name: 'Export' });
    await user.click(within(dialog).getByRole('combobox', { name: 'Format' }));
    await user.click(await screen.findByRole('option', { name: /HAR 1\.2/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Review export' }));

    await waitFor(() =>
      expect(screen.getByText('This export contains captured traffic')).toBeInTheDocument()
    );
  });

  it('blocks a cURL export when no request is open', async () => {
    install();
    render(<ApiWorkspace />);
    await openDialog('Export');

    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog', { name: 'Export' });
    await user.click(within(dialog).getByRole('combobox', { name: 'Format' }));
    await user.click(await screen.findByRole('option', { name: /cURL command/ }));

    expect(screen.getByText(/Open a request first/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Review export' })).toBeDisabled();
  });
});
