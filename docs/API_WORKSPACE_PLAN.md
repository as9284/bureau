# Bureau API Workspace Plan

Status: Phases 0–3 implemented. Phases 4–5 not started.  
Date: 2026-07-29  
Target: Bureau desktop application  
Working name: API  
Plan owner: Bureau maintainers

> **Implementation status.** Phase 0 (navigation + boundary), Phase 1 (persistence, collections,
> environments, REST), Phase 2 (GraphQL, WebSocket, SSE, OAuth 2, TLS profiles), and Phase 3
> (import/export interoperability) are implemented and covered by the unit, integration, component, and
> e2e suites. See §32 for what is and is not included.

## 1. Purpose

Bureau will gain a permanent top-level **API** workspace beside **Projects**. The workspace will be a
local-first, single-user API development client for composing, organizing, executing, inspecting, and
testing REST, GraphQL, WebSocket, and Server-Sent Events traffic.

This is not a Postman skin or an embedded website. It is a native Bureau workbench built on the existing
Electron security model, typed IPC boundary, graphite design system, storage conventions, and test
standards.

The implementation must preserve Bureau's core process boundary:

```text
main services -> validated IPC -> frozen preload bridge -> Zustand store -> React workbench
```

All network traffic, OAuth token handling, secret resolution, import/export file access, and script
execution belong in the main process. The renderer edits declarative request models and receives
bounded, sanitized result data.

## 2. Locked product decisions

| Area | Decision |
|---|---|
| Navigation | Permanent top-level `Projects` and `API` tabs |
| API data | Global, with optional links to tracked Bureau projects |
| Delivery | Phased, with explicit release gates |
| Launch protocols | REST, GraphQL, WebSocket, and SSE |
| Authentication | Basic, Bearer, API key, OAuth 2, and encrypted secrets |
| Interchange | Postman Collection v2.1, OpenAPI, cURL, HAR, and native Bureau format |
| Scripts | Sandboxed JavaScript with no Node.js or filesystem access |
| Destinations | Public internet, LAN, and localhost |
| TLS | Strict verification by default; weakened verification requires explicit host-scoped configuration |
| Product boundary | Single-user and local-only, with no account, collaboration service, or cloud sync |

## 3. Success criteria

The feature is complete when a user can:

1. Move between Projects and API without losing project or request state.
2. Create global API workspaces, optionally associate one with a tracked Bureau project, and keep the API
   data when that project is removed.
3. Build, save, duplicate, rename, move, search, and delete requests and folders.
4. Execute HTTP requests against public, LAN, and loopback hosts from the main process.
5. inspect status, timings, headers, cookies, text, JSON, XML, HTML, images, and binary response metadata.
6. Compose GraphQL queries with variables and operation selection.
7. Open WebSocket sessions, exchange text or binary messages, and inspect connection events.
8. Open SSE streams, inspect parsed events, pause display, and terminate or reconnect safely.
9. Use Basic, Bearer, API key, OAuth 2 Authorization Code with PKCE, OAuth 2 Client Credentials, and
   refresh tokens without storing secrets in plaintext.
10. Use workspace, environment, collection, request, and runtime variables with deterministic precedence.
11. Import and export the five approved formats without executing imported code or leaking secrets.
12. Write bounded pre-request and post-response scripts, define assertions, and run a collection locally.
13. Cancel any in-flight request or stream and have all sockets, listeners, timers, workers, and temporary
    files released.
14. Recover from corrupt storage, unavailable encrypted storage, failed imports, network errors, and stale
    linked projects without presenting a blank pane.

## 4. Explicit non-goals

The following are not part of the initial product:

- Bureau accounts, teams, comments, roles, sharing links, cloud history, or cloud synchronization.
- A public API catalogue, template marketplace, hosted mock server, hosted monitors, or hosted test runs.
- Arbitrary Node.js scripts, package imports, filesystem access, child processes, or shell commands.
- Browser extension capture or traffic interception.
- A general packet sniffer, reverse proxy, or man-in-the-middle TLS debugger.
- Automatic request execution when Bureau starts, a collection is imported, or a project is opened.
- Unattended scheduled runs in the first release.
- gRPC in the first release. The architecture must leave room for it, but the four approved launch
  protocols take priority.
- Exact compatibility with every Postman runtime API. Interchange compatibility and predictable Bureau
  behavior matter more than reproducing undocumented quirks.

## 5. Current-state audit

### 5.1 Navigation

The renderer currently has:

```ts
type AppView = 'hub' | 'project' | 'settings';
type ActiveSection = 'projects' | 'settings';
```

`WorkbenchShell` selects `HubOverview`, `ProjectWorkspace`, or `SettingsPage`. `ProjectWorkspace` owns the
per-project `Overview`, `Files`, `Processes`, `Terminal`, `Preview`, `Android`, and `Git` strip.

The API workspace must therefore introduce a primary navigation layer. It must not be added to
`PROJECT_TAB_IDS`, because API data is global and the user explicitly chose an optional project link.

### 5.2 Privileged capabilities

Bureau already:

- validates trusted IPC senders before parsing request arguments;
- uses Zod schemas at IPC boundaries;
- exposes a frozen preload API rather than `ipcRenderer`;
- stores structured app data under Electron's `userData` path;
- writes JSON atomically;
- encrypts the Gitea token with Electron `safeStorage`;
- keeps a closed shared `BureauErrorCode` union;
- supports streamed main-to-renderer event channels;
- provides resizable panels, CodeMirror, typed controls, banners, skeletons, dialogs, toasts, and live
  regions.

The API workspace should reuse these mechanisms rather than create parallel infrastructure.

### 5.3 Design baseline

`docs/DESIGN_SPEC.md` remains authoritative. The new workspace reads as a dense developer workbench:

- Design variance: 4
- Motion intensity: 3
- Visual density: 9
- Existing graphite surfaces and periwinkle accent
- Flat resting chrome and hairline separators
- Mono text for URLs, methods, headers, payloads, byte counts, timings, status codes, and message frames
- Functional 80-160 ms transitions only

No second component library or independent theme should be introduced.

## 6. Information architecture

### 6.1 Primary application tabs

Add an **API** nav item to the title bar, immediately right of the project switcher:

```text
Title bar: Bureau | [project ▾] [API] | command bar | window controls
Contextual workspace content
Status bar
```

> **Revised 2026-07-29.** An earlier draft placed a `PrimaryTabStrip` beneath the title bar. That row
> was dropped: API is global like the project switcher is, so it belongs beside it in the title bar
> rather than in a second tab row competing with the per-project tab strip. The shell is back to three
> grid rows (title bar / workspace / status bar).

Rules:

- The API item is visible wherever the title bar is — the Projects hub, project workspaces, the API
  workspace, and Settings.
- It toggles: activating it opens API, activating it again returns to the last Projects destination.
- Immersive emulator and preview modes may cover the title bar using the existing immersive layer rules.
- `Projects` restores the last projects destination: either the hub or the previously selected project and
  project tab.
- `API` restores the last API workspace, request document, environment, and internal panel selection.
- Settings is not a third primary tab. Opening Settings remembers the prior primary destination, and closing
  it returns there.
- The project switcher continues to select projects. While API is active, selecting a project switches to
  Projects and opens that project.
- API commands are added to the command palette, including `Open API`, `New request`, `Send request`,
  `Cancel request`, `Import`, `Open environment`, and `Run collection`.

Suggested state model:

```ts
type PrimaryWorkspace = 'projects' | 'api';
type AppView = 'hub' | 'project' | 'api' | 'settings';

type NavigationState = {
  primaryWorkspace: PrimaryWorkspace;
  projectsReturnView: 'hub' | 'project';
  settingsReturnView: Exclude<AppView, 'settings'>;
};
```

Do not overload `activeSection` with API-specific concepts. Replace it with the clearer primary workspace
model and migrate all callers together.

### 6.2 API workbench layout

The default layout is a dense three-region workbench:

```text
┌─ API toolbar: workspace | environment | project link | import | new ───────────┐
├───────────────┬────────────────────────────────────────────────────────────────┤
│ Sidebar       │ Request document tabs                                          │
│               ├────────────────────────────────────────────────────────────────┤
│ Collections   │ Method | URL                                      Send / Cancel │
│ History       ├────────────────────────────────────────────────────────────────┤
│ Environments  │ Params | Auth | Headers | Body | Scripts | Settings             │
│               │ Request editor                                                  │
│               ├────────────────── resizable horizontal separator ───────────────┤
│               │ Response summary and tabs                                       │
│               │ Pretty | Raw | Preview | Headers | Cookies | Tests | Timeline    │
└───────────────┴────────────────────────────────────────────────────────────────┘
```

Layout behavior:

- Sidebar width: 220-440 px, persisted in app settings.
- Request and response split: vertical resize with a useful minimum for both sides.
- Sidebar modes use one compact local tab row and all provide loading, empty, error, and populated states.
- Request documents use a tab strip with dirty, loading, streaming, and error text/icon signals.
- Narrow windows collapse the sidebar to a toggleable overlay and switch the composer/response split to
  stacked views.
- The active request remains mounted only when needed for an active stream. Ordinary inactive documents
  serialize draft state and may unmount.
- No raw OS controls. Use Bureau `Dropdown`, `Checkbox`, `TextField`, `TextArea`, `Button`, `IconButton`,
  `Dialog`, `Banner`, `Skeleton`, `EmptyState`, `ResizablePanel`, and CodeMirror.

### 6.3 Composer behavior

#### Common request line

- Protocol-aware method or connection-mode selector
- Templated URL field
- Environment selector
- Send, Connect, Cancel, or Disconnect primary action according to protocol state
- Save state and a request overflow menu
- Inline validation before execution

#### Common editor tabs

- **Params:** ordered, enabled/disabled, duplicate-preserving name/value rows
- **Auth:** inherited, none, Basic, Bearer, API key, OAuth 2
- **Headers:** ordered, enabled/disabled, duplicate-preserving rows plus computed-header preview
- **Body:** none, JSON, text, XML, HTML, form URL encoded, multipart, binary file
- **Scripts:** pre-request and post-response editors with limits and permission summary
- **Settings:** redirects, timeout, cookie jar, TLS profile, proxy profile, response cap

