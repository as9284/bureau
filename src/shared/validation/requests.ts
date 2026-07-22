import { z } from 'zod';
import { PROJECT_TAB_IDS, TERMINAL_CURSOR_STYLES, VIEWPORT_PRESETS } from '../contracts/settings';
import { SHELL_IDS } from '../contracts/terminal';

const MAX_PATH_LENGTH = 4096;

export const chooseDirectoryRequestSchema = z
  .object({
    title: z.string().max(200).optional(),
    buttonLabel: z.string().max(64).optional(),
  })
  .strict();

export const setEditorPresetSchema = z
  .object({
    preset: z.enum(['none', 'vscode', 'cursor', 'zed', 'sublime']),
  })
  .strict();

export const setTerminalPresetSchema = z
  .object({
    preset: z.enum([
      'auto',
      'windows-terminal',
      'powershell',
      'cmd',
      'terminal-app',
      'gnome-terminal',
      'konsole',
      'xfce4-terminal',
      'alacritty',
      'xterm',
    ]),
  })
  .strict();

const accentColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const editorConfigSchema = z.union([
  z.object({ kind: z.literal('none') }),
  z.object({
    kind: z.literal('preset'),
    preset: z.enum(['vscode', 'cursor', 'zed', 'sublime']),
  }),
  z.object({
    kind: z.literal('custom'),
    executablePath: z.string().min(1).max(MAX_PATH_LENGTH),
  }),
]);

const terminalConfigSchema = z.union([
  z.object({ kind: z.literal('auto') }),
  z.object({
    kind: z.literal('preset'),
    preset: z.enum([
      'windows-terminal',
      'powershell',
      'cmd',
      'terminal-app',
      'gnome-terminal',
      'konsole',
      'xfce4-terminal',
      'alacritty',
      'xterm',
    ]),
  }),
  z.object({
    kind: z.literal('custom'),
    executablePath: z.string().min(1).max(MAX_PATH_LENGTH),
  }),
]);

