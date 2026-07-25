# Bureau — Design Spec

> Bureau adopts the **graphite, Cursor-like** design language shared by StarGit and Monocle, *exactly*.
> This document captures the tokens, theme, shell layout, and the Bureau-specific components layered on
> top. Values below are lifted verbatim from the sibling apps so the three read as one product family.

---

## 1. Design principles

1. **Graphite, quiet, dense.** Near-black surfaces, low-chroma UI, one periwinkle accent. The content
   (logs, code, ports, devices) is the color; the chrome recedes.
2. **Dark-first.** Bureau is a developer tool that lives next to a terminal — dark is the default theme,
   with a full light theme available (StarGit's model, not Monocle's light-default).
3. **Information-dense but calm.** Compact 28–32px controls, tabular numerics, generous use of the mono
   font for anything machine-generated (paths, ports, PIDs, versions, timestamps).
4. **Frameless & native-feeling.** Custom titlebar, hairline borders, subtle elevation only for overlays.
5. **Motion is functional.** 80–160ms transitions, `cubic-bezier` easings, fully respect
   `prefers-reduced-motion`.
6. **Accessible.** 2px accent focus rings, `forced-colors` support, 28px minimum hit targets, ARIA live
   regions for streaming status.

---

## 2. Design tokens

Bureau ships one `tokens.css` (dark values in `:root`) + a `[data-theme='light']` override, mirroring
StarGit. These are the canonical values — **do not re-invent, reuse**.

### 2.1 Color — surfaces (dark / default)
```css
--color-surface-canvas:   #141414;  /* titlebar, statusbar, chrome */
--color-surface-sunken:   #141414;  /* wells, gutters, terminal */
--color-surface-base:     #181818;  /* main stage / content panels */
--color-surface-raised:   #262626;  /* cards, raised fills */
--color-surface-overlay:  #141414;  /* menus, dialogs, toasts */
--color-surface-hover:    rgba(240, 240, 240, 0.067); /* #F0F0F011 */
--color-surface-wash:     rgba(240, 240, 240, 0.04);  /* #F0F0F00A inputs / settings cards */
/* Selected rows: accent mixed into base (live token), not a fixed hex. */
--color-surface-selected: color-mix(in srgb, var(--color-accent-primary) 15%, var(--color-surface-base));
```

### 2.2 Color — text
```css
--color-text-primary:   #f0f0f0;
--color-text-secondary: #f0f0f0bd;
--color-text-muted:     #f0f0f099;
--color-text-disabled:  #f0f0f05c;
--color-text-on-accent: #141414;
```

### 2.3 Color — borders
```css
--color-border-subtle:  rgba(240, 240, 240, 0.075); /* #F0F0F013 hairlines */
--color-border-default: rgba(240, 240, 240, 0.15);  /* #F0F0F026 controls */
--color-border-strong:  #343434;                    /* emphasis chrome */
```

### 2.4 Color — accent (periwinkle) & focus
```css
--color-accent-primary: #7c9cff;
/* hover/pressed/soft/focus-ring derive via color-mix from primary (Settings may override primary). */
--color-accent-hover:   color-mix(in srgb, var(--color-accent-primary) 88%, #ffffff);
--color-accent-pressed: color-mix(in srgb, var(--color-accent-primary) 86%, #000000);
--color-accent-soft:    color-mix(in srgb, var(--color-accent-primary) 10%, transparent);
--color-focus:          var(--color-accent-primary);
--color-focus-ring:     color-mix(in srgb, var(--color-accent-primary) 22%, transparent);
```

### 2.5 Color — status (+ soft fills)
```css
--color-status-success: #3fa266;   --color-status-success-soft: rgba(63,162,102,0.12);
--color-status-warning: #f1b467;   --color-status-warning-soft: rgba(241,180,103,0.12);
--color-status-danger:  #e34671;   --color-status-danger-soft:  rgba(227,70,113,0.12);
--color-status-info:    var(--color-accent-primary);   --color-status-info-soft: var(--color-accent-soft);
```
**Bureau semantic mapping for process/device state:**
`running → success`, `starting → info/accent`, `warning/degraded → warning`, `crashed/error → danger`,
`stopped/idle → text-muted`.

### 2.6 Color — diff / log accents & scrims
```css
--color-diff-add-text: #70b489;  --color-diff-del-text: #fc6b83;   /* also reused for +/- log lines */
--color-scrim-dialog:  rgba(0, 0, 0, 0.55);
--color-scrim-disabled-region: rgba(20, 20, 20, 0.4);
```

