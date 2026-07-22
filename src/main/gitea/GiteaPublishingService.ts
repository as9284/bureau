import type { ProjectCatalogue } from '../projects/ProjectCatalogue';
import type { SnapshotCache } from '../projects/SnapshotCache';
import type { OperationCoordinator } from '../operations/OperationCoordinator';
import type { GitExecutableResolver } from '../git/GitExecutableResolver';
import type { GitRunner } from '../git/GitRunner';
import type { GitStatusService } from '../git/GitStatusService';
import type { GitVersion } from '../git/gitTypes';
import type {
  GiteaConnectRequest,
  GiteaPublishRequest,
  GiteaPublishResult,
  GiteaStatus,
} from '@shared/contracts/gitea';
import { checkRefNameBasics } from '@shared/git/refChecks';
import { toBureauError } from '../ipc/errors';
import type { GiteaCredentialStore } from './GiteaCredentialStore';
import { giteaErrorMessage, giteaRequest, isSameGiteaHost, normalizeHostUrl } from './giteaApi';

const COMMAND_TIMEOUT_MS = 120_000;

export type GiteaPublishingService = {
  getStatus(): Promise<GiteaStatus>;
  connect(input: GiteaConnectRequest): Promise<GiteaStatus>;
  disconnect(): Promise<GiteaStatus>;
  publish(input: GiteaPublishRequest): Promise<GiteaPublishResult>;
  /** Host of the stored connection — the openUrl allowlist consults this. */
  connectedHostUrl(): string | undefined;
};

type GiteaUser = { login?: unknown };
type GiteaRepo = { clone_url?: unknown; html_url?: unknown };