export const settingsPatchSchema = z
  .object({
    git: z
      .object({
        executablePath: z.union([z.string().max(MAX_PATH_LENGTH), z.null()]).optional(),
      })
      .optional(),
    editor: editorConfigSchema.optional(),
    terminal: terminalConfigSchema.optional(),
    general: z
      .object({
        startupView: z.enum(['hub', 'lastOpened']).optional(),
        confirmBeforeQuit: z.boolean().optional(),
        refreshIntervalMs: z
          .union([
            z.literal(0),
            z.literal(5000),
            z.literal(15000),
            z.literal(30000),
            z.literal(60000),
          ])
          .optional(),
        refreshOnFocus: z.boolean().optional(),
      })
      .strict()
      .optional(),
    appearance: z
      .object({
        theme: z.enum(['dark', 'light', 'system']).optional(),
        density: z.enum(['compact', 'comfortable']).optional(),
        accentColor: accentColorSchema.optional(),
        immersiveMode: z.boolean().optional(),
        reduceMotion: z.boolean().optional(),
        uiScale: z
          .union([z.literal(0.9), z.literal(1), z.literal(1.1), z.literal(1.25), z.literal(1.5)])
          .optional(),
        projectTabOrder: z
          .array(z.enum(PROJECT_TAB_IDS))
          .max(PROJECT_TAB_IDS.length)
          .optional(),
      })
      .strict()
      .optional(),
    gitBehavior: z
      .object({
        pullStrategy: z.enum(['ff-only', 'merge', 'rebase']).optional(),
      })
      .strict()
      .optional(),
    tools: z
      .object({
        showOpenInEditor: z.boolean().optional(),
        showOpenInTerminal: z.boolean().optional(),
        showOpenInExplorer: z.boolean().optional(),
      })
      .strict()
      .optional(),
    layout: z
      .object({
        paneWidths: z
          .object({
            files: z.number().int().min(320).optional(),
            commit: z.number().int().min(200).optional(),
            filesExplorer: z.number().int().min(180).max(640).optional(),
          })
          .optional(),
      })
      .strict()
      .optional(),
    history: z
      .object({
        commitLimit: z.number().int().min(1).max(100).optional(),
      })
      .strict()
      .optional(),
    confirmations: z
      .object({
        discardChanges: z.boolean().optional(),
        deleteBranch: z.boolean().optional(),
        dropStash: z.boolean().optional(),
        amendCommit: z.boolean().optional(),
        conflictOverwrite: z.boolean().optional(),
        deleteRemoteBranch: z.boolean().optional(),
        deleteRemoteTag: z.boolean().optional(),
        abortOperation: z.boolean().optional(),
        skipCommit: z.boolean().optional(),
        stashPop: z.boolean().optional(),
        restoreStashFiles: z.boolean().optional(),
        submoduleUpdate: z.boolean().optional(),
        pruneWorktrees: z.boolean().optional(),
        mergeBranch: z.boolean().optional(),
        rebaseBranch: z.boolean().optional(),
        resetBranch: z.boolean().optional(),
        resetHard: z.boolean().optional(),
        checkoutCommit: z.boolean().optional(),
        removeRemote: z.boolean().optional(),
      })
      .strict()
      .optional(),
    commit: z
      .object({
        defaultSignOff: z.boolean().optional(),
        signingPreference: z.enum(['config', 'off']).optional(),
        commitTemplate: z.string().max(12000).optional(),
      })
      .strict()
      .optional(),
    notifications: z
      .object({
        enabled: z.boolean().optional(),
        longRunningOnly: z.boolean().optional(),
      })
      .strict()
      .optional(),
    android: z
      .object({
        sdkPath: z.string().min(1).max(MAX_PATH_LENGTH).optional(),
        scrcpyPath: z.string().min(1).max(MAX_PATH_LENGTH).optional(),
        defaultLogcatPriority: z.enum(['V', 'D', 'I', 'W', 'E', 'F', 'S']).optional(),
        defaultLogcatFilter: z.string().max(256).optional(),
        reactNativeMetroPort: z.number().int().min(1024).max(65535).optional(),
        reactNativeAutoReverse: z.boolean().optional(),
        emulatorDisplayMode: z.enum(['embedded', 'window']).optional(),
      })
      .strict()
      .optional(),
    toolchains: z
      .object({
        preferredNodeManager: z.enum(['fnm', 'volta', 'nvm', 'system']).optional(),
        preferredPythonManager: z.enum(['pyenv', 'venv', 'system']).optional(),
        preferredFlutterManager: z.enum(['fvm', 'flutter']).optional(),
      })
      .strict()
      .optional(),
    processes: z
      .object({
        logBufferLines: z
          .union([z.literal(1000), z.literal(5000), z.literal(10000), z.literal(20000)])
          .optional(),
        maxCrashRestarts: z
          .union([z.literal(0), z.literal(3), z.literal(5), z.literal(10)])
          .optional(),
      })
      .strict()
      .optional(),
    preview: z
      .object({
        defaultViewport: z.enum(VIEWPORT_PRESETS).optional(),
        captureConsole: z.boolean().optional(),
      })
      .strict()
      .optional(),
    embeddedTerminal: z
      .object({
        fontSize: z
          .union([z.literal(11), z.literal(12), z.literal(13), z.literal(14)])
          .optional(),
        scrollback: z.union([z.literal(1000), z.literal(5000), z.literal(10000)]).optional(),
        cursorStyle: z.enum(TERMINAL_CURSOR_STYLES).optional(),
        defaultShellId: z.enum(SHELL_IDS).optional(),
      })
      .strict()
      .optional(),
    files: z
      .object({
        wordWrap: z.boolean().optional(),
        showIgnored: z.boolean().optional(),
        restoreSession: z.boolean().optional(),
        autoReloadClean: z.boolean().optional(),
        allowRawHtml: z.boolean().optional(),
        remoteImages: z.enum(['ask', 'block']).optional(),
        tabSize: z.union([z.literal(2), z.literal(4)]).optional(),
        readerWidth: z.enum(['narrow', 'standard', 'wide']).optional(),
        editorFontSize: z
          .union([z.literal(12), z.literal(13), z.literal(14), z.literal(16)])
          .optional(),
        lineNumbers: z.boolean().optional(),
      })
      .strict()
      .optional(),
    onboarding: z
      .object({
        completedVersion: z.string().max(64).nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ValidatedSettingsPatch = z.infer<typeof settingsPatchSchema>;

// ---------- Projects & processes ----------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const projectIdField = z.string().max(64).regex(UUID_RE, 'projectId must be a UUID');
const boundedPath = z.string().min(1).max(MAX_PATH_LENGTH);

/** A process id/slug that never becomes a CLI flag or path segment. */
const processIdField = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/i, 'process id must be a slug');

/** Executables/args must not be argument-injection vectors. */
const commandField = z
  .string()
  .min(1)
  .max(1024)
  .refine((v) => !v.includes('\0'), 'command must not contain NUL');

const argField = z
  .string()
  .max(4096)
  .refine((v) => !v.includes('\0'), 'arg must not contain NUL');

const toolchainPinSchema = z
  .object({
    node: z.string().max(64).optional(),
    python: z.string().max(64).optional(),
    flutter: z.string().max(64).optional(),
  })
  .strict();

export const processDefinitionSchema = z
  .object({
    id: processIdField,
    label: z.string().min(1).max(120),
    command: commandField,
    args: z.array(argField).max(64),
    cwd: z.string().max(MAX_PATH_LENGTH),
    env: z.record(z.string().max(256), z.string().max(4096)),
    runMode: z.enum(['log', 'terminal']),
    autoRestart: z.boolean(),
    runOnOpen: z.boolean(),
    urlPattern: z.string().max(2048).optional(),
    toolchain: toolchainPinSchema.optional(),
  })
  .strict();

export const addProjectRequestSchema = z.object({ path: boundedPath }).strict();
export const detectRequestSchema = z.object({ path: boundedPath }).strict();
export const projectIdRequestSchema = z.object({ projectId: projectIdField }).strict();

export const setPinnedRequestSchema = z
  .object({ projectId: projectIdField, pinned: z.boolean() })
  .strict();

export const reorderPinnedRequestSchema = z
  .object({ orderedIds: z.array(projectIdField).max(500) })
  .strict();

export const saveProcessRequestSchema = z
  .object({ projectId: projectIdField, definition: processDefinitionSchema })
  .strict();

export const removeProcessRequestSchema = z
  .object({ projectId: projectIdField, processId: processIdField })
  .strict();

export const processTargetRequestSchema = z
  .object({ projectId: projectIdField, processId: processIdField })
  .strict();

export type ValidatedProcessDefinition = z.infer<typeof processDefinitionSchema>;

// ---------- Web preview ----------

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1']);

function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname)
    );
  } catch {
    return false;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export const previewNavigateSchema = z
  .object({ url: z.string().max(2048).refine(isLoopbackUrl, 'URL must be a localhost address') })
  .strict();

export const previewBoundsSchema = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().min(0).max(20000),
    height: z.number().int().min(0).max(20000),
  })
  .strict();

