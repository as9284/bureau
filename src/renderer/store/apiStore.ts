import { create } from 'zustand';
import type { BureauError } from '@shared/contracts/errors';
import type {
  ApiAuth,
  ApiBody,
  ApiCollectionNode,
  ApiEntityId,
  ApiEnvironment,
  ApiExportPlan,
  ApiExportScope,
  ApiGraphqlSchemaSummary,
  ApiHistorySummary,
  ApiImportConflictStrategy,
  ApiImportPreview,
  ApiImportReport,
  ApiInterchangeFormat,
  ApiOAuthStateEvent,
  ApiSaveOAuthProfileInput,
  ApiSaveTlsProfileInput,
  ApiKeyValue,
  ApiRequestDefinition,
  ApiRequestSettings,
  ApiResponsePreview,
  ApiRunConfig,
  ApiRunDataSummary,
  ApiRunEvent,
  ApiRunItemResult,
  ApiRunReport,
  ApiScriptLocation,
  ApiCookie,
  ApiCookieJarSummary,
  ApiRestorePlan,
  ApiRestoreReport,
  ApiSaveProxyProfileInput,
  ApiSaveCookieInput,
  ApiScriptPhase,
  ApiValidateScriptResult,
  ApiSecretSummary,
  ApiSessionEvent,
  ApiStreamEntry,
  ApiStreamStatus,
  ApiWorkspaceSnapshot,
  ApiWorkspaceSummary,
} from '@shared/contracts/apiWorkbench';
import { toError } from '../lib/error';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export type ApiSidebarMode =
  | 'collections'
  | 'history'
  | 'environments'
  | 'secrets'
  | 'cookies';

/**
 * A main-area tab that is not a request. Environments, secrets and cookies are workspace data that
 * needs a table, not a 280px column, so the sidebar lists them and the editor opens here.
 */
export type ApiAuxDocument =
  | { kind: 'environment'; environmentId: ApiEntityId }
  | { kind: 'secrets' }
  | { kind: 'cookies' };

/** Aux tabs are addressed by an opaque string so they can share one ordered open-tab list. */
export type ApiAuxId = string;

/**
 * A destructive API action held pending an explicit confirmation, mirroring `gitStore`'s gate.
 * Every discard-or-delete path routes through `gateApiConfirm`, so a new call site cannot fall
 * back to a raw `window.confirm` — or skip the prompt entirely.
 */
export type ApiConfirmRequest = {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  run: () => void | Promise<void>;
};

export function auxId(document: ApiAuxDocument): ApiAuxId {
  return document.kind === 'environment' ? `env:${document.environmentId}` : document.kind;
}

export function parseAuxId(id: ApiAuxId): ApiAuxDocument | null {
  if (id === 'secrets' || id === 'cookies') return { kind: id };
  if (id.startsWith('env:')) return { kind: 'environment', environmentId: id.slice(4) };
  return null;
}

/** Every request field the composer may edit locally before a save. */
export type ApiDraftPatch = Partial<
  Pick<
    ApiRequestDefinition,
    | 'name'
    | 'urlTemplate'
    | 'method'
    | 'query'
    | 'headers'
    | 'auth'
    | 'body'
    | 'settings'
    | 'variables'
    | 'protocol'
    | 'protocolOptions'
    | 'scripts'
  >
>;

export type ApiRequestDocument = {
  requestId: ApiEntityId;
  workspaceId: ApiEntityId;
  draft: ApiRequestDefinition;
  savedRevision: number;
  localRevision: number;
  dirty: boolean;
  saving: boolean;
  saveError: BureauError | null;
};

export type ApiSessionState = {
  sessionId: ApiEntityId;
  workspaceId: ApiEntityId;
  requestId: ApiEntityId;
  inFlight: boolean;
  phase?: string;
  phaseMessage?: string;
  response?: ApiResponsePreview;
  error?: BureauError;
  /** Highest event sequence applied; anything at or below it is a stale duplicate. */
  lastSeq: number;
  /** Streaming sessions only. */
  protocol?: 'websocket' | 'sse';
  streamStatus?: ApiStreamStatus;
  entries?: ApiStreamEntry[];
  dropped?: number;
  paused?: boolean;
  closeCode?: number;
  closeReason?: string;
  subprotocol?: string;
};

/** Matches the main-process ring capacity so the renderer never outgrows it. */
const STREAM_ENTRY_CAP = 5_000;

type WorkspaceSnapshotState = {
  loadState: LoadState;
  snapshot: ApiWorkspaceSnapshot | null;
  error: BureauError | null;
  generation: number;
};

export type HistoryState = {
  loadState: LoadState;
  items: ApiHistorySummary[];
  error: BureauError | null;
  generation: number;
};

