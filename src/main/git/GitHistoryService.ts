import type { ProjectCatalogue } from '../projects/ProjectCatalogue';
import type { OperationCoordinator } from '../operations/OperationCoordinator';
import type { GitExecutableResolver } from './GitExecutableResolver';
import type { GitRunner } from './GitRunner';
import type {
  HistoryCommit,
  ListHistoryRequest,
  ListHistoryResult,
  ListReflogRequest,
  ListReflogResult,
  ListTagsRequest,
  ListTagsResult,
  CompareCommitsRequest,
  CompareCommitsResult,
} from '@shared/contracts/history';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@shared/contracts/pagination';
import { assignGraphLanes } from '@shared/git/graphLanes';
import { parseReflog, REFLOG_FORMAT } from '@shared/git/reflogParse';
import { toBureauError } from '../ipc/errors';

const QUERY_TIMEOUT_MS = 60_000;

export type GitHistoryService = {
  listHistory(input: ListHistoryRequest): Promise<ListHistoryResult>;
  listReflog(input: ListReflogRequest): Promise<ListReflogResult>;
  listTags(input: ListTagsRequest): Promise<ListTagsResult>;
  compareCommits(input: CompareCommitsRequest): Promise<CompareCommitsResult>;
};

export function createGitHistoryService(params: {
  catalogue: ProjectCatalogue;
  resolver: GitExecutableResolver;
  runner: GitRunner;
  coordinator: OperationCoordinator;
}): GitHistoryService {
  const { catalogue, resolver, runner, coordinator } = params;

  async function listHistory(input: ListHistoryRequest): Promise<ListHistoryResult> {
    return coordinator.runProjectRead(input.projectId, async () => {
      const repo = catalogue.get(input.projectId);
      if (!repo) throw notFound(input.projectId);

      const capability = await resolver.resolve();
      if (capability.kind !== 'available') throw gitUnavailable(input.projectId);

      const limit = Math.min(input.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
      const skip = decodeCursor(input.cursor);

      const args = [
        '-C',
        repo.canonicalPath,
        'log',
        // No trailing %x00: -z alone separates records, so each commit is a clean 6-field NUL
        // group. A trailing separator would inject an empty token between records that a naive
        // filter(Boolean) then conflates with legitimately-empty fields (a root commit's %P).
        '--format=%H%x00%h%x00%s%x00%an%x00%aI%x00%P',
        '-z',
        `--max-count=${limit + 1}`,
      ];

      if (input.filters?.author) args.push(`--author=${input.filters.author}`);
      if (input.filters?.since) args.push(`--since=${input.filters.since}`);
      if (input.filters?.until) args.push(`--until=${input.filters.until}`);
      if (input.filters?.text) args.push('--grep', input.filters.text);
      if (skip > 0) args.push(`--skip=${skip}`);
      if (input.filters?.oid) {
        args.push('-1', input.filters.oid);
      } else if (input.filters?.ref) {
        args.push(input.filters.ref);
      }
      if (input.filters?.path) args.push('--', input.filters.path);

      const result = await runner.run(capability.executablePath, {
        args,
        timeoutMs: QUERY_TIMEOUT_MS,
        stdoutLimitBytes: 4 * 1024 * 1024,
      });
      if (result.exitCode !== 0) throw new Error(result.stderr || 'Could not list history.');

      // Do NOT filter(Boolean): a root commit's parents field is legitimately empty, and
      // dropping it would shift every subsequent field. The loop ignores the lone trailing token.
      const rawEntries = result.stdout.split('\0');
      const commits: HistoryCommit[] = [];
      for (let i = 0; i < rawEntries.length; i += 6) {
        if (i + 5 >= rawEntries.length) break;
        const [oid, abbreviatedOid, subject, authorName, committedAt, parents] = rawEntries.slice(
          i,
          i + 6
        );
        commits.push({
          oid,
          abbreviatedOid,
          subject,
          authorName,
          committedAt,
          parentOids: parents ? parents.split(' ').filter(Boolean) : [],
          decorations: [],
        });
      }

      const hasMore = commits.length > limit;
      const page = hasMore ? commits.slice(0, limit) : commits;
      const graph = assignGraphLanes(page.map((c) => ({ oid: c.oid, parentOids: c.parentOids })));
      const withGraph = page.map((c, idx) => ({
        ...c,
        graphLane: graph[idx]?.lane,
        graphLanes: graph[idx]?.lanes,
        graphConnectors: graph[idx]?.connectors,
      }));

      return {
        items: withGraph,
        hasMore,
        nextCursor: hasMore ? encodeCursor(skip + limit) : undefined,
      };
    });
  }

  /**
   * The reflog of HEAD — the undo trail that makes reset safe to offer. Read-only, so
   * it mirrors listHistory's skip/limit cursor rather than the mutation envelope.
   */
  async function listReflog(input: ListReflogRequest): Promise<ListReflogResult> {
    return coordinator.runProjectRead(input.projectId, async () => {
      const repo = catalogue.get(input.projectId);
      if (!repo) throw notFound(input.projectId);

      const capability = await resolver.resolve();
      if (capability.kind !== 'available') throw gitUnavailable(input.projectId);

      const limit = Math.min(input.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
      const skip = decodeCursor(input.cursor);

      const result = await runner.run(capability.executablePath, {
        args: [
          '-C',
          repo.canonicalPath,
          'reflog',
          'show',
          // `%gD` renders as HEAD@{<date>} under --date, and as HEAD@{<index>} without
          // it — never both. We take the date and synthesize the index from `skip`.
          '--date=iso-strict',
          `--format=${REFLOG_FORMAT}`,
          '-z',
          `--skip=${skip}`,
          `--max-count=${limit + 1}`,
          'HEAD',
        ],
        timeoutMs: QUERY_TIMEOUT_MS,
        stdoutLimitBytes: 4 * 1024 * 1024,
      });
      // An unborn HEAD (fresh `git init`) exits 128 with "unknown revision". That is a
      // legitimate "nothing here yet" state, not a failure — report it as an empty page
      // so the panel shows its empty state instead of an error.
      if (result.exitCode !== 0) return { items: [], hasMore: false };

      const entries = parseReflog(result.stdout, skip);
      const hasMore = entries.length > limit;

      return {
        items: hasMore ? entries.slice(0, limit) : entries,
        hasMore,
        nextCursor: hasMore ? encodeCursor(skip + limit) : undefined,
      };
    });
  }

  async function listTags(input: ListTagsRequest): Promise<ListTagsResult> {
    return coordinator.runProjectRead(input.projectId, async () => {
      const repo = catalogue.get(input.projectId);
      if (!repo) throw notFound(input.projectId);
      const capability = await resolver.resolve();
      if (capability.kind !== 'available') throw gitUnavailable(input.projectId);

      const limit = Math.min(input.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
      const skip = decodeCursor(input.cursor);
      const result = await runner.run(capability.executablePath, {
        args: [
          '-C',
          repo.canonicalPath,
          'for-each-ref',
          '--format=%(refname:short)%00%(objectname)%00%(objecttype)%00',
          'refs/tags',
        ],
        timeoutMs: QUERY_TIMEOUT_MS,
      });
      if (result.exitCode !== 0) return { items: [], hasMore: false };

      const tags = result.stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .map((entry) => {
          const [name, oid, type] = entry.split('\0');
          return {
            name,
            oid,
            targetOid: oid,
            kind: type === 'tag' ? ('annotated' as const) : ('lightweight' as const),
          };
        });

      return {
        items: tags.slice(skip, skip + limit),
        hasMore: tags.length > skip + limit,
        nextCursor: tags.length > skip + limit ? encodeCursor(skip + limit) : undefined,
      };
    });
  }

  async function compareCommits(input: CompareCommitsRequest): Promise<CompareCommitsResult> {
    return coordinator.runProjectRead(input.projectId, async () => {
      const repo = catalogue.get(input.projectId);
      if (!repo) throw notFound(input.projectId);
      const capability = await resolver.resolve();
      if (capability.kind !== 'available') throw gitUnavailable(input.projectId);

      const result = await runner.run(capability.executablePath, {
        args: ['-C', repo.canonicalPath, 'diff', '--name-status', input.baseOid, input.targetOid],
        timeoutMs: QUERY_TIMEOUT_MS,
      });
      if (result.exitCode !== 0) {
        return {
          ok: false,
          error: toBureauError({
            code: 'COMMAND_FAILED',
            message: result.stderr.trim() || 'Compare failed.',
            operation: 'git.compareCommits',
            subjectId: input.projectId,
            retryable: true,
          }),
        };
      }

      const files = result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [status, ...rest] = line.split('\t');
          const path = rest.join('\t');
          const mapped =
            status === 'A'
              ? 'added'
              : status === 'D'
                ? 'deleted'
                : status?.startsWith('R')
                  ? 'renamed'
                  : 'modified';
          return {
            path: status?.startsWith('R') ? (rest[1] ?? path) : path,
            status: mapped as 'added' | 'modified' | 'deleted' | 'renamed',
            originalPath: status?.startsWith('R') ? rest[0] : undefined,
          };
        });

      return { ok: true, files };
    });
  }

  return { listHistory, listReflog, listTags, compareCommits };
}

function encodeCursor(skip: number): string {
  return Buffer.from(JSON.stringify({ skip })).toString('base64url');
}

function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      skip?: number;
    };
    return typeof parsed.skip === 'number' ? parsed.skip : 0;
  } catch {
    return 0;
  }
}

function notFound(projectId: string): never {
  throw toBureauError({
    code: 'PROJECT_NOT_FOUND',
    message: `Repository ${projectId} not found.`,
    operation: 'git.listHistory',
    subjectId: projectId,
    retryable: false,
  });
}

function gitUnavailable(projectId: string): never {
  throw toBureauError({
    code: 'GIT_NOT_FOUND',
    message: 'Git is not available.',
    operation: 'git.listHistory',
    subjectId: projectId,
    retryable: true,
  });
}