export const previewSetVisibleSchema = z.object({ visible: z.boolean() }).strict();

export const previewOpenExternalSchema = z
  .object({ url: z.string().max(2048).refine(isHttpUrl, 'URL must be http(s)') })
  .strict();

export const previewSetZoomSchema = z
  .object({ factor: z.number().min(0.5).max(3) })
  .strict();

export const ptyWriteRequestSchema = z
  .object({
    projectId: projectIdField,
    processId: processIdField,
    data: z.string().max(16_384),
  })
  .strict();

export const ptyResizeRequestSchema = z
  .object({
    projectId: projectIdField,
    processId: processIdField,
    cols: z.number().int().min(2).max(500),
    rows: z.number().int().min(1).max(200),
  })
  .strict();

// ---------- Embedded shell sessions ----------

const sessionIdField = z.string().max(64).regex(UUID_RE, 'sessionId must be a UUID');

/**
 * A project-relative nested root. Bounded and NUL-free here; main additionally checks it
 * against the project's detected roots, so this never becomes an arbitrary path.
 */
const rootRelativeField = z
  .string()
  .min(1)
  .max(MAX_PATH_LENGTH)
  .refine((v) => !v.includes('\0'), 'root must not contain NUL');

export const terminalSessionRequestSchema = z
  .object({ projectId: projectIdField, sessionId: sessionIdField })
  .strict();

export const createTerminalSessionSchema = z
  .object({
    projectId: projectIdField,
    shellId: z.enum(SHELL_IDS).optional(),
    rootRelative: rootRelativeField.optional(),
  })
  .strict();