Labels always remain above fields. Placeholders never substitute for labels.

### 6.4 Response inspector

The response header shows:

- status code and reason;
- total duration and phase timings;
- received and decoded byte counts;
- content type and encoding;
- redirect count;
- source address and protocol where available;
- truncation, TLS exception, cache, or stale indicators.

Response tabs:

- **Pretty:** JSON tree/text formatter, XML/text formatting, image preview, and safe HTML preview
- **Raw:** bounded decoded text or hex preview for binary
- **Preview:** sanitized HTML in an isolated, script-disabled surface; never use the privileged preview view
- **Headers:** ordered raw and normalized views
- **Cookies:** cookies accepted, rejected, or changed by this response
- **Tests:** assertion results and bounded script console output
- **Timeline:** DNS, connect, TLS, upload, first byte, download, redirects

HTML preview must use a sandboxed iframe or sanitized static rendering with no scripts, forms, navigation,
downloads, permissions, or preload. It must not share the app origin.

## 7. Product data model

Create `src/shared/contracts/apiWorkbench.ts` as the canonical shared model. Representative shapes follow.
The implementation may split this file when it becomes unwieldy, but it must preserve explicit ownership.

```ts
type ApiProtocol = 'http' | 'graphql' | 'websocket' | 'sse';
type ApiEntityId = string;

type ApiWorkspaceSummary = {
  workspaceId: ApiEntityId;
  name: string;
  linkedProjectId?: string;
  activeEnvironmentId?: string;
  createdAt: string;
  updatedAt: string;
};

type ApiCollection = {
  collectionId: ApiEntityId;
  workspaceId: ApiEntityId;
  parentId: ApiEntityId | null;
  kind: 'folder' | 'request';
  name: string;
  order: number;
  auth?: ApiAuth;
  variables: ApiVariableDefinition[];
  scripts?: ApiScripts;
};

type ApiRequestDefinition = {
  requestId: ApiEntityId;
  collectionId?: ApiEntityId;
  workspaceId: ApiEntityId;
  name: string;
  protocol: ApiProtocol;
  urlTemplate: string;
  method?: string;
  query: ApiKeyValue[];
  headers: ApiKeyValue[];
  auth: ApiAuth;
  body: ApiBody;
  protocolOptions: ApiProtocolOptions;
  scripts: ApiScripts;
  settings: ApiRequestSettings;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

type ApiVariableDefinition = {
  variableId: ApiEntityId;
  name: string;
  enabled: boolean;
  secret: boolean;
  value?: string;
  hasSecretValue?: boolean;
};
```

### 7.1 Optional project links

- The API workspace owns the optional `linkedProjectId`.
- A linked project contributes display context and approved derived variables such as project name and
  detected local URLs.
- Bureau must not automatically import `.env`, source files, process environments, or repository secrets.
- Any future `.env` import is an explicit file action with preview and secret classification.
- Removing a project clears the link after confirmation but never removes API collections, environments,
  history, or secrets.
- A missing project renders a non-fatal stale-link banner with `Relink` and `Remove link` actions.

### 7.2 Variable scopes and precedence

Variable resolution order, from highest to lowest:

1. Collection-run iteration data
2. Runtime values written by the current script/run
3. Request variables
4. Collection/folder variables, nearest ancestor first
5. Selected environment variables
6. API workspace variables
7. Read-only approved linked-project variables

Rules:

- Duplicate names in one scope are rejected.
- Names are length-bounded and use a documented character set.
- Resolution detects cycles and reports the full bounded cycle.
- Missing variables remain visibly unresolved and block execution by default.
- A per-request opt-in may send unresolved placeholders literally.
- Secret values are resolved only in main.
- Variable previews show the winning scope without revealing secret content.
- URL component encoding is explicit. Query-grid values are encoded structurally; raw templates remain raw.

### 7.3 Optimistic concurrency

Every mutable persisted entity carries a monotonic `revision`. Update and delete requests include the
expected revision. A mismatch returns `STALE_STATE` with enough metadata to reload or duplicate the draft.
This prevents two open document tabs from silently overwriting one another.

## 8. Persistence and retention

### 8.1 On-disk layout

Store API data beneath the Electron `userData` directory:

```text
api/
  index.v1.json
  settings.v1.json
  secrets.v1.json
  workspaces/
    <workspaceId>.v1.json
  history/
    index.v1.json
    entries/
      <historyId>.v1.json
    bodies/
      <bodyId>.bin
  schema-cache/
    <cacheId>.json
  temp/
```

Requirements:

- All identifiers are Bureau-generated UUIDs. Never derive a file path from a user-provided name.
- JSON metadata uses `AtomicJsonStore` or an equivalent atomic temp-write plus rename strategy.
- Large bodies are separate files so saving metadata does not rewrite response payloads.
- Body records include byte length, media type, encoding, SHA-256, truncation state, and creation time.
- Temporary request/upload/download files are deleted after completion or at next-start cleanup.
- Schema validation recovers individual bad workspaces without blanking all API data.
- Unsupported future schema versions are preserved and reported as incompatible rather than overwritten.

### 8.2 Default limits

Add user-facing API settings with conservative defaults:

| Limit | Default |
|---|---:|
| Request timeout | 30 seconds |
| Redirects | 10 |
| Displayed text response | 10 MiB |
| Persisted response body | 25 MiB |
| Single request body | 50 MiB |
| WebSocket/SSE in-memory events | 5,000 |
| Per-message display size | 1 MiB |
| History entries | 500 |
| History age | 30 days |
| Total history body storage | 250 MiB |
| Import file | 50 MiB |
| Collection tree nodes per import | 10,000 |

Limits are enforced in main, not only in renderer controls. When a body exceeds the display or persistence
cap, the request can finish while the UI receives a clear truncated result. The user may explicitly save a
streamed body to a chosen file without loading it into renderer memory.

### 8.3 Secret vault

Extract or generalize the existing `SecretCipher` pattern so Gitea and API secrets share one audited
safe-storage adapter without changing Gitea behavior.

Secret rules:

- `safeStorage` encryption is mandatory for persistence.
- If OS encryption is unavailable, secrets may be used for the current session but cannot be persisted.
- Disk records contain only ciphertext, identifiers, timestamps, and non-secret labels.
- Renderer snapshots contain `hasValue`, never the decrypted value.
- Saving a secret sends plaintext once over trusted IPC, encrypts immediately, and clears local field state.
- Reveal is not provided by default. `Copy secret` may be implemented as a main-process clipboard action
  after explicit user intent.
- OAuth access tokens, refresh tokens, client secrets, Basic passwords, Bearer tokens, and secret variable
  values all use the vault.
- Secret redaction uses both known exact values and secret-derived Authorization/header forms.
- Exports omit secret values by default and state this in the confirmation dialog.

## 9. Main-process architecture

Create `src/main/api/` with narrowly owned services:

```text
src/main/api/
  ApiApplicationService.ts
  ApiWorkspaceStore.ts
  ApiHistoryStore.ts
  ApiSecretStore.ts
  ApiRequestEngine.ts
  ApiRequestCompiler.ts
  ApiSessionRegistry.ts
  HttpTransport.ts
  GraphqlTransport.ts
  WebSocketTransport.ts
  SseTransport.ts
  CookieJar.ts
  OAuthService.ts
  TlsProfileStore.ts
  ProxyProfileStore.ts
  VariableResolver.ts
  ResponseBodyStore.ts
  scripting/
    ScriptRuntime.ts
    scriptWorker.ts
    ScriptApi.ts
  import/
    ImportService.ts
    CurlImporter.ts
    PostmanImporter.ts
    OpenApiImporter.ts
    HarImporter.ts
    BureauImporter.ts
  export/
    ExportService.ts
    CurlExporter.ts
    PostmanExporter.ts
    OpenApiExporter.ts
    HarExporter.ts
    BureauExporter.ts
```

`ApiApplicationService` is the only API-workspace service exposed through `AppServices`. Internal
transports and stores remain private implementation details.

### 9.1 Request lifecycle

```text
Renderer draft
  -> Zod IPC validation
  -> load saved definition / verify revision
  -> resolve non-secret and secret variables
  -> execute pre-request script
  -> compile URL, headers, auth, cookies, body, TLS, and proxy policy
  -> register cancellable session
  -> execute transport
  -> stream bounded progress/events
  -> persist bounded history/body
  -> execute post-response script and assertions
  -> emit final result
  -> dispose session resources
```

Every send receives a generated `sessionId`. All streaming events include `sessionId`, `workspaceId`,
`requestId`, and a monotonic sequence number. Renderer stores use this identity to reject stale events.

### 9.2 Session registry

`ApiSessionRegistry` owns:

- HTTP abort controllers;
- active WebSocket clients;
- active SSE streams;
- OAuth loopback listeners;
- script workers;
- temporary file handles;
- stream sequence counters.

It provides `cancel`, `cancelAllForWorkspace`, and `dispose`. Application shutdown invokes `dispose` before
the main window is destroyed. No session survives shutdown.

## 10. Protocol implementation

### 10.1 REST and general HTTP

Supported methods:

- Standard methods: GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS, TRACE
- Custom RFC-token methods entered manually

Supported bodies:

- None
- JSON
- Plain text
- XML
- HTML
- `application/x-www-form-urlencoded`
- `multipart/form-data`
- Binary file

Transport requirements:

- HTTP and HTTPS only
- LAN, loopback, IPv4, IPv6, and public DNS
- DNS, connect, TLS, first-byte, download, and total timing where available
- decompression with decoded and wire byte counts
- cancellation during DNS, connect, upload, headers, and download
- streaming response storage with backpressure
- duplicate response headers preserved
- redirect history preserved
- cookies isolated by API workspace and optional named jar
- strict URL length, header count, header byte, and body limits
- CR, LF, and NUL rejected in methods and header names/values
- computed `Host`, `Content-Length`, connection, proxy, and WebSocket handshake headers protected from
  invalid manual combinations

Redirect policy:

- Default maximum of 10.
- Method rewriting follows standard status behavior and is visible in the timeline.
- Authorization, cookies, proxy credentials, and configured secret headers are stripped on cross-origin
  redirects unless a host-scoped rule explicitly permits forwarding.
