/** Shared contracts for the top-level API workbench (REST / GraphQL / WebSocket / SSE). */

export type ApiProtocol = 'http' | 'graphql' | 'websocket' | 'sse';

/** Bureau-generated UUID; never derived from a user-provided name. */
export type ApiEntityId = string;

export type ApiWorkspaceSummary = {
  workspaceId: ApiEntityId;
  name: string;
  linkedProjectId?: string;
  activeEnvironmentId?: string;
  /** Applied to every request that does not name its own proxy profile. */
  defaultProxyProfileId?: string;
  /** Named cookie jar in use; absent means the workspace's default jar. */
  activeCookieJarId?: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
};

export type ApiWorkspaceIndex = {
  workspaces: ApiWorkspaceSummary[];
};

export type ApiWorkbenchStatus = {
  ready: boolean;
  secretStorageAvailable: boolean;
};

export type ApiKeyValue = {
  id: ApiEntityId;
  name: string;
  value: string;
  enabled: boolean;
};

export type ApiAuth =
  | { kind: 'inherit' }
  | { kind: 'none' }
  | { kind: 'basic'; usernameTemplate: string; passwordSecretId?: string }
  | { kind: 'bearer'; tokenSecretId?: string }
  | {
      kind: 'api-key';
      placement: 'header' | 'query';
      nameTemplate: string;
      valueSecretId?: string;
    }
  | { kind: 'oauth2'; profileId: ApiEntityId };

export type ApiBody =
  | { kind: 'none' }
  | { kind: 'json'; text: string }
  | { kind: 'text'; text: string; contentType?: string }
  | { kind: 'xml'; text: string }
  | { kind: 'html'; text: string }
  | { kind: 'form-urlencoded'; fields: ApiKeyValue[] }
  | { kind: 'multipart'; fields: ApiKeyValue[] }
  | { kind: 'binary'; fileName?: string; byteLength?: number };

export type ApiScripts = {
  preRequest?: string;
  postResponse?: string;
  /**
   * Scripts never execute unless this is true. Import always writes `false`, which is what makes
   * an imported collection inert: the source is preserved but nothing runs it.
   */
  enabled?: boolean;
  /** Provenance. `imported` source stays untrusted until an explicit per-collection approval. */
  origin?: 'authored' | 'imported';
};

export type ApiRequestSettings = {
  timeoutMs?: number;
  maxRedirects?: number;
  followRedirects?: boolean;
  /** When true, unresolved `{{vars}}` are sent literally instead of blocking. */
  sendUnresolvedLiterals?: boolean;
};

export type ApiGraphqlOptions = {
  query: string;
  variables: string;
  operationName?: string;
  /**
   * GraphQL over HTTP allows GET for queries; POST is the default and the only mutation transport.
   * `WS` runs the operation as a subscription over `graphql-transport-ws` instead, which is a
   * stream rather than a request — Connect/Disconnect, not Send.
   */
  transport: 'POST' | 'GET' | 'WS';
};

export type ApiWebSocketOptions = {
  subprotocols: string[];
  /** Composer draft retained per request so reopening a document keeps the last message. */
  messageDraft?: string;
  messageFormat?: 'text' | 'json' | 'binary-hex';
};

export type ApiSseOptions = {
  /** Disabled by default: a manual test session should not silently reconnect. */
  reconnect: boolean;
  lastEventId?: string;
};

export type ApiProtocolOptions = {
  http?: { http2?: boolean };
  graphql?: ApiGraphqlOptions;
  websocket?: ApiWebSocketOptions;
  sse?: ApiSseOptions;
  /** Host-scoped TLS profile applied to this request; falls back to the workspace default. */
  tlsProfileId?: ApiEntityId;
  /** Proxy profile applied to this request; falls back to the workspace default. */
  proxyProfileId?: ApiEntityId;
};