export type ApiStoreState = {
  loadState: LoadState;
  workspaces: ApiWorkspaceSummary[];
  activeWorkspaceId: ApiEntityId | null;
  error: BureauError | null;
  listGeneration: number;

  workspaceSnapshots: Record<ApiEntityId, WorkspaceSnapshotState>;
  documents: Record<ApiEntityId, ApiRequestDocument>;
  openDocumentIds: ApiEntityId[];
  activeRequestId: ApiEntityId | null;
  /** Open non-request tabs, in tab-strip order. */
  openAuxIds: ApiAuxId[];
  /** When set, the editor shows this aux document instead of the active request. */
  activeAuxId: ApiAuxId | null;
  /** The destructive action awaiting confirmation, if any. */
  pendingConfirm?: ApiConfirmRequest;
  sessions: Record<ApiEntityId, ApiSessionState>;
  histories: Record<ApiEntityId, HistoryState>;
  secrets: ApiSecretSummary[];
  secretsLoadState: LoadState;
  secretStorageAvailable: boolean;
  sidebarMode: ApiSidebarMode;
  /** Renderer-only disclosure state. API workspace files remain unchanged. */
  expandedCollectionIdsByWorkspace: Record<ApiEntityId, ApiEntityId[]>;
  activeEnvironmentId: ApiEntityId | null;
  relinkPickerOpen: boolean;
  graphqlSchemas: Record<ApiEntityId, ApiGraphqlSchemaSummary>;
  introspecting: boolean;
  introspectError: string | null;
  introspectGeneration: number;
  oauthPhases: Record<ApiEntityId, { phase: ApiOAuthStateEvent['phase']; errorMessage?: string }>;

  importPreview: ApiImportPreview | null;
  importBusy: boolean;
  importError: BureauError | null;
  importReport: ApiImportReport | null;
  exportPlan: ApiExportPlan | null;
  exportBusy: boolean;
  exportError: BureauError | null;

  /** Phase 4 — scripts and the collection runner. */
  runnerOpen: boolean;
  runData: ApiRunDataSummary | null;
  runDataBusy: boolean;
  activeRun: ApiRunState | null;
  runError: BureauError | null;
  scriptApproval: {
    open: boolean;
    collectionId: ApiEntityId | null;
    locations: ApiScriptLocation[];
    busy: boolean;
    error: BureauError | null;
  };
  /** Keyed by `${requestId}:${phase}`, so each editor reports its own syntax error. */
  scriptValidation: Record<string, ApiValidateScriptResult>;

  /** Phase 5 — cookie inspection, proxy profiles, backup and restore. */
  cookieJars: ApiCookieJarSummary[];
  activeCookieJarId: string;
  cookies: ApiCookie[];
  cookiesLoading: boolean;
  restorePlan: ApiRestorePlan | null;
  restoreBusy: boolean;
  restoreError: BureauError | null;
  restoreReport: ApiRestoreReport | null;

  loadWorkspaces(): Promise<void>;
  createWorkspace(input?: { name?: string; linkedProjectId?: string }): Promise<void>;
  selectWorkspace(workspaceId: ApiEntityId | null): Promise<void>;
  setActiveWorkspace(workspaceId: ApiEntityId | null): void;
  refreshActiveWorkspace(): Promise<void>;
  setSidebarMode(mode: ApiSidebarMode): void;
  setCollectionExpanded(collectionId: ApiEntityId, expanded: boolean): void;
  setActiveEnvironment(environmentId: ApiEntityId | null): void;
  setRelinkPickerOpen(open: boolean): void;
  relinkWorkspace(projectId: string): Promise<void>;
  removeWorkspaceLink(): Promise<void>;
  updateWorkspaceName(name: string): Promise<void>;

  loadHistory(workspaceId: ApiEntityId): Promise<void>;
  loadSecrets(): Promise<void>;

  createCollection(input: {
    parentId: ApiEntityId | null;
    kind: 'folder' | 'request';
    name: string;
  }): Promise<void>;
  updateCollection(
    collectionId: ApiEntityId,
    patch: { name?: string; parentId?: ApiEntityId | null }
  ): Promise<void>;
  duplicateCollection(collectionId: ApiEntityId): Promise<void>;
  deleteCollection(collectionId: ApiEntityId): Promise<void>;
  createEnvironment(name: string): Promise<void>;
  updateEnvironment(
    environmentId: ApiEntityId,
    patch: { name?: string; variables?: ApiEnvironment['variables'] }
  ): Promise<void>;
  deleteEnvironment(environmentId: ApiEntityId): Promise<void>;

  openRequest(requestId: ApiEntityId): void;
  closeRequest(requestId: ApiEntityId): void;
  setActiveRequest(requestId: ApiEntityId | null): void;
  openAuxDocument(document: ApiAuxDocument): void;
  closeAuxDocument(id: ApiAuxId): void;
  setActiveAux(id: ApiAuxId): void;
  /** Hold `run` behind the shared confirmation dialog. */
  gateApiConfirm(descriptor: ApiConfirmRequest): void;
  cancelApiConfirm(): void;
  acceptApiConfirm(): Promise<void>;
  updateDraft(requestId: ApiEntityId, patch: ApiDraftPatch): void;
  saveRequest(requestId: ApiEntityId): Promise<void>;
  saveAllDirtyRequests(): Promise<boolean>;
  discardAllDirtyDrafts(): void;
  sendRequest(requestId: ApiEntityId): Promise<void>;
  cancelRequest(sessionId: ApiEntityId): Promise<void>;
  openStream(requestId: ApiEntityId): Promise<void>;
  sendStreamMessage(
    sessionId: ApiEntityId,
    format: 'text' | 'json' | 'binary-hex',
    payload: string
  ): Promise<void>;
  closeStream(sessionId: ApiEntityId): Promise<void>;
  setStreamPaused(sessionId: ApiEntityId, paused: boolean): Promise<void>;
  clearStreamTranscript(sessionId: ApiEntityId): void;

  saveSecret(label: string, value: string, persist: boolean): Promise<ApiEntityId | null>;
  deleteSecret(secretId: ApiEntityId): Promise<void>;
  introspectGraphql(requestId: ApiEntityId): Promise<void>;
  saveTlsProfile(input: Omit<ApiSaveTlsProfileInput, 'workspaceId'>): Promise<void>;
  deleteTlsProfile(profileId: ApiEntityId, expectedRevision: number): Promise<void>;
  saveOAuthProfile(input: Omit<ApiSaveOAuthProfileInput, 'workspaceId'>): Promise<void>;
  deleteOAuthProfile(profileId: ApiEntityId, expectedRevision: number): Promise<void>;
  authorizeOAuth(profileId: ApiEntityId): Promise<void>;
  cancelOAuth(profileId: ApiEntityId): Promise<void>;
  clearOAuthToken(profileId: ApiEntityId): Promise<void>;
  handleOAuthEvent(event: ApiOAuthStateEvent): void;

  inspectImport(input: {
    format: ApiInterchangeFormat | 'auto';
    text?: string;
    fromFile?: boolean;
  }): Promise<void>;
  commitImport(input: {
    parentId: ApiEntityId | null;
    conflictStrategy: ApiImportConflictStrategy;
  }): Promise<void>;
  cancelImport(): void;
  clearImportReport(): void;
  planExport(format: ApiInterchangeFormat, scope: ApiExportScope): Promise<void>;
  commitExport(format: ApiInterchangeFormat, scope: ApiExportScope): Promise<void>;
  cancelExport(): void;

  validateScript(requestId: ApiEntityId, phase: ApiScriptPhase, source: string): Promise<void>;
  openScriptApproval(collectionId: ApiEntityId | null): Promise<void>;
  closeScriptApproval(): void;
  approveScripts(enabled: boolean): Promise<void>;

  setRunnerOpen(open: boolean): void;
  chooseRunData(): Promise<void>;
  clearRunData(): Promise<void>;
  startRun(config: Omit<ApiRunConfig, 'workspaceId' | 'dataSetId'>): Promise<void>;
  cancelRun(): Promise<void>;
  exportRunReport(format: 'json' | 'junit'): Promise<void>;
  dismissRun(): void;

  loadCookies(jarId?: string): Promise<void>;
  deleteCookie(cookie: ApiCookie): Promise<void>;
  clearCookies(): Promise<void>;
  saveCookie(cookie: ApiSaveCookieInput['cookie']): Promise<void>;
  saveProxyProfile(input: Omit<ApiSaveProxyProfileInput, 'workspaceId'>): Promise<void>;
  deleteProxyProfile(profileId: ApiEntityId, expectedRevision: number): Promise<void>;
  setDefaultProxyProfile(profileId: ApiEntityId | null): Promise<void>;
  backupWorkspaces(): Promise<void>;
  planRestore(): Promise<void>;
  commitRestore(mode: 'merge' | 'replace'): Promise<void>;
  cancelRestore(): void;

  handleSessionEvent(event: ApiSessionEvent): void;
  handleRunEvent(event: ApiRunEvent): void;
  reset(): void;
};

/** Live progress for the one run a workspace may have in flight, plus its finished report. */
export type ApiRunState = {
  runId: ApiEntityId;
  status: ApiRunReport['status'];
  plannedItems: number;
  completed: number;
  items: ApiRunItemResult[];
  scriptsEnabled: boolean;
  report: ApiRunReport | null;
  /** Highest run-event sequence applied; anything at or below it is a stale duplicate. */
  lastSeq: number;
};

const api = () => window.bureau.api;

const EMPTY_SNAPSHOT: WorkspaceSnapshotState = {
  loadState: 'idle',
  snapshot: null,
  error: null,
  generation: 0,
};

const EMPTY_HISTORY: HistoryState = {
  loadState: 'idle',
  items: [],
  error: null,
  generation: 0,
};

function snapshotState(
  current: WorkspaceSnapshotState | undefined,
  patch: Partial<WorkspaceSnapshotState>
): WorkspaceSnapshotState {
  return { ...(current ?? EMPTY_SNAPSHOT), ...patch };
}

function historyState(current: HistoryState | undefined, patch: Partial<HistoryState>): HistoryState {
  return { ...(current ?? EMPTY_HISTORY), ...patch };
}

function cloneRequest(request: ApiRequestDefinition): ApiRequestDefinition {
  return structuredClone(request);
}

function requestDirty(saved: ApiRequestDefinition, draft: ApiRequestDefinition): boolean {
  return JSON.stringify(pickDraftComparable(saved)) !== JSON.stringify(pickDraftComparable(draft));
}

function pickDraftComparable(request: ApiRequestDefinition) {
  return {
    name: request.name,
    urlTemplate: request.urlTemplate,
    method: request.method,
    query: request.query,
    headers: request.headers,
    auth: request.auth,
    body: request.body,
    settings: request.settings,
    variables: request.variables,
    protocol: request.protocol,
    protocolOptions: request.protocolOptions,
    scripts: request.scripts,
  };
}