- HTTPS-to-HTTP downgrade redirects require confirmation or a saved host-scoped rule.
- Each redirect target is revalidated through the same destination and TLS policy.

### 10.2 GraphQL

GraphQL requests share HTTP auth, headers, cookies, TLS, proxy, history, and response rendering.

Composer features:

- Query/mutation editor using CodeMirror
- Variables JSON editor
- Operation selector for multi-operation documents
- GET or POST transport
- Standard GraphQL response media types and JSON fallback
- Error list linked to response paths
- Optional schema introspection
- Cached schema browser and completion after explicit introspection

Schema introspection:

- Never occurs automatically on URL entry.
- Uses the active auth/environment only after user action.
- Has its own cancellation and size/depth limits.
- Stores no auth material in the schema cache.
- Cache can be cleared per endpoint or globally.

GraphQL subscriptions over `graphql-transport-ws` may reuse the WebSocket engine after the generic
WebSocket launch scope is stable. It is not required for the first GraphQL HTTP milestone.

### 10.3 WebSocket

Use a main-process RFC 6455 client with explicit dependency ownership. `ws` is the leading candidate and
must be installed directly if selected rather than relying on a transitive package.

Features:

- `ws:` and `wss:` URLs
- custom headers, cookies, auth, TLS profiles, proxy profiles, and subprotocols
- connect, disconnect, reconnect, ping, and pong
- text, JSON-formatted text, and binary messages
- message composer history per request
- ordered timestamped event transcript
- connection metadata, selected subprotocol, close code, and close reason
- export transcript without secret handshake headers

Backpressure:

- Store at most the configured event count in renderer memory.
- Batch events over IPC by time and count.
- Preserve dropped-event counts and sequence gaps.
- Large binary messages are stored as body handles, not base64 strings over IPC.
- Pausing display does not pause socket reads. It pauses renderer delivery while main keeps a bounded ring.
- Disconnect and unmount always release listeners and timers.

### 10.4 Server-Sent Events

SSE uses the HTTP engine and parses `text/event-stream` incrementally.

Features:

- GET request composition with standard auth, headers, cookies, TLS, and proxy support
- `event`, `data`, `id`, `retry`, comments, and multiline data parsing
- event transcript with raw and parsed views
- pause display, resume, disconnect, and clear
- optional reconnect behavior, disabled by default for a manual test session
- `Last-Event-ID` support when reconnect is enabled
- bounded buffer, batching, dropped-event counter, cancellation, and history summary

Never buffer an unbounded SSE response body. Persist only the configured bounded transcript.

## 11. Destination, TLS, proxy, and cookie policy

### 11.1 Destination policy

Manual requests may target:

- public internet hosts;
- private RFC 1918 and ULA networks;
- loopback and localhost;
- user-selected IPv4 and IPv6 literals.

Special handling:

- Only `http`, `https`, `ws`, and `wss` schemes enter network transports.
- Cloud metadata destinations and equivalent link-local credential endpoints are denied by default.
- A future advanced setting may allow a specific metadata host after an explicit danger confirmation.
- Imported collections never run automatically.
- Collection runs show the resolved destination host set before the first execution.
- Scripts cannot create undeclared network traffic in the initial scripting release.

These rules defend against a malicious imported collection without defeating the purpose of a local API
client.

### 11.2 TLS profiles

Strict certificate and hostname verification is always the default.

A TLS profile may contain:

- custom CA certificate;
- client certificate and encrypted private key/passphrase;
- minimum TLS version;
- host-scoped `allowInvalidCertificate` exception.

Weakened TLS rules:

- No global `rejectUnauthorized: false`.
- Exceptions are exact-host and optional-port scoped.
- Creating an exception requires a danger dialog naming the host and risk.
- Active exceptions show a persistent warning in the request and response chrome.
- Redirects do not carry an exception to a different host.
- Imported profiles are disabled until explicitly reviewed.
- Private keys and passphrases use encrypted storage or main-owned file handles.

### 11.3 Proxy profiles

Support in a dedicated phase:

- direct/system proxy;
- HTTP proxy;
- HTTPS CONNECT proxy;
- SOCKS proxy if the selected transport library supports it safely;
- proxy bypass list;
- proxy Basic/Bearer credentials in the secret vault.

Proxy selection is workspace or request scoped. Proxy environment variables from Bureau's launch
environment must not silently override the selected profile.

### 11.4 Cookie jars

- Each API workspace has an isolated default cookie jar.
- Additional named jars are optional.
- Cookies never share storage with Bureau, preview sessions, OAuth browser sessions, or other workspaces.
- Domain, path, secure, HttpOnly, SameSite, expiry, and host-only behavior are preserved.
- The cookie inspector supports deletion and clearing with confirmation.
- Cookie values are treated as sensitive in exports and logs.

## 12. Authentication and OAuth 2

### 12.1 Authentication model

```ts
type ApiAuth =
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
  | { kind: 'oauth2'; profileId: string };
```

Auth inheritance follows request, folder, collection, then workspace. The resolved auth source is visible
without exposing values.

### 12.2 OAuth 2 flows

Initial support:

- Authorization Code with PKCE S256
- Client Credentials
- Refresh Token
- Manual Bearer token entry

Later compatibility:

- Device Authorization Grant
- Legacy password and implicit flows only behind a compatibility warning, if real user demand appears

Authorization Code flow:

1. Main generates high-entropy `state`, PKCE verifier, and S256 challenge.
2. Main opens a loopback listener on `127.0.0.1` only, preferably on an ephemeral port.
3. Bureau opens the system browser, not a privileged embedded login view.
4. Callback validation checks path, state, timeout, one-time use, and expected provider profile.
5. Main exchanges the code directly with the token endpoint.
6. Tokens are encrypted immediately.
7. The listener closes on success, failure, cancellation, or timeout.
8. Bureau never logs authorization codes, tokens, client secrets, verifiers, or full callback URLs.

Profiles that require a fixed loopback port may configure one explicitly. Port conflicts are reported
without silently selecting an incompatible redirect URI.

Token refresh:

- Refresh is single-flight per profile.
- Concurrent requests wait for the same refresh.
- A failed refresh does not overwrite a still-valid token.
- Rotated refresh tokens replace old ciphertext atomically.
- Expiry uses a small skew to avoid racing the server.
- Reauthorization is explicit when refresh fails.

## 13. Script sandbox and tests

### 13.1 Security boundary

Do not use Node's `node:vm` as the sandbox. Node documents that it is not a security mechanism.

Use a dedicated worker plus a separately bounded JavaScript runtime. The preferred design is
`quickjs-emscripten` in a worker thread because it provides a Wasm-isolated JavaScript heap and explicit
memory and deadline controls without a native Electron ABI dependency.

Mandatory limits:

| Resource | Pre-request | Post-response |
|---|---:|---:|
| Wall-clock deadline | 500 ms | 2 seconds |
| Runtime heap | 16 MiB | 32 MiB |
| Console entries | 100 | 200 |
| Console entry size | 8 KiB | 8 KiB |
| Total returned data | 256 KiB | 1 MiB |

The main process may terminate the worker for deadline, memory, protocol, or cancellation violations.

### 13.2 Exposed script API

Expose a small Bureau-owned API:

```ts
bureau.request
bureau.response
bureau.variables.get(name)
bureau.variables.set(name, value)
bureau.variables.unset(name)
bureau.environment.name
bureau.test(name, assertion)
bureau.expect(value)
console.log(...)
```

Do not expose:

- `require`, `process`, `Buffer`, Node globals, Electron, IPC, filesystem, network, timers without limits,
  dynamic module loading, WebAssembly compilation, or host object prototypes;
- direct access to the secret vault;
- arbitrary host functions;
- unrestricted `eval` or module imports beyond what the isolated runtime inherently needs to execute the
  submitted script.

Secret variables may be read through the variable API only for use in the current request. Any secret
appearing in console output, assertion messages, errors, history, or exports is redacted.

### 13.3 Imported scripts

- Import preserves script source but marks it disabled and untrusted.
- The import preview lists every imported script and its location.
- Enabling scripts requires explicit confirmation per collection.
- A collection runner shows whether scripts are enabled before execution.
- Imported scripts cannot expand their capabilities.

### 13.4 Assertions and collection runner

The runner executes a selected folder or collection sequentially by default:

- environment selection;
- optional JSON or CSV iteration data;
- configurable iteration count and request delay;
- stop-on-failure option;
- per-request timeout;
- pre-request and post-response scripts;
- assertion summary;
- cancel and cleanup;
- local JSON/JUnit-style report export with secrets redacted.

Parallel execution is deferred until variable mutation semantics and target load controls are proven.
There are no background schedules in the initial runner.

## 14. Import and export

### 14.1 Common import pipeline

Every importer follows:

```text
choose/paste input
  -> size and format detection
  -> parse with bounded depth/count
  -> normalize to an in-memory draft
  -> validate
  -> show import preview and warnings
  -> user chooses destination/conflicts/scripts
  -> one atomic commit
```

No importer executes commands, scripts, URLs, schema references, or collection requests during preview.
Partial writes are rolled back.

### 14.2 cURL

- Parse command text without invoking a shell.
- Support common method, URL, header, cookie, auth, data, form, upload, redirect, timeout, proxy, and TLS
  options.
- Reject command substitution, pipes, redirects, environment expansion, and unsupported executable chains.
- Export one request as a readable cURL command with platform-neutral quoting.
- Secret values export as variable placeholders or redacted tokens by default.

### 14.3 Postman Collection v2.1

- Validate against the published Postman Collection v2.1 schema.
- Import folders, requests, auth, variables, examples, and scripts.
- Preserve unsupported fields in bounded namespaced metadata when practical.
- Disable imported scripts until reviewed.
- Export HTTP collections as v2.1 JSON.
- Multi-protocol Bureau collections export the compatible HTTP/GraphQL subset with a clear omission report.
- Evaluate Postman's newer v3 collection format after v2.1 is stable. It is not a substitute for the
  approved v2.1 requirement.

### 14.4 OpenAPI

Support JSON and YAML for:

- OpenAPI 3.2.x
- OpenAPI 3.1.x
- OpenAPI 3.0.x
- Swagger/OpenAPI 2.0 as compatibility input

Import creates folders from tags or paths, requests from operations, server variables, parameters, security
schemes, example bodies, and response examples.

