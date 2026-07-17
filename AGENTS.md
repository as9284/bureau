# AGENTS.md — Bureau

Operating guide for AI agents (and humans) working in this repo. Read this **before** writing code.
It is the source of truth for how work gets done here; `CLAUDE.md` imports it verbatim.

> **Bureau** is a local-first Electron "mission control" for software projects — it runs, monitors, and
> previews dev servers, language runtimes, the Android emulator, and local web URLs. It is the top layer
> of a three-app suite (with **StarGit** for git and **Monocle** for docs) and shares their graphite,
> Cursor-like design system *exactly*. Windows-first, cross-platform-ready.

**The design companion is authoritative — do not contradict it:**
- [DESIGN_SPEC.md](./docs/DESIGN_SPEC.md) — the exact design tokens, shell layout, and component inventory.

---

## 1. Golden rules (read first)

1. **Read `docs/DESIGN_SPEC.md` before changing interface behavior.** It defines the visual language and
   component rules. For product behavior, inspect the existing contracts, implementation, and tests before
   deciding what the app intends. Most "not thorough enough" failures come from skipping that evidence.
2. **State assumptions, surface tradeoffs, ask when ambiguous** — don't silently pick one interpretation
   or invent product behavior (e.g. what counts as a "port conflict"). Fix contained bugs; flag design decisions.
3. **Verify end-to-end, not just types.** A feature must be wired the whole way:
   `main service → IPC handler → preload API → shared contract → Zustand store → React component`.
   A change that compiles but is only reachable from half the stack is a bug. Explicitly check for
   main-only or renderer-only orphans.
4. **Surgical changes.** Match surrounding style. No speculative abstractions, no drive-by refactors, no
   "improving" adjacent code. Every changed line should trace to the task. Clean up only orphans *your*
   change created.
5. **Never hardcode design values.** Colors, sizes, spacing, fonts, motion — always CSS tokens (§4).
   Never introduce a raw OS control where a design-system primitive exists (§4).
6. **Definition of Done** for any non-trivial change (§6): `npm run typecheck` + `npm run lint` +
   `npm run test:security` + the relevant test suites all green, and the behavior actually exercised.

---

## 2. Architecture

Four layers, strict boundaries.

```
src/
  main/       Node/Electron main process (privileged). Subsystems, each behind typed IPC:
              app/ ipc/ projects/ processes/ preview/ android/ toolchains/ ports/ tasks/
              operations/ capabilities/ system/ storage/ settings/ services/
              git/ github/   (Phase 3 — Git never runs in the renderer)
  preload/    Frozen contextBridge surface (api.ts, global.d.ts). Renderer never sees ipcRenderer.
  renderer/   React 19 + Zustand: app/ layout/ features/ components/ pages/ store/ styles/ lib/
  shared/     Zod contracts, channels, validation, error codes, pure helpers. Imported by all layers.
```

- **Path aliases:** `@main/*`, `@renderer/*`, `@shared/*` (see `tsconfig.json`).
- `src/main/services/createAppServices.ts` is the composition root. `src/main/ipc/registerHandlers.ts`
  registers every channel. `src/main/main.ts` bridges main-process events → renderer.
- The primary Zustand store is `src/renderer/store/appStore.ts`. Git workbench state lives in a separate
  `src/renderer/store/gitStore.ts` (StarGit fold-in); bridge via `ensureGitProject` from the Git tab.
  Streamed data (logs, logcat, process status, preview state, pty output) arrives on IPC **event** channels
  and is subscribed there or in the owning component.

### Adding an IPC-backed capability — the checklist
1. Contract + Zod schema in `src/shared/contracts/*` and `src/shared/validation/*`; channel constant in
   `src/shared/contracts/channels.ts`.
2. Service method in the relevant `src/main/<area>/` module; wire it in `createAppServices.ts`.
3. Handler in `registerHandlers.ts` via the `register(...)` wrapper.
4. Method in `src/preload/api.ts` and its type in `src/shared/contracts/api.ts` (`BureauApiV1`).
5. For push/streamed data: emit from main (`main.ts`) on an event channel + `subscribe` in preload.
6. Store action + state in `appStore.ts`; consume in the feature component.
7. Tests (§6) + run the DoD suite.

---

## 3. IPC, security & invariants (non-negotiable)

Bureau spawns real OS processes and renders untrusted localhost content, so security is first-class.

- **Result envelope:** domain services return `{ ok: true, ... } | { ok: false, error: BureauError }`.
  **Only bugs throw.** Every handler is wrapped by `register(channel, operation, handler)` which asserts a
  trusted sender **before** reading args, Zod-parses the payload, and maps errors. `BureauErrorCode` is a
  **closed union** in `shared` — extend it there, don't invent ad-hoc codes/strings.