/** The unsaved draft fields main should execute instead of the persisted definition. */
function buildSendDraft(draft: ApiRequestDefinition) {
  return {
    urlTemplate: draft.urlTemplate,
    method: draft.method,
    query: draft.query,
    headers: draft.headers,
    auth: draft.auth,
    body: draft.body,
    settings: draft.settings,
    variables: draft.variables,
    protocol: draft.protocol,
    protocolOptions: draft.protocolOptions,
    // Source only: main reads `enabled` from the saved definition, never from a draft.
    scripts: draft.scripts,
  };
}

function buildSavePatch(document: ApiRequestDocument) {
  const saved = document.draft;
  return {
    name: saved.name,
    urlTemplate: saved.urlTemplate,
    method: saved.method,
    query: saved.query,
    headers: saved.headers,
    auth: saved.auth,
    body: saved.body,
    settings: saved.settings,
    variables: saved.variables,
    protocol: saved.protocol,
    protocolOptions: saved.protocolOptions,
    scripts: saved.scripts,
  };
}

function activeSnapshot(get: () => ApiStoreState): ApiWorkspaceSnapshot | null {
  const workspaceId = get().activeWorkspaceId;
  if (!workspaceId) return null;
  return get().workspaceSnapshots[workspaceId]?.snapshot ?? null;
}

function upsertSnapshot(
  set: (partial: Partial<ApiStoreState> | ((state: ApiStoreState) => Partial<ApiStoreState>)) => void,
  get: () => ApiStoreState,
  workspaceId: ApiEntityId,
  snapshot: ApiWorkspaceSnapshot
): void {
  set((state) => ({
    workspaceSnapshots: {
      ...state.workspaceSnapshots,
      [workspaceId]: snapshotState(state.workspaceSnapshots[workspaceId], {
        loadState: 'ready',
        snapshot,
        error: null,
      }),
    },
    workspaces: state.workspaces.map((workspace) =>
      workspace.workspaceId === workspaceId ? snapshot.summary : workspace
    ),
    activeEnvironmentId:
      state.activeWorkspaceId === workspaceId
        ? (snapshot.summary.activeEnvironmentId ?? state.activeEnvironmentId)
        : state.activeEnvironmentId,
    expandedCollectionIdsByWorkspace: (() => {
      const knownFolders = new Set(
        snapshot.collections
          .filter((node) => node.kind === 'folder')
          .map((node) => node.collectionId)
      );
      const current = state.expandedCollectionIdsByWorkspace[workspaceId];
      if (!current) return state.expandedCollectionIdsByWorkspace;
      return {
        ...state.expandedCollectionIdsByWorkspace,
        [workspaceId]: current.filter((collectionId) => knownFolders.has(collectionId)),
      };
    })(),
  }));

  const openIds = get().openDocumentIds;
  if (!openIds.length) return;
  set((state) => {
    const documents = { ...state.documents };
    for (const requestId of openIds) {
      const current = documents[requestId];
      if (!current || current.workspaceId !== workspaceId) continue;
      const saved = snapshot.requests.find((item) => item.requestId === requestId);
      if (!saved) continue;
      const draft = current.dirty ? current.draft : cloneRequest(saved);
      documents[requestId] = {
        ...current,
        draft,
        savedRevision: saved.revision,
        dirty: current.dirty ? requestDirty(saved, current.draft) : false,
      };
    }
    return { documents };
  });
}

let oauthSubscriptionStarted = false;

function ensureOAuthSubscription(): void {
  if (oauthSubscriptionStarted) return;
  const listener = api()?.onOAuthEvent;
  if (!listener) return;
  oauthSubscriptionStarted = true;
  listener((event) => {
    useApiStore.getState().handleOAuthEvent(event);
  });
}

let sessionSubscriptionStarted = false;

function ensureSessionSubscription(): void {
  if (sessionSubscriptionStarted) return;
  const listener = api()?.onSessionEvent;
  if (!listener) return;
  sessionSubscriptionStarted = true;
  listener((event) => {
    useApiStore.getState().handleSessionEvent(event);
  });
}

let runSubscriptionStarted = false;

function ensureRunSubscription(): void {
  if (runSubscriptionStarted) return;
  const listener = api()?.onRunEvent;
  if (!listener) return;
  runSubscriptionStarted = true;
  listener((event) => {
    useApiStore.getState().handleRunEvent(event);
  });
}

