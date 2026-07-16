import { useEffect, useState, type DragEvent } from 'react';
import { useAppStore, type SettingsSection } from '../store/appStore';
import { AccentColorPicker } from '../components/ColorPicker';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { Dropdown } from '../components/Dropdown';
import { IconButton } from '../components/IconButton';
import { TextArea } from '../components/TextArea';
import { TextField } from '../components/TextField';
import { ArrowDownIcon, ArrowUpIcon, GripIcon } from '../components/icons';
import { reorderByDrag } from '../lib/projectOrder';
import { orderProjectTabs, PROJECT_TAB_LABELS } from '../lib/projectTabs';
import type {
  ConfirmationSettings,
  DensityPreference,
  EditorPreset,
  ProjectTabId,
  StartupViewPreference,
  TerminalPreset,
  ThemePreference,
} from '@shared/contracts/settings';
import {
  DEFAULT_FILES_SETTINGS,
  EDITOR_FONT_SIZES,
  LOG_BUFFER_CHOICES,
  MAX_CRASH_RESTART_CHOICES,
  PROJECT_TAB_IDS,
  TERMINAL_CURSOR_STYLES,
  TERMINAL_FONT_SIZES,
  TERMINAL_SCROLLBACKS,
  UI_SCALES,
  VIEWPORT_PRESETS,
} from '@shared/contracts/settings';
import type { AppUpdateState } from '@shared/contracts/updates';

const THEMES: ThemePreference[] = ['dark', 'light', 'system'];
const DENSITIES: DensityPreference[] = ['compact', 'comfortable'];
const STARTUP_VIEWS: StartupViewPreference[] = ['hub', 'lastOpened'];
const PRESET_ACCENTS = ['#7c9cff', '#6db87a', '#c9a24d', '#d46a6a', '#b98cff', '#4fb3c4'];

/**
 * Every destructive git action that can ask first. Checked = ask. These are all
 * honored by the store's gateConfirm; before this list existed only
 * `conflictOverwrite` had a control, so the rest were pinned at their defaults.
 */
const CONFIRMATION_ROWS: Array<{
  key: keyof ConfirmationSettings;
  label: string;
  description: string;
}> = [
  {
    key: 'discardChanges',
    label: 'Discard changes',
    description: 'Ask before discarding uncommitted changes to a file.',
  },
  {
    key: 'deleteBranch',
    label: 'Delete branch',
    description: 'Ask before deleting a local branch.',
  },
  {
    key: 'deleteRemoteBranch',
    label: 'Delete remote branch',
    description: 'Ask before deleting a branch on the remote.',
  },
  {
    key: 'deleteRemoteTag',
    label: 'Delete remote tag',
    description: 'Ask before deleting a tag on the remote.',
  },
  { key: 'dropStash', label: 'Drop stash', description: 'Ask before dropping a stash entry.' },
  {
    key: 'stashPop',
    label: 'Pop stash',
    description: 'Ask before popping a stash, which drops it and can conflict.',
  },
  {
    key: 'restoreStashFiles',
    label: 'Restore files from stash',
    description: 'Ask before overwriting working-tree files with a stashed version.',
  },
  {
    key: 'amendCommit',
    label: 'Amend commit',
    description: 'Ask before rewriting the most recent commit.',
  },
  {
    key: 'conflictOverwrite',
    label: 'Overwrite conflict resolution',
    description: 'Ask before “Use ours/theirs” replaces your working-tree resolution.',
  },
  {
    key: 'mergeBranch',
    label: 'Merge branch',
    description: 'Ask before merging another branch into the current one.',
  },
  {
    key: 'rebaseBranch',
    label: 'Rebase branch',
    description: 'Ask before replaying the current branch onto another, which rewrites its history.',
  },
  {
    key: 'resetBranch',
    label: 'Reset branch (soft or mixed)',
    description: 'Ask before moving the current branch to another commit, keeping your files.',
  },
  {
    key: 'resetHard',
    label: 'Reset branch (hard)',
    description:
      'Ask before a hard reset restores tracked files and destroys your uncommitted changes for good.',
  },
  {
    key: 'checkoutCommit',
    label: 'Check out a commit',
    description: 'Ask before checking out a commit directly, which leaves you on no branch.',
  },
  {
    key: 'removeRemote',
    label: 'Remove remote',
    description: 'Ask before removing a remote and its remote-tracking branches.',
  },
  {
    key: 'abortOperation',
    label: 'Abort merge or rebase',
    description: 'Ask before discarding an in-progress merge, rebase, cherry-pick, or revert.',
  },
  {
    key: 'skipCommit',
    label: 'Skip commit',
    description: "Ask before dropping the current commit's changes during a rebase or cherry-pick.",
  },
  {
    key: 'submoduleUpdate',
    label: 'Update submodule',
    description: "Ask before checking out the recorded commit in a submodule's working tree.",
  },
  {
    key: 'pruneWorktrees',
    label: 'Prune worktrees',
    description: 'Ask before pruning stale worktree entries.',
  },
];

const NODE_MANAGERS = ['fnm', 'volta', 'nvm', 'system'] as const;
const PYTHON_MANAGERS = ['venv', 'pyenv'] as const;
const FLUTTER_MANAGERS = ['fvm', 'flutter'] as const;