### 2.7 Typography
```css
--font-family-ui:   'SF Pro', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
--font-family-mono: 'JetBrains Mono', 'JetBrainsMono NF', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;

--font-size-label: 11px;   --line-height-label: 16px;         /* uppercase section labels, meta */
--font-size-supporting: 12px; --line-height-supporting: 16px; /* secondary UI text */
--font-size-body: 13px;    --line-height-body: 19px;          /* default */
--font-size-section-title: 13px; --line-height-section-title: 19px;
--font-size-repository-title: 18px; /* → project-title */     --line-height-repository-title: 24px;
--font-size-page-title: 20px; --line-height-page-title: 28px;

--font-weight-regular: 400;  --font-weight-medium: 500;  --font-weight-semibold: 600;
```
**Rule:** everything machine-generated — paths, ports, PIDs, versions, log lines, timestamps, byte counts —
uses `--font-family-mono` with `font-variant-numeric: tabular-nums`. Do not invent ad-hoc font sizes outside this scale.

### 2.8 Spacing, radius, sizing
```css
--space-1..16: 4 8 12 16 20 24 32 40 48 64 (px)

--radius-sm: 6px;  --radius-control: 8px;  --radius-overlay: 8px;
--radius-card: 10px;  --radius-panel: 0px;  --radius-dialog: 12px;  --radius-pill: 999px;

--size-control-compact: 28px;  --size-control: 32px;  --size-target-minimum: 28px;
--size-titlebar: 36px;  --size-statusbar: 24px;
--size-list-row: 32px;  --size-list-row-compact: 28px;  --size-hub-row: 44px;
--size-sidebar-default: 220px;  --size-sidebar-min: 160px;  --size-sidebar-max: 360px;
```

### 2.9 Motion, elevation, z-index
```css
--motion-duration-press: 100ms;  --motion-duration-state: 120ms;  --motion-duration-disclosure: 160ms;
--motion-duration-dialog-enter: 160ms;  --motion-duration-dialog-exit: 100ms;
/* easings (from Monocle): */
--ease-enter: cubic-bezier(0.16, 1, 0.3, 1);
--ease-exit:  cubic-bezier(0.4, 0, 1, 1);
--ease-state: cubic-bezier(0.2, 0, 0, 1);

--shadow-menu:   0 8px 20px rgba(0,0,0,0.4);   /* overlays only; quiet Cursor-like */
--shadow-dialog: 0 12px 32px rgba(0,0,0,0.4);
--shadow-card:   none;                          /* resting cards stay flat */
--shadow-card-hover: 0 1px 0 rgba(255,255,255,0.03);

--z-base:0; --z-raised:10; --z-dropdown:100; --z-tooltip:200; --z-statusbar:300;
--z-sidebar-resize:350; --z-command-palette:400; --z-dialog:500;
--z-preview-view: 250;  /* embedded WebContentsView sits above content, below overlays */
--z-app-chrome: 550;    /* title bar / shell chrome */
--z-immersive: 560;     /* fullscreen emulator: covers chrome; Escape + button exit */
--z-popover: 600;       /* menus portalled to <body>, never occluded by a modal scrim */
```

### 2.10 Density
Support `[data-density='comfortable']` exactly like StarGit (controls 32→36px, rows 32→36px, body 13→14px).

### 2.11 Light theme
Provide `[data-theme='light']` with StarGit's light values (canvas `#f4f4f5`, base `#ffffff`, text
`#18181b`, borders `#e4e4e7`/`#d4d4d8`, wash `rgba(24,24,27,0.04)`, same accent). `color-scheme` set per theme.

---

## 3. Global rules (from `global.css`)

- Use the system UI font stack (no bundled Geist). JetBrains Mono for machine text.
- `box-sizing: border-box` everywhere; `html,body,#root` full-height; `body` overflow hidden;
  `-webkit-font-smoothing: antialiased`.
- `:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }`
- **Custom scrollbars:** quiet translucent white thumbs on transparent tracks (Cursor-like).
- `.kbd` / command-bar hints: mono chip, `--radius-sm`, wash fill, subtle border.
- `@media (prefers-reduced-motion)` zeroes animation/transition durations.
- `@media (forced-colors: active)` swaps focus/active outlines to system colors.

---

## 4. App shell layout

```
┌───────────────────────────────────────────────────────────────────────┐
│ TitleBar  ⬡ Bureau  [project ▾]   [⌘K command bar]        — ▢ ✕         │  drag region
├───────────────────────────────────────────────────────────────────────┤
│ Main workspace (full-bleed)                                           │
│  ┌─ tab strip: Overview │ Files │ Processes │ … ─────────────────────┐│
│  │                                                                    ││
│  │   (active tab content)                                             ││
│  │                                                                    ││
│  └────────────────────────────────────────────────────────────────────┘│
├───────────────────────────────────────────────────────────────────────┤
│ StatusBar  ● 3 running   :3000 :8080   node 20.11   ⎇ main            │
└───────────────────────────────────────────────────────────────────────┘
```

