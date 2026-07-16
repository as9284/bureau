import { app, clipboard, shell } from 'electron';
import { createSettingsStoreFromPath, createSettingsStore } from '../settings/SettingsStore';
import { createSettingsApplicationService } from '../settings/SettingsApplicationService';
import type { ExecutablePickerAdapter } from '../settings/SettingsApplicationService';
import { createCapabilityService } from '../capabilities/CapabilityService';
import { createProjectCatalogue, createProjectCatalogueStore } from '../projects/ProjectCatalogue';
import { createProjectApplicationService } from '../projects/ProjectApplicationService';
import {
  createProjectConfigStore,
  createProjectConfigStoreSource,
} from '../projects/ProjectConfigStore';
import { createProcessSupervisor, type ProcessSupervisor } from '../processes/ProcessSupervisor';
import { createProcessApplicationService } from '../processes/ProcessApplicationService';
import { createShellRegistry } from '../terminal/ShellRegistry';
import { createShellSessionService } from '../terminal/ShellSessionService';
import { createPreviewViewManager } from '../preview/PreviewViewManager';
import { createTerminalLauncher } from '../system/TerminalLauncher';
import { createEditorLauncher } from '../system/EditorLauncher';
import { openInFileExplorer } from '../system/FileExplorerLauncher';
import { createElectronExecutablePickerAdapter } from '../system/executablePickerAdapter';
import { createElectronDialogAdapter, type NativeDialogAdapter } from '../system/dialogAdapter';
import { toBureauError } from '../ipc/errors';
import type { AppServices } from '../ipc/serviceContracts';
import type { ProjectApplicationService } from '../projects/ProjectApplicationService';
import type { SettingsStore } from '../settings/SettingsStore';
import type { OkResult } from '@shared/contracts/errors';
import type { ProcessDefinition } from '@shared/contracts/projects';
import { compactGitSnapshot } from '@shared/contracts/gitSnapshot';
import { createExecutableAdapter, type ExecutableAdapter } from '../android/ExecutableAdapter';
import { createSdkResolver } from '../android/SdkResolver';
import { createAdbService } from '../android/AdbService';
import { createAvdService } from '../android/AvdService';
import { createLogcatStreamer } from '../android/LogcatStreamer';
import { createScrcpyLauncher } from '../android/ScrcpyLauncher';
import { createEmulatorDisplayService } from '../android/EmulatorDisplayService';
import { createAndroidApplicationService } from '../android/AndroidApplicationService';
import { createReactNativeService } from '../android/ReactNativeService';
import { createToolchainEnvResolver } from '../toolchains/toolchainEnvResolver';
import { createToolchainApplicationService } from '../toolchains/ToolchainApplicationService';
import { createPortScanner } from '../ports/PortScanner';
import { createPortsApplicationService } from '../ports/PortsApplicationService';
import { createTaskApplicationService } from '../tasks/TaskApplicationService';
import { createOrphanStore, createOrphanStoreApi } from '../processes/orphanState';
import { createGitExecutableResolver } from '../git/GitExecutableResolver';
import { createSettingsGitResolver } from '../git/SettingsGitResolver';
import { createGitRunner } from '../git/GitRunner';
import { createGitStatusService } from '../git/GitStatusService';
import { createOperationCoordinator } from '../operations/OperationCoordinator';
import { createOperationRegistry } from '../operations/OperationRegistry';
import { createOperationApplicationService } from '../operations/OperationApplicationService';
import { createSnapshotCache } from '../projects/SnapshotCache';
import { createGitMutationService } from '../git/GitMutationService';
import { createGitQueryService } from '../git/GitQueryService';
import { createGitRecoveryService } from '../git/GitRecoveryService';
import { createGitBranchQueryService } from '../git/GitBranchQueryService';
import { createGitHistoryService } from '../git/GitHistoryService';
import { createGitHunkService } from '../git/GitHunkService';
import { createGitStashDetailService } from '../git/GitStashDetailService';
import { createGitExtendedMutationService } from '../git/GitExtendedMutationService';
import { createGitLifecycleService } from '../git/GitLifecycleService';
import { createGitAdvancedService } from '../git/GitAdvancedService';
import { createGitHubPublishingService } from '../github/GitHubPublishingService';
import { createRepositoryValidator } from '../repositories/RepositoryValidator';
import { createOperationNotifier } from '../system/OperationNotifier';
import { createFilesPersistence } from '../files/FilePersistence';
import { createFileApplicationService } from '../files/FileApplicationService';
import { createDocumentExportService } from '../files/DocumentExportService';

