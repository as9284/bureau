import path from 'node:path';
import type { ProjectCatalogue } from '../projects/ProjectCatalogue';
import type { GitExecutableResolver } from '../git/GitExecutableResolver';
import type { GitRunner } from '../git/GitRunner';
import type {
  CommitCheckItem,
  CommitCheckSummary,
  GitHubChecksAvailability,
  GitHubCommitChecksRequest,
  GitHubCommitChecksResult,
} from '@shared/contracts/github';
import { parseGitHubOwnerRepo } from '@shared/git/parseGitHubRemote';
import { mapGitHubStatusState } from '@shared/git/checkRollup';
import { toBureauError } from '../ipc/errors';

const CLI_TIMEOUT_MS = 20_000;
const GRAPHQL_TIMEOUT_MS = 45_000;
const MAX_CONTEXTS = 25;

export type GitHubChecksService = {
  getCommitChecks(input: GitHubCommitChecksRequest): Promise<GitHubCommitChecksResult>;
};

type GraphQlCheckRun = {
  __typename?: string;
  name?: string;
  status?: string;
  conclusion?: string | null;
  detailsUrl?: string | null;
  context?: string;
  state?: string;
  targetUrl?: string | null;
};

type GraphQlCommitNode = {
  oid?: string;
  statusCheckRollup?: {
    state?: string | null;
    contexts?: { nodes?: Array<GraphQlCheckRun | null> | null } | null;
  } | null;
} | null;

export function createGitHubChecksService(params: {
  catalogue: ProjectCatalogue;
  resolver: GitExecutableResolver;
  runner: GitRunner;
}): GitHubChecksService {
  const { catalogue, resolver, runner } = params;

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

  async function resolveOwnerRepo(
    executable: string,
    repoPath: string
  ): Promise<{ owner: string; repo: string } | undefined> {
    // Prefer `gh repo view` — handles SSH host aliases and redirects better than URL parse.
    const view = await runner.run(executable, {
      args: ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
      cwd: repoPath,
      timeoutMs: CLI_TIMEOUT_MS,
    });
    if (view.exitCode === 0) {
      const slug = view.stdout.trim();
      const slash = slug.indexOf('/');
      if (slash > 0 && slash < slug.length - 1) {
        return { owner: slug.slice(0, slash), repo: slug.slice(slash + 1) };
      }
    }

    const gitCapability = await resolver.resolve();
    if (gitCapability.kind !== 'available') return undefined;
    const remoteResult = await runner.run(gitCapability.executablePath, {
      args: ['-C', repoPath, 'remote', 'get-url', 'origin'],
      timeoutMs: CLI_TIMEOUT_MS,
    });
    if (remoteResult.exitCode !== 0) return undefined;
    return parseGitHubOwnerRepo(remoteResult.stdout.trim());
  }

  async function getCommitChecks(input: GitHubCommitChecksRequest): Promise<GitHubCommitChecksResult> {
    const tracked = catalogue.get(input.projectId);
    if (!tracked) {
      return {
        ok: false,
        error: toBureauError({
          code: 'PROJECT_NOT_FOUND',
          message: 'Repository not found.',
          operation: 'github.getCommitChecks',
          subjectId: input.projectId,
          retryable: false,
        }),
      };
    }

    const uniqueOids = [...new Set(input.oids.map((oid) => oid.toLowerCase()))];

    const soft = (
      availability: GitHubChecksAvailability,
      extras?: { repository?: string; summaries?: CommitCheckSummary[] }
    ): GitHubCommitChecksResult => ({
      ok: true,
      availability,
      repository: extras?.repository,
      summaries: extras?.summaries ?? [],
    });

    try {
      const executable = await resolveCli();
      if (!executable) return soft('unauthenticated');

      const auth = await runner.run(executable, {
        args: ['auth', 'status', '--hostname', 'github.com'],
        timeoutMs: CLI_TIMEOUT_MS,
      });
      if (auth.exitCode !== 0) return soft('unauthenticated');

      const ownerRepo = await resolveOwnerRepo(executable, tracked.canonicalPath);
      if (!ownerRepo) return soft('not_github');

      const query = buildStatusCheckRollupQuery(uniqueOids);
      const payload = JSON.stringify({
        query,
        variables: { owner: ownerRepo.owner, name: ownerRepo.repo },
      });
      const gql = await runner.run(executable, {
        args: ['api', 'graphql', '--input', '-'],
        stdin: payload,
        cwd: tracked.canonicalPath,
        timeoutMs: GRAPHQL_TIMEOUT_MS,
        stdoutLimitBytes: 4 * 1024 * 1024,
      });

      if (gql.exitCode !== 0) {
        return soft('unavailable', {
          repository: `${ownerRepo.owner}/${ownerRepo.repo}`,
        });
      }

      let parsed: {
        data?: { repository?: Record<string, GraphQlCommitNode> | null };
        errors?: Array<{ message?: string }>;
      };
      try {
        parsed = JSON.parse(gql.stdout) as typeof parsed;
      } catch {
        return soft('unavailable', {
          repository: `${ownerRepo.owner}/${ownerRepo.repo}`,
        });
      }

      if (parsed.errors?.length && !parsed.data?.repository) {
        return soft('unavailable', {
          repository: `${ownerRepo.owner}/${ownerRepo.repo}`,
        });
      }

      const repoNode = parsed.data?.repository;
      if (!repoNode) {
        return soft('not_github', {
          repository: `${ownerRepo.owner}/${ownerRepo.repo}`,
        });
      }

      const observedAt = new Date().toISOString();
      const summaries: CommitCheckSummary[] = uniqueOids.map((oid, index) => {
        const node = repoNode[`c${index}`];
        return summarizeCommitNode(oid, node, observedAt);
      });

      return soft('ready', {
        repository: `${ownerRepo.owner}/${ownerRepo.repo}`,
        summaries,
      });
    } catch (error) {
      return {
        ok: false,
        error: toBureauError({
          code: 'COMMAND_FAILED',
          message: error instanceof Error ? error.message : String(error),
          operation: 'github.getCommitChecks',
          subjectId: input.projectId,
          retryable: true,
        }),
      };
    }
  }

  return { getCommitChecks };
}