- **Sender validation:** `assertTrustedSender` + the mainFrame check bar the untrusted preview
  `WebContents` from invoking app IPC. Don't weaken it.
- **No shell, ever.** All spawns use `shell: false` with an explicitly resolved executable and **array**
  args. Validate user-supplied strings (length-bounded, no leading `-`, no NUL) — argument injection is the
  primary exec risk. On Windows, route `.cmd`/`.bat` through `cmd.exe /c` (see `spawnProcess.ts`,
  `runCommand.ts`) — still `shell: false`.
- **Renderer sandbox:** `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`,
  `webSecurity:true`, strict CSP, `will-navigate`/`setWindowOpenHandler` deny. The preview view runs in an
  isolated session partition, no preload, denied window-open/permissions/downloads, loopback-only navigation.
- **Detected commands are untrusted input.** Process definitions are derived from repo-controlled files
  (`package.json` scripts, `pubspec.yaml`, …) which may arrive via a cloned repo, so a command string is
  attacker-controlled. Display commands; never blind auto-run; parse defensively. Bureau stores the
  definitions in its **own app storage** keyed by projectId (`ProjectConfigStore`) — a repo cannot ship
  process definitions, and in particular cannot set `runOnOpen`.
- **Static guard:** `scripts/check-forbidden-apis.mjs` (`npm run test:security`) bans `shell:true`,
  `exec`/`execSync`/`spawnSync`, hardcoded credentials, unvalidated `argv[0]`, and `<webview>`/`allowpopups`.
  **Keep it green.**
- **Native modules (node-pty):** never static-import a native binding at a main-process module's top level —
  a missing/ABI-mismatched build would crash the app at launch. Load it **lazily inside a try/catch** and
  cache the result so it degrades to a fallback (see `src/main/processes/PtyBridge.ts` for the pattern,
  including the scoped `eslint-disable` for the one permitted `require`).
- **Destructive actions are gated** (stop-all, wipe AVD, uninstall APK, kill process tree, remove project,
  kill a non-Bureau port owner): explicit confirmation, never reachable from injected content.

---

## 4. Design system — how to not create UI inconsistencies

The product must read as one graphite family with StarGit/Monocle. [DESIGN_SPEC.md](./docs/DESIGN_SPEC.md) is
canonical; this is the enforcement summary.

**Tokens live in `src/renderer/styles/tokens.css`. Reuse them — never hardcode, never invent.**
Before using a token, confirm it exists in `tokens.css`. Common families:
- Surfaces: `--color-surface-{canvas,sunken,base,raised,overlay,hover,selected}`
- Text: `--color-text-{primary,secondary,muted,disabled,on-accent}`
- Borders: `--color-border-{subtle,default,strong}`
- Accent (one, periwinkle): `--color-accent-{primary,hover,pressed,soft}`, `--color-focus`
- Status: `--color-status-{success,warning,danger,info}` (+ `-soft`)
- Type: `--font-family-{ui,mono}`; sizes `--font-size-{label(11px),supporting(12px),body(13px),section-title,repository-title,page-title}`
- Also: `--space-1..16`, `--radius-*`, `--size-*`, `--motion-*`, `--shadow-*`, `--z-*`

Resting chrome is flat graphite (hairline borders, no card bloom); elevation is for overlays only. One
periwinkle accent for primary actions — keep filled primaries quiet, not glowing.

**Tokens that do NOT exist — do not reference them** (real bugs found in the wild): there is no
`--font-size-meta` (use `--font-size-label`) and no `--color-status-error` (use `--color-status-danger`).
An undefined `var()` silently renders wrong. If unsure, grep `tokens.css`.

**Use the primitives in `src/renderer/components/`** — do not hand-roll or drop to OS-native controls:
`Button`, `IconButton`, `TextField`, `Dropdown` (never a raw `<select>` — it renders OS-native and breaks
the theme), `Checkbox` (never a raw `<input type="checkbox">`), `ContextMenu`, `Dialog` patterns
(`.overlay-root`/`.dialog`), `ResizablePanel`, `StateDot`, `StackBadge`, `LogConsole`, `ToastStack`,
`LiveRegion`, `icons.tsx` (phosphor). Buttons don't inherit `font-family` — set mono explicitly when a
button shows machine text.

**Rules that are easy to violate:**
- **Everything machine-generated** — paths, ports, PIDs, versions, log lines, timestamps, byte counts —
  uses `--font-family-mono` with `font-variant-numeric: tabular-nums`.
- **Theme-aware:** never a fixed hex where a token exists; the app has dark (default) + light themes. If a
  third-party surface needs concrete colors (e.g. xterm), read the tokens at runtime via
  `getComputedStyle(document.documentElement)` rather than hardcoding (see `TerminalPane.tsx`).