export const useApiStore = create<ApiStoreState>()((set, get) => ({
  loadState: 'idle',
  workspaces: [],
  activeWorkspaceId: null,
  error: null,
  listGeneration: 0,
  workspaceSnapshots: {},
  documents: {},
  openDocumentIds: [],
  activeRequestId: null,
  openAuxIds: [],
  activeAuxId: null,
  pendingConfirm: undefined,
  sessions: {},
  histories: {},
  secrets: [],
  secretsLoadState: 'idle',
  secretStorageAvailable: true,
  sidebarMode: 'collections',
  expandedCollectionIdsByWorkspace: {},
  activeEnvironmentId: null,
  relinkPickerOpen: false,
  graphqlSchemas: {},
  introspecting: false,
  introspectError: null,
  introspectGeneration: 0,
  oauthPhases: {},
  importPreview: null,
  importBusy: false,
  importError: null,
  importReport: null,
  exportPlan: null,
  exportBusy: false,
  exportError: null,
  runnerOpen: false,
  runData: null,
  runDataBusy: false,
  activeRun: null,
  runError: null,
  scriptApproval: { open: false, collectionId: null, locations: [], busy: false, error: null },
  scriptValidation: {},
  cookieJars: [],
  activeCookieJarId: '',
  cookies: [],
  cookiesLoading: false,
  restorePlan: null,
  restoreBusy: false,
  restoreError: null,
  restoreReport: null,

  async loadWorkspaces() {
    ensureSessionSubscription();
    const generation = get().listGeneration + 1;
    set({ loadState: 'loading', error: null, listGeneration: generation });
    try {
      const status = await api().getStatus();
      if (!status.ready) {
        if (get().listGeneration !== generation) return;
        set({
          loadState: 'error',
          error: {
            code: 'CAPABILITY_MISSING',
            message: 'The API workbench is not ready yet.',
            operation: 'api.getStatus',
            retryable: true,
          },
        });
        return;
      }
      set({ secretStorageAvailable: status.secretStorageAvailable });
      const index = await api().listWorkspaces();
      if (get().listGeneration !== generation) return;
      const workspaces = index.workspaces;
      const activeWorkspaceId = get().activeWorkspaceId;
      const stillActive =
        activeWorkspaceId && workspaces.some((w) => w.workspaceId === activeWorkspaceId)
          ? activeWorkspaceId
          : (workspaces[0]?.workspaceId ?? null);
      set({
        loadState: 'ready',
        workspaces,
        activeWorkspaceId: stillActive,
        error: null,
      });
      if (stillActive) {
        await get().selectWorkspace(stillActive);
      }
    } catch (err) {
      if (get().listGeneration !== generation) return;
      set({
        loadState: 'error',
        error: toError(err, 'api.listWorkspaces'),
        workspaces: [],
      });
    }
  },

  async createWorkspace(input) {
    const result = await api().createWorkspace({
      name: input?.name ?? 'My workspace',
      linkedProjectId: input?.linkedProjectId,
    });
    if (!result.ok) {
      set({ error: result.error });
      return;
    }
    await get().loadWorkspaces();
    await get().selectWorkspace(result.workspaceId);
  },

  async selectWorkspace(workspaceId) {
    if (!workspaceId) {
      set({ activeWorkspaceId: null });
      return;
    }
    const existingSnapshot = get().workspaceSnapshots[workspaceId];
    const generation = (existingSnapshot?.generation ?? 0) + 1;
    set((state) => ({
      activeWorkspaceId: workspaceId,
      workspaceSnapshots: {
        ...state.workspaceSnapshots,
        [workspaceId]: snapshotState(state.workspaceSnapshots[workspaceId], {
          // A refresh after an API mutation must not replace the live workbench with a loading pane.
          // Besides being needlessly disruptive, that unmounts focused editors while they are typing.
          loadState: existingSnapshot?.snapshot ? 'ready' : 'loading',
          error: null,
          generation,
        }),
      },
    }));
    try {
      const result = await api().getWorkspace({ workspaceId });
      if (get().workspaceSnapshots[workspaceId]?.generation !== generation) return;
      if (!result.ok) {
        set((state) => ({
          workspaceSnapshots: {
            ...state.workspaceSnapshots,
            [workspaceId]: snapshotState(state.workspaceSnapshots[workspaceId], {
              loadState: 'error',
              error: result.error,
            }),
          },
        }));
        return;
      }
      upsertSnapshot(set, get, workspaceId, result.snapshot);
      if (get().sidebarMode === 'history') {
        void get().loadHistory(workspaceId);
      }
      void get().loadSecrets();
    } catch (err) {
      if (get().workspaceSnapshots[workspaceId]?.generation !== generation) return;
      set((state) => ({
        workspaceSnapshots: {
          ...state.workspaceSnapshots,
          [workspaceId]: snapshotState(state.workspaceSnapshots[workspaceId], {
            loadState: 'error',
            error: toError(err, 'api.getWorkspace'),
          }),
        },
      }));
    }
  },

  setActiveWorkspace(workspaceId) {
    void get().selectWorkspace(workspaceId);
  },

  async refreshActiveWorkspace() {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) return;
    await get().selectWorkspace(workspaceId);
  },

  setSidebarMode(mode) {
    set({ sidebarMode: mode });
    const workspaceId = get().activeWorkspaceId;
    if (mode === 'history' && workspaceId) {
      void get().loadHistory(workspaceId);
    }
  },

  setCollectionExpanded(collectionId, expanded) {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) return;
    set((state) => {
      const current = state.expandedCollectionIdsByWorkspace[workspaceId] ?? [];
      const next = expanded
        ? [...new Set([...current, collectionId])]
        : current.filter((id) => id !== collectionId);
      return {
        expandedCollectionIdsByWorkspace: {
          ...state.expandedCollectionIdsByWorkspace,
          [workspaceId]: next,
        },
      };
    });
  },

  setActiveEnvironment(environmentId) {
    set({ activeEnvironmentId: environmentId });
    const workspaceId = get().activeWorkspaceId;
    const snapshot = workspaceId ? get().workspaceSnapshots[workspaceId]?.snapshot : null;
    if (!workspaceId || !snapshot) return;
    void api()
      .updateWorkspace({
        workspaceId,
        expectedRevision: snapshot.summary.revision,
        activeEnvironmentId: environmentId,
      })
      .then(async (result) => {
        if (!result.ok) return;
        await get().selectWorkspace(workspaceId);
      });
  },

  setRelinkPickerOpen(open) {
    set({ relinkPickerOpen: open });
  },

  async relinkWorkspace(projectId) {
    const workspaceId = get().activeWorkspaceId;
    const snapshot = activeSnapshot(get);
    if (!workspaceId || !snapshot) return;
    const result = await api().updateWorkspace({
      workspaceId,
      expectedRevision: snapshot.summary.revision,
      linkedProjectId: projectId,
    });
    if (!result.ok) {
      set({ error: result.error });
      return;
    }
    set({ relinkPickerOpen: false });
    await get().selectWorkspace(workspaceId);
  },

  async removeWorkspaceLink() {
    const workspaceId = get().activeWorkspaceId;
    const snapshot = activeSnapshot(get);
    if (!workspaceId || !snapshot) return;
    const result = await api().updateWorkspace({
      workspaceId,
      expectedRevision: snapshot.summary.revision,
      linkedProjectId: null,
    });
    if (!result.ok) {
      set({ error: result.error });
      return;
    }
    await get().selectWorkspace(workspaceId);
  },

  async updateWorkspaceName(name) {
    const workspaceId = get().activeWorkspaceId;
    const snapshot = activeSnapshot(get);
    if (!workspaceId || !snapshot) return;
    const result = await api().updateWorkspace({
      workspaceId,
      expectedRevision: snapshot.summary.revision,
      name,
    });
    if (!result.ok) {
      set({ error: result.error });
      return;
    }
    await get().selectWorkspace(workspaceId);
  },

  async loadHistory(workspaceId) {
    const generation = (get().histories[workspaceId]?.generation ?? 0) + 1;
    set((state) => ({
      histories: {
        ...state.histories,
        [workspaceId]: historyState(state.histories[workspaceId], {
          loadState: 'loading',
          error: null,
          generation,
        }),
      },
    }));
    try {
      const result = await api().listHistory({ workspaceId });
      if (get().histories[workspaceId]?.generation !== generation) return;
      set((state) => ({
        histories: {
          ...state.histories,
          [workspaceId]: historyState(state.histories[workspaceId], {
            loadState: 'ready',
            items: result.items,
            error: null,
          }),
        },
      }));
    } catch (err) {
      if (get().histories[workspaceId]?.generation !== generation) return;
      set((state) => ({
        histories: {
          ...state.histories,
          [workspaceId]: historyState(state.histories[workspaceId], {
            loadState: 'error',
            error: toError(err, 'api.listHistory'),
          }),
        },
      }));
    }
  },

  async loadSecrets() {
    set({ secretsLoadState: 'loading' });
    try {
      const result = await api().listSecrets();
      set({ secrets: result.secrets, secretsLoadState: 'ready' });
    } catch {
      set({ secretsLoadState: 'error', secrets: [] });
    }
  },

  async createCollection(input) {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) return;
    const result = await api().createCollection({ workspaceId, ...input });
    if (!result.ok) {
      set({ error: result.error });
      return;
    }
    await get().selectWorkspace(workspaceId);
    if (input.kind === 'request' && result.requestId) {
      get().openRequest(result.requestId);
    }
  },

  async updateCollection(collectionId, patch) {
    const workspaceId = get().activeWorkspaceId;
    const snapshot = activeSnapshot(get);
    if (!workspaceId || !snapshot) return;
    const node = snapshot.collections.find((item) => item.collectionId === collectionId);
    if (!node) return;
    const result = await api().updateCollection({
      workspaceId,
      collectionId,
      expectedRevision: node.revision,
      ...patch,
    });
    if (!result.ok) {
      set({ error: result.error });
      return;
    }
    await get().selectWorkspace(workspaceId);
  },

  async duplicateCollection(collectionId) {
    const workspaceId = get().activeWorkspaceId;
    const snapshot = activeSnapshot(get);
    if (!workspaceId || !snapshot) return;
    const node = snapshot.collections.find((item) => item.collectionId === collectionId);
    if (!node) return;

    const created = await api().createCollection({
      workspaceId,
      parentId: node.parentId,
      kind: node.kind,
      name: `${node.name} copy`,
    });
    if (!created.ok) {
      set({ error: created.error });
      return;
    }

    await get().selectWorkspace(workspaceId);

    if (node.kind === 'request' && node.requestId && created.requestId) {
      const source = snapshot.requests.find((item) => item.requestId === node.requestId);
      const refreshed = activeSnapshot(get);
      const createdRequest = refreshed?.requests.find(
        (item) => item.requestId === created.requestId
      );
      if (source && createdRequest) {
        const saved = await api().saveRequest({
          workspaceId,
          requestId: created.requestId,
          expectedRevision: createdRequest.revision,
          patch: {
            name: `${source.name} copy`,
            urlTemplate: source.urlTemplate,
            method: source.method,
            query: structuredClone(source.query),
            headers: structuredClone(source.headers),
            auth: structuredClone(source.auth),
            body: structuredClone(source.body),
            settings: structuredClone(source.settings),
            variables: structuredClone(source.variables),
            protocol: source.protocol,
            protocolOptions: structuredClone(source.protocolOptions),
            // Keep script source but leave the duplicate disabled until the user opts in.
            scripts: { ...structuredClone(source.scripts), enabled: false },
          },
        });
        if (!saved.ok) {
          set({ error: saved.error });
        } else {
          await get().selectWorkspace(workspaceId);
        }
      }
      get().openRequest(created.requestId);
    }
  },

  async deleteCollection(collectionId) {
    const workspaceId = get().activeWorkspaceId;
    const snapshot = activeSnapshot(get);
    if (!workspaceId || !snapshot) return;
    const node = snapshot.collections.find((item) => item.collectionId === collectionId);
    if (!node) return;
    const requestId =
      node.requestId ?? snapshot.requests.find((request) => request.collectionId === collectionId)?.requestId;
    const result = await api().deleteCollection({
      workspaceId,
      collectionId,
      expectedRevision: node.revision,
    });
    if (!result.ok) {
      set({ error: result.error });
      return;
    }
    if (requestId) get().closeRequest(requestId);
    await get().selectWorkspace(workspaceId);
  },

  async createEnvironment(name) {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) return;
    const result = await api().createEnvironment({ workspaceId, name });
    if (!result.ok) {
      set({ error: result.error });
      return;
    }
    await get().selectWorkspace(workspaceId);
    if (result.environmentId) {
      get().setActiveEnvironment(result.environmentId);
    }
  },

  async updateEnvironment(environmentId, patch) {
    const workspaceId = get().activeWorkspaceId;
    const snapshot = activeSnapshot(get);
    if (!workspaceId || !snapshot) return;
    const environment = snapshot.environments.find((item) => item.environmentId === environmentId);
    if (!environment) return;
    const result = await api().updateEnvironment({
      workspaceId,
      environmentId,
      expectedRevision: environment.revision,
      ...patch,
    });
    if (!result.ok) {
      set({ error: result.error });
      return;
    }
    await get().selectWorkspace(workspaceId);
  },

  async deleteEnvironment(environmentId) {
    const workspaceId = get().activeWorkspaceId;
    const snapshot = activeSnapshot(get);
    if (!workspaceId || !snapshot) return;
    const environment = snapshot.environments.find((item) => item.environmentId === environmentId);
    if (!environment) return;
    const result = await api().deleteEnvironment({
      workspaceId,
      environmentId,
      expectedRevision: environment.revision,
    });
    if (!result.ok) {
      set({ error: result.error });
      return;
    }
    if (get().activeEnvironmentId === environmentId) {
      set({ activeEnvironmentId: null });
    }
    get().closeAuxDocument(auxId({ kind: 'environment', environmentId }));
    await get().selectWorkspace(workspaceId);
  },

  openRequest(requestId) {
    const workspaceId = get().activeWorkspaceId;
    const snapshot = workspaceId ? get().workspaceSnapshots[workspaceId]?.snapshot : null;
    const saved = snapshot?.requests.find((item) => item.requestId === requestId);
    if (!workspaceId || !saved) return;
    const existing = get().documents[requestId];
    if (existing) {
      set({
        activeRequestId: requestId,
        activeAuxId: null,
        openDocumentIds: [...get().openDocumentIds.filter((id) => id !== requestId), requestId],
      });
      return;
    }
    const draft = cloneRequest(saved);
    set((state) => ({
      documents: {
        ...state.documents,
        [requestId]: {
          requestId,
          workspaceId,
          draft,
          savedRevision: saved.revision,
          localRevision: 0,
          dirty: false,
          saving: false,
          saveError: null,
        },
      },
      openDocumentIds: [...state.openDocumentIds.filter((id) => id !== requestId), requestId],
      activeRequestId: requestId,
      activeAuxId: null,
    }));
  },

  closeRequest(requestId) {
    set((state) => {
      const openDocumentIds = state.openDocumentIds.filter((id) => id !== requestId);
      const documents = { ...state.documents };
      delete documents[requestId];
      const activeRequestId =
        state.activeRequestId === requestId
          ? (openDocumentIds[openDocumentIds.length - 1] ?? null)
          : state.activeRequestId;
      return { openDocumentIds, documents, activeRequestId };
    });
  },

  setActiveRequest(requestId) {
    set({ activeRequestId: requestId, activeAuxId: null });
  },

  openAuxDocument(document) {
    const id = auxId(document);
    set((state) => ({
      openAuxIds: state.openAuxIds.includes(id) ? state.openAuxIds : [...state.openAuxIds, id],
      activeAuxId: id,
    }));
  },

  closeAuxDocument(id) {
    set((state) => {
      const openAuxIds = state.openAuxIds.filter((entry) => entry !== id);
      return {
        openAuxIds,
        // Closing the visible aux tab falls back to the last one, then to the active request.
        activeAuxId:
          state.activeAuxId === id ? (openAuxIds[openAuxIds.length - 1] ?? null) : state.activeAuxId,
      };
    });
  },

  setActiveAux(id) {
    set({ activeAuxId: id });
  },

  gateApiConfirm(descriptor) {
    set({ pendingConfirm: descriptor });
  },

  cancelApiConfirm() {
    set({ pendingConfirm: undefined });
  },

  async acceptApiConfirm() {
    const pending = get().pendingConfirm;
    if (!pending) return;
    set({ pendingConfirm: undefined });
    await pending.run();
  },

  updateDraft(requestId, patch) {
    set((state) => {
      const document = state.documents[requestId];
      if (!document) return state;
      const workspaceId = state.activeWorkspaceId;
      const saved = workspaceId
        ? state.workspaceSnapshots[workspaceId]?.snapshot?.requests.find(
            (item) => item.requestId === requestId
          )
        : null;
      const draft = { ...document.draft, ...patch };
      return {
        documents: {
          ...state.documents,
          [requestId]: {
            ...document,
            draft,
            localRevision: document.localRevision + 1,
            dirty: saved ? requestDirty(saved, draft) : true,
            saveError: null,
          },
        },
      };
    });
  },

  async saveRequest(requestId) {
    const document = get().documents[requestId];
    const workspaceId = get().activeWorkspaceId;
    if (!document || !workspaceId || !document.dirty) return;
    set((state) => ({
      documents: {
        ...state.documents,
        [requestId]: { ...document, saving: true, saveError: null },
      },
    }));
    try {
      const result = await api().saveRequest({
        workspaceId,
        requestId,
        expectedRevision: document.savedRevision,
        patch: buildSavePatch(document),
      });
      if (!result.ok) {
        set((state) => ({
          documents: {
            ...state.documents,
            [requestId]: {
              ...state.documents[requestId]!,
              saving: false,
              saveError: result.error,
            },
          },
        }));
        return;
      }
      await get().selectWorkspace(workspaceId);
      set((state) => {
        const current = state.documents[requestId];
        if (!current) return state;
        const saved = state.workspaceSnapshots[workspaceId]?.snapshot?.requests.find(
          (item) => item.requestId === requestId
        );
        return {
          documents: {
            ...state.documents,
            [requestId]: {
              ...current,
              draft: saved ? cloneRequest(saved) : current.draft,
              savedRevision: saved?.revision ?? current.savedRevision,
              dirty: false,
              saving: false,
              saveError: null,
            },
          },
        };
      });
    } catch (err) {
      set((state) => ({
        documents: {
          ...state.documents,
          [requestId]: {
            ...state.documents[requestId]!,
            saving: false,
            saveError: toError(err, 'api.saveRequest'),
          },
        },
      }));
    }
  },

  async saveAllDirtyRequests() {
    const dirtyIds = Object.values(get().documents)
      .filter((document) => document.dirty)
      .map((document) => document.requestId);
    for (const requestId of dirtyIds) {
      await get().saveRequest(requestId);
      if (get().documents[requestId]?.dirty) return false;
    }
    return true;
  },

  discardAllDirtyDrafts() {
    set((state) => {
      const documents: Record<ApiEntityId, ApiRequestDocument> = { ...state.documents };
      for (const [requestId, document] of Object.entries(documents)) {
        if (!document.dirty) continue;
        const saved = state.workspaceSnapshots[document.workspaceId]?.snapshot?.requests.find(
          (item) => item.requestId === requestId
        );
        if (!saved) {
          delete documents[requestId];
          continue;
        }
        documents[requestId] = {
          ...document,
          draft: cloneRequest(saved),
          savedRevision: saved.revision,
          dirty: false,
          saving: false,
          saveError: null,
        };
      }
      return { documents };
    });
  },

  async sendRequest(requestId) {
    ensureSessionSubscription();
    const document = get().documents[requestId];
    const workspaceId = get().activeWorkspaceId;
    if (!document || !workspaceId) return;
    const result = await api().sendRequest({
      workspaceId,
      requestId,
      draft: buildSendDraft(document.draft),
      environmentId: get().activeEnvironmentId,
    });
    if (!result.ok) {
      set((state) => ({
        sessions: {
          ...state.sessions,
          [`pending:${requestId}`]: {
            sessionId: `pending:${requestId}`,
            workspaceId,
            requestId,
            inFlight: false,
            lastSeq: 0,
            error: result.error,
          },
        },
      }));
      return;
    }
    set((state) => {
      // Events for this session may already have arrived; never clobber them.
      const existing = state.sessions[result.sessionId];
      if (existing) return state;
      return {
        sessions: {
          ...state.sessions,
          [result.sessionId]: {
            sessionId: result.sessionId,
            workspaceId,
            requestId,
            inFlight: true,
            lastSeq: 0,
          },
        },
      };
    });
  },

  async openStream(requestId) {
    ensureSessionSubscription();
    const document = get().documents[requestId];
    const workspaceId = get().activeWorkspaceId;
    if (!document || !workspaceId) return;
    const result = await api().openStream({
      workspaceId,
      requestId,
      draft: buildSendDraft(document.draft),
      environmentId: get().activeEnvironmentId,
    });
    if (!result.ok) {
      set((state) => ({
        sessions: {
          ...state.sessions,
          [`pending:${requestId}`]: {
            sessionId: `pending:${requestId}`,
            workspaceId,
            requestId,
            inFlight: false,
            lastSeq: 0,
            error: result.error,
          },
        },
      }));
      return;
    }
    set((state) => {
      if (state.sessions[result.sessionId]) return state;
      return {
        sessions: {
          ...state.sessions,
          [result.sessionId]: {
            sessionId: result.sessionId,
            workspaceId,
            requestId,
            inFlight: true,
            lastSeq: 0,
            protocol: document.draft.protocol === 'sse' ? 'sse' : 'websocket',
            streamStatus: 'connecting',
            entries: [],
            dropped: 0,
          },
        },
      };
    });
  },

  async sendStreamMessage(sessionId, format, payload) {
    const result = await api().sendStreamMessage({ sessionId, format, payload });
    if (!result.ok) set({ error: result.error });
  },

  async closeStream(sessionId) {
    await api().closeStream({ sessionId });
  },

  async setStreamPaused(sessionId, paused) {
    // Display-only: main keeps reading into its bounded ring while paused.
    await api().setStreamPaused({ sessionId, paused });
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return { sessions: { ...state.sessions, [sessionId]: { ...session, paused } } };
    });
  },

  clearStreamTranscript(sessionId) {
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return { sessions: { ...state.sessions, [sessionId]: { ...session, entries: [] } } };
    });
  },

  async saveSecret(label, value, persist) {
    const result = await api().saveSecret({ label, value, persist });
    if (!result.ok) {
      set({ error: result.error });
      return null;
    }
    await get().loadSecrets();
    return result.secretId;
  },

  async deleteSecret(secretId) {
    const result = await api().deleteSecret({ secretId });
    if (!result.ok) {
      set({ error: result.error });
      return;
    }
    await get().loadSecrets();
  },

  async introspectGraphql(requestId) {
    const document = get().documents[requestId];
    const workspaceId = get().activeWorkspaceId;
    if (!document || !workspaceId) return;
    // Latest-request-wins: a second introspection supersedes the first.
    const generation = get().introspectGeneration + 1;
    set({ introspectGeneration: generation, introspecting: true, introspectError: null });
    const result = await api().introspectGraphql({
      workspaceId,
      requestId,
      draft: buildSendDraft(document.draft),
      environmentId: get().activeEnvironmentId,
    });
    if (get().introspectGeneration !== generation) return;
    if (!result.ok) {
      set({ introspecting: false, introspectError: result.error.message });
      return;
    }
    set((state) => ({
      introspecting: false,
      introspectError: null,
      graphqlSchemas: { ...state.graphqlSchemas, [requestId]: result.schema },
    }));
  },

  async saveTlsProfile(input) {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) return;
    const result = await api().saveTlsProfile({ workspaceId, ...input });
    if (!result.ok) {
      set({ error: result.error });
      return;
    }
    await get().selectWorkspace(workspaceId);
  },

  async deleteTlsProfile(profileId, expectedRevision) {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) return;
    const result = await api().deleteTlsProfile({ workspaceId, profileId, expectedRevision });
    if (!result.ok) {
      set({ error: result.error });
      return;
    }
    await get().selectWorkspace(workspaceId);
  },

  async saveOAuthProfile(input) {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) return;
    const result = await api().saveOAuthProfile({ workspaceId, ...input });
    if (!result.ok) {
      set({ error: result.error });
      return;
    }
    await get().selectWorkspace(workspaceId);
  },

  async deleteOAuthProfile(profileId, expectedRevision) {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) return;
    const result = await api().deleteOAuthProfile({ workspaceId, profileId, expectedRevision });
    if (!result.ok) {
      set({ error: result.error });
      return;
    }
    await get().selectWorkspace(workspaceId);
  },

  async authorizeOAuth(profileId) {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) return;
    ensureOAuthSubscription();
    const result = await api().authorizeOAuth({ workspaceId, profileId });
    if (!result.ok) set({ error: result.error });
    await get().selectWorkspace(workspaceId);
  },

  async cancelOAuth(profileId) {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) return;
    await api().cancelOAuth({ workspaceId, profileId });
  },

  async clearOAuthToken(profileId) {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) return;
    const result = await api().clearOAuthToken({ workspaceId, profileId });
    if (!result.ok) {
      set({ error: result.error });
      return;
    }
    await get().selectWorkspace(workspaceId);
  },

  handleOAuthEvent(event) {
    set((state) => ({
      oauthPhases: {
        ...state.oauthPhases,
        [event.profileId]: { phase: event.phase, errorMessage: event.errorMessage },
      },
    }));
  },

  async inspectImport(input) {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) return;
    set({ importBusy: true, importError: null, importReport: null });
    try {
      const result = await api().inspectImport({ workspaceId, ...input });
      if (!result.ok) {
        set({ importBusy: false, importError: result.error, importPreview: null });
        return;
      }
      set({ importBusy: false, importPreview: result.preview });
    } catch (err) {
      set({ importBusy: false, importError: toError(err, 'api.inspectImport'), importPreview: null });
    }
  },

  async commitImport(input) {
    const workspaceId = get().activeWorkspaceId;
    const preview = get().importPreview;
    if (!workspaceId || !preview) return;
    set({ importBusy: true, importError: null });
    try {
      const result = await api().commitImport({
        workspaceId,
        previewId: preview.previewId,
        parentId: input.parentId,
        conflictStrategy: input.conflictStrategy,
        // The preview lists every script; committing records that the user saw them.
        acknowledgeScripts: preview.counts.scripts > 0,
      });
      if (!result.ok) {
        set({ importBusy: false, importError: result.error });
        return;
      }
      set({ importBusy: false, importPreview: null, importReport: result.report });
      await get().selectWorkspace(workspaceId);
    } catch (err) {
      set({ importBusy: false, importError: toError(err, 'api.commitImport') });
    }
  },

  cancelImport() {
    const preview = get().importPreview;
    // Release the main-side preview rather than leaving it to expire.
    if (preview) void api().discardImport({ previewId: preview.previewId });
    set({ importPreview: null, importError: null, importBusy: false });
  },

  clearImportReport() {
    set({ importReport: null });
  },

  async planExport(format, scope) {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) return;
    set({ exportBusy: true, exportError: null, exportPlan: null });
    try {
      const result = await api().planExport({ workspaceId, format, scope });
      if (!result.ok) {
        set({ exportBusy: false, exportError: result.error });
        return;
      }
      set({ exportBusy: false, exportPlan: result.plan });
    } catch (err) {
      set({ exportBusy: false, exportError: toError(err, 'api.planExport') });
    }
  },

  async commitExport(format, scope) {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) return;
    set({ exportBusy: true, exportError: null });
    try {
      const result = await api().commitExport({ workspaceId, format, scope });
      if (!result.ok) {
        set({ exportBusy: false, exportError: result.error });
        return;
      }
      set({ exportBusy: false, exportPlan: null });
    } catch (err) {
      set({ exportBusy: false, exportError: toError(err, 'api.commitExport') });
    }
  },

  cancelExport() {
    set({ exportPlan: null, exportError: null, exportBusy: false });
  },

  async cancelRequest(sessionId) {
    await api().cancelRequest({ sessionId });
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...session, inFlight: false },
        },
      };
    });
  },

  handleSessionEvent(event) {
    set((state) => {
      const existing = state.sessions[event.sessionId];
      // Every event carries a monotonic seq for its session. Main can emit a progress event
      // after the completion it raced, so anything not newer is dropped outright.
      if (existing && event.seq <= existing.lastSeq) return state;

      const session: ApiSessionState = existing ?? {
        sessionId: event.sessionId,
        workspaceId: event.workspaceId,
        requestId: event.requestId,
        inFlight: event.type === 'progress',
        lastSeq: 0,
      };
      const base = { ...session, lastSeq: event.seq };

      let next: ApiSessionState;
      switch (event.type) {
        case 'progress':
          // A completed session never returns to in-flight.
          next = base.response
            ? base
            : { ...base, inFlight: true, phase: event.phase, phaseMessage: event.message };
          break;

        case 'complete':
          next = {
            ...base,
            inFlight: false,
            response: event.response,
            error: event.response.ok
              ? undefined
              : {
                  code: (event.response.errorCode ?? 'API_PROTOCOL_ERROR') as BureauError['code'],
                  message: event.response.errorMessage ?? 'Request failed',
                  operation: 'api.sendRequest',
                  retryable: true,
                },
          };
          break;

        case 'stream-open':
          next = {
            ...base,
            inFlight: true,
            protocol: event.protocol,
            streamStatus: event.status,
            subprotocol: event.subprotocol,
            entries: base.entries ?? [],
            dropped: base.dropped ?? 0,
          };
          break;

        case 'stream-entries': {
          // Capped before insertion so a flood cannot grow renderer memory without bound.
          const merged = [...(base.entries ?? []), ...event.entries];
          next = {
            ...base,
            entries: merged.length > STREAM_ENTRY_CAP ? merged.slice(-STREAM_ENTRY_CAP) : merged,
            dropped: event.dropped,
          };
          break;
        }

        case 'stream-status':
          next = {
            ...base,
            streamStatus: event.status,
            inFlight: event.status === 'open' || event.status === 'connecting',
            closeCode: event.code ?? base.closeCode,
            closeReason: event.reason ?? base.closeReason,
            error: event.errorCode
              ? {
                  code: event.errorCode as BureauError['code'],
                  message: event.errorMessage ?? 'The stream failed.',
                  operation: 'api.openStream',
                  retryable: true,
                }
              : base.error,
          };
          break;
      }

      return { sessions: { ...state.sessions, [event.sessionId]: next } };
    });

    if (event.type === 'complete' && get().activeWorkspaceId === event.workspaceId) {
      void get().loadHistory(event.workspaceId);
    }
  },

  /* ------------------------------------- Phase 4: scripts and the collection runner */

  async validateScript(requestId, phase, source) {
    const key = `${requestId}:${phase}`;
    if (source.trim().length === 0) {
      set((state) => {
        const next = { ...state.scriptValidation };
        delete next[key];
        return { scriptValidation: next };
      });
      return;
    }
    const result = await api().validateScript({ source, phase });
    set((state) => ({ scriptValidation: { ...state.scriptValidation, [key]: result } }));
  },

  async openScriptApproval(collectionId) {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) return;
    set({
      scriptApproval: { open: true, collectionId, locations: [], busy: true, error: null },
    });
    const result = await api().listScriptLocations({ workspaceId, collectionId });
    set((state) => ({
      scriptApproval: {
        ...state.scriptApproval,
        busy: false,
        locations: result.ok ? result.locations : [],
        error: result.ok ? null : result.error,
      },
    }));
  },

  closeScriptApproval() {
    set({ scriptApproval: { open: false, collectionId: null, locations: [], busy: false, error: null } });
  },

  async approveScripts(enabled) {
    const state = get();
    const workspaceId = state.activeWorkspaceId;
    const snapshot = workspaceId ? state.workspaceSnapshots[workspaceId]?.snapshot : null;
    if (!workspaceId || !snapshot) return;
    set((current) => ({ scriptApproval: { ...current.scriptApproval, busy: true, error: null } }));
    const result = await api().approveScripts({
      workspaceId,
      collectionId: state.scriptApproval.collectionId,
      enabled,
      // The reviewed list belongs to this revision; a concurrent edit must reject the approval.
      expectedRevision: snapshot.summary.revision,
    });
    if (!result.ok) {
      set((current) => ({
        scriptApproval: { ...current.scriptApproval, busy: false, error: result.error },
      }));
      return;
    }
    await get().refreshActiveWorkspace();
    get().closeScriptApproval();
  },

  setRunnerOpen(open) {
    if (open) ensureRunSubscription();
    set({ runnerOpen: open, runError: null });
  },

  async chooseRunData() {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) return;
    set({ runDataBusy: true, runError: null });
    const result = await api().loadRunData({ workspaceId });
    if (!result.ok) {
      set({ runDataBusy: false, runError: result.error });
      return;
    }
    // A cancelled picker leaves the previous selection alone.
    set((state) => ({
      runDataBusy: false,
      runData: result.data ?? state.runData,
    }));
  },

  async clearRunData() {
    const current = get().runData;
    set({ runData: null });
    if (current) await api().clearRunData({ dataSetId: current.dataSetId });
  },

  async startRun(config) {
    const state = get();
    const workspaceId = state.activeWorkspaceId;
    if (!workspaceId) return;
    ensureRunSubscription();
    set({ runError: null, activeRun: null });
    const result = await api().startRun({
      ...config,
      workspaceId,
      dataSetId: state.runData?.dataSetId,
    });
    if (!result.ok) {
      set({ runError: result.error });
      return;
    }
    // The run-started event fills in the plan; this keeps the panel from looking idle until then.
    set({
      activeRun: {
        runId: result.runId,
        status: 'running',
        plannedItems: 0,
        completed: 0,
        items: [],
        scriptsEnabled: false,
        report: null,
        lastSeq: 0,
      },
    });
  },

  async cancelRun() {
    const run = get().activeRun;
    if (!run || run.status !== 'running') return;
    await api().cancelRun({ runId: run.runId });
  },

  async exportRunReport(format) {
    const run = get().activeRun;
    if (!run) return;
    const result = await api().exportRunReport({ runId: run.runId, format });
    if (!result.ok) set({ runError: result.error });
  },

  dismissRun() {
    set({ activeRun: null, runError: null });
  },

  handleRunEvent(event) {
    set((state) => {
      const existing = state.activeRun;
      // A run other than the one this window is watching (or a stale duplicate) is ignored.
      if (existing && existing.runId !== event.runId) return state;
      if (existing && event.seq <= existing.lastSeq) return state;

      if (event.type === 'run-started') {
        return {
          activeRun: {
            runId: event.runId,
            status: 'running',
            plannedItems: event.plannedItems,
            completed: 0,
            items: [],
            scriptsEnabled: event.scriptsEnabled,
            report: null,
            lastSeq: event.seq,
          },
        };
      }
      if (!existing) return state;
      if (event.type === 'run-item') {
        return {
          activeRun: {
            ...existing,
            completed: event.completed,
            items: [...existing.items, event.item],
            lastSeq: event.seq,
          },
        };
      }
      return {
        activeRun: {
          ...existing,
          status: event.report.status,
          completed: event.report.items.length,
          items: event.report.items,
          scriptsEnabled: event.report.scriptsEnabled,
          report: event.report,
          lastSeq: event.seq,
        },
      };
    });
  },

  /* ------------------------ Phase 5: cookies, proxy profiles, backup and restore */

  async loadCookies(jarId) {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) return;
    const targetJar = jarId ?? get().activeCookieJarId;
    set({ cookiesLoading: true, activeCookieJarId: targetJar });
    const [jars, cookies] = await Promise.all([
      api().listCookieJars({ workspaceId }),
      api().listCookies({ workspaceId, jarId: targetJar || undefined }),
    ]);
    // A workspace switch mid-flight must not paint another workspace's cookies.
    if (get().activeWorkspaceId !== workspaceId) return;
    set({ cookiesLoading: false, cookieJars: jars.jars, cookies: cookies.cookies });
  },

  async deleteCookie(cookie) {
    const state = get();
    const workspaceId = state.activeWorkspaceId;
    if (!workspaceId) return;
    await api().deleteCookie({
      workspaceId,
      jarId: state.activeCookieJarId || undefined,
      name: cookie.name,
      domain: cookie.domain,
      path: cookie.path,
    });
    await get().loadCookies();
  },

  async clearCookies() {
    const state = get();
    const workspaceId = state.activeWorkspaceId;
    if (!workspaceId) return;
    await api().clearCookies({ workspaceId, jarId: state.activeCookieJarId || undefined });
    await get().loadCookies();
  },

  async saveCookie(cookie) {
    const state = get();
    const workspaceId = state.activeWorkspaceId;
    if (!workspaceId) return;
    await api().saveCookie({ workspaceId, jarId: state.activeCookieJarId || undefined, cookie });
    await get().loadCookies();
  },

  async saveProxyProfile(input) {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) return;
    const result = await api().saveProxyProfile({ ...input, workspaceId });
    if (result.ok) await get().refreshActiveWorkspace();
  },

  async deleteProxyProfile(profileId, expectedRevision) {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) return;
    const result = await api().deleteProxyProfile({ workspaceId, profileId, expectedRevision });
    if (result.ok) await get().refreshActiveWorkspace();
  },

  async setDefaultProxyProfile(profileId) {
    const snapshot = activeSnapshot(get);
    const workspaceId = get().activeWorkspaceId;
    if (!snapshot || !workspaceId) return;
    const result = await api().updateWorkspace({
      workspaceId,
      expectedRevision: snapshot.summary.revision,
      defaultProxyProfileId: profileId,
    });
    if (result.ok) await get().refreshActiveWorkspace();
  },

  async backupWorkspaces() {
    set({ restoreBusy: true, restoreError: null });
    const result = await api().backupWorkspaces();
    set({ restoreBusy: false, restoreError: result.ok ? null : result.error });
  },

  async planRestore() {
    set({ restoreBusy: true, restoreError: null, restoreReport: null });
    const result = await api().planRestore();
    if (!result.ok) {
      set({ restoreBusy: false, restoreError: result.error });
      return;
    }
    // A cancelled picker leaves the dialog as it was rather than showing an empty plan.
    set({ restoreBusy: false, restorePlan: result.plan });
  },

  async commitRestore(mode) {
    const plan = get().restorePlan;
    if (!plan) return;
    set({ restoreBusy: true, restoreError: null });
    const result = await api().commitRestore({ restoreId: plan.restoreId, mode });
    if (!result.ok) {
      set({ restoreBusy: false, restoreError: result.error });
      return;
    }
    set({ restoreBusy: false, restorePlan: null, restoreReport: result.report });
    await get().loadWorkspaces();
  },

  cancelRestore() {
    set({ restorePlan: null, restoreError: null, restoreBusy: false });
  },

  reset() {
    sessionSubscriptionStarted = false;
    oauthSubscriptionStarted = false;
    runSubscriptionStarted = false;
    set({
      loadState: 'idle',
      workspaces: [],
      activeWorkspaceId: null,
      error: null,
      listGeneration: get().listGeneration + 1,
      workspaceSnapshots: {},
      documents: {},
      openDocumentIds: [],
      activeRequestId: null,
      openAuxIds: [],
      activeAuxId: null,
      pendingConfirm: undefined,
      sessions: {},
      histories: {},
      secrets: [],
      secretsLoadState: 'idle',
      secretStorageAvailable: true,
      sidebarMode: 'collections',
      expandedCollectionIdsByWorkspace: {},
      activeEnvironmentId: null,
      relinkPickerOpen: false,
      graphqlSchemas: {},
      introspecting: false,
      introspectError: null,
      introspectGeneration: get().introspectGeneration + 1,
      oauthPhases: {},
      importPreview: null,
      importBusy: false,
      importError: null,
      importReport: null,
      exportPlan: null,
      exportBusy: false,
      exportError: null,
      runnerOpen: false,
      runData: null,
      runDataBusy: false,
      activeRun: null,
      runError: null,
      scriptApproval: { open: false, collectionId: null, locations: [], busy: false, error: null },
      scriptValidation: {},
      cookieJars: [],
      activeCookieJarId: '',
      cookies: [],
      cookiesLoading: false,
      restorePlan: null,
      restoreBusy: false,
      restoreError: null,
      restoreReport: null,
    });
  },
}));