export const renameTerminalSessionSchema = z
  .object({
    projectId: projectIdField,
    sessionId: sessionIdField,
    title: z.string().min(1).max(60),
  })
  .strict();

export const writeTerminalSchema = z
  .object({
    projectId: projectIdField,
    sessionId: sessionIdField,
    data: z.string().max(16_384),
  })
  .strict();

export const resizeTerminalSchema = z
  .object({
    projectId: projectIdField,
    sessionId: sessionIdField,
    cols: z.number().int().min(2).max(500),
    rows: z.number().int().min(1).max(200),
  })
  .strict();

// ---------- Android ----------

const deviceIdField = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._:-]+$/, 'device id contains unsupported characters');
const avdNameField = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._ -]+$/, 'AVD name contains unsupported characters')
  .refine((value) => !value.startsWith('-'), 'AVD name cannot start with a dash');
const packageField = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/, 'invalid Android package name');
const activityField = z
  .string()
  .min(1)
  .max(255)
  .regex(/^\.?[A-Za-z][A-Za-z0-9_.$]*$/, 'invalid Android activity name');

export const androidDeviceRequestSchema = z.object({ deviceId: deviceIdField.optional() }).strict();
export const startAvdRequestSchema = z
  .object({
    name: avdNameField,
    options: z
      .object({
        coldBoot: z.boolean(),
        wipeData: z.boolean(),
        gpu: z.enum(['auto', 'host', 'swiftshader_indirect', 'angle_indirect', 'off']),
        dnsServer: z
          .string()
          .max(253)
          .regex(/^[A-Za-z0-9.:-]+$/, 'invalid DNS server')
          .optional(),
        writableSystem: z.boolean(),
        displayMode: z.enum(['embedded', 'window']).optional(),
      })
      .strict(),
    confirmedWipe: z.boolean(),
  })
  .strict();
export const stopAvdRequestSchema = z
  .object({ name: avdNameField, deviceId: deviceIdField.optional() })
  .strict();
export const avdBootStatusRequestSchema = z.object({ deviceId: deviceIdField }).strict();
export const apkInstallRequestSchema = z
  .object({
    deviceId: deviceIdField.optional(),
    apkPath: boundedPath.refine((value) => /\.apk$/i.test(value), 'file must be an APK'),
    replace: z.boolean(),
  })
  .strict();
export const apkLaunchRequestSchema = z
  .object({
    deviceId: deviceIdField.optional(),
    packageName: packageField,
    activity: activityField.optional(),
  })
  .strict();
export const apkUninstallRequestSchema = z
  .object({ deviceId: deviceIdField.optional(), packageName: packageField, confirmed: z.boolean() })
  .strict();
export const logcatFilterSchema = z
  .object({
    tag: z.string().max(128).optional(),
    priority: z.enum(['V', 'D', 'I', 'W', 'E', 'F', 'S']),
    packageName: z.string().max(255).optional(),
    regex: z.string().max(256).optional(),
  })
  .strict();
export const logcatStartRequestSchema = z
  .object({ deviceId: deviceIdField.optional(), filter: logcatFilterSchema })
  .strict();
export const logcatPauseRequestSchema = z.object({ paused: z.boolean() }).strict();
export const scrcpyLaunchRequestSchema = z
  .object({
    deviceId: deviceIdField.optional(),
    bitrateMbps: z.number().min(1).max(100),
    maxSize: z.number().int().min(320).max(8192).optional(),
    recordPath: boundedPath.optional(),
  })
  .strict();
export const flutterRunRequestSchema = z
  .object({ projectId: projectIdField, deviceId: deviceIdField.optional() })
  .strict();
export const reactNativeProjectRequestSchema = z.object({ projectId: projectIdField }).strict();
export const reactNativeDeviceRequestSchema = z
  .object({
    projectId: projectIdField,
    deviceId: deviceIdField.optional(),
    port: z.number().int().min(1024).max(65535).optional(),
    packageName: packageField.optional(),
  })
  .strict();

export const emulatorDisplayStartRequestSchema = z
  .object({
    avdName: avdNameField,
    width: z.number().int().min(16).max(8192),
    height: z.number().int().min(16).max(8192),
  })
  .strict();