/**
 * One aliased field per OID. OIDs are Zod-validated hex, so embedding them in the
 * query document is safe and keeps the request to a single round-trip.
 */
export function buildStatusCheckRollupQuery(oids: string[]): string {
  const fields = oids
    .map(
      (oid, index) => `
      c${index}: object(oid: "${oid}") {
        ... on Commit {
          oid
          statusCheckRollup {
            state
            contexts(first: ${MAX_CONTEXTS}) {
              nodes {
                __typename
                ... on CheckRun {
                  name
                  status
                  conclusion
                  detailsUrl
                }
                ... on StatusContext {
                  context
                  state
                  targetUrl
                }
              }
            }
          }
        }
      }`
    )
    .join('\n');

  return `query($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      ${fields}
    }
  }`;
}

export function summarizeCommitNode(
  requestedOid: string,
  node: GraphQlCommitNode,
  observedAt: string
): CommitCheckSummary {
  if (!node) {
    return { oid: requestedOid, state: 'none', totalCount: 0, checks: [], observedAt };
  }

  const rollup = node.statusCheckRollup;
  const oid = (node.oid ?? requestedOid).toLowerCase();
  if (!rollup) {
    return { oid, state: 'none', totalCount: 0, checks: [], observedAt };
  }

  const checks: CommitCheckItem[] = [];
  for (const entry of rollup.contexts?.nodes ?? []) {
    if (!entry) continue;
    if (entry.__typename === 'CheckRun' || (entry.name && !entry.context)) {
      checks.push({
        name: entry.name ?? 'check',
        state: (entry.status ?? 'COMPLETED').toUpperCase(),
        conclusion: entry.conclusion ?? null,
        detailsUrl: entry.detailsUrl ?? undefined,
      });
      continue;
    }
    if (entry.__typename === 'StatusContext' || entry.context) {
      checks.push({
        name: entry.context ?? 'status',
        state: (entry.state ?? 'PENDING').toUpperCase(),
        conclusion: null,
        detailsUrl: entry.targetUrl ?? undefined,
      });
    }
  }

  return {
    oid,
    state: mapGitHubStatusState(rollup.state),
    totalCount: checks.length,
    checks,
    observedAt,
  };
}
