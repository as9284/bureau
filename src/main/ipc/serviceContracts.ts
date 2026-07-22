import type { CapabilityService } from '../capabilities/CapabilityService';
import type { ProjectApplicationService } from '../projects/ProjectApplicationService';
import type { ProcessApplicationService } from '../processes/ProcessApplicationService';
import type { PreviewViewManager } from '../preview/PreviewViewManager';
import type { SettingsApplicationService } from '../settings/SettingsApplicationService';
import type { OperationApplicationService } from '../operations/OperationApplicationService';
import type { ChooseDirectoryRequest, ChooseDirectoryResult } from '@shared/contracts/system';
import type { OkResult } from '@shared/contracts/errors';
import type { CommitRequest, MutationResult } from '@shared/contracts/operations';
import type { GitSnapshot } from '@shared/contracts/git';
import type { RepositorySnapshot } from '@shared/contracts/gitSnapshot';
import type { AndroidApplicationService } from '../android/AndroidApplicationService';
import type { ToolchainApplicationService } from '../toolchains/ToolchainApplicationService';
import type { PortsApplicationService } from '../ports/PortsApplicationService';
import type { TaskApplicationService } from '../tasks/TaskApplicationService';
import type { GitMutationService } from '../git/GitMutationService';
import type { GitQueryService } from '../git/GitQueryService';
import type { GitRecoveryService } from '../git/GitRecoveryService';
import type { GitBranchQueryService } from '../git/GitBranchQueryService';
import type { GitHistoryService } from '../git/GitHistoryService';
import type { GitHunkService } from '../git/GitHunkService';
import type { GitStashDetailService } from '../git/GitStashDetailService';
import type { GitExtendedMutationService } from '../git/GitExtendedMutationService';
import type { GitAdvancedService } from '../git/GitAdvancedService';
import type { GitLifecycleService } from '../git/GitLifecycleService';
import type { GitHubPublishingService } from '../github/GitHubPublishingService';
import type { GiteaPublishingService } from '../gitea/GiteaPublishingService';
import type { FileApplicationService } from '../files/FileApplicationService';
import type { ShellSessionService } from '../terminal/ShellSessionService';

export type ProjectActionRequest = { projectId: string };

export type SystemService = {
  chooseDirectory(input: ChooseDirectoryRequest): Promise<ChooseDirectoryResult>;
  openInEditor(input: ProjectActionRequest): Promise<OkResult>;
  openInTerminal(input: ProjectActionRequest): Promise<OkResult>;
  openInExplorer(input: ProjectActionRequest): Promise<OkResult>;
};

export type GitAppService = GitMutationService &
  GitQueryService &
  GitRecoveryService &
  GitBranchQueryService &
  GitHistoryService &
  GitHunkService &
  GitStashDetailService &
  GitExtendedMutationService &
  GitAdvancedService &
  GitLifecycleService & {
    refresh(input: ProjectActionRequest): Promise<RepositorySnapshot>;
    snapshot(input: ProjectActionRequest): Promise<GitSnapshot>;
    /**
     * Composed at the root rather than owned by a module service: createAppServices
     * binds this to GitExtendedMutationService.commitEnhanced, which carries the
     * commit guards and the amend/signoff/signing flags.
     */
    commit(input: CommitRequest): Promise<MutationResult>;
  };

export type AppServices = {
  files: FileApplicationService;
  capabilities: CapabilityService;
  projects: ProjectApplicationService;
  processes: ProcessApplicationService;
  terminal: ShellSessionService;
  preview: PreviewViewManager;
  settings: SettingsApplicationService;
  operations: OperationApplicationService;
  system: SystemService;
  git: GitAppService;
  github: GitHubPublishingService;
  gitea: GiteaPublishingService;
  android: AndroidApplicationService;
  toolchains: ToolchainApplicationService;
  ports: PortsApplicationService;
  tasks: TaskApplicationService;
};