### 4.1 TitleBar (36px, `-webkit-app-region: drag`)
- Left: app mark + "Bureau" wordmark + **project switcher** (current project or "Projects" on hub).
- Center: **command bar** — click / ⌘K opens the palette; mono hint chip. Width `min(360px, 42vw)`.
- Right: window controls (46px each; close hover `#c42b1c`). Everything interactive is `no-drag`.

### 4.2 Project switcher (titlebar)
- Compact trigger with monogram (running ring when processes are live) + truncated name + chevron.
- Popover (portalled): filter field, Pinned / Recent groups, footer actions — Open hub, Add project, Settings.
- Hub remains the rich library for pin/reorder/remove. No persistent left rail; workspace is full-bleed.
- Settings categories stay as compact horizontal local navigation inside the Settings page (wash cards).

### 4.3 Tab strip (36px)
- Per-project workspace tabs (Overview/Files/Processes/Terminal/Preview/Android/Git).
- Inactive on canvas (`#141414`), active merges into stage base (`#181818`) with hairline borders
  (`6px 6px 0 0` top radius).

### 4.4 Status bar (24px)
- Clusters: left = global running-process dot + count; center = active ports (mono); right = active
  toolchain versions + git branch of selected project. While Files is active it additionally reports the
  relative path, cursor, indentation, encoding, EOL, language, dirty/conflict state and Markdown reading data.
  Status dots reuse `.status-dot` colors.

### 4.5 Command palette (⌘K)
- Overlay at 12vh, `min(640px, 100vw-32px)`, `--radius-dialog`, `--shadow-dialog`, `overlay-in` animation.
- Commands: switch project, start/stop process, open preview, boot AVD, run script, open Files /
  Git panels, Quick Open, project search, Markdown modes/headings, toggle theme, etc. Grouped, mono meta
  chips on the right.

---

## 5. Shared component inventory (reuse verbatim)

Port these from StarGit/Monocle with only cosmetic renaming:

**Primitives (Radix + graphite):** Button, IconButton, TextInput, TextArea, Select, Checkbox, Switch,
NumberField, Tooltip, Menu/DropdownMenu, ContextMenu, Dialog, ScrollArea, Separator, Badge, Banner,
Skeleton, EmptyState, StatusLine, Toast stack.

**Layout:** TitleBar (with ProjectSwitcher), TabStrip, StatusBar, CommandPalette, PaneSeparator
(resizable splitters), WorkbenchShell.

Button variants: `primary` (accent bg, `--color-text-on-accent`), `secondary` (raised + border), `ghost`,
`danger`. Heights `--size-control`/`--size-control-compact`, `--radius-control`.

---

## 6. Bureau-specific components

New components, all built from the tokens above.

### 6.0 Files workspace
- Dense three-region workbench: resizable 200–520px explorer sidebar, document tab strip, and editor/reader
  stage. Sidebar modes are Explorer, Search, Outline, Recent, and Document Info; no mode may produce a blank pane.
- File states are semantic and textual as well as chromatic: modified, externally changed, conflict, missing,
  recovered, read-only, unsupported, loading and error. Destructive actions always use Bureau dialogs.
- CodeMirror is themed by resolving Bureau tokens at runtime and reconfigures for theme/density changes.
  Machine text, paths, positions and byte counts remain mono with tabular numerals.
- Markdown Preview/Split uses the same graphite stage, compact toolbar and tokenised prose treatment. Split
  collapses at narrow widths; image zoom/lightbox, focus reading and export controls remain keyboard reachable.

### 6.1 ProjectCard (hub) — `--size-hub-row`+ tall
- Grid: name (body) + path (mono, muted) · stack badges · git/status pills · idle/last-opened foot.
  Flat graphite: hairline `--color-border-subtle`, `--color-surface-raised`, **no resting drop shadow**,
  no hover scale. Hover uses `--color-surface-hover` + slightly stronger border only.
  Quick actions (pin / remove) appear on hover/focus-within.

### 6.2 StackBadge
- Small pill (`--radius-pill`, `--font-size-label`) per detected stack: Node / Flutter / Python / Static /
  Git. Stack language tags use the **muted** tone (quiet graphite chrome). Status pills elsewhere
  (Clean / N changes / Missing) keep `--color-status-*-soft` fills.

### 6.3 ProcessRow / ProcessCard
- **State dot** (running/starting/warning/crashed/stopped → §2.5 mapping) + label + command preview (mono,
  muted, truncated).
- **Controls:** start ▸ / stop ◼ / restart ⟳ (IconButtons); overflow menu (edit, remove, autostart toggle).
- **Meta row (mono, tabular):** PID · uptime · CPU% · mem · detected URL (accent link → Preview).
- Expands to reveal its **LogConsole** or **Terminal**.

