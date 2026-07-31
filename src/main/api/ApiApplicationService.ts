import { randomUUID } from 'node:crypto';
import type {
  ApiCancelRequestInput,
  ApiCloseStreamInput,
  ApiCollectionNode,
  ApiCreateCollectionInput,
  ApiCreateEnvironmentInput,
  ApiCreateWorkspaceInput,
  ApiDeleteOAuthProfileInput,
  ApiDeleteTlsProfileInput,
  ApiApproveScriptsInput,
  ApiCancelRunInput,
  ApiClearCookiesInput,
  ApiCookie,
  ApiCookieJarSummary,
  ApiSaveCookieInput,
  ApiDeleteCookieInput,
  ApiListCookiesInput,
  ApiCommitExportInput,
  ApiCommitImportInput,
  ApiEntityId,
  ApiEnvironment,
  ApiExportRunReportInput,
  ApiExportPlan,
  ApiExportPlanInput,
  ApiGraphqlSchemaSummary,
  ApiImportPreview,
  ApiImportReport,
  ApiInspectImportInput,
  ApiHistorySummary,
  ApiIntrospectGraphqlInput,
  ApiOAuthProfile,
  ApiOAuthProfileRefInput,
  ApiOAuthStateEvent,
  ApiOpenStreamInput,
  ApiOpenStreamResult,
  ApiProxyProfile,
  ApiRequestDefinition,
  ApiResponsePreview,
  ApiCommitRestoreInput,
  ApiRestorePlan,
  ApiRestoreReport,
  ApiRunConfig,
  ApiRunDataSummary,
  ApiRunEvent,
  ApiRunReport,
  ApiRunReportRefInput,
  ApiScriptLocation,
  ApiScriptOutcome,
  ApiScripts,
  ApiScriptPhase,
  ApiSessionProgressEvent,
  ApiValidateScriptInput,
  ApiValidateScriptResult,
  ApiSaveOAuthProfileInput,
  ApiSaveProxyProfileInput,
  ApiDeleteProxyProfileInput,
  ApiSaveRequestInput,
  ApiSaveSecretInput,
  ApiSaveTlsProfileInput,
  ApiSecretSummary,
  ApiSendRequestInput,
  ApiSendRequestResult,
  ApiSendStreamMessageInput,
  ApiSessionEvent,
  ApiStreamEntry,
  ApiTlsProfile,
  ApiUpdateCollectionInput,
  ApiUpdateEnvironmentInput,
  ApiUpdateWorkspaceInput,
  ApiVariableDefinition,
  ApiWorkbenchStatus,
  ApiWorkspaceIndex,
  ApiWorkspaceSnapshot,
} from '@shared/contracts/apiWorkbench';
import type { BureauError, OkResult } from '@shared/contracts/errors';
import type { ApiSettings } from '@shared/contracts/settings';
import type { SecretCipher } from '../gitea/GiteaCredentialStore';
import type { ProjectCatalogue } from '../projects/ProjectCatalogue';
import type { SettingsStore } from '../settings/SettingsStore';
import type { NativeDialogAdapter } from '../system/dialogAdapter';
import type { AtomicJsonStore } from '../storage/AtomicJsonStore';
import { toBureauError } from '../ipc/errors';
import { createApiPersistence } from './ApiPersistence';
import { createApiHistoryStore } from './ApiHistoryStore';
import { createApiSecretStore } from './ApiSecretStore';
import {
  createApiWorkspaceStore,
  sanitizeIncomingVariables,
  type ApiWorkspaceFileV1,
} from './ApiWorkspaceStore';
import { createApiSessionRegistry } from './ApiSessionRegistry';
import { createStreamSessionRegistry, BINARY_HANDLE_THRESHOLD } from './ApiStreamSessions';
import { createPersistentCookieJarRegistry } from './CookieJarStore';
import { compileApiRequest } from './ApiRequestCompiler';
import { executeHttpTransport } from './HttpTransport';
import { createResponseBodyStore } from './ResponseBodyStore';
import { createOAuthService, type OAuthTokensFileV1 } from './OAuthService';
import { introspectGraphqlSchema, parseGraphqlErrors } from './GraphqlTransport';
import { openWebSocketSession } from './WebSocketTransport';
import {
  CONNECTION_ACK_TIMEOUT_MS,
  GRAPHQL_WS_SUBPROTOCOL,
  connectionInit,
  graphqlEventToEntry,
  parseGraphqlWsMessage,
  subscribeMessage,
} from './GraphqlSubscription';
import { createImportService } from './import/ImportService';
import { createExportService } from './export/ExportService';
import { createBackupService, emptyRestoreReport } from './BackupService';
import type { HarHistoryEntry } from './export/HarExporter';
import { createSseParser, sseEventToEntry } from './SseTransport';
import { scriptVariableBag, type VariableResolverInput } from './VariableResolver';
import { createScriptSandbox } from './script/ScriptSandbox';
import type { ScriptContext } from './script/protocol';
import {
  basicProxyAuthorization,
  resolveProxy,
  type ProxyEnvironment,
  type ResolvedProxy,
} from './ProxyPolicy';
import { MAX_GUEST_BODY_BYTES } from './script/limits';
import { scriptLocations, scriptsForRequest } from './script/scriptHolders';
import { createCollectionRunner, resolveRunOrder } from './script/CollectionRunner';
import { createRunDataStore } from './script/RunDataStore';
import { runReportToJUnit, runReportToJson } from './script/runReport';

type SecretsFileV1 = {
  schemaVersion: 1;
  secrets: Array<{ secretId: string; label: string; tokenCipher?: string; updatedAt: string }>;
  updatedAt: string;
};

type Envelope<T> = ({ ok: true } & T) | { ok: false; error: BureauError };
type SnapshotResult = Envelope<{ snapshot: ApiWorkspaceSnapshot }>;

export type ApiApplicationService = {
  getStatus(): Promise<ApiWorkbenchStatus>;
  listWorkspaces(): Promise<ApiWorkspaceIndex>;
  getWorkspace(workspaceId: string): Promise<ApiWorkspaceSnapshot | null>;
  createWorkspace(input: ApiCreateWorkspaceInput): Promise<ApiWorkspaceSnapshot>;
  updateWorkspace(input: ApiUpdateWorkspaceInput): Promise<SnapshotResult>;
  deleteWorkspace(workspaceId: string, expectedRevision: number): Promise<OkResult>;
  createCollection(
    input: ApiCreateCollectionInput
  ): Promise<Envelope<{ snapshot: ApiWorkspaceSnapshot; collectionId: ApiEntityId; requestId?: ApiEntityId }>>;
  updateCollection(input: ApiUpdateCollectionInput): Promise<SnapshotResult>;
  deleteCollection(
    workspaceId: string,
    collectionId: string,
    expectedRevision: number
  ): Promise<SnapshotResult>;
  saveRequest(input: ApiSaveRequestInput): Promise<SnapshotResult>;
  deleteRequest(workspaceId: string, requestId: string, expectedRevision: number): Promise<SnapshotResult>;
  createEnvironment(
    input: ApiCreateEnvironmentInput
  ): Promise<Envelope<{ snapshot: ApiWorkspaceSnapshot; environmentId: ApiEntityId }>>;
  updateEnvironment(input: ApiUpdateEnvironmentInput): Promise<SnapshotResult>;
  deleteEnvironment(
    workspaceId: string,
    environmentId: string,
    expectedRevision: number
  ): Promise<SnapshotResult>;
  listSecrets(): ApiSecretSummary[];
  saveSecret(input: ApiSaveSecretInput): Promise<Envelope<{ summary: ApiSecretSummary }>>;
  deleteSecret(secretId: string): Promise<OkResult>;
  listHistory(workspaceId: string): ApiHistorySummary[];
  getHistoryEntry(historyId: string): ReturnType<ReturnType<typeof createApiHistoryStore>['getEntry']>;
  sendRequest(input: ApiSendRequestInput): Promise<ApiSendRequestResult>;
  cancelRequest(input: ApiCancelRequestInput): Promise<OkResult>;

  // Phase 2
  openStream(input: ApiOpenStreamInput): Promise<ApiOpenStreamResult>;
  sendStreamMessage(input: ApiSendStreamMessageInput): Promise<OkResult>;
  closeStream(input: ApiCloseStreamInput): Promise<OkResult>;
  setStreamPaused(input: { sessionId: string; paused: boolean }): Promise<OkResult>;
  getStreamSnapshot(
    sessionId: string
  ): Promise<Envelope<{ entries: ApiStreamEntry[]; dropped: number; status: string }>>;
  introspectGraphql(
    input: ApiIntrospectGraphqlInput
  ): Promise<Envelope<{ schema: ApiGraphqlSchemaSummary }>>;
  saveTlsProfile(input: ApiSaveTlsProfileInput): Promise<Envelope<{ profileId: ApiEntityId }>>;
  deleteTlsProfile(input: ApiDeleteTlsProfileInput): Promise<OkResult>;
  backupWorkspaces(): Promise<Envelope<{ written: boolean }>>;
  planRestore(): Promise<Envelope<{ plan: ApiRestorePlan | null }>>;
  commitRestore(input: ApiCommitRestoreInput): Promise<Envelope<{ report: ApiRestoreReport }>>;
  saveProxyProfile(input: ApiSaveProxyProfileInput): Promise<Envelope<{ profileId: ApiEntityId }>>;
  deleteProxyProfile(input: ApiDeleteProxyProfileInput): Promise<OkResult>;
  listCookieJars(workspaceId: string): ApiCookieJarSummary[];
  listCookies(input: ApiListCookiesInput): ApiCookie[];
  deleteCookie(input: ApiDeleteCookieInput): OkResult;
  clearCookies(input: ApiClearCookiesInput): OkResult;
  saveCookie(input: ApiSaveCookieInput): OkResult;
  saveOAuthProfile(input: ApiSaveOAuthProfileInput): Promise<Envelope<{ profileId: ApiEntityId }>>;
  deleteOAuthProfile(input: ApiDeleteOAuthProfileInput): Promise<OkResult>;
  authorizeOAuth(input: ApiOAuthProfileRefInput): Promise<OkResult>;
  cancelOAuth(input: ApiOAuthProfileRefInput): Promise<OkResult>;
  clearOAuthToken(input: ApiOAuthProfileRefInput): Promise<OkResult>;

  // Phase 3
  inspectImport(
    input: ApiInspectImportInput
  ): Promise<Envelope<{ preview: ApiImportPreview }>>;
  commitImport(input: ApiCommitImportInput): Promise<Envelope<{ report: ApiImportReport }>>;
  discardImport(previewId: string): void;
  planExport(input: ApiExportPlanInput): Promise<Envelope<{ plan: ApiExportPlan }>>;
  commitExport(input: ApiCommitExportInput): Promise<Envelope<{ written: boolean }>>;

  // Phase 4
  validateScript(input: ApiValidateScriptInput): Promise<ApiValidateScriptResult>;
  listScriptLocations(input: {
    workspaceId: string;
    collectionId: string | null;
  }): Promise<Envelope<{ locations: ApiScriptLocation[] }>>;
  approveScripts(input: ApiApproveScriptsInput): Promise<Envelope<{ changed: number }>>;
  loadRunData(input: { workspaceId: string }): Promise<Envelope<{ data: ApiRunDataSummary | null }>>;
  clearRunData(dataSetId: string): void;
  startRun(config: ApiRunConfig): Promise<Envelope<{ runId: ApiEntityId }>>;
  cancelRun(input: ApiCancelRunInput): Promise<OkResult>;
  getRunReport(input: ApiRunReportRefInput): Promise<Envelope<{ report: ApiRunReport }>>;
  exportRunReport(input: ApiExportRunReportInput): Promise<Envelope<{ written: boolean }>>;

  setDirtyDraftCount(count: number): void;
  dirtyDraftCount(): number;
  unlinkProject(projectId: string): Promise<void>;
  onSessionEvent(listener: (event: ApiSessionEvent) => void): () => void;
  onOAuthEvent(listener: (event: ApiOAuthStateEvent) => void): () => void;
  onRunEvent(listener: (event: ApiRunEvent) => void): () => void;
  dispose(): void;
};

