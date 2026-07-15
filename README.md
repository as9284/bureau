# Bureau

Local-first desktop **mission control for development projects** — the top layer of a suite alongside
[StarGit](../stargit) (git) and [Monocle](../monocle) (docs), sharing their graphite, Cursor-like design.

Bureau runs, monitors, previews, edits, and versions the moving parts of a project: source files, Markdown
documentation, Git, dev servers, language runtimes, the Android emulator, and local web URLs.

- **Plan:** [PLAN.md](./docs/PLAN.md) — scope, architecture, feature pillars, phased roadmap.
- **Design:** [DESIGN_SPEC.md](./docs/DESIGN_SPEC.md) — the graphite design system and components.

## Status

Phases 0–4 are implemented. Alongside project/process/preview/Android/toolchain/task operations, Bureau now
contains the StarGit workbench and a project-scoped Files workspace with a secure explorer, CodeMirror editor,
Monocle Markdown reader, search, recovery drafts, external-change protection, export, and Git handoff actions.

## Develop

```bash
npm install
npm start          # launch the app (Electron Forge + Vite)

npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run test:component
npm run test:e2e
npm run test:security
npm run package
```

## Architecture

`src/main` (privileged Node) · `src/preload` (frozen contextBridge) · `src/renderer` (React UI) ·
`src/shared` (Zod contracts, error codes, channels). See [PLAN.md](./docs/PLAN.md) §4–5.

## Releases

Bureau publishes normal NSIS Windows installers through GitHub Releases. Installed releases check the
public release channel in the background, download an available update, and only restart after the normal
quit guard has handled running processes and unsaved files.

For the initial `v1.0.0` release, push the matching tag:

```powershell
git tag v1.0.0
git push origin v1.0.0
```

For later releases, let npm update `package.json` and `package-lock.json`, create the matching tag, then
push the release commit and tag. GitHub Actions builds the installer, generates `latest.yml`, and attaches
both to the GitHub Release at no additional hosting cost.

```powershell
npm run release:patch
git push --follow-tags
```

Use `release:minor` or `release:major` for the corresponding semantic-version bump.
