import { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { AccentColorPicker } from '../components/ColorPicker';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { Dropdown } from '../components/Dropdown';
import { TextArea } from '../components/TextArea';
import { TextField } from '../components/TextField';
import type {
  DensityPreference,
  EditorPreset,
  StartupViewPreference,
  TerminalPreset,
  ThemePreference,
} from '@shared/contracts/settings';
import { DEFAULT_FILES_SETTINGS } from '@shared/contracts/settings';
import type { AppUpdateState } from '@shared/contracts/updates';

const THEMES: ThemePreference[] = ['dark', 'light', 'system'];
const DENSITIES: DensityPreference[] = ['compact', 'comfortable'];
const STARTUP_VIEWS: StartupViewPreference[] = ['hub', 'lastOpened'];
const PRESET_ACCENTS = ['#7c9cff', '#6db87a', '#c9a24d', '#d46a6a', '#b98cff', '#4fb3c4'];

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

  return (
    <div className="stage-inner">
      <h1 className="page-title">Settings</h1>
      <p className="page-subtitle">Preferences are stored locally and applied instantly.</p>
      {section === 'general' && <GeneralSection />}
      {section === 'appearance' && <AppearanceSection />}
      {section === 'tools' && <ToolsSection />}
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
      <div className="settings-row">
        <div>
          <div className="settings-row__label">Conflict overwrite</div>
          <div className="settings-row__desc">
            Allow conflict resolution to overwrite files without an extra confirmation.
          </div>
        </div>
        <Checkbox
          checked={settings.confirmations.conflictOverwrite}
          onCheckedChange={(checked) =>
            void updateSettings({ confirmations: { conflictOverwrite: checked } })
          }
          label="Overwrite without confirmation"
        />
      </div>
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

  const checking = update.kind === 'checking' || update.kind === 'available';
  const description =
    update.kind === 'disabled'
      ? 'Updates are available in installed releases. Development and locally packaged builds do not check.'
      : update.kind === 'checking'
        ? 'Checking the release channel.'
        : update.kind === 'available'
          ? 'An update is downloading in the background.'
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
            Auto-hide the navigation rail and Projects sidebar so the workspace uses the full width.
            Reveal them from the left workspace edge. Toggle with Ctrl+B.
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
    </section>
  );
}

function ToolsSection() {
  const settings = useAppStore((s) => s.settings);
  const capabilities = useAppStore((s) => s.capabilities);
  const setEditorPreset = useAppStore((s) => s.setEditorPreset);
  const chooseCustomEditor = useAppStore((s) => s.chooseCustomEditor);
  const setTerminalPreset = useAppStore((s) => s.setTerminalPreset);
  const chooseCustomTerminal = useAppStore((s) => s.chooseCustomTerminal);
  if (!settings || !capabilities) return null;

  const editor = settings.editor;
  const terminal = settings.terminal;

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
        Preferred version managers when multiple are installed. Bureau still detects all managers;
        these settings nudge precedence only.
      </p>
      <div className="settings-field">
        <label>Node manager</label>
        <div className="chip-row">
          {(['fnm', 'volta', 'nvm', 'system'] as const).map((manager) => (
            <button
              key={manager}
              type="button"
              className={['chip', toolchains.preferredNodeManager === manager ? 'active' : ''].join(
                ' '
              )}
              onClick={() =>
                void updateSettings({
                  toolchains: { ...toolchains, preferredNodeManager: manager },
                })
              }
            >
              {manager}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-field">
        <label>Python manager</label>
        <div className="chip-row">
          {(['venv', 'pyenv'] as const).map((manager) => (
            <button
              key={manager}
              type="button"
              className={[
                'chip',
                toolchains.preferredPythonManager === manager ? 'active' : '',
              ].join(' ')}
              onClick={() =>
                void updateSettings({
                  toolchains: { ...toolchains, preferredPythonManager: manager },
                })
              }
            >
              {manager}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-field">
        <label>Flutter manager</label>
        <div className="chip-row">
          {(['fvm', 'flutter'] as const).map((manager) => (
            <button
              key={manager}
              type="button"
              className={[
                'chip',
                toolchains.preferredFlutterManager === manager ? 'active' : '',
              ].join(' ')}
              onClick={() =>
                void updateSettings({
                  toolchains: { ...toolchains, preferredFlutterManager: manager },
                })
              }
            >
              {manager}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
