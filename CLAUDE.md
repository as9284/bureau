# CLAUDE.md — Bureau

This project's working agreement lives in **[AGENTS.md](./AGENTS.md)** — architecture, security
invariants, the design-system rules, testing, and the Definition of Done. It is imported below so it is
always in context. Read it before writing code; do not duplicate its contents here.

@AGENTS.md

---

## Claude Code specifics

These supplement AGENTS.md (the canonical guide) and your global `~/.claude/CLAUDE.md`.

- **Ground every task in repository evidence.** For anything non-trivial, inspect the relevant contracts,
  implementation, and tests; read [DESIGN_SPEC.md](./docs/DESIGN_SPEC.md) before interface work. State assumptions
  and surface tradeoffs before implementing (per your global guidelines) — especially for anything that
  looks like a product decision (what a "conflict" means, whether to auto-run a config command, etc.).

- **Be thorough and verify end-to-end.** Confirm a feature is wired the whole way
  (main → IPC → preload → contract → store → component); flag main-only or renderer-only orphans. When
  auditing or reviewing, spawning parallel subagents per subsystem (toolchains / ports / processes / preview)
  and re-verifying their claims against the code before acting is the expected level of rigor here.

- **Definition of Done — run before declaring finished:**
  ```bash
  npm run typecheck && npm run lint && npm run test:security
  npm run test:unit && npm run test:component      # + test:integration / test:e2e when backend/spawn changed
  ```
  Report failures honestly with output; never claim green without running them.

- **UI consistency is a hard requirement.** No hardcoded colors/sizes, no raw `<select>`/`<input
  type=checkbox>` — use tokens from `src/renderer/styles/tokens.css` and primitives from
  `src/renderer/components/`. If you add a token reference, confirm the token exists first.

- **Live verification.** This is a GUI Electron app under single-instance lock, so don't launch a competing
  instance while the user has one running. Prefer the automated suites + a Node-mode build check
  (`npx vite build --config vite.main.config.ts --ssr`); ask the user to smoke-test interactive UI (preview,
  terminal, dialogs) when a real window is needed.

- **Memory.** Durable, non-obvious project facts (e.g. the known Phase 2 gaps) live in the session memory
  directory and are indexed in `MEMORY.md`. Record new such facts there; don't restate what the code or
  these docs already say.