Reference policy:

- Local file references are confined to the user-selected import root.
- Path traversal and symlink escape are rejected using real paths.
- Remote references are blocked by default and may be fetched only after a host preview and explicit approval.
- Cycles, depth, document count, total bytes, and expansion are bounded.
- Markdown and HTML descriptions are sanitized before rendering.

Use an adapter around the chosen OpenAPI parser. `@redocly/openapi-core` is a candidate because current
Redocly tooling supports OpenAPI 2.0 through 3.2, but dependency API stability, bundle size, license,
Electron packaging, and remote-reference control must pass a spike before adoption.

Export:

- Export a compatible REST/GraphQL HTTP collection as OpenAPI 3.2.
- Emit warnings for scripts, runner behavior, WebSocket transcripts, SSE transcripts, and other concepts
  with no lossless OpenAPI representation.

### 14.5 HAR 1.2

- Import HAR 1.2 request entries as requests or history.
- Preserve duplicate headers and query parameters.
- Decode base64 bodies within limits.
- Treat cookies, Authorization headers, request bodies, and response bodies as potentially sensitive.
- Export selected HTTP history as HAR 1.2.
- Show a mandatory privacy warning and redact secrets by default.

### 14.6 Native Bureau format

Use a versioned JSON format:

```json
{
  "format": "bureau-api",
  "version": 1,
  "exportedAt": "2026-07-29T00:00:00.000Z",
  "workspace": {},
  "collections": [],
  "environments": [],
  "secretPolicy": "omitted"
}
```

The native format is the only lossless export for Bureau concepts. Initial exports omit secrets. A future
password-encrypted secret export requires a separate security design and is not implied by this plan.

## 15. IPC and preload contract

Add API channels to `src/shared/contracts/channels.ts` and API methods to `BureauApiV1`.

Group channels by capability:

### Workspace and collection

- list/create/update/delete workspaces
- get workspace snapshot
- link/unlink project
- create/update/move/delete folder or request
- save request draft with expected revision
- search workspace

### Environment and secrets

- list/create/update/delete environments
- select active environment
- save/clear/copy secret
- list TLS/proxy/cookie profiles without secret values

### Sessions

- send HTTP/GraphQL request
- cancel request
- open/send/close WebSocket
- open/close SSE
- get bounded body preview
- save body to file
- clear history
- subscribe to progress, response chunks, WebSocket events, SSE events, and completion

### OAuth

- list/create/update/delete profiles
- authorize/cancel
- refresh/revoke/clear token
- subscribe to OAuth state

### Scripts and runner

- validate script
- run collection/cancel run
- subscribe to run progress
- get/export run report

### Import/export

- inspect import
- commit import
- export selected data

All request payloads have Zod schemas in `src/shared/validation/apiWorkbench.ts`. Length, count, enum, URL,
header, method, variable, and revision limits are enforced there and again where domain context is required.

Create `src/main/ipc/registerApiHandlers.ts` and call it from `registerHandlers.ts`. It must use the existing
trusted-sender `register` wrapper before reading or parsing arguments.

Create `src/preload/apiWorkbenchBridge.ts` and expose it as `window.bureau.api`. The bridge contains only
typed invoke and subscribe methods. It never exposes generic channel names or `ipcRenderer`.

## 16. Error model

Extend the closed `BureauErrorCode` union with API-specific codes:

```text
API_WORKSPACE_NOT_FOUND
API_REQUEST_NOT_FOUND
API_ENVIRONMENT_NOT_FOUND
API_VARIABLE_UNRESOLVED
API_VARIABLE_CYCLE
API_DESTINATION_BLOCKED
API_DNS_FAILED
API_CONNECT_FAILED
API_TLS_FAILED
API_TIMEOUT
API_CANCELLED
API_REDIRECT_BLOCKED
API_RESPONSE_TOO_LARGE
API_PROTOCOL_ERROR
API_WEBSOCKET_CLOSED
API_SSE_DISCONNECTED
API_OAUTH_FAILED
API_OAUTH_STATE_MISMATCH
API_SECRET_STORAGE_UNAVAILABLE
API_SCRIPT_FAILED
API_SCRIPT_LIMIT_EXCEEDED
API_IMPORT_INVALID
API_IMPORT_LIMIT_EXCEEDED
API_EXPORT_FAILED
```

Domain services return result envelopes. Cancellation is an expected result, not an exception. Bugs still
throw and are mapped by the existing handler wrapper.

Error details must never contain secret headers, tokens, passwords, cookies, request bodies classified as
secret, private key material, or full OAuth callback URLs.

## 17. Renderer state

Create a separate `src/renderer/store/apiStore.ts`, following the Git workbench precedent. Keep only primary
navigation and lightweight API badge state in `appStore`.

Suggested normalized state:

```ts
type ApiStoreState = {
  workspaceSummaries: ApiWorkspaceSummary[];
  workspaces: Record<string, ApiWorkspaceSnapshot>;
  documents: Record<string, ApiDocumentState>;
  sessions: Record<string, ApiSessionState>;
  histories: Record<string, ApiHistoryPage>;
  runner: ApiRunnerState | null;
  activeWorkspaceId: string | null;
  activeEnvironmentByWorkspace: Record<string, string | null>;
  openRequestIdsByWorkspace: Record<string, string[]>;
  activeRequestIdByWorkspace: Record<string, string | null>;
};
```

Rules:

- Latest-request-wins for workspace loading, history paging, schema introspection, and imports.
- Session events additionally require an exact `sessionId` and monotonic `seq`.
- Draft edits are immutable Zustand updates.
- Persisted and draft revisions are distinct.
- Streaming event arrays are capped before store insertion.
- Main remains the source of truth for active sockets and request completion.
- Closing a document with an active session prompts to disconnect or keeps a clearly visible background
  session entry.
- Unsaved request drafts participate in Bureau's existing quit confirmation model.

## 18. Renderer component map

Create:

```text
src/renderer/features/api/
  ApiWorkspace.tsx
  ApiToolbar.tsx
  ApiSidebar.tsx
  ApiDocumentTabs.tsx
  RequestComposer.tsx
  RequestLine.tsx
  ParamsEditor.tsx
  AuthEditor.tsx
  HeadersEditor.tsx
  BodyEditor.tsx
  ScriptsEditor.tsx
  RequestSettingsEditor.tsx
  ResponseInspector.tsx
  ResponseBodyView.tsx
  ResponseHeadersView.tsx
  ResponseCookiesView.tsx
  ResponseTestsView.tsx
  ResponseTimeline.tsx
  GraphqlComposer.tsx
  WebSocketConsole.tsx
  SseConsole.tsx
  EnvironmentEditor.tsx
  CollectionRunner.tsx
  ImportDialog.tsx
  ExportDialog.tsx
  OAuthDialog.tsx
  TlsProfileDialog.tsx
  apiFormat.ts
```

Add `src/renderer/styles/api.css` and import it from the renderer entry point. All values use existing
tokens. Add tokens only when a semantic need is proven and document them in `DESIGN_SPEC.md`.

## 19. Accessibility, keyboard, and feedback

Keyboard behavior:

- `Ctrl+Enter`: send/connect current request
- `Escape`: cancel an in-flight send, close an overlay, or leave a focused menu according to context
- `Ctrl+S`: save current request
- `Ctrl+N`: new API request when API is active
- `Ctrl+W`: close current request document, with dirty/active-session protection
- Arrow keys and Home/End: request tabs, sidebar mode tabs, and tree navigation
- Standard tree semantics for collections and folders

Accessibility:

- 28 px minimum targets, comfortable-density scaling, 2 px focus rings
- request documents and local mode strips use correct tab roles and roving focus
- collection tree uses tree/treeitem/group semantics
- URL, method, status, duration, byte count, and message timestamps use mono and tabular numerals
- streaming status is announced only on meaningful transitions, not for every chunk or message
- color is paired with text for status, TLS warnings, test results, and connection state
- editors have accessible labels outside CodeMirror
- response truncation and secret redaction are textual
- forced-colors and reduced-motion coverage

Every pane implements loading, empty, error, degraded/stale, and ready states.

## 20. Settings

Add an `API` Settings section with:

- default timeout;
- redirect limit;
- response display/persistence caps;
- history count, age, and storage cap;
- WebSocket/SSE transcript cap;
- default cookie behavior;
- default TLS profile;
- proxy profiles;
- TLS profiles and explicit weakened-verification hosts;
- automatic JSON formatting;
- line wrapping;
- imported-script default, fixed to disabled unless a future security review permits otherwise;
- clear history, clear schema cache, clear cookies, and clear API secrets actions.

Destructive clear actions use Bureau dialogs and report exactly what is removed.

## 21. Security requirements

### 21.1 Trust boundary

- Only the trusted main frame can invoke API IPC.
- Preview `WebContents`, HTML response previews, imported content, and OAuth pages have no API preload.
- API responses are untrusted data.
- Imported collections, schemas, HAR files, cURL text, environments, and scripts are untrusted input.
- Project-linked repository files are untrusted input.

### 21.2 Required controls

- No shell execution and no cURL process invocation.
- No arbitrary filesystem paths from renderer.
- File bodies and import/export paths come from main-owned pickers or validated drag/drop file handles.
- Realpath confinement for OpenAPI local references.
- CRLF and NUL rejection in protocol fields.
- Bounded URL, header, body, collection, schema, script, console, event, and history data.
- Strict TLS by default and exact-host exceptions only.
- Cross-origin redirect credential stripping.
- Secret redaction before persistence, logging, events, errors, export, and clipboard-adjacent UI.
- HTML and Markdown sanitization.
- Script worker memory/deadline enforcement and termination.
- No automatic imported-script execution.
- No automatic imported-request execution.
- Dependency security and license review before adding transport, parser, proxy, cookie, or sandbox packages.

### 21.3 Static guard additions

Extend `scripts/check-forbidden-apis.mjs` to catch:

- `rejectUnauthorized: false` outside the audited TLS policy module;
- `node:vm` use in API scripting;
- generic `ipcRenderer` API-client channels;
- direct network calls from renderer API feature files;
- plaintext secret fields in API persistence records;
- shell/cURL invocation patterns in import code.