export type AppBootstrap = {
  services: AppServices;
  settingsStore: SettingsStore;
  supervisor: ProcessSupervisor;
};

/**
 * The toolchain env resolver is shaped around a stored process; a shell session has no
 * ProcessDefinition. This stand-in carries no per-process toolchain pin, so a shell gets
 * exactly the project's own toolchain PATH — the same node/python/flutter its processes run.
 */
const SHELL_ENV_DEFINITION: ProcessDefinition = {
  id: 'shell',
  label: 'Shell',
  command: '',
  args: [],
  cwd: '.',
  env: {},
  runMode: 'terminal',
  autoRestart: false,
  runOnOpen: false,
};

export async function createAppServices(
  userDataPath?: string,
  overrides?: {
    dialogAdapter?: NativeDialogAdapter;
    pickerAdapter?: ExecutablePickerAdapter;
    executableAdapter?: ExecutableAdapter;
    trashItem?(targetPath: string): Promise<void>;
    documentExport?: {
      exportHtml(html: string, suggestedName: string): Promise<OkResult>;
      exportPdf(html: string, suggestedName: string): Promise<OkResult>;
      printDocument(html: string): Promise<OkResult>;
      dispose(): void;
    };
  }
): Promise<AppBootstrap> {
  const dataPath = userDataPath ?? app.getPath('userData');

  const settingsStoreSource = createSettingsStoreFromPath(`${dataPath}/settings.v1.json`);
  const projectStoreSource = createProjectCatalogueStore(`${dataPath}/projects.v1.json`);
  const projectConfigSource = createProjectConfigStoreSource(`${dataPath}/projectConfigs.v1.json`);

  await settingsStoreSource.load();
  await projectStoreSource.load();
  await projectConfigSource.load();

  const settingsStore = createSettingsStore(settingsStoreSource);
  const catalogue = createProjectCatalogue(projectStoreSource);
  const projectConfigStore = createProjectConfigStore(projectConfigSource);
  const filesPersistence = await createFilesPersistence(dataPath);
  const documentExport = overrides?.documentExport ?? createDocumentExportService(dataPath);
  const files = createFileApplicationService({
    catalogue,
    ...filesPersistence,
    trashItem: overrides?.trashItem ?? ((targetPath) => shell.trashItem(targetPath)),
    openPath: (targetPath) => shell.openPath(targetPath),
    revealPath: (targetPath) => shell.showItemInFolder(targetPath),
    exportHtml: documentExport.exportHtml,
    exportPdf: documentExport.exportPdf,
    printDocument: documentExport.printDocument,
    disposeExports: documentExport.dispose,
  });
  const resolveEnv = createToolchainEnvResolver({
    settingsStore,
    configStore: projectConfigStore,
  });
  const orphanStoreSource = createOrphanStore(`${dataPath}/runtime-orphans.v1.json`);
  await orphanStoreSource.load();
  const orphanStore = createOrphanStoreApi(orphanStoreSource);
  const supervisor = createProcessSupervisor({
    resolveEnv,
    orphanStore,
    getMaxCrashRestarts: () => settingsStore.get().processes.maxCrashRestarts,
  });
  await supervisor.adoptOrphans();

  // One registry, shared with the capability service: shell detection spawns `where`/`which`
  // per candidate and memoizes, so a second instance would re-probe for no reason.
  const shellRegistry = createShellRegistry();
  const terminal = createShellSessionService({
    catalogue,
    shells: shellRegistry,
    resolveEnv: ({ projectId, projectRoot }) =>
      resolveEnv({ projectId, projectRoot, definition: SHELL_ENV_DEFINITION, overrides: {} }),
    getDefaultShellId: () => settingsStore.get().embeddedTerminal.defaultShellId,
  });

  const terminalLauncher = createTerminalLauncher();
  const editorLauncher = createEditorLauncher();

  const baseGitResolver = createGitExecutableResolver();
  const gitResolver = createSettingsGitResolver(baseGitResolver, settingsStore);
  const gitRunner = createGitRunner();
  const gitValidator = createRepositoryValidator(gitRunner);
  const gitStatusService = createGitStatusService(gitResolver, gitRunner);
  const gitCoordinator = createOperationCoordinator();
  const operationNotifier = createOperationNotifier({
    getSettings: () => settingsStore.get(),
  });
  const operationRegistry = createOperationRegistry({
    onTerminal: operationNotifier,
    onCancel: (operationId) => gitRunner.cancel(operationId),
  });
  const snapshotCache = createSnapshotCache();

  const gitMutation = createGitMutationService({
    catalogue,
    snapshotCache,
    resolver: gitResolver,
    runner: gitRunner,
    statusService: gitStatusService,
    coordinator: gitCoordinator,
    operationRegistry,
    getPullStrategy: () => settingsStore.get().gitBehavior.pullStrategy,
  });
  const gitExtendedMutation = createGitExtendedMutationService({
    catalogue,
    snapshotCache,
    resolver: gitResolver,
    runner: gitRunner,
    statusService: gitStatusService,
    coordinator: gitCoordinator,
  });
  const gitQuery = createGitQueryService({
    catalogue,
    resolver: gitResolver,
    runner: gitRunner,
    coordinator: gitCoordinator,
  });
  const gitRecovery = createGitRecoveryService({
    catalogue,
    snapshotCache,
    resolver: gitResolver,
    runner: gitRunner,
    statusService: gitStatusService,
    coordinator: gitCoordinator,
  });
  const gitBranchQuery = createGitBranchQueryService({
    catalogue,
    resolver: gitResolver,
    runner: gitRunner,
    coordinator: gitCoordinator,
  });
  const gitHistory = createGitHistoryService({
    catalogue,
    resolver: gitResolver,
    runner: gitRunner,
    coordinator: gitCoordinator,
  });
  const gitHunk = createGitHunkService({
    catalogue,
    snapshotCache,
    resolver: gitResolver,
    runner: gitRunner,
    statusService: gitStatusService,
    coordinator: gitCoordinator,
  });
  const gitStashDetail = createGitStashDetailService({
    catalogue,
    resolver: gitResolver,
    runner: gitRunner,
    coordinator: gitCoordinator,
  });
  const gitAdvanced = createGitAdvancedService({
    catalogue,
    snapshotCache,
    resolver: gitResolver,
    runner: gitRunner,
    statusService: gitStatusService,
    coordinator: gitCoordinator,
  });
  const github = createGitHubPublishingService({
    catalogue,
    snapshotCache,
    resolver: gitResolver,
    runner: gitRunner,
    statusService: gitStatusService,
    coordinator: gitCoordinator,
  });

  async function runProjectLaunch(
    operation: string,
    projectId: string,
    run: (root: string) => Promise<void>
  ): Promise<OkResult> {
    const project = catalogue.get(projectId);
    if (!project) {
      return {
        ok: false,
        error: toBureauError({
          code: 'PROJECT_NOT_FOUND',
          message: 'Project not found.',
          operation,
        }),
      };
    }
    try {
      await run(project.path);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: toBureauError({
          code: 'COMMAND_FAILED',
          message: error instanceof Error ? error.message : 'Could not complete the action.',
          operation,
          retryable: false,
        }),
      };
    }
  }

  const pickerAdapter = overrides?.pickerAdapter ?? createElectronExecutablePickerAdapter();
  const dialogAdapter = overrides?.dialogAdapter ?? createElectronDialogAdapter();

  const settings = createSettingsApplicationService({
    settingsStore,
    resolver: gitResolver,
    pickerAdapter,
  });
  const projectsService = createProjectApplicationService(catalogue, projectConfigStore);
  const projects: ProjectApplicationService = {
    ...projectsService,
    async remove(input) {
      // Once the project is gone its Terminal tab is unreachable, so any shell still open
      // there — and whatever it is running — could never be stopped from the UI again.
      await terminal.closeProject(input.projectId);
      return projectsService.remove(input);
    },
  };
  const gitLifecycle = createGitLifecycleService({
    projects,
    validator: gitValidator,
    resolver: gitResolver,
    runner: gitRunner,
    statusService: gitStatusService,
    snapshotCache,
    coordinator: gitCoordinator,
    operationRegistry,
  });

  async function refreshGit(input: { projectId: string }) {
    const project = catalogue.get(input.projectId);
    if (!project) {
      throw toBureauError({
        code: 'PROJECT_NOT_FOUND',
        message: 'Project not found.',
        operation: 'git.refresh',
        subjectId: input.projectId,
        retryable: false,
      });
    }

    const run = async () => {
      const snapshot = await gitCoordinator.runProjectRead(input.projectId, () =>
        gitStatusService.collectSnapshot(input.projectId, project.canonicalPath)
      );
      snapshotCache.set(input.projectId, snapshot);
      return snapshot;
    };

    return operationRegistry.runTracked({
      kind: 'refresh',
      summary: `Refresh ${project.name}`,
      projectId: input.projectId,
      cancellable: false,
      fn: async () => run(),
    });
  }

  const git = {
    ...gitMutation,
    ...gitQuery,
    ...gitRecovery,
    ...gitBranchQuery,
    ...gitHistory,
    ...gitHunk,
    ...gitStashDetail,
    ...gitExtendedMutation,
    ...gitAdvanced,
    ...gitLifecycle,
    commit: gitExtendedMutation.commitEnhanced,
    refresh: refreshGit,
    async snapshot(input: { projectId: string }) {
      const cached = snapshotCache.get(input.projectId);
      if (cached) {
        return compactGitSnapshot(cached);
      }
      try {
        const full = await refreshGit(input);
        return compactGitSnapshot(full);
      } catch {
        return compactGitSnapshot(undefined);
      }
    },
  };

  const processes = createProcessApplicationService(catalogue, supervisor, projectConfigStore);
  const preview = createPreviewViewManager();
  const executableAdapter = overrides?.executableAdapter ?? createExecutableAdapter();
  const sdkResolver = createSdkResolver(settingsStore);
  const adb = createAdbService(sdkResolver, executableAdapter);
  const avds = createAvdService(sdkResolver, executableAdapter, adb);
  const logcat = createLogcatStreamer(adb, executableAdapter);
  const scrcpy = createScrcpyLauncher(sdkResolver, executableAdapter, adb);
  const emulatorDisplay = createEmulatorDisplayService({
    resolveGrpcPort: (avdName) => avds.getGrpcPort(avdName),
  });
  const reactNative = createReactNativeService({ catalogue, processes, adb, settingsStore });
  const android = createAndroidApplicationService({
    resolver: sdkResolver,
    avds,
    adb,
    logcat,
    scrcpy,
    display: emulatorDisplay,
    settingsStore,
    processes,
    dialog: dialogAdapter,
    reactNative,
    readHostClipboard: () => clipboard.readText(),
  });
  const capabilities = createCapabilityService(
    gitResolver,
    settingsStore,
    terminalLauncher,
    sdkResolver,
    shellRegistry
  );
  const toolchains = createToolchainApplicationService({
    catalogue,
    settingsStore,
    configStore: projectConfigStore,
  });
  const ports = createPortsApplicationService(
    createPortScanner({ catalogue, supervisor, processes })
  );
  const tasks = createTaskApplicationService({ catalogue, processes });
  const operations = createOperationApplicationService(operationRegistry);

  const services: AppServices = {
    files,
    capabilities,
    projects,
    processes,
    terminal,
    preview,
    settings,
    operations,
    toolchains,
    ports,
    tasks,
    github,
    system: {
      async chooseDirectory(input) {
        const path = await dialogAdapter.showOpenDirectoryDialog({
          title: input.title,
          buttonLabel: input.buttonLabel,
        });
        return { path: path ?? null };
      },
      openInEditor({ projectId }) {
        return runProjectLaunch('system.openInEditor', projectId, (root) =>
          editorLauncher.open(root, settingsStore.get().editor)
        );
      },
      openInTerminal({ projectId }) {
        return runProjectLaunch('system.openInTerminal', projectId, (root) =>
          terminalLauncher.open(root, settingsStore.get().terminal)
        );
      },
      openInExplorer({ projectId }) {
        return runProjectLaunch('system.openInExplorer', projectId, (root) =>
          openInFileExplorer(root)
        );
      },
    },
    git,
    android,
  };

  return { services, settingsStore, supervisor };
}