const SETTINGS_NAV: Array<{ id: SettingsSection; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'tools', label: 'Editors' },
  { id: 'processes', label: 'Processes' },
  { id: 'toolchains', label: 'Toolchains' },
  { id: 'files', label: 'Files' },
  { id: 'git', label: 'Git' },
  { id: 'android', label: 'Android' },
];

const EDITOR_LABELS: Record<EditorPreset, string> = {
  vscode: 'VS Code',
  cursor: 'Cursor',
  zed: 'Zed',
  sublime: 'Sublime',
};

const TERMINAL_LABELS: Record<TerminalPreset, string> = {
  'windows-terminal': 'Windows Terminal',
  powershell: 'PowerShell',
  cmd: 'Command Prompt',
  'terminal-app': 'Terminal',
  'gnome-terminal': 'GNOME Terminal',
  konsole: 'Konsole',
  'xfce4-terminal': 'XFCE Terminal',
  alacritty: 'Alacritty',
  xterm: 'xterm',
};

export function SettingsPage() {
  const section = useAppStore((s) => s.settingsSection);
  const setSettingsSection = useAppStore((s) => s.setSettingsSection);

  return (
    <div className="stage-inner stage-inner--settings">
      <h1 className="page-title">Settings</h1>
      <p className="page-subtitle">Preferences are stored locally and applied instantly.</p>
      <nav className="settings-nav" aria-label="Settings sections">
        {SETTINGS_NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className={section === item.id ? 'active' : ''}
            aria-current={section === item.id ? 'page' : undefined}
            onClick={() => setSettingsSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {section === 'general' && <GeneralSection />}
      {section === 'appearance' && <AppearanceSection />}
      {section === 'tools' && <ToolsSection />}
      {section === 'processes' && <ProcessesSettingsSection />}
      {section === 'toolchains' && <ToolchainsSettingsSection />}
      {section === 'files' && <FilesSettingsSection />}
      {section === 'git' && <GitSettingsSection />}
      {section === 'android' && <AndroidSection />}
    </div>
  );
}

function FilesSettingsSection() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  if (!settings) return null;
  const files = settings.files ?? DEFAULT_FILES_SETTINGS;
  return (
    <section className="settings-section">
      <h2>Files</h2>
      <div className="settings-row">
        <div>
          <div className="settings-row__label">Session restore</div>
          <div className="settings-row__desc">
            Restore file tabs, modes, recents, and expanded folders per project.
          </div>
        </div>
        <Checkbox
          checked={files.restoreSession}
          onCheckedChange={(restoreSession) => void updateSettings({ files: { restoreSession } })}
          label="Restore Files sessions"
        />
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-row__label">External changes</div>
          <div className="settings-row__desc">
            Reload clean buffers automatically. Dirty buffers always enter conflict mode.
          </div>
        </div>
        <Checkbox
          checked={files.autoReloadClean}
          onCheckedChange={(autoReloadClean) => void updateSettings({ files: { autoReloadClean } })}
          label="Reload clean files"
        />
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-row__label">Ignored files</div>
          <div className="settings-row__desc">
            Show files matched by nested .gitignore rules. The .git directory remains inaccessible.
          </div>
        </div>
        <Checkbox
          checked={files.showIgnored}
          onCheckedChange={(showIgnored) => void updateSettings({ files: { showIgnored } })}
          label="Show ignored files"
        />
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-row__label">Editor text size</div>
          <div className="settings-row__desc">
            Type size in the code editor. The app-wide interface scale applies on top of this.
          </div>
        </div>
        <div className="segmented" role="group" aria-label="Editor text size">
          {EDITOR_FONT_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              className={files.editorFontSize === size ? 'active' : ''}
              onClick={() => void updateSettings({ files: { editorFontSize: size } })}
            >
              {size}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-row__label">Line numbers</div>
          <div className="settings-row__desc">Show the line-number gutter in the code editor.</div>
        </div>
        <Checkbox
          checked={files.lineNumbers}
          onCheckedChange={(lineNumbers) => void updateSettings({ files: { lineNumbers } })}
          label="Show line numbers"
        />
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-row__label">Editor wrapping</div>
          <div className="settings-row__desc">
            Wrap long lines in code and text editors. Markdown editing always wraps.
          </div>
        </div>
        <Checkbox
          checked={files.wordWrap}
          onCheckedChange={(wordWrap) => void updateSettings({ files: { wordWrap } })}
          label="Word wrap"
        />
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-row__label">Indentation</div>
          <div className="settings-row__desc">
            Default indentation width for newly edited content.
          </div>
        </div>
        <Dropdown
          label="Tab size"
          value={String(files.tabSize)}
          options={[
            { value: '2', label: '2 spaces' },
            { value: '4', label: '4 spaces' },
          ]}
          onChange={(value) => void updateSettings({ files: { tabSize: Number(value) as 2 | 4 } })}
        />
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-row__label">Reader width</div>
          <div className="settings-row__desc">Maximum line width for rendered Markdown.</div>
        </div>
        <Dropdown
          label="Reader width"
          value={files.readerWidth}
          options={[
            { value: 'narrow', label: 'Narrow' },
            { value: 'standard', label: 'Standard' },
            { value: 'wide', label: 'Wide' },
          ]}
          onChange={(readerWidth) =>
            void updateSettings({
              files: { readerWidth: readerWidth as 'narrow' | 'standard' | 'wide' },
            })
          }
        />
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-row__label">Raw HTML</div>
          <div className="settings-row__desc">
            Parse Markdown HTML before strict sanitisation. Disabled is the safer default.
          </div>
        </div>
        <Checkbox
          checked={files.allowRawHtml}
          onCheckedChange={(allowRawHtml) => void updateSettings({ files: { allowRawHtml } })}
          label="Allow sanitised HTML"
        />
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-row__label">Remote images</div>
          <div className="settings-row__desc">
            Remote content never loads directly in the renderer.
          </div>
        </div>
        <Dropdown
          label="Remote images"
          value={files.remoteImages}
          options={[
            { value: 'ask', label: 'Ask before loading' },
            { value: 'block', label: 'Block' },
          ]}
          onChange={(remoteImages) =>
            void updateSettings({ files: { remoteImages: remoteImages as 'ask' | 'block' } })
          }
        />
      </div>
    </section>
  );
}

function GitSettingsSection() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const applySettings = useAppStore((s) => s.applySettings);
  if (!settings) return null;

  const chooseGit = async () => {
    await window.bureau.settings.chooseGitExecutable();
    applySettings(await window.bureau.settings.get());
  };

  const clearGit = async () => {
    await window.bureau.settings.clearGitExecutable();
    applySettings(await window.bureau.settings.get());
  };

  return (
    <section className="settings-section">
      <h2>Git</h2>
      <div className="settings-row">
        <div>
          <div className="settings-row__label">Git executable</div>
          <div className="settings-row__desc">
            Leave empty to use PATH / platform defaults (min 2.25).
          </div>
          <div className="settings-path mono">{settings.git.executablePath ?? 'Auto-detect'}</div>
        </div>
        <div className="settings-row__actions">
          <Button onClick={() => void chooseGit()}>Choose…</Button>
          {settings.git.executablePath ? (
            <Button variant="ghost" onClick={() => void clearGit()}>
              Clear
            </Button>
          ) : null}
        </div>
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-row__label">Pull strategy</div>
          <div className="settings-row__desc">How Bureau runs git pull from the Sync bar.</div>
        </div>
        <Dropdown
          className="settings-dropdown"
          label="Pull strategy"
          value={settings.gitBehavior.pullStrategy}
          options={[
            { value: 'ff-only', label: 'Fast-forward only' },
            { value: 'merge', label: 'Merge' },
            { value: 'rebase', label: 'Rebase' },
          ]}
          onChange={(pullStrategy) =>
            void updateSettings({
              gitBehavior: { pullStrategy: pullStrategy as 'ff-only' | 'merge' | 'rebase' },
            })
          }
        />
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-row__label">History page size</div>
          <div className="settings-row__desc">Initial commits loaded in the History panel.</div>
        </div>
        <Dropdown
          className="settings-dropdown"
          label="History page size"
          value={String(settings.history.commitLimit)}
          options={['20', '30', '50', '100'].map((n) => ({ value: n, label: n }))}
          onChange={(value) => void updateSettings({ history: { commitLimit: Number(value) } })}
        />
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-row__label">Auto-refresh</div>
          <div className="settings-row__desc">
            How often the Git tab refreshes status (never fetches).
          </div>
        </div>
        <Dropdown
          className="settings-dropdown"
          label="Refresh interval"
          value={String(settings.general.refreshIntervalMs)}
          options={[
            { value: '0', label: 'Off' },
            { value: '5000', label: '5 seconds' },
            { value: '15000', label: '15 seconds' },
            { value: '30000', label: '30 seconds' },
            { value: '60000', label: '60 seconds' },
          ]}
          onChange={(value) =>
            void updateSettings({
              general: {
                refreshIntervalMs: Number(value) as 0 | 5000 | 15000 | 30000 | 60000,
              },
            })
          }
        />
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-row__label">Refresh on focus</div>
          <div className="settings-row__desc">
            Also refresh the Git tab whenever Bureau regains focus (never fetches).
          </div>
        </div>
        <Checkbox
          checked={settings.general.refreshOnFocus}
          onCheckedChange={(refreshOnFocus) => void updateSettings({ general: { refreshOnFocus } })}
          label="Refresh on window focus"
        />
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-row__label">Default sign-off</div>
          <div className="settings-row__desc">Pre-check --signoff on new commits.</div>
        </div>
        <Dropdown
          className="settings-dropdown"
          label="Default sign-off"
          value={settings.commit.defaultSignOff ? 'on' : 'off'}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'on', label: 'On' },
          ]}
          onChange={(value) => void updateSettings({ commit: { defaultSignOff: value === 'on' } })}
        />
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-row__label">Commit signing</div>
          <div className="settings-row__desc">Pass -S when Git config enables signing.</div>
        </div>
        <Dropdown
          className="settings-dropdown"
          label="Commit signing"
          value={settings.commit.signingPreference}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'config', label: 'Respect Git config' },
          ]}
          onChange={(signingPreference) =>
            void updateSettings({
              commit: { signingPreference: signingPreference as 'off' | 'config' },
            })
          }
        />
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-row__label">Commit message template</div>
          <div className="settings-row__desc">
            Prefills the commit message when starting a new commit in the Git tab.
          </div>
        </div>
        <TextArea
          label="Commit message template"
          value={settings.commit.commitTemplate ?? ''}
          rows={4}
          onChange={(e) =>
            void updateSettings({
              commit: { commitTemplate: e.target.value || undefined },
            })
          }
        />
      </div>
      {CONFIRMATION_ROWS.map((row) => (
        <div className="settings-row" key={row.key}>
          <div>
            <div className="settings-row__label">{row.label}</div>
            <div className="settings-row__desc">{row.description}</div>
          </div>
          <Checkbox
            checked={settings.confirmations[row.key]}
            onCheckedChange={(checked) =>
              void updateSettings({ confirmations: { [row.key]: checked } })
            }
            label="Ask first"
          />
        </div>
      ))}
    </section>
  );
}

