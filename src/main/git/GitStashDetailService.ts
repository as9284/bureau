import type { ProjectCatalogue } from '../projects/ProjectCatalogue';
import type { OperationCoordinator } from '../operations/OperationCoordinator';
import type { GitExecutableResolver } from './GitExecutableResolver';
import type { GitRunner } from './GitRunner';
import type { StashFileEntry } from '@shared/contracts/stashDetail';
import type { DiffResult } from '@shared/contracts/operations';
import { toBureauError } from '../ipc/errors';

const TIMEOUT_MS = 30_000;

export type GitStashDetailService = {
  listStashFiles(input: { projectId: string; index: number }): Promise<StashFileEntry[]>;
  getStashDiff(input: { projectId: string; index: number; path: string }): Promise<DiffResult>;
};

export function createGitStashDetailService(params: {
  catalogue: ProjectCatalogue;
  resolver: GitExecutableResolver;
  runner: GitRunner;
  coordinator: OperationCoordinator;
}): GitStashDetailService {
  const { catalogue, resolver, runner, coordinator } = params;

  async function listStashFiles(input: {
    projectId: string;
    index: number;
  }): Promise<StashFileEntry[]> {
    return coordinator.runProjectRead(input.projectId, async () => {
      const repo = catalogue.get(input.projectId);
      if (!repo) throw notFound(input.projectId);
      const executablePath = await resolveExecutable(input.projectId);

      const result = await runner.run(executablePath, {
        args: [
          '-C',
          repo.canonicalPath,
          'stash',
          'show',
          '--name-status',
          `stash@{${input.index}}`,
        ],
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode !== 0) return [];

      return result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [status, ...rest] = line.split('\t');
          return { path: rest.join('\t'), status: status ?? 'M' };
        });
    });
  }

  async function getStashDiff(input: {
    projectId: string;
    index: number;
    path: string;
  }): Promise<DiffResult> {
    try {
      return await coordinator.runProjectRead(input.projectId, async () => {
        const repo = catalogue.get(input.projectId);
        if (!repo) return errorDiff('PROJECT_NOT_FOUND', 'Repository not found.', input.projectId);

        const executablePath = await resolveExecutable(input.projectId);
        const result = await runner.run(executablePath, {
          args: [
            '-C',
            repo.canonicalPath,
            'stash',
            'show',
            '-p',
            `stash@{${input.index}}`,
            '--',
            input.path,
          ],
          timeoutMs: TIMEOUT_MS,
        });
        if (result.exitCode !== 0) {
          return errorDiff(
            'COMMAND_FAILED',
            result.stderr.trim() || 'Could not load stash diff.',
            input.projectId
          );
        }
        return { ok: true, diff: result.stdout };
      });
    } catch (error) {
      return errorDiff(
        'COMMAND_FAILED',
        error instanceof Error ? error.message : String(error),
        input.projectId
      );
    }
  }

  async function resolveExecutable(projectId: string): Promise<string> {
    const capability = await resolver.resolve();
    if (capability.kind !== 'available') throw gitUnavailable(projectId);
    return capability.executablePath;
  }

  return { listStashFiles, getStashDiff };
}

function errorDiff(
  code: 'PROJECT_NOT_FOUND' | 'COMMAND_FAILED',
  message: string,
  projectId: string
): DiffResult {
  return {
    ok: false,
    error: toBureauError({
      code,
      message,
      operation: 'git.stashDiff',
      subjectId: projectId,
      retryable: true,
    }),
  };
}

function notFound(projectId: string): never {
  throw toBureauError({
    code: 'PROJECT_NOT_FOUND',
    message: `Repository ${projectId} not found.`,
    operation: 'git.listStashFiles',
    subjectId: projectId,
    retryable: false,
  });
}

function gitUnavailable(projectId: string): never {
  throw toBureauError({
    code: 'GIT_NOT_FOUND',
    message: 'Git is not available.',
    operation: 'git.stashDetail',
    subjectId: projectId,
    retryable: true,
  });
}