let reportedDirtyDrafts = -1;
useApiStore.subscribe((state) => {
  const count = Object.values(state.documents).filter((document) => document.dirty).length;
  if (count === reportedDirtyDrafts) return;
  const setter = window.bureau?.api?.setDirtyDraftCount;
  if (!setter) return;
  reportedDirtyDrafts = count;
  void setter({ count });
});

export function selectActiveApiSnapshot(state: ApiStoreState): ApiWorkspaceSnapshot | null {
  const workspaceId = state.activeWorkspaceId;
  if (!workspaceId) return null;
  return state.workspaceSnapshots[workspaceId]?.snapshot ?? null;
}

export function selectCollectionTree(
  collections: ApiCollectionNode[],
  expandedFolderIds?: readonly ApiEntityId[]
): Array<ApiCollectionNode & { depth: number; hasChildren: boolean; expanded: boolean }> {
  const byParent = new Map<string | null, ApiCollectionNode[]>();
  for (const node of collections) {
    const key = node.parentId;
    const bucket = byParent.get(key) ?? [];
    bucket.push(node);
    byParent.set(key, bucket);
  }
  for (const bucket of byParent.values()) {
    bucket.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }
  const rows: Array<
    ApiCollectionNode & { depth: number; hasChildren: boolean; expanded: boolean }
  > = [];
  const expanded = expandedFolderIds ? new Set(expandedFolderIds) : null;
  const walk = (parentId: string | null, depth: number): void => {
    for (const node of byParent.get(parentId) ?? []) {
      const hasChildren = (byParent.get(node.collectionId) ?? []).length > 0;
      const isExpanded =
        node.kind === 'folder' &&
        hasChildren &&
        (expanded ? expanded.has(node.collectionId) : parentId === null);
      rows.push({ ...node, depth, hasChildren, expanded: isExpanded });
      if (node.kind === 'folder') {
        if (isExpanded) walk(node.collectionId, depth + 1);
      }
    }
  };
  walk(null, 0);
  return rows;
}

export function newKeyValue(name = '', value = ''): ApiKeyValue {
  return {
    id: crypto.randomUUID(),
    name,
    value,
    enabled: true,
  };
}

export function defaultAuth(): ApiAuth {
  return { kind: 'none' };
}

export function defaultBody(): ApiBody {
  return { kind: 'none' };
}

export function defaultSettings(): ApiRequestSettings {
  return {
    followRedirects: true,
    sendUnresolvedLiterals: false,
  };
}