- **Every list/panel implements all states:** Empty (`.empty-state`), Loading (skeleton/`.tab-loading`),
  Error (non-fatal `role="alert"` banner + retry), Degraded (`stale` flag, not blanking). No blank panes.
- **Accessibility:** ≥28px hit targets, 2px accent focus rings (`:focus-visible`), full keyboard nav,
  respect `prefers-reduced-motion` and `forced-colors`, color is never the only signal (pair dots with
  text). Motion 80–160ms.
- **Consistency across sibling tabs:** new tabs mirror the existing header/list language
  (`*-tab__header` + `*-tab__title` + `*-tab__actions`; rows like `.toolchain-row`/`.port-row`). Match, don't diverge.
- Styles are plain CSS in `src/renderer/styles/*.css` (`tokens.css`, `theme.css`, `global.css`, `shell.css`,
  `controls.css`, `phase1.css`, `overview.css`, `android.css`, `panels.css`). No CSS-in-JS.

---

## 5. Renderer state & streaming

- One normalized Zustand store (`appStore.ts`); immutable `set(s => …)` updates; per-subject keyed sub-maps
  for concurrent state (`processesByProject`, `toolchainsByProject`, `portsByProject`, `previewState`, …).
- **Latest-request-wins:** guard async streams so stale responses are dropped on fast project/device switches.
- Streamed data arrives on IPC **event** channels (snapshot-on-subscribe + live tail), throttled/batched;
  never block the UI thread.
- Announce streaming status changes via the aria-live queue (`LiveRegion`).
- Optimistic feedback: start/stop/restart set an immediate `pendingProcesses` state, cleared when the real
  status event lands.

---

## 6. Testing & Definition of Done

Vitest 3, four suites by config + directory (`tests/` mirrors `src/`), plus the security script.

| Command | Scope |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | eslint `src` + `tests` |
| `npm run test:unit` | parsers, detectors, ring buffer, error mapping, stores, geometry (node) |
| `npm run test:integration` | real `spawn` through `ProcessSupervisor` (start/stop/**tree-kill**/crash), stores (node) |
| `npm run test:component` | primitives + feature components via Testing Library (jsdom) |
| `npm run test:e2e` | headless backend journey through the services bootstrap (node) |
| `npm run test:security` | forbidden-API guard script |

**DoD for every change:** `typecheck` + `lint` + `test:security` + the relevant suites green, **and** the
behavior actually exercised (not just "it compiles").

**Testing rules:**
- **Prefer real over mocked** for backend logic: temp dirs (`fs.mkdtemp`) + real child processes via
  `node -e "…"` as cross-platform fixtures; tear down in `afterEach` (kill processes, `fs.rm`).
- **Mock only what can't be real:** `electron` (window/preview/IPC), and adb/emulator behind an injected
  executable adapter (Android is unit-testable without a device; env-gate real-device tests with
  `it.runIf(process.env.ANDROID_HOME)`).
- **Tree-kill is a first-class test** (spawn parent→child, stop, assert child PID gone; platform-branched).
- **No flaky timing** — poll for conditions with bounded timeouts, never fixed sleeps.
- When you fix a bug, add a regression test that would have caught it. When you touch a parser, feed it
  realistic sample input (real `netstat`/`lsof`/`.tool-versions`/pubspec lines), including IPv6/UDP/edge forms.

---

## 7. Build, dev & environment gotchas

- **Toolchain:** Electron Forge + Vite. `npm run dev` (via `scripts/dev.mjs`, which forces a TTY so Forge
  registers its `rs` restart) gives main-process auto-restart (`vite.hot-restart.ts`) + renderer HMR.
  `npm start` is the plain Forge start.
- **Main bundle is CommonJS** (rollup, `formats: ['cjs']`; `node-pty`/`pidusage`/`electron` external). At
  runtime `require`/`__filename` exist, but ESLint bans the bare `require` global in `main`/`preload` — the
  only sanctioned use is the lazy native-module load, with a scoped `eslint-disable` (see `PtyBridge.ts`).
- **`tsconfig` uses `module: NodeNext`** → main files are classified CJS, so `import.meta` is a type error
  there even though rollup would accept it. Don't use `import.meta` in main.
- **Sanity-checking a main build:** plain `npx vite build --config vite.main.config.ts` runs in *browser*
  mode and wrongly shims `node:` builtins. Use `--ssr` to replicate Forge's Node target, or run the real
  Forge build. Component/renderer changes are covered by `test:component`.
- **Windows native rebuild:** `postinstall` (`scripts/patch-native-build.mjs`) teaches node-gyp VS 18 +
  disables Spectre for `node-pty`. Prefer a **space-free clone path** (node-gyp warns on spaces).