function AndroidSection() {
  const settings = useAppStore((s) => s.settings);
  const capabilities = useAppStore((s) => s.capabilities);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const applySettings = useAppStore((s) => s.applySettings);
  if (!settings || !capabilities) return null;

  const chooseSdk = async () => {
    const status = await window.bureau.android.chooseSdkPath();
    applySettings(await window.bureau.settings.get());
    if (status.sdkPath !== capabilities.android.sdkPath) {
      useAppStore.setState((state) => ({
        capabilities: state.capabilities ? { ...state.capabilities, android: status } : null,
      }));
    }
  };

  const chooseScrcpy = async () => {
    const status = await window.bureau.android.chooseScrcpyPath();
    applySettings(await window.bureau.settings.get());
    useAppStore.setState((state) => ({
      capabilities: state.capabilities ? { ...state.capabilities, android: status } : null,
    }));
  };

  return (
    <section className="settings-section">
      <h2>Android</h2>
      <div className="settings-row">
        <div>
          <div className="settings-row__label">scrcpy</div>
          <div className="settings-row__desc">
            Optional executable used for device mirroring and recording.
          </div>
          <div className="settings-path mono">
            {settings.android.scrcpyPath ?? capabilities.android.scrcpy.path ?? 'Not detected'}
          </div>
        </div>
        <Button onClick={() => void chooseScrcpy()}>Choose scrcpy</Button>
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-row__label">Android SDK</div>
          <div className="settings-row__desc">
            The SDK root containing platform-tools and emulator.
          </div>
          <div className="settings-path mono">
            {settings.android.sdkPath ?? capabilities.android.sdkPath ?? 'Not detected'}
          </div>
        </div>
        <Button onClick={() => void chooseSdk()}>Choose SDK</Button>
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-row__label">Default logcat priority</div>
          <div className="settings-row__desc">Minimum severity selected when opening Android.</div>
        </div>
        <Dropdown
          className="settings-dropdown"
          label="Default logcat priority"
          value={settings.android.defaultLogcatPriority}
          options={(['V', 'D', 'I', 'W', 'E', 'F', 'S'] as const).map((priority) => ({
            value: priority,
            label: priority,
          }))}
          onChange={(priority) =>
            void updateSettings({
              android: { defaultLogcatPriority: priority },
            })
          }
        />
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-row__label">Default logcat regex</div>
          <div className="settings-row__desc">
            Optional regular expression applied to new streams.
          </div>
        </div>
        <TextField
          mono
          className="settings-text-field"
          value={settings.android.defaultLogcatFilter}
          onChange={(event) =>
            void updateSettings({ android: { defaultLogcatFilter: event.target.value } })
          }
          placeholder="No filter"
        />
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-row__label">React Native Metro port</div>
          <div className="settings-row__desc">
            Port used by managed Metro processes, Android builds, and ADB reverse.
          </div>
        </div>
        <TextField
          mono
          className="settings-text-field"
          type="number"
          min={1024}
          max={65535}
          value={settings.android.reactNativeMetroPort}
          onChange={(event) => {
            const port = Number(event.target.value);
            if (Number.isInteger(port) && port >= 1024 && port <= 65535) {
              void updateSettings({ android: { reactNativeMetroPort: port } });
            }
          }}
        />
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-row__label">Reverse Metro automatically</div>
          <div className="settings-row__desc">
            Run ADB reverse for the selected device before each React Native Android build.
          </div>
        </div>
        <div className="segmented" aria-label="Reverse Metro automatically">
          <button
            type="button"
            className={settings.android.reactNativeAutoReverse ? 'active' : ''}
            onClick={() => void updateSettings({ android: { reactNativeAutoReverse: true } })}
          >
            On
          </button>
          <button
            type="button"
            className={!settings.android.reactNativeAutoReverse ? 'active' : ''}
            onClick={() => void updateSettings({ android: { reactNativeAutoReverse: false } })}
          >
            Off
          </button>
        </div>
      </div>
    </section>
  );
}

