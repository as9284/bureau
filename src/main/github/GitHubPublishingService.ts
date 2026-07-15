import path from 'node:path';
import type { ProjectCatalogue } from '../projects/ProjectCatalogue';
import type { SnapshotCache } from '../projects/SnapshotCache';
import type { OperationCoordinator } from '../operations/OperationCoordinator';
import type { GitExecutableResolver } from '../git/GitExecutableResolver';
import type { GitRunner } from '../git/GitRunner';
import type { GitStatusService } from '../git/GitStatusService';
import type {
  GitHubCliStatus,
  GitHubPublishRequest,
  GitHubPublishResult,
} from '@shared/contracts/github';
import { checkRefNameBasics } from '@shared/git/refChecks';
import { toBureauError } from '../ipc/errors';

const COMMAND_TIMEOUT_MS = 120_000;
const AUTH_TIMEOUT_MS = 600_000;

export type GitHubPublishingService = {
  getStatus(): Promise<GitHubCliStatus>;
  signIn(): Promise<GitHubCliStatus>;
  publish(input: GitHubPublishRequest): Promise<GitHubPublishResult>;
};

export function createGitHubPublishingService(params: {
  catalogue: ProjectCatalogue;
  snapshotCache: SnapshotCache;
  resolver: GitExecutableResolver;
  runner: GitRunner;
  statusService: GitStatusService;
  coordinator: OperationCoordinator;
}): GitHubPublishingService {
  const { catalogue, snapshotCache, resolver, runner, statusService, coordinator } = params;

  async function resolveCli(): Promise<string | undefined> {
    const candidates =
      process.platform === 'win32'
        ? [
            path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'GitHub CLI', 'gh.exe'),
            'gh.exe',
          ]
        : ['/usr/local/bin/gh', '/opt/homebrew/bin/gh', 'gh'];

    for (const candidate of candidates) {
      try {
        const result = await runner.run(candidate, { args: ['--version'], timeoutMs: 10_000 });
        if (result.exitCode === 0) return candidate;
      } catch {
        // Try the next known location.
      }
    }
    return undefined;
  }

  async function getStatus(): Promise<GitHubCliStatus> {
    const executable = await resolveCli();
    if (!executable) return { available: false, authenticated: false };

    const versionResult = await runner.run(executable, {
      args: ['--version'],
      timeoutMs: 10_000,
    });
    const version = /^gh version ([^\s]+)/m.exec(versionResult.stdout)?.[1];
    const authResult = await runner.run(executable, {
      args: ['auth', 'status', '--hostname', 'github.com'],
      timeoutMs: 20_000,
    });
    if (authResult.exitCode !== 0) {
      return { available: true, authenticated: false, version };
    }

    const accountResult = await runner.run(executable, {
      args: ['api', 'user', '--jq', '.login'],
      timeoutMs: 30_000,
    });
    return {
      available: true,
      authenticated: accountResult.exitCode === 0,
      account: accountResult.exitCode === 0 ? accountResult.stdout.trim() || undefined : undefined,
      version,
    };
  }

  async function signIn(): Promise<GitHubCliStatus> {
    const executable = await resolveCli();
    if (!executable) return { available: false, authenticated: false };
    const result = await runner.run(executable, {
      args: [
        'auth',
        'login',
        '--hostname',
        'github.com',
        '--git-protocol',
        'https',
        '--web',
        '--clipboard',
      ],
      timeoutMs: AUTH_TIMEOUT_MS,
    });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || 'GitHub sign-in did not complete.');
    }
    return getStatus();
  }

  async function publish(input: GitHubPublishRequest): Promise<GitHubPublishResult> {
    const refError = checkRefNameBasics(input.branchName);
    if (refError) return failure('INVALID_REQUEST', refError.message, input.projectId, false);

    return coordinator.runMutation(input.projectId, async () => {
      const repo = catalogue.get(input.projectId);
      if (!repo) {
        return failure('PROJECT_NOT_FOUND', 'Repository not found.', input.projectId, false);
      }
      const snapshot = snapshotCache.get(input.projectId);
      if (!snapshot || snapshot.revision !== input.snapshotRevision) {
        return failure('SNAPSHOT_STALE', 'Repository snapshot is stale.', input.projectId, true);
      }
      if (snapshot.blockedOperation) {
        return failure('REPOSITORY_BLOCKED', 'Repository is blocked.', input.projectId, false);
      }
      if (!snapshot.latestCommit) {
        return failure(
          'NO_COMMITS_YET',
          'Create your first commit before publishing to GitHub.',
          input.projectId,
          false
        );
      }
      if (snapshot.branch.kind !== 'named' || snapshot.branch.name !== input.branchName) {
        return failure(
          'INVALID_REQUEST',
          'Checkout the branch you want to publish, then try again.',
          input.projectId,
          false
        );
      }

      const [gitCapability, githubStatus, githubExecutable] = await Promise.all([
        resolver.resolve(),
        getStatus(),
        resolveCli(),
      ]);
      if (gitCapability.kind !== 'available') {
        return failure('GIT_NOT_FOUND', 'Git is not available.', input.projectId, true);
      }
      if (!githubExecutable || !githubStatus.available) {
        return failure(
          'EXECUTABLE_NOT_FOUND',
          'GitHub CLI is not installed. Install it, then restart StarGit.',
          input.projectId,
          true
        );
      }
      if (!githubStatus.authenticated) {
        return failure(
          'COMMAND_FAILED',
          'Sign in to GitHub before publishing.',
          input.projectId,
          true
        );
      }

      try {
        const remoteResult = await runner.run(gitCapability.executablePath, {
          args: ['-C', repo.canonicalPath, 'remote', 'get-url', 'origin'],
          timeoutMs: 20_000,
        });
        let repositoryUrl = '';
        let created = false;

        if (remoteResult.exitCode === 0) {
          const viewResult = await runner.run(githubExecutable, {
            args: ['repo', 'view', '--json', 'url', '--jq', '.url'],
            cwd: repo.canonicalPath,
            timeoutMs: 30_000,
          });
          if (viewResult.exitCode !== 0) {
            return failure(
              'INVALID_REQUEST',
              'The existing origin is not a GitHub repository. Use the branch publishing dialog for this remote.',
              input.projectId,
              false
            );
          }
          repositoryUrl = viewResult.stdout.trim();
        } else {
          const fullName = input.owner
            ? `${input.owner}/${input.repositoryName}`
            : input.repositoryName;
          const args = [
            'repo',
            'create',
            fullName,
            input.visibility === 'public' ? '--public' : '--private',
            '--source',
            repo.canonicalPath,
            '--remote',
            'origin',
          ];
          if (input.description) args.push('--description', input.description);
          const createResult = await runner.run(githubExecutable, {
            args,
            cwd: repo.canonicalPath,
            timeoutMs: COMMAND_TIMEOUT_MS,
          });
          if (createResult.exitCode !== 0) {
            return failure(
              'COMMAND_FAILED',
              createResult.stderr.trim() || 'GitHub repository creation failed.',
              input.projectId,
              true
            );
          }
          repositoryUrl = createResult.stdout.trim() || `https://github.com/${fullName}`;
          created = true;
        }

        const pushResult = await runner.run(gitCapability.executablePath, {
          args: [
            '-C',
            repo.canonicalPath,
            'push',
            '-u',
            'origin',
            `${input.branchName}:${input.branchName}`,
          ],
          timeoutMs: COMMAND_TIMEOUT_MS,
        });
        if (pushResult.exitCode !== 0) {
          return failure(
            'COMMAND_FAILED',
            `${created ? 'The GitHub repository was created, but ' : ''}${pushResult.stderr.trim() || 'the branch could not be pushed.'}`,
            input.projectId,
            true
          );
        }

        const nextSnapshot = await statusService.collectSnapshot(input.projectId, repo.canonicalPath);
        snapshotCache.set(input.projectId, nextSnapshot);
        return { ok: true, snapshot: nextSnapshot, repositoryUrl, created };
      } catch (error) {
        return failure(
          'COMMAND_FAILED',
          error instanceof Error ? error.message : String(error),
          input.projectId,
          true
        );
      }
    });
  }

  return { getStatus, signIn, publish };
}

function failure(
  code:
    | 'INVALID_REQUEST'
    | 'PROJECT_NOT_FOUND'
    | 'SNAPSHOT_STALE'
    | 'REPOSITORY_BLOCKED'
    | 'NO_COMMITS_YET'
    | 'GIT_NOT_FOUND'
    | 'EXECUTABLE_NOT_FOUND'
    | 'COMMAND_FAILED',
  message: string,
  projectId: string,
  retryable: boolean
): GitHubPublishResult {
  return {
    ok: false,
    error: toBureauError({
      code,
      message,
      operation: 'github.publish',
      subjectId: projectId,
      retryable,
    }),
  };
}