### 6.4 LogConsole (default process view)
- Mono, `--font-size-supporting`, `--color-surface-sunken` background, thin scrollbar.
- ANSI color mapped to the palette (`+`/`-` lines use diff colors; error lines tinted danger).
- Toolbar: follow-tail toggle, search (highlight like Monocle's `::highlight`), wrap toggle, copy, clear,
  export. Sticky "N new lines ↓" affordance when scrolled up.

### 6.5 Terminal (attach mode)
- **xterm.js** themed to the palette: background `--color-surface-sunken`, foreground `--color-text-primary`,
  cursor + selection `--color-accent-soft`, the 16 ANSI colors from Cursor Dark Anysphere.
  JetBrains Mono (Nerd Font preferred), fit-addon, search-addon. A "detach → log view" control returns to LogConsole.

### 6.6 Preview toolbar + frame
- Address bar (localhost-scoped, mono), reload / back / forward IconButtons, **viewport preset select**
  (Mobile 375×812 / Tablet 768×1024 / Desktop / Custom W×H + rotate), "open in browser", "DevTools".
- The frame is a positioned region; the actual page renders in the `WebContentsView` (§8 of PLAN). A subtle
  inset border + `--color-surface-sunken` matte around the device viewport.

### 6.7 Android panel
- **AVD list rows:** device name · API/target · state dot · start/stop; start dialog with options
  (cold boot, wipe data, GPU, DNS) as Switches/Selects.
- **Device selector** (adb devices) in the panel header.
- **Logcat console:** same LogConsole component, plus a filter bar (tag / priority Select / package /
  regex) and pause.
- **APK dropzone / picker** row → install progress → launch.
- **Mirror** button (scrcpy) with a small options popover.

### 6.8 PortRow (Phase 2)
- Mono port · protocol · owning process (link) · PID · kill IconButton. Conflict rows tinted
  `--color-status-warning-soft`.

### 6.9 ToolchainRow (Phase 2)
- Runtime icon · name · **active version** (mono) via a Select of installed versions · expected version
  badge · mismatch warning. Manager tag (fnm/pyenv/fvm) as a muted mono chip.

### 6.10 Status primitives
- **StateDot:** 6px, colors per §2.5, optional pulse animation for `starting` (respecting reduced-motion).
- **MetricChip:** mono value + uppercase label (Monocle's `.info-stat` pattern) for CPU/mem/uptime/ports.

---

## 7. Iconography

Use **`@phosphor-icons/react`** (Monocle's set) at 16/18/20px, `--color-text-secondary` default →
`--color-text-primary` on hover. Suggested mapping: Projects `Stack`/`FolderOpen`, Processes `Terminal`/
`Play`/`Stop`/`ArrowsClockwise`, Preview `Browser`/`DeviceMobile`, Android `AndroidLogo`/`DeviceMobileCamera`,
Ports `PlugsConnected`, Toolchains `Wrench`/`GitBranch`, Settings `GearSix`. Keep stroke weight consistent
(`regular`), reserve `fill`/accent color for active/selected states.

---

## 8. States, motion & feedback

- **Empty states** (Monocle's `.empty-state`): centered icon + title + one-line help + primary action
  ("Add a project", "No processes yet — detect from package.json").
- **Toasts** (`.toast` from Monocle): success/error/info with a 2px inset accent stripe; bottom-right,
  above the status bar; auto-dismiss + manual close.
- **Skeletons** for project scan / detection loading.
- **Overlays** animate with `overlay-in` (`--motion-standard`, `--ease-enter`).
- **Live regions:** streaming status changes (process crashed, AVD booted) announce via an ARIA live region.

---

## 9. Accessibility checklist

- 2px `--color-focus` focus-visible rings, `outline-offset: 2px`, everywhere.
- ≥ `--size-target-minimum` (28px) hit targets; comfortable density bumps to 32px.
- Full keyboard nav: rail/sidebar/tabs/palette are all keyboard-reachable; Escape closes overlays.
- `prefers-reduced-motion` and `forced-colors` handled globally (§3).
- Color is never the *only* signal — pair state dots with text labels/icons.

---

## 10. Do / Don't (keeping it on-brand)

**Do:** near-black graphite surfaces, hairline `--color-border-subtle` separators, one accent, mono for
data, compact rows, subtle elevation **only on overlays** (menus/dialogs), functional 80–160ms motion,
flat resting cards (no bloom or hover lift).

**Don't:** introduce a second accent hue, use pure black `#000` or pure white surfaces, add drop shadows to
inline/resting elements (including hub ProjectCards), use rounded-heavy cards, animate longer than ~200ms,
or mix in a non-Geist font.

---