export type ApiVariableDefinition = {
  variableId: ApiEntityId;
  name: string;
  enabled: boolean;
  secret: boolean;
  /** Non-secret value; omitted when secret. */
  value?: string;
  /**
   * Vault handle for a secret variable. An identifier, not secret material, so it survives the
   * renderer round-trip the same way `passwordSecretId` does on auth.
   */
  secretId?: ApiEntityId;
  /** True when a secret value is stored (never the plaintext). */
  hasSecretValue?: boolean;
};

export type ApiCollectionNode = {
  collectionId: ApiEntityId;
  workspaceId: ApiEntityId;
  parentId: ApiEntityId | null;
  kind: 'folder' | 'request';
  name: string;
  order: number;
  /** Present when kind === 'request'. */
  requestId?: ApiEntityId;
  auth?: ApiAuth;
  variables: ApiVariableDefinition[];
  scripts?: ApiScripts;
  revision: number;
};

export type ApiRequestDefinition = {
  requestId: ApiEntityId;
  collectionId?: ApiEntityId;
  workspaceId: ApiEntityId;
  name: string;
  protocol: ApiProtocol;
  urlTemplate: string;
  method: string;
  query: ApiKeyValue[];
  headers: ApiKeyValue[];
  auth: ApiAuth;
  body: ApiBody;
  protocolOptions: ApiProtocolOptions;
  scripts: ApiScripts;
  settings: ApiRequestSettings;
  variables: ApiVariableDefinition[];
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type ApiEnvironment = {
  environmentId: ApiEntityId;
  workspaceId: ApiEntityId;
  name: string;
  variables: ApiVariableDefinition[];
  revision: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * A host-scoped TLS profile. Strict verification is always the default; `allowInvalidCertificateHosts`
 * holds exact `host` or `host:port` entries only — never wildcards, never suffixes.
 */
export type ApiTlsProfile = {
  profileId: ApiEntityId;
  workspaceId: ApiEntityId;
  name: string;
  caPem?: string;
  clientCertPem?: string;
  /** Private key and passphrase live in the secret vault, never in this record. */
  clientKeySecretId?: ApiEntityId;
  passphraseSecretId?: ApiEntityId;
  minVersion?: 'TLSv1.2' | 'TLSv1.3';
  allowInvalidCertificateHosts: string[];
  /** Imported profiles stay disabled until explicitly reviewed. */
  enabled: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * `system` reads Bureau's launch environment (`HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`). Those variables
 * apply *only* under this mode — a shell that happens to export a proxy must never redirect a request
 * the user configured as direct (§11.3).
 */
export type ApiProxyMode = 'direct' | 'system' | 'http' | 'https' | 'socks5';

export type ApiProxyProfile = {
  profileId: ApiEntityId;
  workspaceId: ApiEntityId;
  name: string;
  mode: ApiProxyMode;
  /** Required for `http`/`https`/`socks5`; ignored otherwise. */
  host?: string;
  port?: number;
  username?: string;
  /** Proxy password lives in the secret vault, never in this record. */
  passwordSecretId?: ApiEntityId;
  /** Hosts that go direct. Exact host, or a leading-dot suffix; `*` bypasses everything. */
  bypass: string[];
  /** Imported profiles stay disabled until explicitly reviewed, like TLS profiles. */
  enabled: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type ApiSaveProxyProfileInput = {
  workspaceId: ApiEntityId;
  profileId?: ApiEntityId;
  expectedRevision?: number;
  name: string;
  mode: ApiProxyMode;
  host?: string;
  port?: number;
  username?: string;
  passwordSecretId?: ApiEntityId | null;
  bypass: string[];
  enabled: boolean;
};

export type ApiDeleteProxyProfileInput = {
  workspaceId: ApiEntityId;
  profileId: ApiEntityId;
  expectedRevision: number;
};

/**
 * One cookie as the inspector shows it. The value is included because a cookie inspector that hides
 * values cannot be used to debug one — but it is treated as sensitive everywhere else: redacted in
 * HAR exports, never written to a run report, and never logged.
 */
export type ApiCookie = {
  name: string;
  value: string;
  domain?: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  hostOnly: boolean;
  sameSite: 'strict' | 'lax' | 'none';
  /** ISO timestamp; absent for a session cookie. */
  expiresAt?: string;
};

export type ApiCookieJarSummary = {
  /** Empty string is the workspace's default jar. */
  jarId: string;
  name: string;
  cookieCount: number;
};

export type ApiListCookiesInput = {
  workspaceId: ApiEntityId;
  jarId?: string;
};

export type ApiDeleteCookieInput = {
  workspaceId: ApiEntityId;
  jarId?: string;
  name: string;
  domain?: string;
  path: string;
};

export type ApiClearCookiesInput = {
  workspaceId: ApiEntityId;
  jarId?: string;
};

/** A cookie written deliberately in the inspector, rather than received from a response. */
export type ApiSaveCookieInput = {
  workspaceId: ApiEntityId;
  jarId?: string;
  cookie: ApiCookie;
};

export type ApiOAuthGrant = 'authorization_code' | 'client_credentials';

export type ApiOAuthProfile = {
  profileId: ApiEntityId;
  workspaceId: ApiEntityId;
  name: string;
  grant: ApiOAuthGrant;
  /** Required for authorization_code. */
  authorizationUrl?: string;
  tokenUrl: string;
  clientId: string;
  clientSecretId?: ApiEntityId;
  scope?: string;
  audience?: string;
  /**
   * Fixed loopback port for providers that require a registered redirect URI.
   * Omitted (or 0) means an ephemeral port, which is preferred.
   */
  redirectPort?: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

/** Token state exposed to the renderer. Never carries token material. */
export type ApiOAuthTokenStatus = {
  profileId: ApiEntityId;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  /** ISO timestamp; absent when the provider returned no expiry. */
  expiresAt?: string;
  tokenType?: string;
  scope?: string;
  obtainedAt?: string;
};

export type ApiOAuthStateEvent = {
  type: 'oauth';
  profileId: ApiEntityId;
  workspaceId: ApiEntityId;
  phase: 'idle' | 'awaiting-callback' | 'exchanging' | 'refreshing' | 'authorized' | 'failed';
  status?: ApiOAuthTokenStatus;
  errorCode?: string;
  errorMessage?: string;
};

/** Full workspace document returned to the renderer (secrets redacted). */
export type ApiWorkspaceSnapshot = {
  summary: ApiWorkspaceSummary;
  variables: ApiVariableDefinition[];
  auth: ApiAuth;
  collections: ApiCollectionNode[];
  requests: ApiRequestDefinition[];
  environments: ApiEnvironment[];
  tlsProfiles: ApiTlsProfile[];
  proxyProfiles: ApiProxyProfile[];
  oauthProfiles: ApiOAuthProfile[];
  oauthTokens: ApiOAuthTokenStatus[];
  /** Linked project display name when the project still exists. */
  linkedProjectName?: string;
  /** True when linkedProjectId is set but the project is missing. */
  linkedProjectStale?: boolean;
};

export type ApiSecretSummary = {
  secretId: ApiEntityId;
  label: string;
  hasValue: boolean;
  persisted: boolean;
  updatedAt: string;
};

export type ApiTimingPhases = {
  dnsMs?: number;
  connectMs?: number;
  tlsMs?: number;
  firstByteMs?: number;
  downloadMs?: number;
  totalMs: number;
};

export type ApiRedirectHop = {
  status: number;
  url: string;
  method: string;
};

export type ApiResponsePreview = {
  sessionId: ApiEntityId;
  workspaceId: ApiEntityId;
  requestId: ApiEntityId;
  historyId?: ApiEntityId;
  ok: boolean;
  status: number;
  statusText: string;
  url: string;
  method: string;
  headers: Array<{ name: string; value: string }>;
  timings: ApiTimingPhases;
  redirects: ApiRedirectHop[];
  contentType?: string;
  encoding?: string;
  wireBytes: number;
  decodedBytes: number;
  truncated: boolean;
  /** Bounded text preview for the renderer (never unbounded). */
  bodyText?: string;
  /** Hex preview when body is treated as binary. */
  bodyHexPreview?: string;
  bodyIsBinary: boolean;
  /** True when this response's host carried an explicit invalid-certificate exception. */
  tlsExceptionApplied?: boolean;
  /** `host:port` of the proxy this response travelled through, when one did. */
  proxyUsed?: string;
  /** GraphQL reports failures with HTTP 200, so they are surfaced separately. */
  graphqlErrors?: Array<{ message: string; path?: string; line?: number; column?: number }>;
  /** One entry per script holder that ran, in execution order. Absent when no script ran. */
  scripts?: ApiScriptOutcome[];
  errorCode?: string;
  errorMessage?: string;
};

export type ApiHistorySummary = {
  historyId: ApiEntityId;
  workspaceId: ApiEntityId;
  requestId?: ApiEntityId;
  name: string;
  method: string;
  url: string;
  status?: number;
  ok?: boolean;
  totalMs?: number;
  createdAt: string;
};

export type ApiSessionProgressEvent = {
  type: 'progress';
  sessionId: ApiEntityId;
  workspaceId: ApiEntityId;
  requestId: ApiEntityId;
  seq: number;
  phase: 'dns' | 'connect' | 'tls' | 'upload' | 'headers' | 'download';
  message?: string;
};

export type ApiSessionCompleteEvent = {
  type: 'complete';
  sessionId: ApiEntityId;
  workspaceId: ApiEntityId;
  requestId: ApiEntityId;
  seq: number;
  response: ApiResponsePreview;
};

/** One entry in a WebSocket or SSE transcript. Bounded and batched before it reaches the renderer. */
export type ApiStreamEntry = {
  entryId: string;
  /** Monotonic within the session; a gap means events were dropped by the ring buffer. */
  seq: number;
  at: string;
  direction: 'in' | 'out' | 'system';
  kind:
    | 'open'
    | 'message'
    | 'binary'
    | 'sse-event'
    | 'comment'
    | 'close'
    | 'error'
    | 'ping'
    | 'pong'
    | 'retry';
  /** Bounded preview; large payloads are truncated and flagged. */
  text?: string;
  truncated?: boolean;
  byteLength?: number;
  /** Body handle for large binary frames — never base64 over IPC. */
  bodyId?: string;
  /** SSE fields. */
  eventName?: string;
  eventId?: string;
  retryMs?: number;
  /** Close frame details. */
  code?: number;
  reason?: string;
};

export type ApiStreamStatus =
  | 'connecting'
  | 'open'
  | 'closing'
  | 'closed'
  | 'error'
  | 'reconnecting';

export type ApiStreamOpenEvent = {
  type: 'stream-open';
  sessionId: ApiEntityId;
  workspaceId: ApiEntityId;
  requestId: ApiEntityId;
  seq: number;
  protocol: 'websocket' | 'sse';
  status: ApiStreamStatus;
  url: string;
  /** Negotiated WebSocket subprotocol, when one was selected. */
  subprotocol?: string;
  httpStatus?: number;
  tlsExceptionApplied?: boolean;
};

export type ApiStreamEntriesEvent = {
  type: 'stream-entries';
  sessionId: ApiEntityId;
  workspaceId: ApiEntityId;
  requestId: ApiEntityId;
  seq: number;
  entries: ApiStreamEntry[];
  /** Total entries dropped by the bounded ring since the session opened. */
  dropped: number;
};

export type ApiStreamStatusEvent = {
  type: 'stream-status';
  sessionId: ApiEntityId;
  workspaceId: ApiEntityId;
  requestId: ApiEntityId;
  seq: number;
  status: ApiStreamStatus;
  code?: number;
  reason?: string;
  errorCode?: string;
  errorMessage?: string;
};

export type ApiSessionEvent =
  | ApiSessionProgressEvent
  | ApiSessionCompleteEvent
  | ApiStreamOpenEvent
  | ApiStreamEntriesEvent
  | ApiStreamStatusEvent;

export type ApiSendRequestInput = {
  workspaceId: ApiEntityId;
  requestId: ApiEntityId;
  /** Optional draft override; when omitted, the saved definition is used. */
  draft?: Partial<
    Pick<
      ApiRequestDefinition,
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
      /**
       * Script *source* may be drafted, so a script can be iterated on without saving. Whether
       * scripts run is always read from the saved definition — see `loadContext`.
       */
      | 'scripts'
    >
  >;
  environmentId?: ApiEntityId | null;
};

export type ApiSendRequestResult =
  | { ok: true; sessionId: ApiEntityId }
  | { ok: false; error: import('./errors').BureauError };

export type ApiCancelRequestInput = {
  sessionId: ApiEntityId;
};

export type ApiCreateWorkspaceInput = {
  name: string;
  linkedProjectId?: string;
};

export type ApiUpdateWorkspaceInput = {
  workspaceId: ApiEntityId;
  expectedRevision: number;
  name?: string;
  linkedProjectId?: string | null;
  activeEnvironmentId?: string | null;
  defaultProxyProfileId?: string | null;
  activeCookieJarId?: string | null;
  variables?: ApiVariableDefinition[];
  auth?: ApiAuth;
};

export type ApiCreateCollectionInput = {
  workspaceId: ApiEntityId;
  parentId: ApiEntityId | null;
  kind: 'folder' | 'request';
  name: string;
};

export type ApiUpdateCollectionInput = {
  workspaceId: ApiEntityId;
  collectionId: ApiEntityId;
  expectedRevision: number;
  name?: string;
  parentId?: ApiEntityId | null;
  order?: number;
  auth?: ApiAuth;
  variables?: ApiVariableDefinition[];
  scripts?: ApiScripts;
};

export type ApiSaveRequestInput = {
  workspaceId: ApiEntityId;
  requestId: ApiEntityId;
  expectedRevision: number;
  patch: Partial<
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
      | 'scripts'
      | 'protocol'
      | 'protocolOptions'
    >
  >;
};

export type ApiCreateEnvironmentInput = {
  workspaceId: ApiEntityId;
  name: string;
};

export type ApiUpdateEnvironmentInput = {
  workspaceId: ApiEntityId;
  environmentId: ApiEntityId;
  expectedRevision: number;
  name?: string;
  variables?: ApiVariableDefinition[];
};

export type ApiSaveSecretInput = {
  secretId?: ApiEntityId;
  label: string;
  value: string;
  persist: boolean;
};

export type ApiDeleteSecretInput = {
  secretId: ApiEntityId;
};

/* ---------------------------------------------------------------- Phase 2 inputs */

export type ApiOpenStreamInput = {
  workspaceId: ApiEntityId;
  requestId: ApiEntityId;
  draft?: ApiSendRequestInput['draft'];
  environmentId?: ApiEntityId | null;
};

export type ApiOpenStreamResult =
  | { ok: true; sessionId: ApiEntityId }
  | { ok: false; error: import('./errors').BureauError };

export type ApiSendStreamMessageInput = {
  sessionId: ApiEntityId;
  format: 'text' | 'json' | 'binary-hex';
  payload: string;
};

export type ApiCloseStreamInput = {
  sessionId: ApiEntityId;
  code?: number;
  reason?: string;
};

export type ApiIntrospectGraphqlInput = {
  workspaceId: ApiEntityId;
  requestId: ApiEntityId;
  draft?: ApiSendRequestInput['draft'];
  environmentId?: ApiEntityId | null;
};

export type ApiGraphqlSchemaSummary = {
  endpoint: string;
  fetchedAt: string;
  queryTypeName?: string;
  mutationTypeName?: string;
  subscriptionTypeName?: string;
  /** Bounded, flattened field index used for the schema browser and completion. */
  types: Array<{ name: string; kind: string; fields: string[] }>;
};

export type ApiSaveTlsProfileInput = {
  workspaceId: ApiEntityId;
  profileId?: ApiEntityId;
  expectedRevision?: number;
  name: string;
  caPem?: string;
  clientCertPem?: string;
  clientKeySecretId?: ApiEntityId | null;
  passphraseSecretId?: ApiEntityId | null;
  minVersion?: 'TLSv1.2' | 'TLSv1.3' | null;
  allowInvalidCertificateHosts: string[];
  enabled: boolean;
};

export type ApiDeleteTlsProfileInput = {
  workspaceId: ApiEntityId;
  profileId: ApiEntityId;
  expectedRevision: number;
};

export type ApiSaveOAuthProfileInput = {
  workspaceId: ApiEntityId;
  profileId?: ApiEntityId;
  expectedRevision?: number;
  name: string;
  grant: ApiOAuthGrant;
  authorizationUrl?: string;
  tokenUrl: string;
  clientId: string;
  clientSecretId?: ApiEntityId | null;
  scope?: string;
  audience?: string;
  redirectPort?: number | null;
};

export type ApiDeleteOAuthProfileInput = {
  workspaceId: ApiEntityId;
  profileId: ApiEntityId;
  expectedRevision: number;
};

export type ApiOAuthProfileRefInput = {
  workspaceId: ApiEntityId;
  profileId: ApiEntityId;
};

/* ------------------------------------------------- Phase 3: import and export */

export type ApiInterchangeFormat = 'curl' | 'postman' | 'openapi' | 'har' | 'bureau';

/**
 * A non-fatal note attached to a preview or an export plan. Import warnings say what was
 * degraded on the way in; export omissions say what will be lost on the way out — and are
 * always shown *before* anything is written.
 */
export type ApiInterchangeNote = {
  code: string;
  message: string;
  /** Location in the source document, when the importer can identify one. */
  path?: string;
};

/** One node of the normalised, not-yet-committed tree shown in the import preview. */
export type ApiImportDraftNode = {
  tempId: string;
  parentTempId: string | null;
  kind: 'folder' | 'request';
  name: string;
  protocol?: ApiProtocol;
  method?: string;
  /** Still templated; variables are not resolved during preview. */
  url?: string;
  /** True when script source came with the node. It is always stored disabled. */
  hasScripts?: boolean;
  /** Name it would take at the destination after the conflict strategy is applied. */
  resolvedName?: string;
  conflict?: boolean;
};

export type ApiImportDraftEnvironment = {
  tempId: string;
  name: string;
  variableCount: number;
  /** Values the importer classified as secret; never carried into storage as plaintext. */
  secretCount: number;
  conflict?: boolean;
};

export type ApiImportPreview = {
  previewId: ApiEntityId;
  format: ApiInterchangeFormat;
  /** File name or "Pasted text" — never a full filesystem path. */
  sourceLabel: string;
  nodes: ApiImportDraftNode[];
  environments: ApiImportDraftEnvironment[];
  warnings: ApiInterchangeNote[];
  counts: {
    folders: number;
    requests: number;
    environments: number;
    scripts: number;
    secrets: number;
  };
  /** True when a bound (node cap, depth, document count) stopped the parse early. */
  truncated: boolean;
};

export type ApiImportConflictStrategy = 'rename' | 'replace' | 'skip';

export type ApiInspectImportInput = {
  workspaceId: ApiEntityId;
  /** 'auto' sniffs the format from the content. */
  format: ApiInterchangeFormat | 'auto';
  /** Pasted source. Mutually exclusive with `fromFile`. */
  text?: string;
  /** Opens a main-owned picker. The renderer never supplies a filesystem path. */
  fromFile?: boolean;
};

export type ApiCommitImportInput = {
  workspaceId: ApiEntityId;
  previewId: ApiEntityId;
  /** Destination folder, or null for the workspace root. */
  parentId: ApiEntityId | null;
  conflictStrategy: ApiImportConflictStrategy;
  /**
   * Imported scripts are stored disabled regardless. This only records that the user was
   * shown the script list and accepted it; enabling still happens per collection afterwards.
   */
  acknowledgeScripts: boolean;
};

export type ApiImportReport = {
  createdFolders: number;
  createdRequests: number;
  createdEnvironments: number;
  renamed: number;
  replaced: number;
  skipped: number;
  /** Scripts carried in, all disabled. */
  scriptsImportedDisabled: number;
  warnings: ApiInterchangeNote[];
};

export type ApiExportScope =
  | { kind: 'workspace' }
  | { kind: 'collection'; collectionId: ApiEntityId }
  | { kind: 'request'; requestId: ApiEntityId }
  | { kind: 'history'; historyIds: ApiEntityId[] };

export type ApiExportPlanInput = {
  workspaceId: ApiEntityId;
  format: ApiInterchangeFormat;
  scope: ApiExportScope;
};

/** Shown before any file is written, so a lossy export is always a deliberate choice. */
export type ApiExportPlan = {
  format: ApiInterchangeFormat;
  itemCount: number;
  omissions: ApiInterchangeNote[];
  /** Initial exports never contain secret values. */
  includesSecrets: false;
  /** True for HAR, which carries cookies, Authorization headers, and bodies. */
  privacySensitive: boolean;
  suggestedFileName: string;
  /** Rendered content for a single-request cURL export, so it can be previewed or copied. */
  inlinePreview?: string;
};

export type ApiCommitExportInput = ApiExportPlanInput;

/* --------------------------------------- Phase 4: script sandbox and collection runner */

export type ApiScriptPhase = 'pre-request' | 'post-response';

/** Where a script came from, so the inspector can name it without guessing. */
export type ApiScriptHolder = {
  kind: 'folder' | 'request';
  id: ApiEntityId;
  name: string;
};

export type ApiScriptConsoleEntry = {
  level: 'log' | 'warn' | 'error';
  /** Redacted and length-bounded before it leaves main. */
  text: string;
  truncated?: boolean;
};

export type ApiAssertionResult = {
  name: string;
  passed: boolean;
  /** Redacted failure detail; absent when the assertion passed. */
  message?: string;
};

/**
 * The result of running one script holder in one phase. A script that was skipped because it is
 * disabled still produces no outcome at all — `ran: false` means the sandbox was entered but the
 * script produced nothing (an empty source).
 */
export type ApiScriptOutcome = {
  phase: ApiScriptPhase;
  holder: ApiScriptHolder;
  ran: boolean;
  ok: boolean;
  durationMs: number;
  console: ApiScriptConsoleEntry[];
  /** Console entries dropped by the per-phase cap. */
  consoleDropped: number;
  tests: ApiAssertionResult[];
  /** Names only — a runtime write may hold a secret-derived value. */
  variableWrites: string[];
  errorCode?: 'API_SCRIPT_FAILED' | 'API_SCRIPT_LIMIT_EXCEEDED' | 'API_CANCELLED';
  /** Redacted message, with the guest line/column when the runtime reported one. */
  errorMessage?: string;
  errorLine?: number;
};

export type ApiValidateScriptInput = {
  source: string;
  phase: ApiScriptPhase;
};

export type ApiValidateScriptResult =
  | { ok: true }
  | { ok: false; message: string; line?: number; column?: number };

/**
 * Enables or disables every script under one collection subtree in a single confirmed action.
 * This is the only way imported (untrusted) script source becomes runnable.
 */
export type ApiApproveScriptsInput = {
  workspaceId: ApiEntityId;
  /** Subtree root, or null for the whole workspace. */
  collectionId: ApiEntityId | null;
  enabled: boolean;
  /**
   * The workspace revision the reviewed list was read from. Enabling scripts is a security
   * decision about a *specific* set of sources, so it must not land on a workspace that gained
   * another script in the meantime.
   */
  expectedRevision: number;
};

/** A script location listed in the approval dialog, so enabling is never a blind toggle. */
export type ApiScriptLocation = {
  holder: ApiScriptHolder;
  phases: ApiScriptPhase[];
  enabled: boolean;
  origin: 'authored' | 'imported';
  /** Path from the subtree root, for display. */
  path: string;
};

export type ApiRunTarget =
  | { kind: 'workspace' }
  | { kind: 'collection'; collectionId: ApiEntityId }
  | { kind: 'request'; requestId: ApiEntityId };

/**
 * A parsed iteration data set held in main. The renderer only ever sees this summary and passes
 * the `dataSetId` back, so rows never round-trip over IPC.
 */
export type ApiRunDataSummary = {
  dataSetId: ApiEntityId;
  /** File name only — never a filesystem path. */
  fileName: string;
  rowCount: number;
  columns: string[];
  warnings: ApiInterchangeNote[];
};

export type ApiRunConfig = {
  workspaceId: ApiEntityId;
  target: ApiRunTarget;
  environmentId?: ApiEntityId | null;
  /** 1..100. With a data set, one iteration per row up to this many. */
  iterations: number;
  /** Delay between requests, 0..60000 ms. */
  delayMs: number;
  stopOnFailure: boolean;
  perRequestTimeoutMs?: number;
  dataSetId?: ApiEntityId;
};

export type ApiRunItemResult = {
  itemId: ApiEntityId;
  requestId: ApiEntityId;
  name: string;
  iteration: number;
  method: string;
  url: string;
  status?: number;
  ok: boolean;
  totalMs: number;
  tests: ApiAssertionResult[];
  scripts: ApiScriptOutcome[];
  historyId?: ApiEntityId;
  errorCode?: string;
  errorMessage?: string;
};

export type ApiRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type ApiRunReport = {
  runId: ApiEntityId;
  workspaceId: ApiEntityId;
  status: ApiRunStatus;
  startedAt: string;
  finishedAt?: string;
  environmentName?: string;
  dataFileName?: string;
  iterations: number;
  /** Total requests the run intends to make, so progress is a fraction and not a guess. */
  plannedItems: number;
  items: ApiRunItemResult[];
  totals: {
    requests: number;
    failedRequests: number;
    assertions: number;
    failedAssertions: number;
    scriptErrors: number;
    totalMs: number;
  };
  /** True when the run started with at least one enabled script. */
  scriptsEnabled: boolean;
  stoppedOnFailure?: boolean;
};

export type ApiRunStartedEvent = {
  type: 'run-started';
  runId: ApiEntityId;
  workspaceId: ApiEntityId;
  seq: number;
  plannedItems: number;
  iterations: number;
  scriptsEnabled: boolean;
};

export type ApiRunItemEvent = {
  type: 'run-item';
  runId: ApiEntityId;
  workspaceId: ApiEntityId;
  seq: number;
  completed: number;
  item: ApiRunItemResult;
};

export type ApiRunCompleteEvent = {
  type: 'run-complete';
  runId: ApiEntityId;
  workspaceId: ApiEntityId;
  seq: number;
  report: ApiRunReport;
};

export type ApiRunEvent = ApiRunStartedEvent | ApiRunItemEvent | ApiRunCompleteEvent;

export type ApiCancelRunInput = { runId: ApiEntityId };

export type ApiRunReportRefInput = { runId: ApiEntityId };

export type ApiExportRunReportInput = {
  runId: ApiEntityId;
  format: 'json' | 'junit';
};

/* ------------------------------------------- Phase 5: backup and restore */

/**
 * What a restore would do, shown before anything is written — the same two-step shape as Phase 3's
 * import, and for the same reason: a restore that silently replaced a workspace would be the most
 * destructive operation in the app.
 */
export type ApiRestorePlan = {
  restoreId: ApiEntityId;
  /** File name only — never a filesystem path. */
  sourceLabel: string;
  createdAt?: string;
  workspaces: Array<{
    workspaceId: ApiEntityId;
    name: string;
    requestCount: number;
    environmentCount: number;
    /** True when a workspace with this id already exists. */
    conflict: boolean;
  }>;
  warnings: ApiInterchangeNote[];
};

export type ApiCommitRestoreInput = {
  restoreId: ApiEntityId;
  /** `merge` keeps existing workspaces and restores the rest; `replace` overwrites conflicts. */
  mode: 'merge' | 'replace';
};

export type ApiRestoreReport = {
  restored: number;
  replaced: number;
  skipped: number;
  warnings: ApiInterchangeNote[];
};