function UpdateSection() {
  const [update, setUpdate] = useState<AppUpdateState>({
    kind: 'disabled',
    currentVersion: 'Unknown',
  });

  useEffect(() => {
    const app = window.bureau?.app;
    if (!app) return;
    let active = true;
    const unsubscribe = app.onUpdateState((next) => {
      if (active) setUpdate(next);
    });
    void app.getUpdateState().then((next) => {
      if (active) setUpdate(next);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const checking =
    update.kind === 'checking' || update.kind === 'available' || update.kind === 'downloading';
  const description =
    update.kind === 'disabled'
      ? 'Updates are available in installed releases. Development and locally packaged builds do not check.'
      : update.kind === 'checking'
        ? 'Checking the release channel.'
        : update.kind === 'available'
          ? 'An update is downloading in the background.'
          : update.kind === 'downloading'
            ? `Downloading update… ${update.percent}%`
            : update.kind === 'downloaded'
              ? `Version ${update.availableVersion} is ready. Restart when your work is safe to close.`
              : update.kind === 'error'
                ? 'The release channel could not be checked. Try again later.'
                : 'Bureau is up to date.';

  return (
    <div className="settings-row">
      <div>
        <div className="settings-row__label">Application updates</div>
        <div className="settings-row__desc">{description}</div>
        <div className="settings-path mono">Bureau {update.currentVersion}</div>
      </div>
      <div className="settings-row__actions">
        {update.kind === 'downloaded' ? (
          <Button variant="primary" onClick={() => void window.bureau.app.installUpdate()}>
            Restart and update
          </Button>
        ) : (
          <Button
            loading={checking}
            disabled={update.kind === 'disabled' || checking}
            onClick={() => void window.bureau.app.checkForUpdates()}
          >
            Check for updates
          </Button>
        )}
      </div>
    </div>
  );
}

function GeneralSection() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  if (!settings) return null;

  return (
    <section className="settings-section">
      <h2>General</h2>

      <div className="settings-row">
        <div>
          <div className="settings-row__label">On startup</div>
          <div className="settings-row__desc">Which view Bureau opens to.</div>
        </div>
        <div className="segmented">
          {STARTUP_VIEWS.map((view) => (
            <button
              key={view}
              type="button"
              className={settings.general.startupView === view ? 'active' : ''}
              onClick={() => updateSettings({ general: { startupView: view } })}
            >
              {view === 'hub' ? 'Hub' : 'Last opened'}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-row__label">Confirm before quitting</div>
          <div className="settings-row__desc">
            Warn when running processes would be stopped on quit.
          </div>
        </div>
        <div className="segmented">
          <button
            type="button"
            className={settings.general.confirmBeforeQuit ? 'active' : ''}
            onClick={() => updateSettings({ general: { confirmBeforeQuit: true } })}
          >
            On
          </button>
          <button
            type="button"
            className={!settings.general.confirmBeforeQuit ? 'active' : ''}
            onClick={() => updateSettings({ general: { confirmBeforeQuit: false } })}
          >
            Off
          </button>
        </div>
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-row__label">Notifications</div>
          <div className="settings-row__desc">
            Show a desktop notification when a background operation finishes while Bureau is not
            focused.
          </div>
        </div>
        <Checkbox
          checked={settings.notifications.enabled}
          onCheckedChange={(enabled) => void updateSettings({ notifications: { enabled } })}
          label="Enable notifications"
        />
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-row__label">Notify for</div>
          <div className="settings-row__desc">
            Limit notifications to operations that run longer than 10 seconds, instead of every
            completed operation.
          </div>
        </div>
        <Checkbox
          checked={settings.notifications.longRunningOnly}
          disabled={!settings.notifications.enabled}
          onCheckedChange={(longRunningOnly) =>
            void updateSettings({ notifications: { longRunningOnly } })
          }
          label="Long-running operations only"
        />
      </div>

      <UpdateSection />
    </section>
  );
}

function AppearanceSection() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  if (!settings) return null;

  const accent = settings.appearance.accentColor;
  const isCustomAccent = !PRESET_ACCENTS.includes(accent);

  return (
    <section className="settings-section">
      <h2>Appearance</h2>

      <div className="settings-row">
        <div>
          <div className="settings-row__label">Theme</div>
          <div className="settings-row__desc">Bureau is dark-first; switch any time.</div>
        </div>
        <div className="segmented">
          {THEMES.map((theme) => (
            <button
              key={theme}
              type="button"
              className={settings.appearance.theme === theme ? 'active' : ''}
              onClick={() => updateSettings({ appearance: { theme } })}
            >
              {theme}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-row__label">Density</div>
          <div className="settings-row__desc">Control and row heights.</div>
        </div>
        <div className="segmented">
          {DENSITIES.map((density) => (
            <button
              key={density}
              type="button"
              className={settings.appearance.density === density ? 'active' : ''}
              onClick={() => updateSettings({ appearance: { density } })}
            >
              {density}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-row__label">Accent</div>
          <div className="settings-row__desc">
            Used for highlights, focus rings, and selection. Pick a preset or choose a custom color.
          </div>
        </div>
        <div className="accent-swatches">
          {PRESET_ACCENTS.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-label={`Accent ${preset}`}
              className={['accent-swatch', accent === preset ? 'active' : ''].join(' ')}
              style={{ background: preset }}
              onClick={() => updateSettings({ appearance: { accentColor: preset } })}
            />
          ))}
          <AccentColorPicker
            value={accent}
            isActive={isCustomAccent}
            onChange={(hex) => updateSettings({ appearance: { accentColor: hex } })}
          />
          <span className="accent-value mono">{accent}</span>
        </div>
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-row__label">Immersive mode</div>
          <div className="settings-row__desc">
            Auto-hide the project rail so the workspace uses the full width. Reveal it from the left
            workspace edge. Toggle with Ctrl+B.
          </div>
        </div>
        <Checkbox
          checked={settings.appearance.immersiveMode}
          onCheckedChange={(immersiveMode) =>
            void updateSettings({ appearance: { immersiveMode } })
          }
          label="Enable immersive mode"
        />
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-row__label">Interface scale</div>
          <div className="settings-row__desc">
            Scales the whole interface. Does not affect the previewed page, which has its own zoom.
          </div>
        </div>
        <div className="segmented" role="group" aria-label="Interface scale">
          {UI_SCALES.map((scale) => (
            <button
              key={scale}
              type="button"
              className={settings.appearance.uiScale === scale ? 'active' : ''}
              onClick={() => void updateSettings({ appearance: { uiScale: scale } })}
            >
              {Math.round(scale * 100)}%
            </button>
          ))}
        </div>
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-row__label">Reduce motion</div>
          <div className="settings-row__desc">
            Cut animations and transitions throughout the app. Bureau already follows your
            system’s reduce-motion setting; this turns it on regardless.
          </div>
        </div>
        <Checkbox
          checked={settings.appearance.reduceMotion}
          onCheckedChange={(reduceMotion) => void updateSettings({ appearance: { reduceMotion } })}
          label="Always reduce motion"
        />
      </div>

      <div className="settings-row settings-row--stacked">
        <div>
          <div className="settings-row__label">Workspace tabs</div>
          <div className="settings-row__desc">
            Drag to reorder the tabs shown in every project workspace, or use the arrows. Saved
            automatically.
          </div>
        </div>
        <ProjectTabOrderEditor
          order={settings.appearance.projectTabOrder}
          onReorder={(projectTabOrder) => void updateSettings({ appearance: { projectTabOrder } })}
        />
      </div>
    </section>
  );
}

function ProjectTabOrderEditor({
  order: saved,
  onReorder,
}: {
  order: ProjectTabId[] | undefined;
  onReorder(order: ProjectTabId[] | undefined): void;
}) {
  const [draft, setDraft] = useState<ProjectTabId[] | null>(null);
  const [draggingId, setDraggingId] = useState<ProjectTabId | null>(null);

  const base = orderProjectTabs(saved);
  const order = draft ?? base;
  const isDefault = base.join(' ') === PROJECT_TAB_IDS.join(' ');

  const commit = (next: ProjectTabId[]) => {
    setDraggingId(null);
    setDraft(null);
    // Reset to the canonical order clears the override; otherwise persist the change.
    if (next.join(' ') === PROJECT_TAB_IDS.join(' ')) {
      if (!isDefault) onReorder(undefined);
    } else if (next.join(' ') !== base.join(' ')) {
      onReorder(next);
    }
  };

  const move = (id: ProjectTabId, delta: number) =>
    commit(reorderByDrag(order, id, order[order.indexOf(id) + delta]));

  return (
    <div className="tab-order">
      <ul className="tab-order__list">
        {order.map((id, index) => (
          <li
            key={id}
            className={['tab-order__item', draggingId === id ? 'dragging' : ''].join(' ')}
            draggable
            onDragStart={(event: DragEvent) => {
              setDraggingId(id);
              setDraft(order);
              event.dataTransfer.effectAllowed = 'move';
              // Firefox requires drag data for a drag to begin.
              event.dataTransfer.setData('text/plain', id);
            }}
            onDragEnd={() => {
              setDraggingId(null);
              setDraft(null);
            }}
            onDragOver={(event: DragEvent) => {
              if (!draggingId) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              const next = reorderByDrag(order, draggingId, id);
              if (next.join(' ') !== order.join(' ')) setDraft(next);
            }}
            onDrop={(event: DragEvent) => {
              if (!draggingId) return;
              event.preventDefault();
              commit(reorderByDrag(order, draggingId, id));
            }}
          >
            <span className="tab-order__grip" aria-hidden title="Drag to reorder">
              <GripIcon size={14} />
            </span>
            <span className="tab-order__index mono">{index + 1}</span>
            <span className="tab-order__label">{PROJECT_TAB_LABELS[id]}</span>
            <span className="tab-order__move">
              <IconButton
                label={`Move ${PROJECT_TAB_LABELS[id]} up`}
                disabled={index === 0}
                onClick={() => move(id, -1)}
              >
                <ArrowUpIcon size={14} />
              </IconButton>
              <IconButton
                label={`Move ${PROJECT_TAB_LABELS[id]} down`}
                disabled={index === order.length - 1}
                onClick={() => move(id, 1)}
              >
                <ArrowDownIcon size={14} />
              </IconButton>
            </span>
          </li>
        ))}
      </ul>
      {!isDefault && (
        <div className="tab-order__actions">
          <Button variant="ghost" onClick={() => commit([...PROJECT_TAB_IDS])}>
            Reset to default
          </Button>
        </div>
      )}
    </div>
  );
}

function ToolsSection() {
  const settings = useAppStore((s) => s.settings);
  const capabilities = useAppStore((s) => s.capabilities);
  const setEditorPreset = useAppStore((s) => s.setEditorPreset);
  const chooseCustomEditor = useAppStore((s) => s.chooseCustomEditor);
  const setTerminalPreset = useAppStore((s) => s.setTerminalPreset);
  const chooseCustomTerminal = useAppStore((s) => s.chooseCustomTerminal);
  const updateSettings = useAppStore((s) => s.updateSettings);
  if (!settings || !capabilities) return null;

  const editor = settings.editor;
  const terminal = settings.terminal;
  const tools = settings.tools;

  const editorPresets = unique<EditorPreset>([
    ...(editor.kind === 'preset' ? [editor.preset] : []),
    ...capabilities.availableEditors,
  ]);
  const terminalPresets = unique<TerminalPreset>([
    ...(terminal.kind === 'preset' ? [terminal.preset] : []),
    ...capabilities.availableTerminals,
  ]);

  return (
    <section className="settings-section">
      <h2>Editors &amp; Terminals</h2>

      <div className="settings-row">
        <div>
          <div className="settings-row__label">External editor</div>
          <div className="settings-row__desc">
            Used by “Open in editor”. Detected editors are listed; pick another with Custom.
          </div>
        </div>
        <div className="chip-row">
          <button
            type="button"
            className={['chip', editor.kind === 'none' ? 'active' : ''].join(' ')}
            onClick={() => setEditorPreset('none')}
          >
            None
          </button>
          {editorPresets.map((preset) => (
            <button
              key={preset}
              type="button"
              className={[
                'chip',
                editor.kind === 'preset' && editor.preset === preset ? 'active' : '',
              ].join(' ')}
              onClick={() => setEditorPreset(preset)}
            >
              {EDITOR_LABELS[preset]}
            </button>
          ))}
          <button
            type="button"
            className={['chip', editor.kind === 'custom' ? 'active' : ''].join(' ')}
            onClick={() => void chooseCustomEditor()}
          >
            Custom…
          </button>
        </div>
      </div>
      {editor.kind === 'custom' && <p className="settings-path mono">{editor.executablePath}</p>}

      <div className="settings-row">
        <div>
          <div className="settings-row__label">Terminal</div>
          <div className="settings-row__desc">
            Used by “Open in terminal”. Automatic picks the best available on this platform.
          </div>
        </div>
        <div className="chip-row">
          <button
            type="button"
            className={['chip', terminal.kind === 'auto' ? 'active' : ''].join(' ')}
            onClick={() => setTerminalPreset('auto')}
          >
            Automatic
          </button>
          {terminalPresets.map((preset) => (
            <button
              key={preset}
              type="button"
              className={[
                'chip',
                terminal.kind === 'preset' && terminal.preset === preset ? 'active' : '',
              ].join(' ')}
              onClick={() => setTerminalPreset(preset)}
            >
              {TERMINAL_LABELS[preset]}
            </button>
          ))}
          <button
            type="button"
            className={['chip', terminal.kind === 'custom' ? 'active' : ''].join(' ')}
            onClick={() => void chooseCustomTerminal()}
          >
            Custom…
          </button>
        </div>
      </div>
      {terminal.kind === 'custom' && (
        <p className="settings-path mono">{terminal.executablePath}</p>
      )}

      <div className="settings-row">
        <div>
          <div className="settings-row__label">Project actions</div>
          <div className="settings-row__desc">
            Which “Open in…” buttons appear on the project Overview and in the Git tab.
          </div>
        </div>
        <div className="settings-checks">
          <Checkbox
            checked={tools.showOpenInEditor}
            onCheckedChange={(showOpenInEditor) =>
              void updateSettings({ tools: { showOpenInEditor } })
            }
            label="Open in editor"
          />
          <Checkbox
            checked={tools.showOpenInTerminal}
            onCheckedChange={(showOpenInTerminal) =>
              void updateSettings({ tools: { showOpenInTerminal } })
            }
            label="Open in terminal"
          />
          <Checkbox
            checked={tools.showOpenInExplorer}
            onCheckedChange={(showOpenInExplorer) =>
              void updateSettings({ tools: { showOpenInExplorer } })
            }
            label="Open in explorer"
          />
        </div>
      </div>
    </section>
  );
}

function ManagerRow<T extends string>({
  label,
  description,
  options,
  value,
  onSelect,
}: {
  label: string;
  description: string;
  options: readonly T[];
  value: T | undefined;
  onSelect: (value: T | undefined) => void;
}) {
  return (
    <div className="settings-row">
      <div>
        <div className="settings-row__label">{label}</div>
        <div className="settings-row__desc">{description}</div>
      </div>
      <div className="segmented" role="group" aria-label={`Preferred ${label} version manager`}>
        <button
          type="button"
          className={value === undefined ? 'active' : ''}
          onClick={() => onSelect(undefined)}
        >
          Auto
        </button>
        {options.map((manager) => (
          <button
            key={manager}
            type="button"
            className={value === manager ? 'active' : ''}
            onClick={() => onSelect(manager)}
          >
            {manager}
          </button>
        ))}
      </div>
    </div>
  );
}

function ProcessesSettingsSection() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  if (!settings) return null;

  const { processes, preview, embeddedTerminal } = settings;

  return (
    <section className="settings-section">
      <h2>Processes &amp; Preview</h2>

      <div className="settings-row">
        <div>
          <div className="settings-row__label">Log buffer</div>
          <div className="settings-row__desc">
            Log lines kept per process before the oldest are dropped. Higher values use more memory.
          </div>
        </div>
        <Dropdown
          className="settings-dropdown"
          label="Log buffer"
          value={String(processes.logBufferLines)}
          options={LOG_BUFFER_CHOICES.map((lines) => ({
            value: String(lines),
            label: `${lines.toLocaleString()} lines`,
          }))}
          onChange={(value) =>
            void updateSettings({
              processes: { logBufferLines: Number(value) as (typeof LOG_BUFFER_CHOICES)[number] },
            })
          }
        />
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-row__label">Crash auto-restart</div>
          <div className="settings-row__desc">
            How many times in a row Bureau restarts a crashing process before giving up. Only
            applies to processes configured to auto-restart.
          </div>
        </div>
        <Dropdown
          className="settings-dropdown"
          label="Crash auto-restart"
          value={String(processes.maxCrashRestarts)}
          options={MAX_CRASH_RESTART_CHOICES.map((count) => ({
            value: String(count),
            label: count === 0 ? 'Never restart' : `${count} attempts`,
          }))}
          onChange={(value) =>
            void updateSettings({
              processes: {
                maxCrashRestarts: Number(value) as (typeof MAX_CRASH_RESTART_CHOICES)[number],
              },
            })
          }
        />
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-row__label">Default viewport</div>
          <div className="settings-row__desc">The size the Preview tab opens with.</div>
        </div>
        <div className="segmented" role="group" aria-label="Default viewport">
          {VIEWPORT_PRESETS.map((option) => (
            <button
              key={option}
              type="button"
              className={preview.defaultViewport === option ? 'active' : ''}
              onClick={() => void updateSettings({ preview: { defaultViewport: option } })}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-row__label">Preview console</div>
          <div className="settings-row__desc">
            Capture the previewed page’s console output into the Preview console panel.
          </div>
        </div>
        <Checkbox
          checked={preview.captureConsole}
          onCheckedChange={(captureConsole) => void updateSettings({ preview: { captureConsole } })}
          label="Capture console output"
        />
      </div>

      <h2 style={{ marginTop: 'var(--space-6)' }}>Embedded terminal</h2>

      <div className="settings-row">
        <div>
          <div className="settings-row__label">Terminal text size</div>
          <div className="settings-row__desc">Type size in the attached terminal pane.</div>
        </div>
        <div className="segmented" role="group" aria-label="Terminal text size">
          {TERMINAL_FONT_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              className={embeddedTerminal.fontSize === size ? 'active' : ''}
              onClick={() => void updateSettings({ embeddedTerminal: { fontSize: size } })}
            >
              {size}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-row__label">Scrollback</div>
          <div className="settings-row__desc">
            Lines the terminal keeps in history. Applies to terminals opened from now on.
          </div>
        </div>
        <Dropdown
          className="settings-dropdown"
          label="Scrollback"
          value={String(embeddedTerminal.scrollback)}
          options={TERMINAL_SCROLLBACKS.map((lines) => ({
            value: String(lines),
            label: `${lines.toLocaleString()} lines`,
          }))}
          onChange={(value) =>
            void updateSettings({
              embeddedTerminal: {
                scrollback: Number(value) as (typeof TERMINAL_SCROLLBACKS)[number],
              },
            })
          }
        />
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-row__label">Cursor</div>
          <div className="settings-row__desc">Terminal cursor shape.</div>
        </div>
        <div className="segmented" role="group" aria-label="Terminal cursor">
          {TERMINAL_CURSOR_STYLES.map((style) => (
            <button
              key={style}
              type="button"
              className={embeddedTerminal.cursorStyle === style ? 'active' : ''}
              onClick={() => void updateSettings({ embeddedTerminal: { cursorStyle: style } })}
            >
              {style}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function ToolchainsSettingsSection() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  if (!settings) return null;

  const toolchains = settings.toolchains;

  return (
    <section className="settings-section">
      <h2>Toolchains</h2>
      <p className="settings-help">
        When several version managers are installed for a runtime, Bureau prefers the one you pick
        here. It still detects every manager — this only nudges precedence. Leave a runtime on Auto
        to let Bureau decide.
      </p>
      <ManagerRow
        label="Node.js"
        description="Used when more than one of fnm, Volta, or nvm is installed. System uses the Node.js on your PATH."
        options={NODE_MANAGERS}
        value={toolchains.preferredNodeManager}
        onSelect={(preferredNodeManager) =>
          void updateSettings({ toolchains: { preferredNodeManager } })
        }
      />
      <ManagerRow
        label="Python"
        description="pyenv selects an interpreter version; venv activates the project's virtual environment."
        options={PYTHON_MANAGERS}
        value={toolchains.preferredPythonManager}
        onSelect={(preferredPythonManager) =>
          void updateSettings({ toolchains: { preferredPythonManager } })
        }
      />
      <ManagerRow
        label="Flutter"
        description="fvm pins a per-project SDK version; flutter uses your global install."
        options={FLUTTER_MANAGERS}
        value={toolchains.preferredFlutterManager}
        onSelect={(preferredFlutterManager) =>
          void updateSettings({ toolchains: { preferredFlutterManager } })
        }
      />
    </section>
  );
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