export type ApiApplicationServiceDeps = {
  dataPath: string;
  cipher: SecretCipher;
  settingsStore: SettingsStore;
  catalogue: ProjectCatalogue;
  /** Opens the system browser for OAuth. Injected so headless tests never shell out. */
  openExternal(url: string): Promise<void>;
  /** Main-owned file pickers; the renderer never supplies a filesystem path. */
  dialog: NativeDialogAdapter;
};

function isBinaryBuffer(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 512));
  for (const byte of sample) {
    if (byte === 0) return true;
  }
  return false;
}

function folderVariableLayers(
  file: ApiWorkspaceFileV1,
  collectionId: string | null
): ApiVariableDefinition[][] {
  const layers: ApiVariableDefinition[][] = [];
  let currentId = collectionId;
  while (currentId) {
    const node = file.collections.find((entry) => entry.collectionId === currentId);
    if (!node) break;
    layers.unshift(node.variables);
    currentId = node.parentId;
  }
  return layers;
}

/**
 * What a script sees as `bureau.request.body`. Structured bodies are handed over as the text the
 * user typed, not as a compiled buffer: the guest heap is 16-32 MiB, so the body is a bounded head.
 */
function scriptBodyPreview(body: ApiRequestDefinition['body']): string | undefined {
  switch (body.kind) {
    case 'json':
    case 'text':
    case 'xml':
    case 'html':
      return body.text.slice(0, MAX_GUEST_BODY_BYTES);
    case 'form-urlencoded':
    case 'multipart':
      return body.fields
        .filter((field) => field.enabled)
        .map((field) => `${field.name}=${field.value}`)
        .join('&')
        .slice(0, MAX_GUEST_BODY_BYTES);
    default:
      return undefined;
  }
}

/** The response half of a script context. Bounded for the same reason as the request body. */
function scriptResponseSnapshot(preview: ApiResponsePreview): ScriptContext['response'] {
  return {
    ok: preview.ok,
    status: preview.status,
    statusText: preview.statusText,
    url: preview.url,
    headers: preview.headers,
    body: preview.bodyText?.slice(0, MAX_GUEST_BODY_BYTES),
    totalMs: preview.timings.totalMs,
  };
}

/**
 * Applies a script patch without letting it enable untrusted source.
 *
 * A save may edit script text freely and may always *disable* — but turning imported source on has
 * exactly one entry point, `approveScripts`, which shows the reviewer what they are enabling and
 * checks the workspace revision. Enforcing that here rather than in the composer means a crafted
 * IPC payload cannot do what the disabled checkbox refuses to.
 */
function mergeScripts(current: ApiScripts, patch: ApiScripts | undefined): ApiScripts {
  if (!patch) return current;
  const origin = current.origin ?? patch.origin;
  const enabled =
    origin === 'imported' && current.enabled !== true ? false : (patch.enabled ?? current.enabled);
  return { ...current, ...patch, origin, enabled };
}

function notFound(code: BureauError['code'], message: string, operation: string, subjectId?: string) {
  return { ok: false as const, error: toBureauError({ code, message, operation, subjectId, retryable: false }) };
}

function staleState(operation: string, subjectId: string) {
  return {
    error: toBureauError({
      code: 'STALE_STATE' as const,
      message: 'The record was modified elsewhere. Reload and try again.',
      operation,
      subjectId,
      retryable: true,
    }),
  };
}