- Dropdown/menu overlays portal to `document.body` (so `overflow:auto` ancestors don't clip them).
- **Embedded preview is a native `WebContentsView`** that composites *above* all DOM regardless of CSS
  `z-index`, and holds keyboard focus once the page is interacted with. Global renderer key handlers won't
  fire while it's focused — capture such keys in main via `before-input-event` and forward them (see the
  preview fullscreen hotkey path). DevTools opened on this view logs benign `Autofill.*` CDP errors from
  Chromium's DevTools frontend; those are not app bugs and can't be suppressed from app code.

---

## 8. Current status & known gaps

Phases 0–4 are implemented (projects hub, process manager, web preview, deep Android, toolchains, ports,
tasks, monorepo roots, terminal attach, live metrics, orphan adopt, preview polish, CI, and the StarGit
fold-in as a per-project **Git** tab). Phase 4 is complete: the per-project **Files** workspace (secure
explorer, CodeMirror editor, Monocle reader, search, drafts, conflict-safe saves, export, settings and Git
handoff) plus its 2026-07-14 security/design follow-ups.

**Embedded emulator display (2026-07-16):** the Android tab renders a running AVD in-app instead of the
emulator's detached window (Android Studio's approach). Bureau launches with `-qt-hide-window -grpc <port>`
and streams frames over the emulator's own gRPC API (`src/main/android/EmulatorDisplayService.ts`,
vendored proto in `src/main/android/proto/`), forwarding input back the same way. Notes for future work:
- Frames are **raw RGBA** (`w*h*4` bytes per frame) — PNG was too slow, but IPC bandwidth is now the
  ceiling. The 60fps cap and the stream pixel budget in `EmulatorDisplay.tsx` exist for that reason;
  going beyond them means replacing raw-pixels-over-IPC with an encoded stream, not raising a constant.
- gRPC is **emulator-only**. Physical devices still use the scrcpy mirror path.
- `-grpc <port>` disables the emulator's default JWT auth, so the port is unauthenticated on loopback
  (no escalation over adb, which is already unauthenticated and strictly more powerful). Harden with
  `-grpc-use-token` + an auth metadata header if that tradeoff stops being acceptable.
- A cancelled gRPC stream emits `end`/`error` *after* its replacement is live; stream handlers must stay
  keyed to their own stream (never a shared flag) or a resize silently kills the session.

**Embedded terminal (2026-07-16):** the per-project **Terminal** tab hosts free shell sessions
(`src/main/terminal/**`, `src/renderer/features/terminal/**`) instead of the "open terminal" buttons
launching an OS terminal; the external launcher remains as a secondary "Open in external terminal"
action. It sits *beside* `ProcessSupervisor` (a shell has no `ProcessDefinition`) and reuses `spawnPty`.
Notes for future work:
- Sessions live until closed, so the pane can unmount. Replay is a **seq handshake**: subscribe first,
  queue, fetch the buffer, then replay only chunks with `seq > snapshot.seq`. Fetch-then-subscribe
  drops the gap. The buffer holds raw bytes and trims at a newline — an arbitrary cut can strand a
  partial escape sequence and render as garbage.
- Closing a session **tree-kills** (`pty.kill()` leaves ConPTY grandchildren orphaned), and skips it
  once exited, since the pid may be reused. `killTree` is injectable because a fake-pty test with an
  invented pid would otherwise `taskkill` a real process.
- node-pty can't load under vitest (Electron ABI), so there is no real-pty test; the integration test
  fakes the pty around a real child process and asserts the pid dies.
- The renderer sends `projectId` + an optional `rootRelative` checked against the project's detected
  `nestedRoots`, never a path; shells are chosen by `ShellId` from a closed set. Git Bash is derived
  from the resolved `git` executable — `bash` on PATH is System32's WSL launcher on Windows.

**Phase 3 notes:** Git runs only in main (`src/main/git/**`, `github/`); renderer uses `gitStore` +
`features/git/**`. Bureau Projects hub owns tracking — do not reintroduce StarGit’s multi-repo catalogue.
Deferred with StarGit: interactive rebase, three-way merge editor, LFS, force-push, full git e2e matrix.

**Remaining low-priority cleanups** (not blocking; fix opportunistically):
- The metrics `setInterval` sampler is `unref`'d but never `.stop()`-ed on shutdown.
- `ProcessSupervisor`'s launch-time cwd check is lexical (`path.resolve`, no `fs.realpath`), so a symlink
  escaping the project root would pass the `startsWith` check.
- `PortScanner.processName` is always `null` (owning-process name not resolved yet).

(The earlier "big three" Phase 2 gaps — Windows metrics reading ~0, inverted ports-conflict tinting, and
npm-only task discovery — have been fixed: metrics now sum the whole process tree, conflicts are
expected-port-vs-non-Bureau-owner, and task discovery reuses `StackDetector` for non-Node ecosystems.)

When in doubt, prefer thoroughness for review/audit work and brevity for quick fixes — and leave the repo
greener than you found it.