Scoped allow comments, if unavoidable, must identify the audited module and rationale.

## 22. Performance and resilience

- Stream response bodies to disk or bounded buffers rather than concatenate unbounded chunks.
- Throttle HTTP progress events and batch WebSocket/SSE events.
- Do not parse or pretty-print large JSON on the React render path. Use a worker or bounded incremental view.
- Virtualize long history, message, event, and collection-run result lists.
- Cache CodeMirror language extensions and theme compartments.
- Abort obsolete schema, history, and import work.
- Use content hashes for schema/body deduplication only after profiling shows value.
- Recover orphaned temp files on startup.
- Shut down active sockets and workers with a bounded deadline.
- A failed API subsystem must degrade the API tab without preventing Projects from opening.

## 23. Dependency plan

No dependency is added until the owning phase and a focused spike confirm Electron 36/CommonJS packaging.

Likely additions:

| Capability | Candidate | Gate |
|---|---|---|
| WebSocket client | `ws` | RFC behavior, proxy/TLS hooks, no optional native addon required |
| Script runtime | `quickjs-emscripten` | Wasm packaging, worker termination, memory/deadline enforcement |
| YAML | `yaml` | schema-bomb limits and package size |
| OpenAPI | `@redocly/openapi-core` behind an adapter | OpenAPI 2.0-3.2, reference control, stable documented API |
| Cookies | standards-compliant cookie jar package or small audited adapter | SameSite, prefix, expiry, redirect correctness |
| Proxy | focused proxy-agent packages | exact proxy support, TLS propagation, no environment surprises |

Avoid native dependencies unless there is no safe alternative. If a native dependency becomes necessary, it
must follow Bureau's lazy-load and graceful-degradation rule and pass Windows packaging tests.

## 24. Phased delivery plan

### Phase 0: Architecture and primary navigation

Goal: establish the global API boundary without networking.

Tasks:

1. Update `docs/DESIGN_SPEC.md` with the primary `Projects | API` strip and API workbench inventory.
2. Add `PrimaryWorkspace`, extend `AppView`, and preserve return destinations.
3. Build the title-bar `ApiNavButton` and wire command-palette navigation.
4. Add empty/loading/error API workspace shell.
5. Add shared base contracts, validation file, API error codes, service contract, handler registrar, preload
   bridge skeleton, and separate renderer store.
6. Add API settings defaults and storage schema migration.
7. Add component, navigation, settings-schema, IPC-sender, and startup regression tests.

Acceptance:

- Projects behavior is unchanged.
- Projects and API navigation state survives switching and Settings.
- Project tab ordering remains exclusively per-project.
- API failure cannot blank Projects.
- Primary tabs are keyboard accessible in both densities and themes.

### Phase 1: Persistence, collections, environments, and REST

Goal: a robust local HTTP client.

Tasks:

1. Implement workspace, collection, environment, history, response-body, and secret stores.
2. Implement entity revisions and stale-write handling.
3. Build collection tree, request documents, composer, response inspector, and history.
4. Implement variable resolution and secret handling.
5. Implement HTTP transport, cancellation, redirects, cookies, response limits, timings, and body saving.
6. Implement Basic, Bearer, and API key auth.
7. Implement optional project linking without reading repository secrets.
8. Add quit protection for dirty requests and session cleanup.
9. Add REST unit, integration, component, e2e, and security tests.

Acceptance:

- A request can be created, saved, sent to public/LAN/localhost, inspected, cancelled, reopened, and found
  in bounded history.
- Text and binary response limits work without renderer memory spikes.
- Secrets are encrypted or session-only, never plaintext on disk.
- Cross-origin redirects strip credentials.
- Project deletion leaves API data intact.

### Phase 2: GraphQL, WebSocket, SSE, OAuth 2, and TLS exceptions

Goal: complete the approved launch protocol and auth scope.

Tasks:

1. Add GraphQL query, variables, operation selection, response errors, and explicit introspection.
2. Add WebSocket transport, message composer, transcript, binary body handles, and batching.
3. Add SSE parser, transcript, bounded reconnect, and Last-Event-ID.
4. Add OAuth profiles, system-browser Authorization Code with PKCE, Client Credentials, refresh, revoke,
   and encrypted token storage.
5. Add host-scoped TLS profiles, custom CA, client certificate, and explicit invalid-certificate warnings.
6. Add protocol-specific status-bar and command-palette behavior.
7. Add local HTTP/HTTPS/GraphQL/WebSocket/SSE integration fixtures.
8. Add OAuth state, PKCE, listener lifecycle, token-redaction, and TLS-policy tests.

Release Gate A:

- REST, GraphQL, WebSocket, and SSE work end to end.
- OAuth 2 Authorization Code with PKCE and Client Credentials work against controlled fixtures.
- Strict TLS is default and exceptions cannot leak across hosts.
- All active sessions cancel and dispose cleanly.
- Full Definition of Done suite passes.

### Phase 3: Import/export interoperability

Goal: move real work into and out of Bureau safely.

Tasks:

1. Implement bounded import preview and atomic commit pipeline.
2. Implement cURL import/export without shell execution.
3. Implement Postman Collection v2.1 import/export.
4. Implement OpenAPI JSON/YAML import and compatible export.
5. Implement HAR 1.2 import/export with privacy warning and redaction.
6. Implement native Bureau format.
7. Add duplicate/conflict strategies and import reports.
8. Add realistic fixtures, malformed inputs, reference cycles, path escapes, oversize inputs, and secret
   redaction tests.

Acceptance:

- All five formats round-trip their supported concepts.
- Lossy exports report omissions before writing.
- Imported scripts are disabled.
- No import triggers network access or request execution without explicit approval.
- Imports are atomic and recoverable.

### Phase 4: Script sandbox and collection runner

Goal: programmable local testing without granting Node access.

Tasks:

1. Spike and package QuickJS/Wasm in the Electron main build.
2. Implement worker protocol, memory/deadline limits, cancellation, and redaction.
3. Implement Bureau script API and assertion library.
4. Add script editors, validation, console, and result UI.
5. Implement sequential collection runner with iteration data and report export.
6. Add imported-script approval flow.
7. Add escape, prototype, timeout, memory, console-flood, secret-leak, worker-crash, and cancellation tests.

Release Gate B:

- Scripts cannot access Node, Electron, filesystem, network, or host prototypes.
- A malicious or infinite script cannot hang Bureau.
- Runner cancellation closes in-flight traffic and the worker.
- Assertion reports are deterministic and redacted.

### Phase 5: Proxy, advanced cookies, GraphQL subscriptions, and polish

Goal: production-network compatibility and mature daily use.

Tasks:

1. Add system/direct/HTTP/HTTPS CONNECT proxy profiles and encrypted proxy credentials.
2. Complete cookie-jar inspection and named jars.
3. Add GraphQL subscriptions over the WebSocket engine.
4. Add code-generation adapters only if a concrete language list is approved.
5. Add workspace backup/restore and richer native export.
6. Profile large collections, histories, JSON payloads, and long-lived streams.
7. Run packaging tests on Windows, macOS, and Linux.
8. Decide separately whether a local CLI runner or gRPC phase is warranted.

Acceptance:

- Proxy and TLS profiles compose predictably.
- Long-lived sessions remain bounded.
- Cross-platform packaging includes all parser and Wasm assets.
- No Projects workflow regresses.

## 25. File impact map

Expected modified files:

- `docs/DESIGN_SPEC.md`
- `src/shared/contracts/api.ts`
- `src/shared/contracts/channels.ts`
- `src/shared/contracts/errors.ts`
- `src/shared/contracts/settings.ts`
- `src/shared/validation/requests.ts` or the new API validation module
- `src/main/services/createAppServices.ts`
- `src/main/ipc/serviceContracts.ts`
- `src/main/ipc/registerHandlers.ts`
- `src/main/main.ts`
- `src/preload/api.ts`
- `src/renderer/app/App.tsx`
- `src/renderer/layout/WorkbenchShell.tsx`
- `src/renderer/layout/TitleBar.tsx` (+ `ApiNavButton.tsx`)
- `src/renderer/layout/CommandPalette.tsx`
- `src/renderer/layout/StatusBar.tsx`
- `src/renderer/store/appStore.ts`
- `src/renderer/pages/SettingsPage.tsx`
- `src/renderer/styles/shell.css`
- `src/renderer/styles/tokens.css` only if an audited semantic gap exists
- `src/renderer/main.tsx`
- `scripts/check-forbidden-apis.mjs`

Expected new areas:

- `src/shared/contracts/apiWorkbench.ts`
- `src/shared/validation/apiWorkbench.ts`
- `src/main/api/**`
- `src/main/ipc/registerApiHandlers.ts`
- `src/preload/apiWorkbenchBridge.ts`
- `src/renderer/features/api/**`
- `src/renderer/store/apiStore.ts`
- `src/renderer/styles/api.css`
- `tests/unit/api/**`
- `tests/integration/api/**`
- `tests/component/api/**`
- `tests/e2e/apiWorkspaceJourney.test.ts`

## 26. Test strategy

### 26.1 Unit

- Zod request and persistence schemas
- variable precedence, missing values, encoding, and cycles
- auth inheritance and redaction
- header validation and duplicate preservation
- redirect credential stripping and downgrade policy
- TLS profile host matching
- cookie rules
- SSE parsing across arbitrary chunk boundaries
- WebSocket event ring and batching
- GraphQL request compilation
- OAuth state, PKCE, refresh single-flight, and expiry skew
- history retention and body cleanup
- cURL/Postman/OpenAPI/HAR/native parsers and exporters
- script worker protocol and limits
- navigation return-state reducer
- API Zustand stale-event guards

### 26.2 Integration

Use real local fixtures:

- HTTP server covering methods, redirects, compression, cookies, chunked responses, slow response,
  cancellation, duplicate headers, uploads, and oversized bodies
- HTTPS server with trusted, self-signed, wrong-host, custom-CA, and mutual-TLS cases
- GraphQL HTTP fixture
- RFC 6455 WebSocket server with text, binary, subprotocol, close, and burst traffic
- SSE server with split lines, multiline data, ids, retry fields, reconnect, and endless stream
- OAuth authorization/token fixture with state mismatch, code reuse, refresh rotation, and cancellation
- proxy and CONNECT fixture in Phase 5