export async function createApiApplicationService(
  deps: ApiApplicationServiceDeps
): Promise<ApiApplicationService> {
  const persistence = await createApiPersistence(deps.dataPath);
  const workspaces = createApiWorkspaceStore(persistence);
  const secrets = createApiSecretStore(
    persistence.secretsStore as AtomicJsonStore<SecretsFileV1>,
    deps.cipher
  );
  const history = createApiHistoryStore(persistence);
  const sessions = createApiSessionRegistry();
  const cookieJars = createPersistentCookieJarRegistry(
    persistence.cookiesStore,
    deps.cipher
  );
  await cookieJars.ready;
  const streamBodies = createResponseBodyStore(persistence.historyBodiesDir);
  const sessionListeners = new Set<(event: ApiSessionEvent) => void>();
  const oauthListeners = new Set<(event: ApiOAuthStateEvent) => void>();
  const runListeners = new Set<(event: ApiRunEvent) => void>();
  let dirtyDrafts = 0;

  function emit(event: ApiSessionEvent): void {
    for (const listener of sessionListeners) listener(event);
  }
  function emitOAuth(event: ApiOAuthStateEvent): void {
    for (const listener of oauthListeners) listener(event);
  }
  function emitRun(event: ApiRunEvent): void {
    for (const listener of runListeners) listener(event);
  }

  const oauth = createOAuthService(
    persistence.oauthTokensStore as AtomicJsonStore<OAuthTokensFileV1>,
    deps.cipher,
    { openExternal: deps.openExternal }
  );
  const streams = createStreamSessionRegistry(emit, sessions);
  const imports = createImportService(deps.dialog);
  const exports = createExportService(deps.dialog);
  const sandbox = createScriptSandbox();
  const runData = createRunDataStore(deps.dialog);
  const backups = createBackupService(deps.dialog);

  function apiSettings(): ApiSettings {
    return deps.settingsStore.get().api;
  }

  function linkedInfo(file: ApiWorkspaceFileV1): {
    name?: string;
    stale?: boolean;
    oauthTokens: ReturnType<typeof oauth.tokenStatuses>;
  } {
    const oauthTokens = oauth.tokenStatuses(
      (file.oauthProfiles ?? []).map((profile) => profile.profileId)
    );
    const linkedProjectId = file.summary.linkedProjectId;
    if (!linkedProjectId) return { oauthTokens };
    const project = deps.catalogue.get(linkedProjectId);
    if (!project) return { stale: true, oauthTokens };
    return { name: project.name, oauthTokens };
  }

  async function snapshotFromFile(file: ApiWorkspaceFileV1): Promise<ApiWorkspaceSnapshot> {
    return (await workspaces.getSnapshot(file.summary.workspaceId, linkedInfo(file)))!;
  }

  async function getWorkspace(workspaceId: string): Promise<ApiWorkspaceSnapshot | null> {
    const file = await workspaces.getFile(workspaceId);
    if (!file) return null;
    return workspaces.getSnapshot(workspaceId, linkedInfo(file));
  }

  /** Wraps a `mutateWorkspace` result into the snapshot envelope every CRUD handler returns. */
  async function toSnapshotResult(
    result: Awaited<ReturnType<typeof workspaces.mutateWorkspace>>
  ): Promise<SnapshotResult> {
    if (!result.ok) return result;
    return { ok: true, snapshot: await snapshotFromFile(result.file) };
  }

  // ------------------------------------------------------------------ compilation

  type PreparedRequest = {
    context: RequestContext;
    request: ApiRequestDefinition;
    file: ApiWorkspaceFileV1;
    compiled: ReturnType<typeof compileApiRequest>;
    tls: { profile: ApiTlsProfile | null; clientKeyPem?: string; passphrase?: string };
  };

  /**
   * Everything a request needs except the compilation itself. Split out from `prepare` because a
   * pre-request script runs *before* compiling — its variable writes are what the templates then
   * resolve against — and it needs this context to build the bag the script sees.
   */
  type RequestContext = {
    file: ApiWorkspaceFileV1;
    request: ApiRequestDefinition;
    environment?: ApiEnvironment;
    collection?: ApiCollectionNode;
    activeTls: ApiTlsProfile | null;
    activeProxy: ApiProxyProfile | null;
  };

  /** Values a script (and a run's data row) contributes, above every stored scope. */
  type RuntimeLayers = {
    runtimeValues?: Map<string, string>;
    iterationValues?: Map<string, string>;
  };

  /**
   * Merges the draft over the saved definition and resolves the OAuth token (the only async step).
   */
  async function loadContext(
    input: ApiSendRequestInput | ApiOpenStreamInput,
    operation: string
  ): Promise<{ ok: true; context: RequestContext } | { ok: false; error: BureauError }> {
    const file = await workspaces.getFile(input.workspaceId);
    if (!file) {
      return notFound('API_WORKSPACE_NOT_FOUND', 'API workspace not found.', operation, input.workspaceId);
    }
    const saved = file.requests.find((request) => request.requestId === input.requestId);
    if (!saved) {
      return notFound('API_REQUEST_NOT_FOUND', 'Request not found.', operation, input.requestId);
    }

    const request: ApiRequestDefinition = {
      ...saved,
      ...input.draft,
      settings: { ...saved.settings, ...input.draft?.settings },
      protocolOptions: { ...saved.protocolOptions, ...input.draft?.protocolOptions },
      scripts: {
        ...saved.scripts,
        ...input.draft?.scripts,
        // A draft may iterate on script *source*, but whether scripts run is only ever read from
        // the saved definition. Otherwise a draft could enable an imported script that was never
        // approved, and enabling would stop being a persisted, reviewable act.
        enabled: saved.scripts.enabled,
        origin: saved.scripts.origin,
      } satisfies ApiScripts,
    };

    const environmentId =
      input.environmentId === null ? undefined : (input.environmentId ?? file.summary.activeEnvironmentId);
    const environment = file.environments.find((entry) => entry.environmentId === environmentId);
    const collection = file.collections.find((node) => node.requestId === input.requestId);

    // OAuth is resolved (and refreshed) before compiling so the compiler stays synchronous.
    const effectiveAuth = request.auth.kind === 'inherit' ? file.auth : request.auth;
    if (effectiveAuth.kind === 'oauth2') {
      const profile = (file.oauthProfiles ?? []).find(
        (entry) => entry.profileId === effectiveAuth.profileId
      );
      if (!profile) {
        return notFound(
          'API_OAUTH_FAILED',
          'The OAuth profile referenced by this request no longer exists.',
          operation,
          effectiveAuth.profileId
        );
      }
      const clientSecret = profile.clientSecretId
        ? secrets.getPlaintext(profile.clientSecretId)
        : undefined;
      const token = await oauth.ensureAccessToken(profile, clientSecret);
      if (!token.ok) return { ok: false, error: token.error };
    }

    const tlsProfileId = request.protocolOptions.tlsProfileId;
    const tlsProfile = tlsProfileId
      ? ((file.tlsProfiles ?? []).find((entry) => entry.profileId === tlsProfileId) ?? null)
      : null;
    // An imported or disabled profile must not silently take effect.
    const activeTls = tlsProfile?.enabled ? tlsProfile : null;

    // Request-scoped selection wins over the workspace default (§11.3).
    const proxyProfileId =
      request.protocolOptions.proxyProfileId ?? file.summary.defaultProxyProfileId;
    const proxyProfile = proxyProfileId
      ? ((file.proxyProfiles ?? []).find((entry) => entry.profileId === proxyProfileId) ?? null)
      : null;
    const activeProxy = proxyProfile?.enabled ? proxyProfile : null;

    return {
      ok: true,
      context: { file, request, environment, collection, activeTls, activeProxy },
    };
  }

  /** Builds the resolver input for a context, with the script/iteration layers on top. */
  function variableInputFor(
    context: RequestContext,
    layers: RuntimeLayers
  ): VariableResolverInput {
    return {
      requestVariables: context.request.variables,
      folderVariables: folderVariableLayers(context.file, context.collection?.collectionId ?? null),
      environmentVariables: context.environment?.variables ?? [],
      workspaceVariables: context.file.variables,
      runtimeValues: layers.runtimeValues,
      iterationValues: layers.iterationValues,
      sendUnresolvedLiterals: context.request.settings.sendUnresolvedLiterals ?? false,
      resolveSecret: (secretId) => secrets.getPlaintext(secretId),
    };
  }

  /**
   * Resolves the proxy for one URL, attaching credentials from the vault. Kept in the service
   * rather than the transport so the transport never touches the secret store.
   */
  function proxyFor(context: RequestContext, url: string): ResolvedProxy {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { kind: 'direct' };
    }
    const resolved = resolveProxy(parsed, context.activeProxy, process.env as ProxyEnvironment);
    if (resolved.kind === 'direct') return resolved;
    if (resolved.kind === 'socks5' && resolved.credentials) return resolved;
    if (resolved.authorization) return resolved;
    const profile = context.activeProxy;
    const password = profile?.passwordSecretId
      ? secrets.getPlaintext(profile.passwordSecretId)
      : undefined;
    if (!profile?.username && !password) return resolved;
    if (resolved.kind === 'socks5') {
      return {
        ...resolved,
        credentials: { username: profile?.username ?? '', password: password ?? '' },
      };
    }
    return {
      ...resolved,
      authorization: basicProxyAuthorization(profile?.username ?? '', password ?? ''),
    };
  }

  /** Compilation stays synchronous and performs no network I/O. */
  function compileFrom(
    context: RequestContext,
    operation: string,
    layers: RuntimeLayers = {}
  ): PreparedRequest {
    const { file, request, activeTls } = context;
    return {
      context,
      request,
      file,
      compiled: compileApiRequest({
        request,
        workspaceAuth: file.auth,
        variableInput: variableInputFor(context, layers),
        getSecretPlaintext: (secretId) => secrets.getPlaintext(secretId),
        getOAuthAccessToken: (profileId) => oauth.cachedAccessToken(profileId),
        operation,
      }),
      tls: {
        profile: activeTls,
        clientKeyPem: activeTls?.clientKeySecretId
          ? secrets.getPlaintext(activeTls.clientKeySecretId)
          : undefined,
        passphrase: activeTls?.passphraseSecretId
          ? secrets.getPlaintext(activeTls.passphraseSecretId)
          : undefined,
      },
    };
  }

  async function prepare(
    input: ApiSendRequestInput | ApiOpenStreamInput,
    operation: string,
    layers: RuntimeLayers = {}
  ): Promise<{ ok: true; prepared: PreparedRequest } | { ok: false; error: BureauError }> {
    const loaded = await loadContext(input, operation);
    if (!loaded.ok) return loaded;
    return { ok: true, prepared: compileFrom(loaded.context, operation, layers) };
  }

  // ------------------------------------------------------------------ scripts

  /**
   * Runs every enabled script for one phase, in holder order.
   *
   * Writes accumulate into `runtimeValues` as each holder finishes, so a folder script can hand a
   * value to the request beneath it. A holder that fails stops the phase: continuing would run the
   * next script against a variable state that the failed one only half-established.
   */
  async function runScriptPhase(input: {
    context: RequestContext;
    phase: ApiScriptPhase;
    /** `runtimeValues` is mutated in place, so later holders and the compiler see earlier writes. */
    layers: RuntimeLayers & { runtimeValues: Map<string, string> };
    response?: ScriptContext['response'];
    /**
     * The compiled URL and method, once they exist. A post-response script asking for
     * `bureau.request.url` means the URL that was actually sent, not the `{{templated}}` source.
     */
    sent?: { url: string; method: string };
    signal?: AbortSignal;
  }): Promise<ApiScriptOutcome[]> {
    const { context, phase } = input;
    const runtimeValues = input.layers.runtimeValues;
    if (!apiSettings().scriptsEnabled) return [];
    const holders = scriptsForRequest(context.file, context.request, context.collection, phase);
    if (holders.length === 0) return [];

    const outcomes: ApiScriptOutcome[] = [];
    for (const holder of holders) {
      const bag = scriptVariableBag(variableInputFor(context, input.layers));
      const result = await sandbox.run({
        phase,
        holder: holder.holder,
        source: holder.source,
        secretValues: bag.secretValues,
        signal: input.signal,
        context: {
          request: {
            name: context.request.name,
            protocol: context.request.protocol,
            method: input.sent?.method ?? context.request.method,
            url: input.sent?.url ?? context.request.urlTemplate,
            headers: context.request.headers
              .filter((header) => header.enabled)
              .map((header) => ({ name: header.name, value: header.value })),
            body: scriptBodyPreview(context.request.body),
          },
          response: input.response,
          variables: bag.variables,
          secretNames: bag.secretNames,
          environmentName: context.environment?.name,
        },
      });
      for (const write of result.writes) {
        if (write.value === null) runtimeValues.delete(write.name);
        else runtimeValues.set(write.name, write.value);
      }
      outcomes.push(result.outcome);
      if (!result.outcome.ok) break;
    }
    return outcomes;
  }

  // ------------------------------------------------------------------ HTTP / GraphQL send

  type PipelineInput = {
    workspaceId: string;
    requestId: string;
    operation: string;
    context: RequestContext;
    sessionId: string;
    signal: AbortSignal;
    layers: RuntimeLayers & { runtimeValues: Map<string, string> };
    /** The collection runner's per-request timeout, which overrides the request's own. */
    timeoutOverrideMs?: number;
    onProgress?: (phase: ApiSessionProgressEvent['phase']) => void;
  };

  /**
   * One request, end to end: pre-request scripts → compile → transport → post-response scripts →
   * history. Shared by `sendRequest` and the collection runner so a run behaves exactly like a
   * manual send. Always resolves with a preview; it never throws.
   */
  async function runRequestPipeline(input: PipelineInput): Promise<ApiResponsePreview> {
    const { context, sessionId, signal, layers } = input;
    const settings = apiSettings();
    const request = context.request;

    const failure = (
      errorCode: string,
      errorMessage: string,
      extra: Partial<ApiResponsePreview> = {}
    ): ApiResponsePreview => ({
      sessionId,
      workspaceId: input.workspaceId,
      requestId: input.requestId,
      ok: false,
      status: 0,
      statusText: '',
      url: request.urlTemplate,
      method: request.method,
      headers: [],
      timings: { totalMs: 0 },
      redirects: [],
      wireBytes: 0,
      decodedBytes: 0,
      truncated: false,
      bodyIsBinary: false,
      errorCode,
      errorMessage,
      ...extra,
    });

    const scriptOutcomes: ApiScriptOutcome[] = [];

    try {
      const preOutcomes = await runScriptPhase({
        context,
        phase: 'pre-request',
        layers,
        signal,
      });
      scriptOutcomes.push(...preOutcomes);
      const failedPre = preOutcomes.find((outcome) => !outcome.ok);
      if (failedPre) {
        // The request is not sent: a pre-request script that failed may not have set the values
        // the URL, headers, or body depend on.
        return failure(
          failedPre.errorCode ?? 'API_SCRIPT_FAILED',
          failedPre.errorMessage ?? `The ${failedPre.holder.name} pre-request script failed.`,
          { scripts: scriptOutcomes }
        );
      }

      const prepared = compileFrom(context, input.operation, layers);
      if (!prepared.compiled.ok) {
        return failure(prepared.compiled.error.code, prepared.compiled.error.message, {
          scripts: scriptOutcomes.length > 0 ? scriptOutcomes : undefined,
        });
      }
      const compiled = prepared.compiled.compiled;
      const cookieJar = cookieJars.forWorkspace(
        input.workspaceId,
        context.file.summary.activeCookieJarId
      );
      const activeProxy = proxyFor(context, compiled.url);

      const transportResult = await executeHttpTransport({
        url: compiled.url,
        method: compiled.method,
        headers: compiled.headers,
        body: compiled.body,
        timeoutMs: input.timeoutOverrideMs ?? request.settings.timeoutMs ?? settings.requestTimeoutMs,
        maxRedirects: request.settings.maxRedirects ?? settings.maxRedirects,
        followRedirects: request.settings.followRedirects ?? true,
        persistResponseBytes: settings.persistResponseBytes,
        displayResponseBytes: settings.displayResponseBytes,
        signal,
        tls: prepared.tls,
        proxy: activeProxy,
        // Per-hop, so a cross-origin redirect never carries another origin's cookies.
        getCookieHeader: settings.cookiesEnabled ? (url) => cookieJar.cookieHeader(url) : undefined,
        onSetCookies: settings.cookiesEnabled
          ? (url, headers) => cookieJar.setFromResponse(url, headers)
          : undefined,
        onProgress: input.onProgress,
      });

      const bodyIsBinary = isBinaryBuffer(transportResult.body);
      const bodyText = bodyIsBinary ? undefined : transportResult.body.toString('utf8');
      const graphqlErrors =
        request.protocol === 'graphql' ? parseGraphqlErrors(bodyText) : [];

      const preview: ApiResponsePreview = {
        sessionId,
        workspaceId: input.workspaceId,
        requestId: input.requestId,
        // A GraphQL 200 carrying an `errors` array is not a success.
        ok: transportResult.ok && !transportResult.errorCode && graphqlErrors.length === 0,
        status: transportResult.status,
        statusText: transportResult.statusText,
        url: transportResult.url,
        method: transportResult.method,
        headers: transportResult.headers,
        timings: transportResult.timings,
        redirects: transportResult.redirects,
        contentType: transportResult.contentType,
        encoding: transportResult.encoding,
        wireBytes: transportResult.wireBytes,
        decodedBytes: transportResult.decodedBytes,
        truncated: transportResult.truncated,
        bodyText,
        bodyHexPreview: bodyIsBinary
          ? transportResult.body.toString('hex').slice(0, settings.displayResponseBytes * 2)
          : undefined,
        bodyIsBinary,
        tlsExceptionApplied: transportResult.tlsExceptionApplied,
        proxyUsed:
          activeProxy.kind === 'direct' ? undefined : `${activeProxy.host}:${activeProxy.port}`,
        graphqlErrors: graphqlErrors.length > 0 ? graphqlErrors : undefined,
        errorCode: transportResult.errorCode,
        errorMessage: transportResult.errorMessage,
      };

      scriptOutcomes.push(
        ...(await runScriptPhase({
          context,
          phase: 'post-response',
          layers,
          response: scriptResponseSnapshot(preview),
          sent: { url: compiled.url, method: compiled.method },
          signal,
        }))
      );
      if (scriptOutcomes.length > 0) preview.scripts = scriptOutcomes;
      // A passing response with a failing assertion is a failed request: that is the whole point
      // of writing the assertion.
      const scriptsPassed = scriptOutcomes.every(
        (outcome) => outcome.ok && outcome.tests.every((test) => test.passed)
      );
      if (!scriptsPassed) preview.ok = false;

      const historySummary = await history.record({
        workspaceId: input.workspaceId,
        requestId: input.requestId,
        name: request.name,
        response: preview,
        body: transportResult.body,
        settings,
      });
      return { ...preview, historyId: historySummary.historyId };
    } catch (error) {
      // A bug in the pipeline must still settle the session; the renderer would hang otherwise.
      return failure(
        'API_PROTOCOL_ERROR',
        error instanceof Error ? error.message : 'The request failed unexpectedly.',
        { scripts: scriptOutcomes.length > 0 ? scriptOutcomes : undefined }
      );
    }
  }

  async function sendRequest(input: ApiSendRequestInput): Promise<ApiSendRequestResult> {
    const operation = 'api.sendRequest';
    const loaded = await loadContext(input, operation);
    if (!loaded.ok) return loaded;
    const context = loaded.context;

    // A subscription is a stream, not a request; sending it as one would post the document to the
    // endpoint over HTTP and silently return the wrong thing.
    if (
      context.request.protocol === 'graphql' &&
      context.request.protocolOptions.graphql?.transport === 'WS'
    ) {
      return notFound(
        'API_PROTOCOL_ERROR',
        'This is a subscription. Use Connect rather than Send.',
        operation,
        input.requestId
      );
    }

    // With no pre-request script, nothing can change the variable state, so a broken template is
    // still reported as an envelope rather than as a session event.
    const hasPreScripts =
      apiSettings().scriptsEnabled &&
      scriptsForRequest(context.file, context.request, context.collection, 'pre-request').length > 0;
    if (!hasPreScripts) {
      const compiled = compileFrom(context, operation).compiled;
      if (!compiled.ok) return { ok: false, error: compiled.error };
    }

    const { sessionId, signal } = sessions.create({
      workspaceId: input.workspaceId,
      requestId: input.requestId,
      kind: 'request',
    });

    void (async () => {
      try {
        const response = await runRequestPipeline({
          workspaceId: input.workspaceId,
          requestId: input.requestId,
          operation,
          context,
          sessionId,
          signal,
          layers: { runtimeValues: new Map() },
          onProgress: (phase) => {
            emit({
              type: 'progress',
              sessionId,
              workspaceId: input.workspaceId,
              requestId: input.requestId,
              seq: sessions.nextSeq(sessionId),
              phase,
            });
          },
        });
        emit({
          type: 'complete',
          sessionId,
          workspaceId: input.workspaceId,
          requestId: input.requestId,
          seq: sessions.nextSeq(sessionId),
          response,
        });
      } finally {
        sessions.remove(sessionId);
      }
    })();

    return { ok: true, sessionId };
  }

  // ------------------------------------------------------------------ collection runner

  const runner = createCollectionRunner({
    emit: emitRun,
    async execute(item) {
      const operation = 'api.startRun';
      const loaded = await loadContext(
        { workspaceId: item.workspaceId, requestId: item.requestId },
        operation
      );
      if (!loaded.ok) {
        return {
          sessionId: '',
          workspaceId: item.workspaceId,
          requestId: item.requestId,
          ok: false,
          status: 0,
          statusText: '',
          url: '',
          method: '',
          headers: [],
          timings: { totalMs: 0 },
          redirects: [],
          wireBytes: 0,
          decodedBytes: 0,
          truncated: false,
          bodyIsBinary: false,
          errorCode: loaded.error.code,
          errorMessage: loaded.error.message,
        };
      }

      const { sessionId, signal: sessionSignal } = sessions.create({
        workspaceId: item.workspaceId,
        requestId: item.requestId,
        kind: 'request',
      });
      // Either the run being cancelled or the session being cancelled must stop this request.
      const linked = new AbortController();
      const abort = (): void => linked.abort();
      if (item.signal.aborted || sessionSignal.aborted) linked.abort();
      item.signal.addEventListener('abort', abort, { once: true });
      sessionSignal.addEventListener('abort', abort, { once: true });

      try {
        return await runRequestPipeline({
          workspaceId: item.workspaceId,
          requestId: item.requestId,
          operation,
          context: loaded.context,
          sessionId,
          signal: linked.signal,
          layers: {
            runtimeValues: item.runtimeValues,
            iterationValues: item.iterationValues,
          },
          timeoutOverrideMs: item.timeoutMs,
        });
      } finally {
        item.signal.removeEventListener('abort', abort);
        sessionSignal.removeEventListener('abort', abort);
        sessions.remove(sessionId);
      }
    },
  });

  // ------------------------------------------------------------------ streams

  function emitStreamStatus(
    context: { sessionId: string; workspaceId: string; requestId: string },
    status: Parameters<typeof streams.setStatus>[1],
    extra?: { code?: number; reason?: string; errorCode?: string; errorMessage?: string }
  ): void {
    streams.setStatus(context.sessionId, status);
    emit({
      type: 'stream-status',
      sessionId: context.sessionId,
      workspaceId: context.workspaceId,
      requestId: context.requestId,
      seq: sessions.nextSeq(context.sessionId),
      status,
      ...extra,
    });
  }

  async function openWebSocket(
    input: ApiOpenStreamInput,
    prepared: PreparedRequest,
    sessionId: string
  ): Promise<ApiOpenStreamResult> {
    const settings = apiSettings();
    const compiled = prepared.compiled;
    if (!compiled.ok) return { ok: false, error: compiled.error };

    const context = streams.create({
      sessionId,
      workspaceId: input.workspaceId,
      requestId: input.requestId,
      protocol: 'websocket',
      settings,
    });

    const cookieJar = cookieJars.forWorkspace(
      input.workspaceId,
      prepared.file.summary.activeCookieJarId
    );
    // http(s) templates are accepted and mapped, matching what users paste from docs.
    const wsUrl = compiled.compiled.url.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
    const options = prepared.request.protocolOptions.websocket;

    // A GraphQL request with the WS transport is a subscription: same socket engine, one extra
    // protocol layer on top.
    const graphql =
      prepared.request.protocol === 'graphql'
        ? prepared.request.protocolOptions.graphql
        : undefined;
    const isSubscription = graphql?.transport === 'WS';
    const subscriptionId = randomUUID();
    let acknowledged = false;
    let ackTimer: NodeJS.Timeout | undefined;

    const push = (entry: Omit<ApiStreamEntry, 'entryId' | 'seq' | 'at'>) => context.ring.push(entry);

    const opened = await openWebSocketSession(
      {
        url: wsUrl,
        headers: compiled.compiled.headers,
        subprotocols: isSubscription ? [GRAPHQL_WS_SUBPROTOCOL] : (options?.subprotocols ?? []),
        cookieHeader: settings.cookiesEnabled ? cookieJar.cookieHeader(wsUrl) : undefined,
        handshakeTimeoutMs: prepared.request.settings.timeoutMs ?? settings.requestTimeoutMs,
        maxPayloadBytes: settings.maxRequestBodyBytes,
        tls: prepared.tls,
        proxy: proxyFor(prepared.context, wsUrl),
      },
      {
        onOpen: () => undefined,
        onMessage: (data, isBinary) => {
          if (isSubscription && !isBinary) {
            const event = parseGraphqlWsMessage(data.toString('utf8'), subscriptionId);
            // A frame belonging to another subscription id is not ours to report.
            if (!event) return;
            if (event.kind === 'ack') {
              acknowledged = true;
              if (ackTimer) clearTimeout(ackTimer);
            }
            if (event.kind === 'ping') {
              context.send?.({ format: 'text', payload: JSON.stringify({ type: 'pong' }) });
            }
            const entry = graphqlEventToEntry(event, settings.perMessageDisplayBytes);
            if (entry) push({ ...entry, byteLength: data.byteLength });
            if (event.kind === 'complete') context.close?.(1000, 'The subscription completed.');
            return;
          }
          if (!isBinary) {
            push({ direction: 'in', kind: 'message', text: data.toString('utf8'), byteLength: data.byteLength });
            return;
          }
          if (data.byteLength <= BINARY_HANDLE_THRESHOLD) {
            push({
              direction: 'in',
              kind: 'binary',
              text: data.toString('hex'),
              byteLength: data.byteLength,
            });
            return;
          }
          // Large binary frames become a body handle instead of crossing IPC as a string.
          const bodyId = randomUUID();
          void streamBodies
            .writeBody(bodyId, data, { maxBytes: settings.persistResponseBytes })
            .then(() => {
              push({ direction: 'in', kind: 'binary', bodyId, byteLength: data.byteLength, truncated: true });
            })
            .catch(() => {
              push({ direction: 'in', kind: 'binary', byteLength: data.byteLength, truncated: true });
            });
        },
        onPing: () => push({ direction: 'in', kind: 'ping' }),
        onPong: () => push({ direction: 'in', kind: 'pong' }),
        onClose: (code, reason) => {
          push({ direction: 'system', kind: 'close', code, reason });
          context.ring.flush();
          emitStreamStatus(context, 'closed', { code, reason });
          sessions.remove(sessionId);
          streams.remove(sessionId);
        },
        onError: (code, message) => {
          push({ direction: 'system', kind: 'error', text: message });
          context.ring.flush();
          emitStreamStatus(context, 'error', { errorCode: code, errorMessage: message });
        },
      }
    );

    if (!opened.ok) {
      streams.remove(sessionId);
      sessions.remove(sessionId);
      return {
        ok: false,
        error: toBureauError({
          code: opened.code as BureauError['code'],
          message: opened.message,
          operation: 'api.openStream',
          subjectId: input.requestId,
          retryable: true,
        }),
      };
    }

    const socket = opened.session;
    context.send = ({ format, payload }) => {
      if (format === 'binary-hex') {
        const cleaned = payload.replace(/\s+/g, '');
        const data = Buffer.from(cleaned, 'hex');
        socket.sendBinary(data);
        push({ direction: 'out', kind: 'binary', text: cleaned, byteLength: data.byteLength });
        return;
      }
      socket.sendText(payload);
      push({
        direction: 'out',
        kind: 'message',
        text: payload,
        byteLength: Buffer.byteLength(payload, 'utf8'),
      });
    };
    context.close = (code, reason) => socket.close(code, reason);
    sessions.attachResources(sessionId, { dispose: () => socket.destroy() });

    push({ direction: 'system', kind: 'open' });
    emit({
      type: 'stream-open',
      sessionId,
      workspaceId: input.workspaceId,
      requestId: input.requestId,
      seq: sessions.nextSeq(sessionId),
      protocol: 'websocket',
      status: 'open',
      url: wsUrl,
    });
    streams.setStatus(sessionId, 'open');

    if (isSubscription && graphql) {
      // The protocol requires connection_init first, and a server may close a socket that never
      // sends one.
      context.send?.({ format: 'text', payload: JSON.stringify(connectionInit()) });
      let variables: unknown;
      if (graphql.variables.trim()) {
        try {
          variables = JSON.parse(graphql.variables);
        } catch {
          push({ direction: 'system', kind: 'error', text: 'The variables are not valid JSON.' });
        }
      }
      context.send?.({
        format: 'text',
        payload: JSON.stringify(
          subscribeMessage(subscriptionId, graphql.query, variables, graphql.operationName)
        ),
      });
      ackTimer = setTimeout(() => {
        if (acknowledged) return;
        push({
          direction: 'system',
          kind: 'error',
          text: 'The server did not acknowledge the connection.',
        });
        context.ring.flush();
        emitStreamStatus(context, 'error', {
          errorCode: 'API_PROTOCOL_ERROR',
          errorMessage: 'The server did not acknowledge the connection.',
        });
      }, CONNECTION_ACK_TIMEOUT_MS);
      ackTimer.unref?.();
      sessions.attachResources(sessionId, {
        dispose: () => {
          if (ackTimer) clearTimeout(ackTimer);
        },
      });
    }

    return { ok: true, sessionId };
  }

  async function openSse(
    input: ApiOpenStreamInput,
    prepared: PreparedRequest,
    sessionId: string,
    signal: AbortSignal
  ): Promise<ApiOpenStreamResult> {
    const settings = apiSettings();
    const compiled = prepared.compiled;
    if (!compiled.ok) return { ok: false, error: compiled.error };

    const context = streams.create({
      sessionId,
      workspaceId: input.workspaceId,
      requestId: input.requestId,
      protocol: 'sse',
      settings,
    });
    const cookieJar = cookieJars.forWorkspace(
      input.workspaceId,
      prepared.file.summary.activeCookieJarId
    );
    const options = prepared.request.protocolOptions.sse;
    const push = (entry: Omit<ApiStreamEntry, 'entryId' | 'seq' | 'at'>) => context.ring.push(entry);

    let lastEventId = options?.lastEventId;
    let closedByUser = false;
    let retryMs: number | undefined;

    context.close = () => {
      closedByUser = true;
      sessions.cancel(sessionId);
    };

    const parser = createSseParser({
      onEvent: (event) => {
        if (event.eventId) lastEventId = event.eventId;
        push(sseEventToEntry(event));
      },
      onComment: (text) => push({ direction: 'in', kind: 'comment', text }),
      onRetry: (ms) => {
        retryMs = ms;
        push({ direction: 'in', kind: 'retry', retryMs: ms });
      },
      onId: (id) => {
        lastEventId = id;
      },
    });

    const headers = [
      ...compiled.compiled.headers.filter((header) => header.name.toLowerCase() !== 'accept'),
      { name: 'Accept', value: 'text/event-stream' },
      { name: 'Cache-Control', value: 'no-cache' },
    ];
    if (lastEventId) headers.push({ name: 'Last-Event-ID', value: lastEventId });

    // Errors are reported through the event channel, so this promise resolves as soon as the
    // request is dispatched; the stream itself lives on until closed or cancelled.
    let resolveOpen: (result: ApiOpenStreamResult) => void = () => undefined;
    const openResult = new Promise<ApiOpenStreamResult>((resolve) => {
      resolveOpen = resolve;
    });
    let opened = false;

    void executeHttpTransport({
      url: compiled.compiled.url,
      method: 'GET',
      headers,
      timeoutMs: 0, // A long-lived stream must not trip the per-request timeout.
      maxRedirects: prepared.request.settings.maxRedirects ?? settings.maxRedirects,
      followRedirects: prepared.request.settings.followRedirects ?? true,
      persistResponseBytes: 0,
      displayResponseBytes: 0,
      signal,
      tls: prepared.tls,
      proxy: proxyFor(prepared.context, compiled.compiled.url),
      getCookieHeader: settings.cookiesEnabled ? (url) => cookieJar.cookieHeader(url) : undefined,
      onSetCookies: settings.cookiesEnabled
        ? (url, cookies) => cookieJar.setFromResponse(url, cookies)
        : undefined,
      onResponseStart: (info) => {
        opened = true;
        const contentType = info.contentType ?? '';
        if (!contentType.includes('text/event-stream')) {
          push({
            direction: 'system',
            kind: 'error',
            text: `The endpoint returned ${contentType || 'no content type'} instead of text/event-stream.`,
          });
        }
        push({ direction: 'system', kind: 'open' });
        emit({
          type: 'stream-open',
          sessionId,
          workspaceId: input.workspaceId,
          requestId: input.requestId,
          seq: sessions.nextSeq(sessionId),
          protocol: 'sse',
          status: 'open',
          url: info.url,
          httpStatus: info.status,
        });
        streams.setStatus(sessionId, 'open');
        resolveOpen({ ok: true, sessionId });
      },
      // Never buffered: chunks are parsed incrementally and only the bounded transcript is kept.
      onBodyChunk: (chunk) => parser.push(chunk.toString('utf8')),
    }).then((result) => {
      parser.end();
      context.ring.flush();
      if (closedByUser || signal.aborted) {
        emitStreamStatus(context, 'closed');
      } else if (result.errorCode) {
        emitStreamStatus(context, 'error', {
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
        });
      } else {
        emitStreamStatus(context, 'closed', {
          errorCode: 'API_SSE_DISCONNECTED',
          errorMessage: 'The event stream ended.',
        });
      }
      sessions.remove(sessionId);
      streams.remove(sessionId);
      if (!opened) {
        resolveOpen({
          ok: false,
          error: toBureauError({
            code: (result.errorCode ?? 'API_SSE_DISCONNECTED') as BureauError['code'],
            message: result.errorMessage ?? 'The event stream could not be opened.',
            operation: 'api.openStream',
            subjectId: input.requestId,
            retryable: true,
          }),
        });
      }
      void retryMs;
    });

    sessions.attachResources(sessionId, { dispose: () => undefined });
    return openResult;
  }

  async function openStream(input: ApiOpenStreamInput): Promise<ApiOpenStreamResult> {
    const operation = 'api.openStream';
    const prep = await prepare(input, operation);
    if (!prep.ok) return prep;
    const protocol = prep.prepared.request.protocol;
    const isGraphqlSubscription =
      protocol === 'graphql' && prep.prepared.request.protocolOptions.graphql?.transport === 'WS';
    if (protocol !== 'websocket' && protocol !== 'sse' && !isGraphqlSubscription) {
      return notFound(
        'API_PROTOCOL_ERROR',
        'Only WebSocket, SSE, and GraphQL subscription requests open a stream.',
        operation,
        input.requestId
      );
    }
    const { sessionId, signal } = sessions.create({
      workspaceId: input.workspaceId,
      requestId: input.requestId,
      kind: protocol === 'sse' ? 'sse' : 'websocket',
    });
    return protocol === 'sse'
      ? openSse(input, prep.prepared, sessionId, signal)
      : openWebSocket(input, prep.prepared, sessionId);
  }

  // ------------------------------------------------------------------ profile CRUD

  async function saveTlsProfile(
    input: ApiSaveTlsProfileInput
  ): Promise<Envelope<{ profileId: ApiEntityId }>> {
    const operation = 'api.saveTlsProfile';
    const profileId = input.profileId ?? randomUUID();
    const stamp = new Date().toISOString();
    const result = await workspaces.mutateWorkspace(input.workspaceId, null, (file) => {
      const profiles = file.tlsProfiles ?? [];
      const index = profiles.findIndex((entry) => entry.profileId === profileId);
      if (index >= 0 && profiles[index].revision !== input.expectedRevision) {
        return staleState(operation, profileId);
      }
      const current = index >= 0 ? profiles[index] : null;
      const next: ApiTlsProfile = {
        profileId,
        workspaceId: input.workspaceId,
        name: input.name,
        caPem: input.caPem || undefined,
        clientCertPem: input.clientCertPem || undefined,
        clientKeySecretId:
          input.clientKeySecretId === null ? undefined : (input.clientKeySecretId ?? current?.clientKeySecretId),
        passphraseSecretId:
          input.passphraseSecretId === null
            ? undefined
            : (input.passphraseSecretId ?? current?.passphraseSecretId),
        minVersion: input.minVersion === null ? undefined : (input.minVersion ?? current?.minVersion),
        allowInvalidCertificateHosts: input.allowInvalidCertificateHosts,
        enabled: input.enabled,
        revision: (current?.revision ?? 0) + 1,
        createdAt: current?.createdAt ?? stamp,
        updatedAt: stamp,
      };
      const nextProfiles = index >= 0 ? [...profiles] : [...profiles, next];
      if (index >= 0) nextProfiles[index] = next;
      return { ...file, tlsProfiles: nextProfiles };
    });
    if (!result.ok) return result;
    return { ok: true, profileId };
  }

  async function saveProxyProfile(
    input: ApiSaveProxyProfileInput
  ): Promise<Envelope<{ profileId: ApiEntityId }>> {
    const operation = 'api.saveProxyProfile';
    const profileId = input.profileId ?? randomUUID();
    const stamp = new Date().toISOString();
    const result = await workspaces.mutateWorkspace(input.workspaceId, null, (file) => {
      const profiles = file.proxyProfiles ?? [];
      const index = profiles.findIndex((entry) => entry.profileId === profileId);
      if (index >= 0 && profiles[index].revision !== input.expectedRevision) {
        return staleState(operation, profileId);
      }
      const current = index >= 0 ? profiles[index] : null;
      const next: ApiProxyProfile = {
        profileId,
        workspaceId: input.workspaceId,
        name: input.name,
        mode: input.mode,
        host: input.mode === 'http' || input.mode === 'https' ? input.host : undefined,
        port: input.mode === 'http' || input.mode === 'https' ? input.port : undefined,
        username: input.username || undefined,
        passwordSecretId:
          input.passwordSecretId === null
            ? undefined
            : (input.passwordSecretId ?? current?.passwordSecretId),
        bypass: input.bypass,
        enabled: input.enabled,
        revision: (current?.revision ?? 0) + 1,
        createdAt: current?.createdAt ?? stamp,
        updatedAt: stamp,
      };
      const nextProfiles = index >= 0 ? [...profiles] : [...profiles, next];
      if (index >= 0) nextProfiles[index] = next;
      return { ...file, proxyProfiles: nextProfiles };
    });
    if (!result.ok) return result;
    return { ok: true, profileId };
  }

  async function saveOAuthProfile(
    input: ApiSaveOAuthProfileInput
  ): Promise<Envelope<{ profileId: ApiEntityId }>> {
    const operation = 'api.saveOAuthProfile';
    const profileId = input.profileId ?? randomUUID();
    const stamp = new Date().toISOString();
    const result = await workspaces.mutateWorkspace(input.workspaceId, null, (file) => {
      const profiles = file.oauthProfiles ?? [];
      const index = profiles.findIndex((entry) => entry.profileId === profileId);
      if (index >= 0 && profiles[index].revision !== input.expectedRevision) {
        return staleState(operation, profileId);
      }
      const current = index >= 0 ? profiles[index] : null;
      const next: ApiOAuthProfile = {
        profileId,
        workspaceId: input.workspaceId,
        name: input.name,
        grant: input.grant,
        authorizationUrl: input.authorizationUrl || undefined,
        tokenUrl: input.tokenUrl,
        clientId: input.clientId,
        clientSecretId:
          input.clientSecretId === null ? undefined : (input.clientSecretId ?? current?.clientSecretId),
        scope: input.scope || undefined,
        audience: input.audience || undefined,
        redirectPort:
          input.redirectPort === null || input.redirectPort === 0 ? undefined : input.redirectPort,
        revision: (current?.revision ?? 0) + 1,
        createdAt: current?.createdAt ?? stamp,
        updatedAt: stamp,
      };
      const nextProfiles = index >= 0 ? [...profiles] : [...profiles, next];
      if (index >= 0) nextProfiles[index] = next;
      return { ...file, oauthProfiles: nextProfiles };
    });
    if (!result.ok) return result;
    return { ok: true, profileId };
  }

  /** Loads the stored responses a HAR export needs, skipping entries whose body is gone. */
  async function loadHistoryEntries(scope: { kind: string } & Record<string, unknown>): Promise<HarHistoryEntry[]> {
    if (scope.kind !== 'history') return [];
    const ids = Array.isArray(scope.historyIds) ? (scope.historyIds as string[]) : [];
    const entries: HarHistoryEntry[] = [];
    for (const historyId of ids) {
      const loaded = await history.getEntry(historyId);
      if (!loaded.ok) continue;
      entries.push({
        historyId,
        name: loaded.summary.name,
        method: loaded.summary.method,
        url: loaded.summary.url,
        createdAt: loaded.summary.createdAt,
        response: loaded.response,
      });
    }
    return entries;
  }

  async function oauthProfile(
    workspaceId: string,
    profileId: string
  ): Promise<{ profile: ApiOAuthProfile; clientSecret?: string } | null> {
    const file = await workspaces.getFile(workspaceId);
    const profile = (file?.oauthProfiles ?? []).find((entry) => entry.profileId === profileId);
    if (!profile) return null;
    return {
      profile,
      clientSecret: profile.clientSecretId ? secrets.getPlaintext(profile.clientSecretId) : undefined,
    };
  }

  return {
    async getStatus() {
      return { ready: true, secretStorageAvailable: secrets.canPersist() };
    },
    async listWorkspaces() {
      return { workspaces: workspaces.listSummaries() };
    },
    getWorkspace,
    createWorkspace: async (input) => snapshotFromFile(await workspaces.createWorkspace(input)),
    updateWorkspace: async (input) => {
      const result = await workspaces.updateWorkspace(input);
      if (!result.ok) return result;
      return { ok: true, snapshot: await snapshotFromFile(result.file) };
    },
    deleteWorkspace: async (workspaceId, expectedRevision) => {
      // Sockets and in-flight requests for a deleted workspace must not outlive it.
      sessions.cancelAllForWorkspace(workspaceId);
      cookieJars.clearWorkspace(workspaceId);
      return workspaces.deleteWorkspace({ workspaceId, expectedRevision });
    },

    createCollection: async (input) => {
      if (input.kind === 'request') {
        const created = await workspaces.createDefaultRequestNode({
          workspaceId: input.workspaceId,
          parentId: input.parentId,
          name: input.name,
        });
        if (!created.ok) return created;
        return {
          ok: true,
          snapshot: await snapshotFromFile(created.file),
          collectionId: created.collectionId,
          requestId: created.requestId,
        };
      }
      const collectionId = randomUUID();
      const result = await workspaces.mutateWorkspace(input.workspaceId, null, (file) => {
        const siblings = file.collections.filter((node) => node.parentId === input.parentId);
        const order = siblings.reduce((max, node) => Math.max(max, node.order), -1) + 1;
        const node: ApiCollectionNode = {
          collectionId,
          workspaceId: input.workspaceId,
          parentId: input.parentId,
          kind: 'folder',
          name: input.name,
          order,
          variables: [],
          revision: 1,
        };
        return { ...file, collections: [...file.collections, node] };
      });
      if (!result.ok) return result;
      return { ok: true, snapshot: await snapshotFromFile(result.file), collectionId };
    },

    updateCollection: async (input) =>
      toSnapshotResult(
        await workspaces.mutateWorkspace(input.workspaceId, null, (file) => {
          const index = file.collections.findIndex((node) => node.collectionId === input.collectionId);
          if (index < 0) {
            return notFound(
              'API_REQUEST_NOT_FOUND',
              'Collection node not found.',
              'api.updateCollection',
              input.collectionId
            );
          }
          const node = file.collections[index];
          if (node.revision !== input.expectedRevision) {
            return staleState('api.updateCollection', input.collectionId);
          }
          const updatedNode = {
            ...node,
            name: input.name ?? node.name,
            parentId: input.parentId === undefined ? node.parentId : input.parentId,
            order: input.order ?? node.order,
            auth: input.auth ?? node.auth,
            variables: input.variables ? sanitizeIncomingVariables(input.variables) : node.variables,
            scripts: input.scripts ? mergeScripts(node.scripts ?? {}, input.scripts) : node.scripts,
            revision: node.revision + 1,
          };
          const collections = [...file.collections];
          collections[index] = updatedNode;
          // Request documents and their collection-tree entries are the same visible item.
          // A sidebar rename must therefore keep the request editor's title in sync as well.
          const requests =
            input.name === undefined || !node.requestId
              ? file.requests
              : file.requests.map((request) =>
                  request.requestId === node.requestId
                    ? { ...request, name: updatedNode.name, revision: request.revision + 1 }
                    : request
                );
          return { ...file, collections, requests };
        })
      ),

    deleteCollection: async (workspaceId, collectionId, expectedRevision) =>
      toSnapshotResult(
        await workspaces.mutateWorkspace(workspaceId, null, (file) => {
          const node = file.collections.find((entry) => entry.collectionId === collectionId);
          if (!node) {
            return notFound(
              'API_REQUEST_NOT_FOUND',
              'Collection node not found.',
              'api.deleteCollection',
              collectionId
            );
          }
          if (node.revision !== expectedRevision) {
            return staleState('api.deleteCollection', collectionId);
          }
          // Deleting a folder removes its whole subtree, so no node is orphaned.
          const doomedFolders = new Set<string>([collectionId]);
          let grew = true;
          while (grew) {
            grew = false;
            for (const entry of file.collections) {
              if (entry.parentId && doomedFolders.has(entry.parentId) && !doomedFolders.has(entry.collectionId)) {
                doomedFolders.add(entry.collectionId);
                grew = true;
              }
            }
          }
          const removed = file.collections.filter((entry) => doomedFolders.has(entry.collectionId));
          const removedRequestIds = new Set(
            removed.map((entry) => entry.requestId).filter((id): id is string => Boolean(id))
          );
          return {
            ...file,
            collections: file.collections.filter((entry) => !doomedFolders.has(entry.collectionId)),
            requests: file.requests.filter((request) => !removedRequestIds.has(request.requestId)),
          };
        })
      ),

    saveRequest: async (input) =>
      toSnapshotResult(
        await workspaces.mutateWorkspace(input.workspaceId, null, (file) => {
          const index = file.requests.findIndex((request) => request.requestId === input.requestId);
          if (index < 0) {
            return notFound('API_REQUEST_NOT_FOUND', 'Request not found.', 'api.saveRequest', input.requestId);
          }
          const current = file.requests[index];
          if (current.revision !== input.expectedRevision) {
            return staleState('api.saveRequest', input.requestId);
          }
          const requests = [...file.requests];
          const savedRequest = {
            ...current,
            ...input.patch,
            variables: input.patch.variables
              ? sanitizeIncomingVariables(input.patch.variables)
              : current.variables,
            scripts: mergeScripts(current.scripts, input.patch.scripts),
            revision: current.revision + 1,
            updatedAt: new Date().toISOString(),
          };
          requests[index] = savedRequest;

          // Request documents and their collection-tree entries are one user-visible item. Keeping
          // their labels aligned here means every refreshed snapshot updates the sidebar, too.
          const collections =
            input.patch.name === undefined
              ? file.collections
              : file.collections.map((entry) =>
                  entry.requestId === input.requestId
                    ? { ...entry, name: savedRequest.name, revision: entry.revision + 1 }
                    : entry
                );
          return { ...file, requests, collections };
        })
      ),

    deleteRequest: async (workspaceId, requestId, expectedRevision) =>
      toSnapshotResult(
        await workspaces.mutateWorkspace(workspaceId, null, (file) => {
          const request = file.requests.find((entry) => entry.requestId === requestId);
          if (!request) {
            return notFound('API_REQUEST_NOT_FOUND', 'Request not found.', 'api.deleteRequest', requestId);
          }
          if (request.revision !== expectedRevision) {
            return staleState('api.deleteRequest', requestId);
          }
          return {
            ...file,
            requests: file.requests.filter((entry) => entry.requestId !== requestId),
            collections: file.collections.filter((node) => node.requestId !== requestId),
          };
        })
      ),

    createEnvironment: async (input) => {
      const environmentId = randomUUID();
      const stamp = new Date().toISOString();
      const result = await workspaces.mutateWorkspace(input.workspaceId, null, (file) => ({
        ...file,
        environments: [
          ...file.environments,
          {
            environmentId,
            workspaceId: input.workspaceId,
            name: input.name,
            variables: [],
            revision: 1,
            createdAt: stamp,
            updatedAt: stamp,
          },
        ],
      }));
      if (!result.ok) return result;
      return { ok: true, snapshot: await snapshotFromFile(result.file), environmentId };
    },

    updateEnvironment: async (input) =>
      toSnapshotResult(
        await workspaces.mutateWorkspace(input.workspaceId, null, (file) => {
          const index = file.environments.findIndex((env) => env.environmentId === input.environmentId);
          if (index < 0) {
            return notFound(
              'API_ENVIRONMENT_NOT_FOUND',
              'Environment not found.',
              'api.updateEnvironment',
              input.environmentId
            );
          }
          const current = file.environments[index];
          if (current.revision !== input.expectedRevision) {
            return staleState('api.updateEnvironment', input.environmentId);
          }
          const environments = [...file.environments];
          environments[index] = {
            ...current,
            name: input.name ?? current.name,
            variables: input.variables ? sanitizeIncomingVariables(input.variables) : current.variables,
            revision: current.revision + 1,
            updatedAt: new Date().toISOString(),
          };
          return { ...file, environments };
        })
      ),

    deleteEnvironment: async (workspaceId, environmentId, expectedRevision) =>
      toSnapshotResult(
        await workspaces.mutateWorkspace(workspaceId, null, (file) => {
          const environment = file.environments.find((entry) => entry.environmentId === environmentId);
          if (!environment) {
            return notFound(
              'API_ENVIRONMENT_NOT_FOUND',
              'Environment not found.',
              'api.deleteEnvironment',
              environmentId
            );
          }
          if (environment.revision !== expectedRevision) {
            return staleState('api.deleteEnvironment', environmentId);
          }
          const summary =
            file.summary.activeEnvironmentId === environmentId
              ? { ...file.summary, activeEnvironmentId: undefined }
              : file.summary;
          return {
            ...file,
            summary,
            environments: file.environments.filter((entry) => entry.environmentId !== environmentId),
          };
        })
      ),

    listSecrets: () => secrets.list(),
    saveSecret: (input) => secrets.save(input),
    deleteSecret: (secretId) => secrets.delete(secretId),
    listHistory: (workspaceId) => history.list(workspaceId),
    getHistoryEntry: (historyId) => history.getEntry(historyId),
    sendRequest,

    cancelRequest: async (input) => {
      const cancelled = sessions.cancel(input.sessionId);
      if (!cancelled) {
        return notFound('API_REQUEST_NOT_FOUND', 'Session not found.', 'api.cancelRequest', input.sessionId);
      }
      return { ok: true };
    },

    openStream,

    async sendStreamMessage(input) {
      const context = streams.get(input.sessionId);
      if (!context?.send) {
        return notFound(
          'API_WEBSOCKET_CLOSED',
          'The stream is not open for sending.',
          'api.sendStreamMessage',
          input.sessionId
        );
      }
      if (input.format === 'binary-hex' && !/^[0-9a-fA-F\s]*$/.test(input.payload)) {
        return notFound(
          'INVALID_REQUEST',
          'A binary message must be hexadecimal.',
          'api.sendStreamMessage',
          input.sessionId
        );
      }
      context.send({ format: input.format, payload: input.payload });
      return { ok: true };
    },

    async closeStream(input) {
      const context = streams.get(input.sessionId);
      if (!context) {
        return notFound('API_WEBSOCKET_CLOSED', 'The stream is already closed.', 'api.closeStream', input.sessionId);
      }
      emitStreamStatus(context, 'closing');
      context.close(input.code, input.reason);
      return { ok: true };
    },

    async setStreamPaused(input) {
      const context = streams.get(input.sessionId);
      if (!context) {
        return notFound('API_WEBSOCKET_CLOSED', 'The stream is closed.', 'api.setStreamPaused', input.sessionId);
      }
      // Display-only: the socket keeps reading into the bounded ring.
      context.setPaused(input.paused);
      return { ok: true };
    },

    async getStreamSnapshot(sessionId) {
      const context = streams.get(sessionId);
      if (!context) {
        return notFound('API_WEBSOCKET_CLOSED', 'The stream is closed.', 'api.getStreamSnapshot', sessionId);
      }
      const snapshot = context.snapshot();
      return { ok: true, ...snapshot, status: context.status };
    },

    async introspectGraphql(input) {
      const operation = 'api.introspectGraphql';
      const prep = await prepare(input, operation);
      if (!prep.ok) return prep;
      const { compiled, tls, request } = prep.prepared;
      if (!compiled.ok) return { ok: false, error: compiled.error };
      const settings = apiSettings();
      const cookieJar = cookieJars.forWorkspace(input.workspaceId);

      const result = await introspectGraphqlSchema({
        // The compiled URL for a GET-transport GraphQL request carries the document; strip it.
        url: stripGraphqlQueryParams(compiled.compiled.url),
        headers: compiled.compiled.headers,
        timeoutMs: request.settings.timeoutMs ?? settings.requestTimeoutMs,
        maxRedirects: settings.maxRedirects,
        followRedirects: true,
        tls,
        getCookieHeader: settings.cookiesEnabled ? (url) => cookieJar.cookieHeader(url) : undefined,
      });
      if (!result.ok) {
        return {
          ok: false,
          error: toBureauError({
            code: result.code as BureauError['code'],
            message: result.message,
            operation,
            subjectId: input.requestId,
            retryable: true,
          }),
        };
      }
      return { ok: true, schema: result.schema };
    },

    saveTlsProfile,

    async deleteTlsProfile(input) {
      const result = await workspaces.mutateWorkspace(input.workspaceId, null, (file) => {
        const profiles = file.tlsProfiles ?? [];
        const profile = profiles.find((entry) => entry.profileId === input.profileId);
        if (!profile) {
          return notFound(
            'API_REQUEST_NOT_FOUND',
            'TLS profile not found.',
            'api.deleteTlsProfile',
            input.profileId
          );
        }
        if (profile.revision !== input.expectedRevision) {
          return staleState('api.deleteTlsProfile', input.profileId);
        }
        // Requests referencing the profile fall back to strict defaults rather than dangling.
        return {
          ...file,
          tlsProfiles: profiles.filter((entry) => entry.profileId !== input.profileId),
          requests: file.requests.map((request) =>
            request.protocolOptions.tlsProfileId === input.profileId
              ? {
                  ...request,
                  protocolOptions: { ...request.protocolOptions, tlsProfileId: undefined },
                }
              : request
          ),
        };
      });
      if (!result.ok) return result;
      return { ok: true };
    },

    async backupWorkspaces() {
      const files: ApiWorkspaceFileV1[] = [];
      for (const summary of workspaces.listSummaries()) {
        const file = await workspaces.getFile(summary.workspaceId);
        if (file) files.push(file);
      }
      const result = await backups.backup(files);
      if (!result.ok) {
        return {
          ok: false,
          error: toBureauError({
            code: result.code as BureauError['code'],
            message: result.message,
            operation: 'api.backupWorkspaces',
            retryable: false,
          }),
        };
      }
      return { ok: true, written: result.written };
    },

    async planRestore() {
      const existing = workspaces.listSummaries().map((entry) => entry.workspaceId);
      const result = await backups.plan(existing);
      if (!result.ok) {
        return {
          ok: false,
          error: toBureauError({
            code: result.code as BureauError['code'],
            message: result.message,
            operation: 'api.planRestore',
            retryable: false,
          }),
        };
      }
      return { ok: true, plan: result.plan };
    },

    async commitRestore(input) {
      const taken = backups.take(input.restoreId);
      if (!taken) {
        return notFound(
          'API_IMPORT_INVALID',
          'That restore is no longer pending. Choose the backup again.',
          'api.commitRestore',
          input.restoreId
        );
      }
      const existing = new Set(workspaces.listSummaries().map((entry) => entry.workspaceId));
      const report = emptyRestoreReport();
      report.warnings = taken.plan.warnings;

      for (const file of taken.files) {
        const conflict = existing.has(file.summary.workspaceId);
        // `merge` never overwrites: a workspace that already exists is left exactly as it is.
        if (conflict && input.mode === 'merge') {
          report.skipped += 1;
          continue;
        }
        await workspaces.restoreWorkspace(file);
        if (conflict) report.replaced += 1;
        else report.restored += 1;
      }
      return { ok: true, report };
    },

    saveProxyProfile,

    async deleteProxyProfile(input) {
      const result = await workspaces.mutateWorkspace(input.workspaceId, null, (file) => {
        const profiles = file.proxyProfiles ?? [];
        const existing = profiles.find((entry) => entry.profileId === input.profileId);
        if (!existing) {
          return notFound(
            'API_REQUEST_NOT_FOUND',
            'Proxy profile not found.',
            'api.deleteProxyProfile',
            input.profileId
          );
        }
        if (existing.revision !== input.expectedRevision) {
          return staleState('api.deleteProxyProfile', input.profileId);
        }
        return {
          ...file,
          proxyProfiles: profiles.filter((entry) => entry.profileId !== input.profileId),
          summary:
            file.summary.defaultProxyProfileId === input.profileId
              ? { ...file.summary, defaultProxyProfileId: undefined }
              : file.summary,
          // A request pointing at the deleted profile falls back to direct rather than to whatever
          // profile happens to occupy that id next.
          requests: file.requests.map((request) =>
            request.protocolOptions.proxyProfileId === input.profileId
              ? {
                  ...request,
                  protocolOptions: { ...request.protocolOptions, proxyProfileId: undefined },
                }
              : request
          ),
        };
      });
      if (!result.ok) return result;
      return { ok: true };
    },

    listCookieJars(workspaceId) {
      return cookieJars.jarIds(workspaceId).map((jarId) => ({
        jarId,
        name: jarId || 'Default',
        cookieCount: cookieJars.forWorkspace(workspaceId, jarId || undefined).list().length,
      }));
    },

    listCookies(input) {
      return cookieJars
        .forWorkspace(input.workspaceId, input.jarId || undefined)
        .list()
        .map((cookie) => ({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          hostOnly: cookie.hostOnly,
          sameSite: cookie.sameSite,
          expiresAt: cookie.expires === undefined ? undefined : new Date(cookie.expires).toISOString(),
        }));
    },

    deleteCookie(input) {
      const removed = cookieJars
        .forWorkspace(input.workspaceId, input.jarId || undefined)
        .remove(input.name, input.domain, input.path);
      if (!removed) {
        return notFound('API_REQUEST_NOT_FOUND', 'That cookie is no longer held.', 'api.deleteCookie');
      }
      return { ok: true };
    },

    clearCookies(input) {
      cookieJars.forWorkspace(input.workspaceId, input.jarId || undefined).clear();
      return { ok: true };
    },

    saveCookie(input) {
      const expires = input.cookie.expiresAt ? Date.parse(input.cookie.expiresAt) : undefined;
      if (input.cookie.expiresAt && !Number.isFinite(expires)) {
        return notFound('INVALID_REQUEST', 'The cookie expiry is not valid.', 'api.saveCookie');
      }
      cookieJars.forWorkspace(input.workspaceId, input.jarId || undefined).upsert({
        name: input.cookie.name,
        value: input.cookie.value,
        domain: input.cookie.domain,
        path: input.cookie.path,
        secure: input.cookie.secure,
        httpOnly: input.cookie.httpOnly,
        hostOnly: input.cookie.hostOnly,
        sameSite: input.cookie.sameSite,
        expires,
      });
      return { ok: true };
    },

    saveOAuthProfile,

    async deleteOAuthProfile(input) {
      const result = await workspaces.mutateWorkspace(input.workspaceId, null, (file) => {
        const profiles = file.oauthProfiles ?? [];
        const profile = profiles.find((entry) => entry.profileId === input.profileId);
        if (!profile) {
          return notFound(
            'API_REQUEST_NOT_FOUND',
            'OAuth profile not found.',
            'api.deleteOAuthProfile',
            input.profileId
          );
        }
        if (profile.revision !== input.expectedRevision) {
          return staleState('api.deleteOAuthProfile', input.profileId);
        }
        return { ...file, oauthProfiles: profiles.filter((entry) => entry.profileId !== input.profileId) };
      });
      if (!result.ok) return result;
      oauth.cancelAuthorize(input.profileId);
      await oauth.clearToken(input.profileId);
      return { ok: true };
    },

    async authorizeOAuth(input) {
      const found = await oauthProfile(input.workspaceId, input.profileId);
      if (!found) {
        return notFound('API_OAUTH_FAILED', 'OAuth profile not found.', 'api.authorizeOAuth', input.profileId);
      }
      const result = await oauth.authorize(found.profile, found.clientSecret, (phase) => {
        emitOAuth({
          type: 'oauth',
          profileId: input.profileId,
          workspaceId: input.workspaceId,
          phase,
        });
      });
      if (!result.ok) {
        emitOAuth({
          type: 'oauth',
          profileId: input.profileId,
          workspaceId: input.workspaceId,
          phase: 'failed',
          errorCode: result.error.code,
          errorMessage: result.error.message,
        });
        return result;
      }
      emitOAuth({
        type: 'oauth',
        profileId: input.profileId,
        workspaceId: input.workspaceId,
        phase: 'authorized',
        status: result.status,
      });
      return { ok: true };
    },

    async cancelOAuth(input) {
      const cancelled = oauth.cancelAuthorize(input.profileId);
      if (cancelled) {
        emitOAuth({
          type: 'oauth',
          profileId: input.profileId,
          workspaceId: input.workspaceId,
          phase: 'idle',
        });
      }
      return { ok: true };
    },

    async clearOAuthToken(input) {
      await oauth.clearToken(input.profileId);
      emitOAuth({
        type: 'oauth',
        profileId: input.profileId,
        workspaceId: input.workspaceId,
        phase: 'idle',
        status: oauth.tokenStatuses([input.profileId])[0],
      });
      return { ok: true };
    },

    async inspectImport(input) {
      const file = await workspaces.getFile(input.workspaceId);
      if (!file) {
        return notFound(
          'API_WORKSPACE_NOT_FOUND',
          'API workspace not found.',
          'api.inspectImport',
          input.workspaceId
        );
      }
      const result = await imports.inspect({
        workspaceId: input.workspaceId,
        format: input.format,
        text: input.text,
        fromFile: input.fromFile,
        settings: apiSettings(),
        existingNames: (parentId) =>
          file.collections.filter((node) => node.parentId === parentId).map((node) => node.name),
        existingEnvironmentNames: () => file.environments.map((environment) => environment.name),
      });
      if (!result.ok) {
        return {
          ok: false,
          error: toBureauError({
            code: result.code as BureauError['code'],
            message: result.message,
            operation: 'api.inspectImport',
            subjectId: input.workspaceId,
            retryable: false,
          }),
        };
      }
      return { ok: true, preview: result.preview };
    },

    async commitImport(input) {
      let report: ApiImportReport | null = null;
      let failure: { code: string; message: string } | null = null;

      // The whole tree is built inside one mutation, so the import is a single atomic write.
      const result = await workspaces.mutateWorkspace(input.workspaceId, null, (file) => {
        const applied = imports.commit({
          previewId: input.previewId,
          workspaceId: input.workspaceId,
          parentId: input.parentId,
          conflictStrategy: input.conflictStrategy,
          file,
        });
        if (!applied.ok) {
          failure = { code: applied.code, message: applied.message };
          return {
            error: toBureauError({
              code: applied.code as BureauError['code'],
              message: applied.message,
              operation: 'api.commitImport',
              subjectId: input.workspaceId,
              retryable: false,
            }),
          };
        }
        report = applied.report;
        return applied.file;
      });

      if (!result.ok) return result;
      void failure;
      return { ok: true, report: report! };
    },

    discardImport(previewId) {
      imports.discard(previewId);
    },

    async planExport(input) {
      const file = await workspaces.getFile(input.workspaceId);
      if (!file) {
        return notFound(
          'API_WORKSPACE_NOT_FOUND',
          'API workspace not found.',
          'api.planExport',
          input.workspaceId
        );
      }
      const result = await exports.plan({
        file,
        format: input.format,
        scope: input.scope,
        history: () => loadHistoryEntries(input.scope),
      });
      if (!result.ok) {
        return {
          ok: false,
          error: toBureauError({
            code: result.code as BureauError['code'],
            message: result.message,
            operation: 'api.planExport',
            subjectId: input.workspaceId,
            retryable: false,
          }),
        };
      }
      return { ok: true, plan: result.plan };
    },

    async commitExport(input) {
      const file = await workspaces.getFile(input.workspaceId);
      if (!file) {
        return notFound(
          'API_WORKSPACE_NOT_FOUND',
          'API workspace not found.',
          'api.commitExport',
          input.workspaceId
        );
      }
      const result = await exports.commit({
        file,
        format: input.format,
        scope: input.scope,
        history: () => loadHistoryEntries(input.scope),
      });
      if (!result.ok) {
        return {
          ok: false,
          error: toBureauError({
            code: result.code as BureauError['code'],
            message: result.message,
            operation: 'api.commitExport',
            subjectId: input.workspaceId,
            retryable: false,
          }),
        };
      }
      return { ok: true, written: result.written };
    },

    /* ------------------------------------- Phase 4: scripts and the collection runner */

    validateScript(input) {
      return sandbox.validate(input.source, input.phase);
    },

    async listScriptLocations(input) {
      const file = await workspaces.getFile(input.workspaceId);
      if (!file) {
        return notFound(
          'API_WORKSPACE_NOT_FOUND',
          'API workspace not found.',
          'api.listScriptLocations',
          input.workspaceId
        );
      }
      return { ok: true, locations: scriptLocations(file, input.collectionId) };
    },

    async approveScripts(input) {
      const operation = 'api.approveScripts';
      const file = await workspaces.getFile(input.workspaceId);
      if (!file) {
        return notFound('API_WORKSPACE_NOT_FOUND', 'API workspace not found.', operation, input.workspaceId);
      }
      const targets = scriptLocations(file, input.collectionId);
      const folderIds = new Set(
        targets.filter((entry) => entry.holder.kind === 'folder').map((entry) => entry.holder.id)
      );
      const requestIds = new Set(
        targets.filter((entry) => entry.holder.kind === 'request').map((entry) => entry.holder.id)
      );
      let changed = 0;

      const result = await workspaces.mutateWorkspace(
        input.workspaceId,
        input.expectedRevision,
        (draft) => ({
          ...draft,
          collections: draft.collections.map((node) => {
            if (!folderIds.has(node.collectionId) || !node.scripts) return node;
            if (node.scripts.enabled === input.enabled) return node;
            changed += 1;
            return { ...node, scripts: { ...node.scripts, enabled: input.enabled } };
          }),
          requests: draft.requests.map((request) => {
            if (!requestIds.has(request.requestId)) return request;
            if (request.scripts.enabled === input.enabled) return request;
            changed += 1;
            return { ...request, scripts: { ...request.scripts, enabled: input.enabled } };
          }),
        })
      );
      if (!result.ok) return result;
      return { ok: true, changed };
    },

    async loadRunData(input) {
      const operation = 'api.loadRunData';
      const file = await workspaces.getFile(input.workspaceId);
      if (!file) {
        return notFound('API_WORKSPACE_NOT_FOUND', 'API workspace not found.', operation, input.workspaceId);
      }
      const result = await runData.load(apiSettings().runDataRowCap);
      if (!result.ok) {
        return {
          ok: false,
          error: toBureauError({
            code: result.code as BureauError['code'],
            message: result.message,
            operation,
            retryable: false,
          }),
        };
      }
      return { ok: true, data: result.data?.summary ?? null };
    },

    clearRunData(dataSetId) {
      runData.clear(dataSetId);
    },

    async startRun(config) {
      const operation = 'api.startRun';
      const file = await workspaces.getFile(config.workspaceId);
      if (!file) {
        return notFound('API_WORKSPACE_NOT_FOUND', 'API workspace not found.', operation, config.workspaceId);
      }
      const settings = apiSettings();
      const iterations = Math.min(config.iterations, settings.runMaxIterations);

      const dataSet = config.dataSetId ? runData.get(config.dataSetId) : undefined;
      if (config.dataSetId && !dataSet) {
        return notFound(
          'API_IMPORT_INVALID',
          'The iteration data is no longer loaded. Choose the file again.',
          operation,
          config.dataSetId
        );
      }

      const environmentId =
        config.environmentId === null
          ? undefined
          : (config.environmentId ?? file.summary.activeEnvironmentId);
      const environment = file.environments.find((entry) => entry.environmentId === environmentId);

      const order = resolveRunOrder(file.collections, file.requests, config.target);
      const scriptsEnabled =
        settings.scriptsEnabled &&
        order.some((request) => {
          const node = file.collections.find((entry) => entry.requestId === request.requestId);
          return (
            scriptsForRequest(file, request, node, 'pre-request').length > 0 ||
            scriptsForRequest(file, request, node, 'post-response').length > 0
          );
        });

      const started = runner.start({
        config: { ...config, iterations },
        collections: file.collections,
        requests: file.requests,
        environmentName: environment?.name,
        dataFileName: dataSet?.summary.fileName,
        dataRows: dataSet?.rows,
        scriptsEnabled,
      });
      if (!started.ok) {
        return {
          ok: false,
          error: toBureauError({
            code: started.code,
            message:
              started.code === 'API_RUN_ACTIVE'
                ? 'A run is already in progress for this workspace.'
                : 'The selected target has no requests to run.',
            operation,
            subjectId: config.workspaceId,
            retryable: started.code === 'API_RUN_ACTIVE',
          }),
        };
      }
      return { ok: true, runId: started.runId };
    },

    async cancelRun(input) {
      if (!runner.cancel(input.runId)) {
        return notFound('API_RUN_NOT_FOUND', 'That run is not active.', 'api.cancelRun', input.runId);
      }
      return { ok: true };
    },

    async getRunReport(input) {
      const report = runner.report(input.runId);
      if (!report) {
        return notFound('API_RUN_NOT_FOUND', 'That run report is no longer held.', 'api.getRunReport', input.runId);
      }
      return { ok: true, report };
    },

    async exportRunReport(input) {
      const operation = 'api.exportRunReport';
      const report = runner.report(input.runId);
      if (!report) {
        return notFound('API_RUN_NOT_FOUND', 'That run report is no longer held.', operation, input.runId);
      }
      const written = await exports.writeText({
        title: 'Export run report',
        suggestedFileName:
          input.format === 'junit'
            ? `bureau-run-${report.runId.slice(0, 8)}.junit.xml`
            : `bureau-run-${report.runId.slice(0, 8)}.json`,
        extensions: input.format === 'junit' ? ['xml'] : ['json'],
        content: input.format === 'junit' ? runReportToJUnit(report) : runReportToJson(report),
      });
      if (!written.ok) {
        return {
          ok: false,
          error: toBureauError({
            code: written.code as BureauError['code'],
            message: written.message,
            operation,
            subjectId: input.runId,
            retryable: false,
          }),
        };
      }
      return { ok: true, written: written.written };
    },

    setDirtyDraftCount(count) {
      dirtyDrafts = count;
    },
    dirtyDraftCount() {
      return dirtyDrafts;
    },
    unlinkProject: (projectId) => workspaces.unlinkProject(projectId),

    onSessionEvent(listener) {
      sessionListeners.add(listener);
      return () => sessionListeners.delete(listener);
    },
    onOAuthEvent(listener) {
      oauthListeners.add(listener);
      return () => oauthListeners.delete(listener);
    },
    onRunEvent(listener) {
      runListeners.add(listener);
      return () => runListeners.delete(listener);
    },

    dispose() {
      // Order matters: cancel sockets first, then drop the rings they still write into.
      imports.dispose();
      backups.dispose();
      // A run in flight is cancelled before the sandbox goes, so no job outlives its worker.
      runner.dispose();
      sandbox.dispose();
      runData.dispose();
      sessions.dispose();
      streams.dispose();
      oauth.dispose();
      cookieJars.dispose();
      sessionListeners.clear();
      oauthListeners.clear();
      runListeners.clear();
    },
  };
}

/** GraphQL introspection targets the bare endpoint, not a GET-transport document URL. */
function stripGraphqlQueryParams(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('query');
    parsed.searchParams.delete('variables');
    parsed.searchParams.delete('operationName');
    return parsed.toString();
  } catch {
    return url;
  }
}
