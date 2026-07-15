import fs from 'node:fs/promises';
import path from 'node:path';
import type { SnapshotCache } from '../projects/SnapshotCache';
import type { OperationCoordinator } from '../operations/OperationCoordinator';
import type { OperationRegistry } from '../operations/OperationRegistry';
import type { GitExecutableResolver } from './GitExecutableResolver';
import type { GitRunner } from './GitRunner';
import type { GitStatusService } from './GitStatusService';
import type { RepositoryValidator } from '../repositories/RepositoryValidator';
import type {
  CloneRequest,
  CloneResult,
  InitRepositoryRequest,
  InitRepositoryResult,
} from '@shared/contracts/gitLifecycle';
import type { ProjectApplicationService } from '../projects/ProjectApplicationService';
import { redactUrlCredentials } from '@shared/git/refChecks';
import { toBureauError } from '../ipc/errors';

const CLONE_TIMEOUT_MS = 600_000;
const DEFAULT_GITIGNORE = 'node_modules/\n.env\n*.log\n';

export type GitLifecycleService = {
  clone(input: CloneRequest): Promise<CloneResult>;
  initRepository(input: InitRepositoryRequest): Promise<InitRepositoryResult>;
};

export function createGitLifecycleService(params: {
  projects: ProjectApplicationService;
  validator: RepositoryValidator;
  resolver: GitExecutableResolver;
  runner: GitRunner;
  statusService: GitStatusService;
  snapshotCache: SnapshotCache;
  coordinator: OperationCoordinator;
  operationRegistry: OperationRegistry;
}): GitLifecycleService {
  const {
    projects,
    validator,
    resolver,
    runner,
    statusService,
    snapshotCache,
    coordinator,
    operationRegistry,
  } = params;

  async function clone(input: CloneRequest): Promise<CloneResult> {
    try {
      const result = await operationRegistry.runTracked({
        kind: 'clone',
        summary: `Clone ${redactUrlCredentials(input.url)}`,
        cancellable: true,
        fn: async ({ operationId }) => {
          const parentPath = path.resolve(input.parentDirectory);
          const targetPath = path.resolve(parentPath, input.folderName);
          if (path.dirname(targetPath) !== parentPath) {
            throw toBureauError({
              code: 'INVALID_REQUEST',
              message: 'Clone folder must be directly inside the selected destination.',
              operation: 'lifecycle.clone',
              retryable: false,
            });
          }
          const capability = await resolver.resolve();
          if (capability.kind !== 'available') {
            throw toBureauError({
              code: 'GIT_NOT_FOUND',
              message: 'Git is not available.',
              operation: 'lifecycle.clone',
              retryable: true,
            });
          }

          try {
            await fs.access(targetPath);
            throw toBureauError({
              code: 'INVALID_REQUEST',
              message: 'Target directory already exists.',
              operation: 'lifecycle.clone',
              retryable: false,
            });
          } catch (error) {
            if (
              error &&
              typeof error === 'object' &&
              'code' in error &&
              (error as { code: string }).code === 'ENOENT'
            ) {
              // expected
            } else if (error && typeof error === 'object' && 'code' in error) {
              throw error;
            }
          }

          const args = ['clone', '--progress', input.url, targetPath];
          if (input.depth) args.splice(2, 0, '--depth', String(input.depth));
          if (input.branch) args.splice(2, 0, '--branch', input.branch);

          operationRegistry.setProgress(operationId, { phase: 'receiving', message: 'Cloningâ€¦' });

          const result = await runner.run(capability.executablePath, {
            args,
            timeoutMs: CLONE_TIMEOUT_MS,
            operationId,
          });
          if (result.killed === 'cancelled') {
            await safeRm(targetPath);
            throw toBureauError({
              code: 'COMMAND_FAILED',
              message: 'Clone cancelled.',
              operation: 'lifecycle.clone',
              retryable: true,
            });
          }
          if (result.exitCode !== 0) {
            await safeRm(targetPath);
            throw toBureauError({
              code: 'COMMAND_FAILED',
              message: result.stderr.trim() || 'Clone failed.',
              operation: 'lifecycle.clone',
              retryable: true,
            });
          }

          const validation = await validator.validate(capability.executablePath, targetPath);
          if (validation.kind !== 'valid') {
            throw toBureauError({
              code: 'NOT_A_WORKTREE',
              message: 'Cloned path is not a valid worktree.',
              operation: 'lifecycle.clone',
              retryable: false,
            });
          }

          const addResult = await projects.add({ path: validation.root });
          if (!addResult.ok) {
            throw addResult.error;
          }
          const repo = addResult.project;

          const snapshot = await coordinator.runRead(() =>
            statusService.collectSnapshot(repo.projectId, repo.canonicalPath)
          );
          snapshotCache.set(repo.projectId, snapshot);

          return { projectId: repo.projectId, path: validation.root };
        },
      });
      return { ok: true, projectId: result.projectId, path: result.path };
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'message' in error &&
        error.message === 'Clone cancelled.'
      ) {
        return { ok: false, cancelled: true };
      }
      if (error && typeof error === 'object' && 'code' in error) {
        return { ok: false, error: error as import('@shared/contracts/errors').BureauError };
      }
      return {
        ok: false,
        error: toBureauError({
          code: 'COMMAND_FAILED',
          message: error instanceof Error ? error.message : String(error),
          operation: 'lifecycle.clone',
          retryable: true,
        }),
      };
    }
  }

  async function initRepository(input: InitRepositoryRequest): Promise<InitRepositoryResult> {
    try {
      const result = await operationRegistry.runTracked({
        kind: 'init',
        summary: `Initialize ${input.directory}`,
        cancellable: false,
        fn: async () => {
          const capability = await resolver.resolve();
          if (capability.kind !== 'available') {
            throw toBureauError({
              code: 'GIT_NOT_FOUND',
              message: 'Git is not available.',
              operation: 'lifecycle.init',
              retryable: true,
            });
          }

          const directoryPath = path.resolve(input.directory);
          const existing = await validator.validate(capability.executablePath, directoryPath);
          if (existing.kind === 'valid') {
            throw toBureauError({
              code: 'DUPLICATE_REPOSITORY',
              message: 'Directory is already a Git worktree.',
              operation: 'lifecycle.init',
              retryable: false,
            });
          }

          await fs.mkdir(directoryPath, { recursive: true });

          const initArgs = ['-C', directoryPath, 'init'];
          if (input.defaultBranch) initArgs.push('-b', input.defaultBranch);

          const initResult = await runner.run(capability.executablePath, {
            args: initArgs,
            timeoutMs: 60_000,
          });
          if (initResult.exitCode !== 0) {
            throw new Error(initResult.stderr || 'git init failed.');
          }

          if (input.createReadme) {
            await writeFileIfMissing(path.join(directoryPath, 'README.md'), '# README\n');
          }
          if (input.createGitignore) {
            await writeFileIfMissing(
              path.join(directoryPath, '.gitignore'),
              input.gitignoreTemplate || DEFAULT_GITIGNORE
            );
          }

          const addResult = await projects.add({ path: directoryPath });
          if (!addResult.ok) {
            throw addResult.error;
          }
          const repo = addResult.project;

          const snapshot = await coordinator.runRead(() =>
            statusService.collectSnapshot(repo.projectId, repo.canonicalPath)
          );
          snapshotCache.set(repo.projectId, snapshot);

          return { projectId: repo.projectId, path: repo.canonicalPath };
        },
      });
      return { ok: true, projectId: result.projectId, path: result.path };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        return { ok: false, error: error as import('@shared/contracts/errors').BureauError };
      }
      return {
        ok: false,
        error: toBureauError({
          code: 'COMMAND_FAILED',
          message: error instanceof Error ? error.message : String(error),
          operation: 'lifecycle.init',
          retryable: true,
        }),
      };
    }
  }

  return { clone, initRepository };
}

async function writeFileIfMissing(filePath: string, contents: string): Promise<void> {
  try {
    await fs.writeFile(filePath, contents, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (
      !error ||
      typeof error !== 'object' ||
      !('code' in error) ||
      (error as { code: string }).code !== 'EEXIST'
    ) {
      throw error;
    }
  }
}

async function safeRm(targetPath: string): Promise<void> {
  try {
    const stat = await fs.stat(targetPath);
    if (stat.isDirectory()) {
      const entries = await fs.readdir(targetPath);
      if (entries.length <= 2) {
        await fs.rm(targetPath, { recursive: true, force: true });
      }
    }
  } catch {
    // leave partial clone for user inspection
  }
}