Tests use bounded polling, never fixed sleeps. Every server, socket, listener, worker, and temp directory is
disposed in `afterEach`.

### 26.3 Component

- primary Projects/API tab keyboard behavior
- API shell loading/empty/error/degraded states
- collection tree keyboard behavior
- request tabs and dirty/streaming states
- URL/method/send/cancel flow
- Params/Auth/Headers/Body/Scripts/Settings editors
- response text, JSON, binary, truncated, error, and timing states
- WebSocket and SSE transcript caps
- OAuth and TLS warning dialogs
- import preview, omissions, script warnings, and conflict choices
- runner progress, assertion results, cancellation, and redaction
- both themes, both densities, forced colors, and reduced motion where practical

### 26.4 End to end

Headless service journey:

1. bootstrap services in a temp user-data directory;
2. create workspace, environment, collection, and request;
3. save an encrypted/session-only secret according to the injected cipher;
4. send against a real local HTTP fixture;
5. persist and reload history;
6. import then export a collection;
7. cancel a long request;
8. shut down and assert no sessions or temp files remain.

Add protocol journeys for GraphQL, WebSocket, SSE, OAuth, and runner in their owning phases.

### 26.5 Security regression matrix

- untrusted preview sender rejected before argument parsing
- malformed IPC counts and payload sizes rejected
- CRLF/NUL header injection rejected
- file path traversal and symlink escape rejected
- cross-origin secret forwarding rejected
- strict TLS remains default
- TLS exceptions exact-host scoped
- OAuth state mismatch rejected
- callback listener loopback-only and always closed
- plaintext secret absent from disk, history, logs, errors, IPC snapshots, and default exports
- import bombs and reference cycles bounded
- imported scripts disabled
- script Node/filesystem/network access impossible
- infinite scripts and event floods bounded
- HTML response scripts and navigation blocked
- shutdown closes sockets, streams, listeners, workers, and files

## 27. Definition of Done for every phase

Required commands:

```text
npm run typecheck
npm run lint
npm run test:security
npm run test:unit
npm run test:integration
npm run test:component
npm run test:e2e
```

Additionally:

- behavior is exercised end to end, not merely typechecked;
- dark and light themes are visually inspected;
- compact and comfortable densities are inspected;
- keyboard-only flows are exercised;
- streaming and cancellation are tested under load;
- secrets are searched for in temporary persisted artifacts during tests;
- Windows packaged-build smoke test passes for network, OAuth callback, WebSocket, and QuickJS/Wasm phases;
- documentation and import/export compatibility tables are updated;
- no main-only, renderer-only, IPC-only, or preload-only orphan remains.

## 28. Risks and mitigations

| Risk | Consequence | Mitigation |
|---|---|---|
| Renderer executes network requests | CORS inconsistencies and secret exposure | Main-only transports and typed IPC |
| Unbounded bodies or streams | Memory exhaustion and UI stalls | disk streaming, caps, batching, virtualization |
| Imported scripts are malicious | host compromise or data exfiltration | disabled by default, QuickJS/Wasm worker, no host access |
| Node `vm` mistaken for a sandbox | sandbox escape | explicitly forbidden and statically guarded |
| OAuth callback hijack | token theft | loopback-only listener, PKCE S256, state, timeout, one-time use |
| TLS disablement becomes global | silent interception | exact-host profiles and persistent warnings |
| Redirect leaks credentials | secret exposure | cross-origin stripping and tests |
| OpenAPI references escape import root | local file disclosure | realpath confinement and explicit remote approval |
| Native/Wasm packaging fails | launch or feature failure | dependency spike, lazy capability, packaged-build test |
| Main process becomes overloaded | app-wide stalls | streaming backpressure and workers for heavy parse/format/script work |
| API state bloats `appStore` | broad rerenders and maintenance cost | dedicated normalized `apiStore` |
| Postman compatibility expands without bound | perpetual parity chase | published v2.1 contract and explicit omission reports |
| Project link becomes ownership | accidental data loss | global API ownership, nullable link, unlink on project removal |

## 29. Release and migration strategy

- Ship storage schemas behind an internal capability flag until Phase 1 data recovery tests pass.
- Preserve API data across feature-flag disablement.
- Do not expose an empty permanent API tab in a public build before the owning phase meets its acceptance
  criteria.
- Mark Phase 1 as developer preview.
- Mark Release Gate A as the first user-facing API beta because it contains all four approved protocols and
  OAuth 2.
- Run storage migrations on copies and retain the previous file until the new version commits successfully.
- Never silently downgrade or rewrite a newer schema.
- Provide `Export native backup` before any future destructive migration.

## 30. Future extensions

These fit the architecture but require separate approval:

- gRPC and protobuf import;
- GraphQL subscriptions beyond `graphql-transport-ws`;
- local mock servers;
- request code generation for an approved language list;
- local CLI collection runner and CI exit codes;
- scheduled local monitors;
- response diffing and contract regression;
- OpenAPI editing and linting;
- traffic capture from Bureau's Preview surface;
- password-encrypted portable secret archives.

None should be implemented opportunistically while completing the approved phases.

## 31. Specification references

- Bureau design companion: `docs/DESIGN_SPEC.md`
- Postman Collection v2.1 schema:
  https://schema.postman.com/json/collection/v2.1.0/docs/index.html
- OpenAPI Specification 3.2.0:
  https://spec.openapis.org/oas/v3.2.0.html
- GraphQL over HTTP working draft:
  https://graphql.github.io/graphql-over-http/draft/
- WebSocket Protocol, RFC 6455:
  https://www.rfc-editor.org/rfc/rfc6455.html
- Server-Sent Events processing model:
  https://www.w3.org/TR/eventsource/
- OAuth 2.0, RFC 6749:
  https://www.rfc-editor.org/rfc/rfc6749.html
- PKCE, RFC 7636:
  https://www.rfc-editor.org/rfc/rfc7636.html
- OAuth 2.0 for Native Apps, RFC 8252:
  https://www.rfc-editor.org/rfc/rfc8252.html
- OAuth 2.0 Security Best Current Practice, RFC 9700:
  https://www.rfc-editor.org/rfc/rfc9700.html
- HAR 1.2:
  https://w3c.github.io/web-performance/specs/HAR/Overview.html
- Node `vm` warning:
  https://nodejs.org/api/vm.html
- QuickJS Emscripten:
  https://github.com/justjake/quickjs-emscripten


---

## 32. Implementation record — Phases 0–2

### 32.1 What is implemented

**Phase 0 — architecture and primary navigation.** Title-bar `ApiNavButton` beside the project switcher
(the planned `PrimaryTabStrip` was dropped — see §6.1); `AppView` extended with `api` and `activeSection` replaced by `primaryWorkspace` +
`projectsReturnView` + `settingsReturnView`; API settings section and `DEFAULT_API_SETTINGS` with the §8.2
limits; shared contracts, validation module, closed-union error codes, handler registrar, preload bridge,
and a separate `apiStore`.

**Phase 1 — persistence, collections, environments, REST.** Workspace/collection/environment/history/
response-body/secret stores under `userData/api/`; per-entity `revision` with `STALE_STATE` on mismatch;
collection tree, request documents, composer, response inspector, history; variable resolution with scope
precedence, cycle detection, and nested expansion; HTTP transport with cancellation, redirects, cookies,
timings, decompression, and response caps; Basic/Bearer/API-key auth; optional project linking; quit
protection for dirty drafts.

**Phase 2 — GraphQL, WebSocket, SSE, OAuth 2, TLS exceptions.**

| Area | Where |
|---|---|
| GraphQL compile, error extraction, bounded introspection | `ApiRequestCompiler.ts`, `GraphqlTransport.ts` |
| WebSocket client (`ws`, direct dependency, external in the main bundle) | `WebSocketTransport.ts` |
| SSE incremental parser (chunk-boundary safe, CRLF/CR/LF, multiline data, id/retry/comments) | `SseTransport.ts` |
| Bounded transcript ring, batching, pause-display, dropped counter | `StreamRing.ts`, `ApiStreamSessions.ts` |
| OAuth 2 PKCE S256 + Client Credentials + refresh + encrypted tokens | `OAuthService.ts` |
| Host-scoped TLS profiles — the only module allowed to weaken verification | `TlsPolicy.ts` |
| Session ownership, cancellation, and shutdown disposal | `ApiSessionRegistry.ts` |

### 32.2 Phase 0/1 defects found and fixed during the Phase 2 pass

These were live bugs in the Phase 0/1 code, each now covered by a regression test:

1. **Blocked or unresolvable destinations threw instead of returning a result.** `resolveDestination`
   threw a `BureauError` object out of an un-awaited async task, producing an unhandled rejection, a
   session that was never removed, and a request that hung forever in the renderer. It now returns a
   typed failure and the send pipeline has a `try/catch/finally`.
2. **Cookies leaked across a cross-origin redirect.** The `Cookie` header was computed once and reused on
   every hop, defeating the credential stripping. The transport now takes `getCookieHeader(url)` /
   `onSetCookies(url, …)` callbacks and consults the jar per hop.
3. **A 303 redirect resent the original body.** Method rewriting to GET kept `body` and `Content-Length`.
   The body and its `Content-Type` are now dropped whenever the method is rewritten.
4. **`Domain=` on `Set-Cookie` was unvalidated.** A response from any host could set a cookie for an
   unrelated domain (including a bare TLD). The jar now rejects a `Domain` the response is not itself under.
5. **Secret variables never resolved.** `resolveSecret` was stubbed to `() => undefined`, and the vault
   handle was stored in `value` — which redaction stripped, so a renderer round-trip destroyed the
   binding. Secret variables now carry an explicit `secretId`, redaction preserves it, and incoming
   variables are sanitised so plaintext can never be persisted.
6. **Nested variables were detected but not expanded.** Cycle detection walked nested references while
   substitution was single-pass, so `{{a}}` → `{{b}}` was sent literally. Expansion is now recursive with
   a depth backstop.
7. **Draft headers bypassed the CRLF guard.** `apiSendRequestSchema` validated draft headers with the
   generic key/value schema instead of the control-character-checked header schema.
