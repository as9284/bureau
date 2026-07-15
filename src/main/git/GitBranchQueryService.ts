import type { ProjectCatalogue } from '../projects/ProjectCatalogue';
import type { OperationCoordinator } from '../operations/OperationCoordinator';
import type { GitExecutableResolver } from './GitExecutableResolver';
import type { GitRunner } from './GitRunner';
import type { BranchDetail } from '@shared/contracts/branches';
import { toBureauError } from '../ipc/errors';

const QUERY_TIMEOUT_MS = 30_000;

export type GitBranchQueryService = {
  listBranchDetails(input: { projectId: string }): Promise<BranchDetail[]>;
};

export function createGitBranchQueryService(params: {
  catalogue: ProjectCatalogue;
  resolver: GitExecutableResolver;
  runner: GitRunner;
  coordinator: OperationCoordinator;
}): GitBranchQueryService {
  const { catalogue, resolver, runner, coordinator } = params;

  async function listBranchDetails(input: { projectId: string }): Promise<BranchDetail[]> {
    return coordinator.runProjectRead(input.projectId, async () => {
      const repo = catalogue.get(input.projectId);
      if (!repo) throw notFound(input.projectId);

      const capability = await resolver.resolve();
      if (capability.kind !== 'available') throw gitUnavailable(input.projectId);

      const result = await runner.run(capability.executablePath, {
        args: [
          '-C',
          repo.canonicalPath,
          'for-each-ref',
          '--format=%(refname)%00%(objectname)%00%(upstream)%00',
          'refs/heads',
          'refs/remotes',
        ],
        timeoutMs: QUERY_TIMEOUT_MS,
        stdoutLimitBytes: 2 * 1024 * 1024,
      });
      if (result.exitCode !== 0) throw new Error(result.stderr || 'Could not list branches.');

      const headResult = await runner.run(capability.executablePath, {
        args: ['-C', repo.canonicalPath, 'symbolic-ref', 'HEAD'],
        timeoutMs: QUERY_TIMEOUT_MS,
      });
      const currentRef = headResult.exitCode === 0 ? headResult.stdout.trim() : '';

      const entries = result.stdout.split(/\r?\n/).filter(Boolean);
      const branches = await Promise.all(
        entries.map(async (entry): Promise<BranchDetail | undefined> => {
          const parts = entry.split('\0');
          if (parts.length < 2) return undefined;
          const [ref, oid, upstream] = parts;
          const isRemote = ref.startsWith('refs/remotes/');
          const shortName = isRemote
            ? ref.replace(/^refs\/remotes\//, '')
            : ref.replace(/^refs\/heads\//, '');
          const remoteName = isRemote ? shortName.split('/')[0] : undefined;
          const localShort = isRemote ? shortName.slice((remoteName?.length ?? 0) + 1) : shortName;

          if (isRemote && shortName.endsWith('/HEAD')) return undefined;

          let ahead: number | undefined;
          let behind: number | undefined;
          if (!isRemote && upstream) {
            const counts = await runner.run(capability.executablePath, {
              args: [
                '-C',
                repo.canonicalPath,
                'rev-list',
                '--left-right',
                '--count',
                `${ref}...${upstream}`,
              ],
              timeoutMs: QUERY_TIMEOUT_MS,
              stdoutLimitBytes: 1024,
            });
            if (counts.exitCode === 0) {
              const [left, right] = counts.stdout.trim().split(/\s+/);
              ahead = Number.parseInt(left ?? '', 10);
              behind = Number.parseInt(right ?? '', 10);
            }
          }

          return {
            ref,
            shortName: isRemote ? shortName : localShort,
            kind: isRemote ? 'remote' : 'local',
            current: ref === currentRef,
            headOid: oid,
            upstreamRef: upstream || undefined,
            ahead: isRemote ? undefined : ahead,
            behind: isRemote ? undefined : behind,
            remoteName,
            published: !isRemote && Boolean(upstream),
          };
        })
      );

      return branches
        .filter((branch): branch is BranchDetail => Boolean(branch))
        .sort((a, b) => a.shortName.localeCompare(b.shortName));
    });
  }

  return { listBranchDetails };
}

function notFound(projectId: string): never {
  throw toBureauError({
    code: 'PROJECT_NOT_FOUND',
    message: `Repository ${projectId} not found.`,
    operation: 'git.listBranchDetails',
    subjectId: projectId,
    retryable: false,
  });
}

function gitUnavailable(projectId: string): never {
  throw toBureauError({
    code: 'GIT_NOT_FOUND',
    message: 'Git is not available.',
    operation: 'git.listBranchDetails',
    subjectId: projectId,
    retryable: true,
  });
}