export const emulatorDisplayStopRequestSchema = z.object({ avdName: avdNameField }).strict();
export const emulatorMouseRequestSchema = z
  .object({
    avdName: avdNameField,
    x: z.number().int().min(0).max(32767),
    y: z.number().int().min(0).max(32767),
    buttons: z.number().int().min(0).max(7),
  })
  .strict();
export const emulatorKeyRequestSchema = z
  .object({
    avdName: avdNameField,
    eventType: z.enum(['keydown', 'keyup', 'keypress']),
    key: z.string().min(1).max(32).optional(),
    text: z.string().min(1).max(1024).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.key) !== Boolean(value.text), 'provide exactly one of key or text');
export const emulatorButtonRequestSchema = z
  .object({
    avdName: avdNameField,
    deviceId: deviceIdField.optional(),
    button: z.enum(['back', 'home', 'overview', 'power', 'volumeUp', 'volumeDown']),
  })
  .strict();
export const emulatorRotateRequestSchema = z
  .object({ deviceId: deviceIdField.optional() })
  .strict();
export const emulatorPasteRequestSchema = z.object({ avdName: avdNameField }).strict();
export const emulatorScreenshotRequestSchema = z.object({ avdName: avdNameField }).strict();
const snapshotNameField = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'invalid snapshot name');
export const emulatorSnapshotRequestSchema = z
  .object({ deviceId: deviceIdField.optional(), name: snapshotNameField })
  .strict();
export const geoFixRequestSchema = z
  .object({
    deviceId: deviceIdField.optional(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .strict();

// ---------- Toolchains / Ports / Tasks (Phase 2) ----------

export const setActiveVersionRequestSchema = z
  .object({
    projectId: projectIdField,
    kind: z.enum(['node', 'python', 'flutter']),
    version: z.string().min(1).max(64),
  })
  .strict();

export const killPortRequestSchema = z
  .object({
    pid: z.number().int().positive(),
    port: z.number().int().min(1).max(65535),
  })
  .strict();

export const runTaskRequestSchema = z
  .object({
    projectId: projectIdField,
    taskId: z.string().min(1).max(128),
  })
  .strict();

export {
  fileMutationRequestSchema,
  repoMutationRequestSchema,
  branchSwitchRequestSchema,
  branchCreateRequestSchema,
  branchDeleteRequestSchema,
  githubPublishRequestSchema,
  githubOpenUrlRequestSchema,
  stashPushRequestSchema,
  stashIndexRequestSchema,
  diffRequestSchema,
  listCommitFilesRequestSchema,
  commitRequestSchema,
  operationCancelRequestSchema,
  addWorktreeRequestSchema,
  removeWorktreeRequestSchema,
  lockWorktreeRequestSchema,
  hunkMutationRequestSchema,
  historyRequestSchema,
  tagsRequestSchema,
  stashFilesRequestSchema,
  stashDiffRequestSchema,
  conflictVersionRequestSchema,
  conflictResolveRequestSchema,
  branchPublishRequestSchema,
  branchSetUpstreamRequestSchema,
  branchRenameRequestSchema,
  branchCheckoutTrackingRequestSchema,
  branchDeleteRemoteRequestSchema,
  mergeBranchRequestSchema,
  rebaseBranchRequestSchema,
  resetToCommitRequestSchema,
  reflogRequestSchema,
  commitOidMutationRequestSchema,
  cherryPickRequestSchema,
  revertCommitRequestSchema,
  checkoutCommitRequestSchema,
  listRemotesRequestSchema,
  addRemoteRequestSchema,
  renameRemoteRequestSchema,
  removeRemoteRequestSchema,
  setRemoteUrlRequestSchema,
  branchFromCommitRequestSchema,
  createTagRequestSchema,
  tagMutationRequestSchema,
  remoteTagMutationRequestSchema,
  stashMutationRequestSchema,
  stashBranchRequestSchema,
  stashRestoreFilesRequestSchema,
  submoduleActionRequestSchema,
  blameRequestSchema,
  compareCommitsRequestSchema,
  cloneRequestSchema,
  initRepositoryRequestSchema,
} from './gitRequests';

export {
  giteaHostUrlSchema,
  giteaConnectRequestSchema,
  giteaPublishRequestSchema,
} from './giteaRequests';