8. **Stale session events could resurrect a finished request.** The store applied every event
   unconditionally, so a late `progress` flipped `inFlight` back on after completion. Events now require a
   strictly increasing `seq` per session.
9. **`User-Agent` was overwritten**, and computed headers (`Host`, `Content-Length`, …) could be
   duplicated from manual input.
10. **Multipart boundaries were time-derived and field names unescaped**, allowing part forgery. The
    boundary is now random and a name containing a quote, backslash, or control character is rejected.
11. **The static guard's `'bureau:` skip applied to every rule**, not just the credential rule — a line
    mentioning an IPC channel could hide a `shell:true`. The skip is now scoped to `CREDENTIAL-STORAGE`,
    and the §21.3 rules are implemented.
12. **The OAuth loopback listener kept keep-alive sockets alive** after `close()`; it now calls
    `closeAllConnections()` too.

### 32.3 Release Gate A assessment

Met: REST, GraphQL, WebSocket, and SSE work end to end against real local fixtures; OAuth 2 Authorization
Code with PKCE and Client Credentials work against a controlled fixture (state mismatch, listener
lifecycle, single-flight refresh, rotation, and redaction all tested); strict TLS is the default and
exceptions are proven exact-host and non-transitive across redirects; sessions cancel and dispose cleanly,
including on shutdown; the full DoD suite passes.

Not yet met, and deliberately out of Phase 2 scope:

- **Packaged-build smoke test on Windows** for the network, OAuth callback, and WebSocket paths. The main
  bundle builds in Node mode with `ws` marked external, but a real packaged run has not been exercised.
- **Visual inspection** of both themes and both densities, and keyboard-only walkthroughs, for the new
  Phase 2 surfaces (StreamConsole, TLS dialog, OAuth dialog, Secrets pane).
- **GraphQL subscriptions** over `graphql-transport-ws` — explicitly deferred by §10.2 until the generic
  WebSocket scope is stable.
- **Named cookie jars and the cookie inspector** (Phase 5), **proxy profiles** (Phase 5), and
  **SSE automatic reconnect**: the contract and `Last-Event-ID` plumbing exist and reconnect is stored as
  a per-request flag defaulting to false, but no automatic reconnect loop is implemented yet.
- **Schema-cache persistence.** Introspection results live in renderer state for the session; the
  `schema-cache/` directory in §8.1 is not yet written.

---

## 33. Implementation record — Phase 3

### 33.1 What is implemented

A two-step pipeline for both directions. **Import** is inspect → preview → explicit commit; **export** is
plan → omission report → explicit save. Neither step writes or executes anything until the user commits,
and file paths never cross the IPC boundary — main owns the pickers on both sides.

| Area | Where |
|---|---|
| Bounded parsing, format sniffing, secret classification | `import/importSupport.ts` |
| cURL parsing without a shell | `import/CurlImporter.ts` |
| Postman Collection v2.0/v2.1 | `import/PostmanImporter.ts` |
| OpenAPI 2.0–3.2 (JSON + YAML) with confined `$ref` resolution | `import/OpenApiImporter.ts` |
| HAR 1.2 | `import/HarImporter.ts` |
| Native Bureau format | `import/BureauImporter.ts` + `export/BureauExporter.ts` |
| Preview lifetime, conflict strategies, atomic commit | `import/ImportService.ts` |
| Export rendering and omission reporting | `export/ExportService.ts` + the five exporters |

### 33.2 Decisions worth recording

- **No `@redocly/openapi-core`.** §23 gated it behind a spike. A focused reader was written instead: the
  fields Bureau consumes (servers, paths, operations, parameters, request bodies, security schemes) are a
  small subset, and a bespoke reader keeps `$ref` policy — the security-sensitive part — under direct
  control rather than configured through a third-party resolver. `yaml` is the only new dependency, taken
  with `maxAliasCount` set so an alias bomb cannot expand.
- **External `$ref` is blocked outright, not confined.** §14.4 describes confining local file refs to the
  import root. Bureau imports a *single document* — pasted text or one picked file — so there is no root
  to confine to. Following a relative ref would mean reading arbitrary neighbouring files, and a remote
  ref would be an SSRF vector from an untrusted document. Both are reported as omissions and the parse
  continues.
- **Credentials are never imported.** Passwords from `curl -u`, Postman `basic`/`bearer`/`apikey` values,
  and variables marked secret all come in as a shape without a value. HAR is the exception that proves the
  rule: captured `Authorization` and `Cookie` headers *are* imported (a capture is evidence and dropping
  them silently would be worse) but arrive **disabled**, so they cannot be replayed by accident.
- **`--insecure` is not honoured.** A cURL command carrying `-k` produces a warning, not a TLS exception.
  Weakening TLS stays an explicit host-scoped decision made in Bureau's own dialog.

### 33.3 Defect found and fixed during this phase

**Any UUID resolved to a phantom empty workspace.** `ApiWorkspaceStore.loadFile` called
`AtomicJsonStore.load()`, which falls back to its configured default when the file is missing — and that
default's `summary.workspaceId` is the id being requested, so the existing
`file.summary.workspaceId !== workspaceId` guard could never fire. Every caller (`getWorkspace`,
`sendRequest`, `planExport`, …) therefore saw an empty workspace instead of "not found", and committing
an import into a non-existent id would have *created* it. The index is now consulted first, since it is
the authority on which workspaces exist. Regression test in `tests/unit/api/workspaceStore.test.ts`.

### 33.4 Acceptance against §24 Phase 3

Met: all five formats round-trip their supported concepts (native losslessly, including WebSocket/SSE
and protocol options; the others their documented subset); lossy exports report every omission before a
file is written; imported scripts are stored disabled and disclosed in the preview; no import performs
network access or executes a request (asserted in the e2e journey); commits are a single atomic
`mutateWorkspace` write, so a failure leaves the workspace untouched.

Not done, and deliberately out of scope:

- **HAR export covers history, not live request headers.** Bureau stores response headers in history but
  not the exact request headers sent, so exported HAR entries carry empty `request.headers`. Recording
  them would mean widening the history record — a Phase 1 storage change, not an export change.
- **No unredacted HAR export path in the UI.** `exportHar` accepts `redactSecrets: false` and the
  exporter warns accordingly, but the dialog always passes `true`. Exposing the toggle needs a danger
  confirmation of its own.
- **OpenAPI export infers a shallow schema from the example body** rather than a full JSON Schema, and
  emits `security` references without a matching `components.securitySchemes` block.
- **Import cannot target an arbitrary nested folder from the palette** — the palette command opens the
  picker and the dialog chooses the destination.
- **Postman v3, and Bureau-format secret encryption**, remain future work per §14.3 and §14.6.

---

## 34. Implementation record — Phase 4

Landed 2026-07-30. Script sandbox and collection runner, against §13 and §24's Release Gate B.

### 34.1 What was implemented

**Sandbox** (`src/main/api/script/`):

- `scriptWorker.js` — the guest runtime. Authored as standalone CommonJS and started with
  `new Worker(source, { eval: true })` from a `?raw` import, so there is still exactly one main bundle:
  no second rollup entry, no asset to resolve at runtime, and the worker is byte-identical in dev, in
  Vitest, and in a packaged build. It requires nothing but `node:worker_threads`; QuickJS is loaded from
  absolute paths the host resolves and passes in `workerData`, because an eval-mode worker's own
  `require` resolves against the working directory, which is not knowable in a packaged app.
- `ScriptSandbox.ts` — one persistent worker, one fresh QuickJS runtime per job. Runtime disposal is what
  isolates one script from the next; a guest cannot reach the worker's own JS at all, so reuse is safe.
  Jobs are serialised so the heap ceiling stays meaningful.
- `limits.ts` — the §13.1 table, plus a host `hardDeadlineMs` above each guest deadline.
- `redact.ts` — outbound redaction of every secret value the guest could have seen.
- `scriptHolders.ts` — which scripts run for a request, and the approval listing.
- `CollectionRunner.ts`, `RunDataStore.ts`, `runReport.ts` — the runner, its iteration data, and JSON /
  JUnit report serialisation.

**Three independent limits bound every job**, which is what makes "a malicious or infinite script cannot
hang Bureau" true rather than hoped-for:

1. a QuickJS interrupt handler aborts the guest at its wall-clock deadline (verified: `while (true) {}`
   returns in ~2s at the post-response deadline);
2. `runtime.setMemoryLimit` caps the heap (verified: an unbounded allocation reports out-of-memory, not a
   timeout);
3. the host terminates the worker at the hard deadline — proven in the spike to kill a runaway synchronous
   wasm loop in 2 ms, so even a wedged interrupt handler cannot hold the process.

`scripts/check-forbidden-apis.mjs` gained `SCRIPT-WORKER-HOST-ACCESS` (the worker may require nothing but
`node:worker_threads`) and `SCRIPT-SANDBOX-LIMITS`, the guard's first *required*-pattern rule: a missing
safety call cannot be caught by scanning for what is present. The scanner now reads `.js` as well as
`.ts`/`.tsx`. Both rules were negative-tested.

### 34.2 Dependency spike (§23)

`quickjs-emscripten-core` + `@jitl/quickjs-singlefile-cjs-release-sync`, both pure JS. The **singlefile**
variant embeds its Wasm as base64 in the JS, so there is no separate `.wasm` asset to package — which is
most of what made §24 Phase 5's "packaging includes all Wasm assets" a risk. The `-core` package is used
rather than the `quickjs-emscripten` umbrella because the umbrella depends on four separate-Wasm-file
variants Bureau does not use and would otherwise have to ship. Both packages, plus
`@jitl/quickjs-ffi-types`, are added to `forge.config.ts`'s packaged-runtime allowlist, since the worker
resolves them at runtime rather than having them bundled.

### 34.3 Decisions worth recording

**Scripts mutate variables, not the request.** `bureau.request` is a frozen read-only snapshot; the way a
script influences the request is `bureau.variables.set`, which becomes §7.2's tier-2 runtime layer and is
then resolved by the normal template machinery. This keeps one compilation path instead of a compile /
mutate / recompile loop, and it means every script effect is visible as a variable rather than as an
invisible edit. The common case — compute a signature, reference it as `{{sig}}` — is unaffected.

**In the post-response phase, `bureau.request.url` is the URL that was sent**, not the still-templated
source. Found by an e2e test asserting on it; a script inspecting the request after the fact means the
real one.

**A failing assertion fails the request.** `ApiResponsePreview.ok` is false when any test failed — a
passing transport with a failing assertion is a failure, which is the entire point of writing the
assertion.

**A failed script's variable writes are discarded**, and a failed pre-request script stops the send
entirely: a half-run script may not have set the values the URL, headers, or body depend on.

**Enabling untrusted script source has exactly one entry point.** `approveScripts` lists every script in
the subtree with its provenance and takes the workspace revision the list was read at, so an approval
cannot land on a workspace that has since gained another script. Two other paths were closed to match,
neither of which the UI could reach but both of which a crafted IPC payload could:
- a **draft** may carry script *source* but never `enabled` — `loadContext` always reads enablement from
  the saved definition;
- an ordinary **save** may edit source and may always *disable*, but cannot flip imported source to
  enabled (`mergeScripts`). Both have e2e regression tests.

**Async is not supported.** The guest API has no network, no timers, and no I/O, so `async` has nothing to
await; pending jobs are drained once so a stray `.then()` is not silently lost, and that is all.

**No parallel runner** (§13.4): variable mutation across concurrent iterations has no defined semantics,
and Bureau should not accidentally load-test someone's staging environment.

### 34.4 Acceptance against Release Gate B

- *Scripts cannot access Node, Electron, filesystem, network, or host prototypes* — asserted directly in
  `tests/integration/api/scriptSandbox.test.ts`: no host globals; `Function('return this')()` yields the
  guest global; a prototype-chain walk reaches no host constructor; guest prototype pollution does not
  survive into the next script.
- *A malicious or infinite script cannot hang Bureau* — deadline, heap, console-flood, oversized-return,
  and oversized-source tests, plus the worker-termination backstop and a test that the sandbox still runs
  the next job after a termination.
- *Runner cancellation closes in-flight traffic and the worker* — cancel aborts a linked signal that stops
  the transport and the sandbox job together, and the run reports `cancelled`.
- *Assertion reports are deterministic and redacted* — a secret echoed into console output, an assertion
  message, or a thrown error is redacted before it leaves main, so it cannot reappear in history or in an
  exported report. JUnit output escapes every interpolated value and strips control characters.

### 34.5 Not done, and deliberately out of scope

- **No script debugger, breakpoints, or step-through.** The console and the test list are the whole
  feedback surface.
- **No shared library of helper functions across requests.** Each holder is an independent job; sharing
  happens through variables.
- **`bureau.request` is not writable**, per §34.3. If direct header/body mutation is wanted later it needs
  a defined recompilation point, not an extra setter.
- **The runner is sequential only**, and has no background schedules (§13.4).
- **No packaged-build smoke test on Windows/macOS/Linux.** The Wasm-in-JS variant removes the asset-copy
  risk and the allowlist is in place, but the packaged path has not been exercised on this machine.
- **No visual/keyboard pass over the new surfaces** (Scripts tab, approval dialog, runner) in both themes
  and densities.

---

## 35. Implementation record — Phase 5

Landed 2026-07-30. Proxy, advanced cookies, GraphQL subscriptions, and polish, against §24's Phase 5.

### 35.1 What was implemented

**Proxy profiles** (`src/main/api/ProxyPolicy.ts`) — direct, system, HTTP, and HTTPS CONNECT, with a
bypass list, credentials from the secret vault, request-scoped selection over a workspace default, and
`proxyUsed` reported on the response so it is visible which proxy carried a request.

Written here rather than pulled in as a proxy-agent package, for the same reason the OpenAPI reader was:
the security-relevant part is *which host gets contacted and with what credentials*, and that stays
legible when the CONNECT handshake is fifty lines in one file. The handshake is exercised against a real
proxy process in `tests/integration/api/proxyTransport.test.ts`, not a mock that would agree with
whatever we wrote.

**SOCKS is deliberately absent.** §11.3 makes it conditional on the transport supporting it safely; it
needs its own authentication negotiation and a UDP-associate story, and nothing Bureau does exercises it.

**Cookies** — the jar now records `hostOnly` and `SameSite` (defaulting to Lax per RFC 6265bis) and
rejects `SameSite=None` without `Secure`, as browsers do. A host-only cookie goes back to the exact host
that set it and to no subdomain, which is the distinction a jar storing only a domain string silently
loses. Named jars are keyed `workspaceId:jarId`, so a second identity against the same API never sees the
default jar's cookies. The inspector lists, deletes one, and clears with confirmation.

**GraphQL subscriptions** (`src/main/api/GraphqlSubscription.ts`) — `graphql-transport-ws` as a pure
state machine over the existing WebSocket engine. Kept separate from the transport so the protocol is
testable without opening a socket. Only `graphql-transport-ws` is implemented: the older
`subscriptions-transport-ws` is deprecated and unmaintained, and supporting both means guessing which one
a server speaks.

**Backup and restore** (`src/main/api/BackupService.ts`) — every workspace document in one file,
restored through the same two-step shape as import, because a restore that silently replaced a workspace
would be the most destructive operation in the app. A committed plan cannot be replayed.

### 35.2 Decisions worth recording

**The launch environment applies only under `system` mode.** §11.3 requires that Bureau's own environment
not silently override a selected profile, so `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` are read *only* when a
profile explicitly selects `system`. A shell that happens to export a proxy cannot redirect a request the
user configured as direct. Asserted directly in the unit tests.

**With a proxy in play, it is the proxy whose address is vetted and pinned** — that is the host this
process connects to. The target is still checked when it resolves locally, so a proxy cannot become a way
around the metadata block (there is a test for exactly that), but a name only the proxy can resolve is not
an error.

**A bypass entry is an exact host, a leading-dot suffix, or `*` — never a glob.** A half-understood
wildcard in a proxy bypass list is how traffic escapes a corporate proxy by accident. `evilapi.test` does
not match a `api.test` entry.

**A backup is not a secret backup.** Secret material stays in the OS vault, and the file says
`secretPolicy: "omitted"`. A portable file that decrypts a vault is a worse failure mode than a re-typed
token — the same rule as the native export (§14.6).

### 35.3 Performance work (§22), measured rather than assumed

Pretty-printing ran on the React render path with no bound. Measured on this machine:

| Body | Parse + re-stringify | Formatted output |
|---|---:|---:|
| 0.25 MiB | 2.6 ms | 0.4 MiB |
| 1 MiB | 8.9 ms | 1.7 MiB |
| 4 MiB | 34.3 ms | 6.8 MiB |
| 10 MiB | 97.0 ms | 16.9 MiB |

At the 10 MiB display cap that is ~97 ms of blocked UI *plus* a 16.9 MiB string handed to the DOM. So:
auto-formatting stops at 1 MiB (with an explicit "Format anyway"), and the body view renders at most
2 MiB, saying how much of how much it is showing. Nothing is silently truncated.

The stream transcript holds up to 5,000 entries and rendered all of them; it now shows a 200-entry tail
with `Show more`/`Show all` and states how many are above (`useTailWindow`). A measured-height virtualiser
was rejected — these lists are append-only and read newest-first, and variable row heights would make a
windowed scroller fight the content for no gain at this scale.

`tests/unit/api/largeDataBounds.test.ts` asserts the ring stays at capacity over 10,000 events, that
sequence gaps remain detectable after eviction, and that run-order resolution over 2,000 requests does not
regress to a quadratic walk.

### 35.4 Packaging (§24 Phase 5 acceptance)

A real `electron-forge package` build was produced and its `app.asar` inspected:

- main, preload, and renderer bundles present;
- `quickjs-emscripten-core`, `@jitl/quickjs-singlefile-cjs-release-sync`, and `@jitl/quickjs-ffi-types`
  packaged;
- **zero separate `.wasm` files and zero unused wasmfile variants** — which is exactly what the Phase 4
  decision to use `-core` plus the singlefile variant was for;
- the sandbox worker source and the emulator proto are inlined in `main.js`, so neither is an asset that
  can go missing.

macOS and Linux packaging remain unverified — there is one Windows machine here.

### 35.5 Decisions deferred back to you, not implemented

- **§24.4 code-generation adapters** are explicitly gated on "a concrete language list is approved". No
  list has been approved, so none were built. My recommendation if this is wanted: start with cURL (which
  already exists as an export), then JavaScript `fetch` and Python `requests`, and treat each additional
  language as its own small adapter behind the existing export plan/commit shape rather than a
  code-generation framework.
- **§24.8 local CLI runner or gRPC.** My recommendation is that a CLI runner is worth doing and gRPC is
  not, yet. The runner already produces JUnit output, so a headless `bureau run <collection>` is mostly a
  packaging problem over machinery that exists, and it is what makes the collection runner useful in CI.
  gRPC needs proto ingestion, reflection, streaming semantics, and a code path that shares almost nothing
  with the HTTP engine — it is a phase, not a feature, and should be scoped separately.

### 35.6 Follow-up closure

Landed immediately after Phase 5:

- **SOCKS5 proxies.** Bureau implements only the TCP `CONNECT` command, with optional RFC 1929
  username/password negotiation. There is intentionally no UDP-associate mode because no Bureau transport
  can use it. SOCKS5 works for HTTP, HTTPS, WebSocket, and SSE through the shared tunnel path.
- **WebSocket and SSE proxying.** WebSocket hands a vetted/pinned CONNECT or SOCKS socket to `ws`; SSE
  carries the selected request proxy into the existing streaming HTTP transport. Both routes are covered
  by real-socket integration tests.
- **Persistent cookie jars and editor.** Jars are encrypted per jar through the OS keychain and restore on
  restart. If the keychain is unavailable they remain session-only rather than falling back to plaintext.
  The Cookies pane can add and edit cookies, while preserving exact identity fields on edits.
- **Packaging verification.** Windows packaging remains locally exercised and inspected. CI now runs the
  Forge package smoke build on Windows, macOS, and Linux, so the main/preload bundle, runtime allowlist,
  native module layout, and embedded QuickJS path are verified on their own host platforms.
- **Visual pass.** Cookies use the dense flat list language in both themes, dialogs remain token-only and
  responsive, and the new editor uses Bureau controls with keyboard-accessible labels and validation.