export function createGiteaPublishingService(params: {
  catalogue: ProjectCatalogue;
  snapshotCache: SnapshotCache;
  resolver: GitExecutableResolver;
  runner: GitRunner;
  statusService: GitStatusService;
  coordinator: OperationCoordinator;
  credentials: GiteaCredentialStore;
}): GiteaPublishingService {
  const { catalogue, snapshotCache, resolver, runner, statusService, coordinator, credentials } =
    params;

  async function fetchAccount(
    hostUrl: string,
    token: string
  ): Promise<{ ok: true; account: string } | { ok: false; error: string }> {
    const result = await giteaRequest({ hostUrl, token, method: 'GET', path: '/user' });
    if (!result.ok) return { ok: false, error: result.error };
    if (result.status === 401 || result.status === 403) {
      return { ok: false, error: 'The access token was rejected by this Gitea instance.' };
    }
    if (result.status !== 200) {
      return {
        ok: false,
        error: giteaErrorMessage(result.status, result.body, 'Gitea rejected the request.'),
      };
    }
    const login = (result.body as GiteaUser | undefined)?.login;
    if (typeof login !== 'string' || !login) {
      return { ok: false, error: 'Gitea did not return an account for this token.' };
    }
    return { ok: true, account: login };
  }

  async function fetchVersion(hostUrl: string, token: string): Promise<string | undefined> {
    const result = await giteaRequest({
      hostUrl,
      token,
      method: 'GET',
      path: '/version',
      timeoutMs: 10_000,
    });
    if (!result.ok || result.status !== 200) return undefined;
    const version = (result.body as { version?: unknown } | undefined)?.version;
    return typeof version === 'string' ? version : undefined;
  }

  async function getStatus(): Promise<GiteaStatus> {
    const hostUrl = credentials.getHostUrl();
    if (!hostUrl) return { configured: false, authenticated: false };

    const stored = credentials.getToken();
    if (!stored) {
      return {
        configured: true,
        authenticated: false,
        hostUrl,
        account: credentials.getAccount(),
        error: credentials.canPersist()
          ? 'The saved token could not be decrypted. Reconnect to Gitea.'
          : 'Encrypted storage is unavailable on this system.',
      };
    }

    const account = await fetchAccount(stored.hostUrl, stored.token);
    if (!account.ok) {
      return {
        configured: true,
        authenticated: false,
        hostUrl: stored.hostUrl,
        account: stored.account,
        error: account.error,
      };
    }
    return {
      configured: true,
      authenticated: true,
      hostUrl: stored.hostUrl,
      account: account.account,
      version: await fetchVersion(stored.hostUrl, stored.token),
    };
  }

  async function connect(input: GiteaConnectRequest): Promise<GiteaStatus> {
    let hostUrl: string;
    try {
      hostUrl = normalizeHostUrl(input.hostUrl);
    } catch {
      return { configured: false, authenticated: false, error: 'The Gitea host URL is not valid.' };
    }
    if (!credentials.canPersist()) {
      return {
        configured: false,
        authenticated: false,
        hostUrl,
        error: 'Encrypted storage is unavailable, so the token cannot be saved on this system.',
      };
    }

    const account = await fetchAccount(hostUrl, input.token);
    if (!account.ok) {
      return { configured: false, authenticated: false, hostUrl, error: account.error };
    }
    await credentials.save({ hostUrl, account: account.account, token: input.token });
    return {
      configured: true,
      authenticated: true,
      hostUrl,
      account: account.account,
      version: await fetchVersion(hostUrl, input.token),
    };
  }

  async function disconnect(): Promise<GiteaStatus> {
    await credentials.clear();
    return { configured: false, authenticated: false };
  }

  async function publish(input: GiteaPublishRequest): Promise<GiteaPublishResult> {
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
          'Create your first commit before publishing to Gitea.',
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

      const stored = credentials.getToken();
      if (!stored) {
        return failure(
          'CAPABILITY_MISSING',
          'Connect a Gitea account before publishing.',
          input.projectId,
          true
        );
      }
      const gitCapability = await resolver.resolve();
      if (gitCapability.kind !== 'available') {
        return failure('GIT_NOT_FOUND', 'Git is not available.', input.projectId, true);
      }

      try {
        const remoteResult = await runner.run(gitCapability.executablePath, {
          args: ['-C', repo.canonicalPath, 'remote', 'get-url', 'origin'],
          timeoutMs: 20_000,
        });

        let cloneUrl: string;
        let repositoryUrl: string;
        let created = false;

        if (remoteResult.exitCode === 0) {
          const existing = remoteResult.stdout.trim();
          if (!isSameGiteaHost(existing, stored.hostUrl)) {
            return failure(
              'INVALID_REQUEST',
              'The existing origin does not point at the connected Gitea instance. Use the branch publishing dialog for this remote.',
              input.projectId,
              false
            );
          }
          cloneUrl = existing;
          repositoryUrl = existing.replace(/\.git$/, '');
        } else {
          const owner = input.owner?.trim();
          const isOrganisation = Boolean(owner) && owner !== stored.account;
          const createResult = await giteaRequest({
            hostUrl: stored.hostUrl,
            token: stored.token,
            method: 'POST',
            path: isOrganisation ? `/orgs/${encodeURIComponent(owner as string)}/repos` : '/user/repos',
            body: {
              name: input.repositoryName,
              description: input.description ?? '',
              private: input.visibility === 'private',
              auto_init: false,
              default_branch: input.branchName,
            },
            timeoutMs: 60_000,
          });
          if (!createResult.ok) {
            return failure('COMMAND_FAILED', createResult.error, input.projectId, true);
          }
          if (createResult.status !== 201) {
            return failure(
              'COMMAND_FAILED',
              giteaErrorMessage(
                createResult.status,
                createResult.body,
                'Gitea repository creation failed.'
              ),
              input.projectId,
              true
            );
          }
          const body = createResult.body as GiteaRepo | undefined;
          if (typeof body?.clone_url !== 'string' || !body.clone_url) {
            return failure(
              'COMMAND_FAILED',
              'Gitea created the repository but did not return a clone URL.',
              input.projectId,
              true
            );
          }
          cloneUrl = body.clone_url;
          repositoryUrl = typeof body.html_url === 'string' ? body.html_url : cloneUrl;
          created = true;

          const addRemote = await runner.run(gitCapability.executablePath, {
            args: ['-C', repo.canonicalPath, 'remote', 'add', 'origin', cloneUrl],
            timeoutMs: 20_000,
          });
          if (addRemote.exitCode !== 0) {
            return failure(
              'COMMAND_FAILED',
              `The Gitea repository was created, but ${addRemote.stderr.trim() || 'origin could not be configured.'}`,
              input.projectId,
              true
            );
          }
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
          env: pushEnv(cloneUrl, stored.account, stored.token, gitCapability.version),
          timeoutMs: COMMAND_TIMEOUT_MS,
        });
        if (pushResult.exitCode !== 0) {
          return failure(
            'COMMAND_FAILED',
            `${created ? 'The Gitea repository was created, but ' : ''}${pushResult.stderr.trim() || 'the branch could not be pushed.'}`,
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

  return { getStatus, connect, disconnect, publish, connectedHostUrl: () => credentials.getHostUrl() };
}

/**
 * Gitea has no credential helper of its own, so the push carries the token in an
 * `Authorization` header. It is passed through `GIT_CONFIG_*` **environment**
 * variables rather than `-c` arguments, because argv is world-readable via `ps`
 * while a process environment is not. The key is scoped to the clone URL so a
 * redirect to another origin cannot replay the token.
 *
 * Env-based config needs git >= 2.31; Bureau's floor is 2.25, so older versions
 * fall through to whatever credential helper the user has configured.
 */
export function pushEnv(
  cloneUrl: string,
  account: string,
  token: string,
  version: GitVersion
): Record<string, string | undefined> | undefined {
  if (!/^https?:\/\//i.test(cloneUrl)) return undefined;
  if (version.major < 2 || (version.major === 2 && version.minor < 31)) return undefined;
  const basic = Buffer.from(`${account}:${token}`, 'utf8').toString('base64');
  // GitRunner replaces the child environment wholesale when `env` is set, so the
  // parent environment (PATH, HOME, SystemRoot) has to be carried through.
  return {
    ...process.env,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `http.${cloneUrl}.extraHeader`,
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
  };
}

function failure(
  code:
    | 'INVALID_REQUEST'
    | 'PROJECT_NOT_FOUND'
    | 'SNAPSHOT_STALE'
    | 'REPOSITORY_BLOCKED'
    | 'NO_COMMITS_YET'
    | 'GIT_NOT_FOUND'
    | 'CAPABILITY_MISSING'
    | 'COMMAND_FAILED',
  message: string,
  projectId: string,
  retryable: boolean
): GiteaPublishResult {
  return {
    ok: false,
    error: toBureauError({
      code,
      message,
      operation: 'gitea.publish',
      subjectId: projectId,
      retryable,
    }),
  };
}
