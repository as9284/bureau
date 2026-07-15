import fs from 'node:fs';

const src = fs.readFileSync('E:/Code/Electron Projects/stargit/src/shared/contracts/api.ts', 'utf8');
const ops = src.match(/  operations: \{[\s\S]*?\n  \};/)[0];
const gh = src.match(/  github: \{[\s\S]*?\n  \};/)[0];
const git = src.match(/  git: \{[\s\S]*?\n  \};/)[0];
const converted = [ops, gh, git]
  .join('\n')
  .replace(/repoId/g, 'projectId')
  .replace(/StarGitApiV1/g, 'BureauApiV1')
  .replace(/RefreshAllResult,\n  RepositorySnapshot,\n  TrackedRepository,\n\} from '\.\/repositories';/g, '')
  .replace(/repositories: \{[\s\S]*?\n  \};\n  /g, '');

const imports = `import type {
  CommitRequest,
  BranchSwitchRequest,
  BranchCreateRequest,
  BranchDeleteRequest,
  DiffRequest,
  DiffResult,
  FileMutationRequest,
  HunkMutationRequest,
  ListCommitFilesRequest,
  ListCommitFilesResult,
  MutationResult,
  RecentCommit,
  RepoMutationRequest,
  StashEntry,
  StashPushRequest,
  StashIndexRequest,
} from './operations';
import type {
  OperationCancelRequest,
  OperationCancelResult,
  OperationListResult,
} from './operationLog';
import type {
  BranchCheckoutTrackingRequest,
  BranchDeleteRemoteRequest,
  BranchDetail,
  BranchPublishRequest,
  BranchRenameRequest,
  BranchSetUpstreamRequest,
} from './branches';
import type {
  BisectState,
  ConflictResolveRequest,
  ConflictVersionRequest,
  ConflictVersionResult,
  OperationStateDetails,
  RecoveryActionRequest,
} from './recovery';
import type {
  CherryPickRequest,
  CompareCommitsRequest,
  CompareCommitsResult,
  CreateBranchFromCommitRequest,
  CreateTagRequest,
  DeleteRemoteTagRequest,
  DeleteTagRequest,
  ListHistoryRequest,
  ListHistoryResult,
  ListTagsRequest,
  ListTagsResult,
  PushTagRequest,
  RevertCommitRequest,
} from './history';
import type {
  StashApplyRequest,
  StashBranchRequest,
  StashFileEntry,
  StashRestoreFilesRequest,
} from './stashDetail';
import type {
  CloneRequest,
  CloneResult,
  InitRepositoryRequest,
  InitRepositoryResult,
} from './lifecycle';
import type { BlameResult, SubmoduleEntry, WorktreeEntry } from './advanced';
import type { GitHubCliStatus, GitHubPublishRequest, GitHubPublishResult } from './github';
import type { GitSnapshot, GitSnapshotRequest, RepositorySnapshot } from './gitSnapshot';
`;

fs.writeFileSync(
  'src/shared/contracts/gitApiSurface.txt',
  imports + '\n// --- paste into BureauApiV1 ---\n' + converted
);
console.log('done');
