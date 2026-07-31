import { randomUUID } from 'node:crypto';
import type {
  ApiCollectionNode,
  ApiRequestDefinition,
  ApiResponsePreview,
  ApiRunConfig,
  ApiRunEvent,
  ApiRunItemResult,
  ApiRunReport,
  ApiRunTarget,
} from '@shared/contracts/apiWorkbench';

/**
 * Sequential collection runner.
 *
 * Requests run one at a time in collection order. Parallelism is deliberately absent (§13.4):
 * variable mutation across concurrent iterations has no defined semantics, and Bureau should not
 * be the thing that load-tests someone's staging environment by accident.
 *
 * Runtime variables persist for the whole run, so a login request at the top of a folder can set a
 * token the rest of the folder uses. A data set turns each row into one iteration, and its columns
 * sit above every other scope for that iteration only.
 */

export type RunRequestExecutor = (input: {
  workspaceId: string;
  requestId: string;
  runtimeValues: Map<string, string>;
  iterationValues?: Map<string, string>;
  timeoutMs?: number;
  signal: AbortSignal;
}) => Promise<ApiResponsePreview>;

export type RunnerDeps = {
  emit(event: ApiRunEvent): void;
  execute: RunRequestExecutor;
};

export type StartRunInput = {
  config: ApiRunConfig;
  collections: ApiCollectionNode[];
  requests: ApiRequestDefinition[];
  environmentName?: string;
  dataFileName?: string;
  dataRows?: Array<Record<string, string>>;
  /** True when at least one script under the target is enabled — surfaced before the run starts. */
  scriptsEnabled: boolean;
};

export type CollectionRunner = {
  start(input: StartRunInput): { ok: true; runId: string } | { ok: false; code: 'API_RUN_ACTIVE' | 'API_RUN_EMPTY' };
  cancel(runId: string): boolean;
  report(runId: string): ApiRunReport | undefined;
  activeRunId(workspaceId: string): string | undefined;
  dispose(): void;
};

/** Reports are kept for export and re-inspection; older ones are dropped. */
const MAX_RETAINED_REPORTS = 10;

/**
 * Requests in the target, in the order the tree shows them: a run whose order did not match the
 * sidebar would be impossible to reason about.
 */
export function resolveRunOrder(
  collections: ApiCollectionNode[],
  requests: ApiRequestDefinition[],
  target: ApiRunTarget
): ApiRequestDefinition[] {
  if (target.kind === 'request') {
    const single = requests.find((entry) => entry.requestId === target.requestId);
    return single ? [single] : [];
  }

  const ordered: ApiRequestDefinition[] = [];
  const childrenOf = (parentId: string | null): ApiCollectionNode[] =>
    collections.filter((node) => node.parentId === parentId).sort((a, b) => a.order - b.order);

  const visit = (node: ApiCollectionNode, depth: number): void => {
    // A corrupt tree could otherwise recurse without end.
    if (depth > 64) return;
    if (node.kind === 'request') {
      const request = requests.find((entry) => entry.requestId === node.requestId);
      if (request) ordered.push(request);
      return;
    }
    for (const child of childrenOf(node.collectionId)) visit(child, depth + 1);
  };

  if (target.kind === 'workspace') {
    for (const node of childrenOf(null)) visit(node, 0);
    return ordered;
  }

  const root = collections.find((node) => node.collectionId === target.collectionId);
  if (root) visit(root, 0);
  return ordered;
}

export function createCollectionRunner(deps: RunnerDeps): CollectionRunner {
  type ActiveRun = {
    runId: string;
    workspaceId: string;
    controller: AbortController;
    cancelled: boolean;
  };

  const reports = new Map<string, ApiRunReport>();
  const active = new Map<string, ActiveRun>();
  let seq = 0;

  function retain(report: ApiRunReport): void {
    reports.set(report.runId, report);
    while (reports.size > MAX_RETAINED_REPORTS) {
      const oldest = reports.keys().next();
      if (oldest.done) break;
      reports.delete(oldest.value);
    }
  }

  function start(input: StartRunInput): ReturnType<CollectionRunner['start']> {
    const { config } = input;
    // One run per workspace: two concurrent runs would fight over the same runtime variables.
    for (const run of active.values()) {
      if (run.workspaceId === config.workspaceId) return { ok: false, code: 'API_RUN_ACTIVE' };
    }

    const order = resolveRunOrder(input.collections, input.requests, config.target);
    if (order.length === 0) return { ok: false, code: 'API_RUN_EMPTY' };

    const rows = input.dataRows;
    // A data set defines the iteration count, bounded by what the caller asked for.
    const iterations = rows ? Math.min(rows.length, config.iterations) : config.iterations;
    const runId = randomUUID();
    const controller = new AbortController();
    const run: ActiveRun = { runId, workspaceId: config.workspaceId, controller, cancelled: false };
    active.set(runId, run);

    const report: ApiRunReport = {
      runId,
      workspaceId: config.workspaceId,
      status: 'running',
      startedAt: new Date().toISOString(),
      environmentName: input.environmentName,
      dataFileName: input.dataFileName,
      iterations,
      plannedItems: order.length * iterations,
      items: [],
      totals: {
        requests: 0,
        failedRequests: 0,
        assertions: 0,
        failedAssertions: 0,
        scriptErrors: 0,
        totalMs: 0,
      },
      scriptsEnabled: input.scriptsEnabled,
    };
    retain(report);

    deps.emit({
      type: 'run-started',
      runId,
      workspaceId: config.workspaceId,
      seq: (seq += 1),
      plannedItems: report.plannedItems,
      iterations,
      scriptsEnabled: input.scriptsEnabled,
    });

    void (async () => {
      // Runtime writes outlive a single request, which is how a run chains requests together.
      const runtimeValues = new Map<string, string>();
      let stopped = false;

      try {
        for (let iteration = 1; iteration <= iterations && !stopped; iteration += 1) {
          const iterationValues = rows
            ? new Map(Object.entries(rows[iteration - 1] ?? {}))
            : undefined;

          for (const request of order) {
            if (run.cancelled) {
              stopped = true;
              break;
            }
            const startedAt = Date.now();
            let response: ApiResponsePreview;
            try {
              response = await deps.execute({
                workspaceId: config.workspaceId,
                requestId: request.requestId,
                runtimeValues,
                iterationValues,
                timeoutMs: config.perRequestTimeoutMs,
                signal: controller.signal,
              });
            } catch (error) {
              // The executor is not supposed to throw; a run must still produce a report.
              response = {
                sessionId: '',
                workspaceId: config.workspaceId,
                requestId: request.requestId,
                ok: false,
                status: 0,
                statusText: '',
                url: request.urlTemplate,
                method: request.method,
                headers: [],
                timings: { totalMs: Date.now() - startedAt },
                redirects: [],
                wireBytes: 0,
                decodedBytes: 0,
                truncated: false,
                bodyIsBinary: false,
                errorCode: 'API_PROTOCOL_ERROR',
                errorMessage: error instanceof Error ? error.message : 'The request failed.',
              };
            }

            const scripts = response.scripts ?? [];
            const tests = scripts.flatMap((outcome) => outcome.tests);
            const item: ApiRunItemResult = {
              itemId: randomUUID(),
              requestId: request.requestId,
              name: request.name,
              iteration,
              method: response.method || request.method,
              url: response.url || request.urlTemplate,
              status: response.status || undefined,
              ok: response.ok,
              totalMs: response.timings.totalMs,
              tests,
              scripts,
              historyId: response.historyId,
              errorCode: response.errorCode,
              errorMessage: response.errorMessage,
            };

            report.items.push(item);
            report.totals.requests += 1;
            if (!item.ok) report.totals.failedRequests += 1;
            report.totals.assertions += tests.length;
            report.totals.failedAssertions += tests.filter((test) => !test.passed).length;
            report.totals.scriptErrors += scripts.filter((outcome) => outcome.errorCode).length;
            report.totals.totalMs += item.totalMs;

            deps.emit({
              type: 'run-item',
              runId,
              workspaceId: config.workspaceId,
              seq: (seq += 1),
              completed: report.items.length,
              item,
            });

            if (config.stopOnFailure && !item.ok) {
              report.stoppedOnFailure = true;
              stopped = true;
              break;
            }

            const isLast =
              iteration === iterations && request === order[order.length - 1];
            if (config.delayMs > 0 && !isLast && !run.cancelled) {
              await new Promise<void>((resolve) => {
                const timer = setTimeout(resolve, config.delayMs);
                timer.unref?.();
                // A cancel during the delay must not wait it out.
                controller.signal.addEventListener(
                  'abort',
                  () => {
                    clearTimeout(timer);
                    resolve();
                  },
                  { once: true }
                );
              });
            }
          }
        }

        report.status = run.cancelled
          ? 'cancelled'
          : report.totals.failedRequests > 0 || report.totals.failedAssertions > 0
            ? 'failed'
            : 'completed';
      } catch (error) {
        report.status = 'failed';
        report.items.push({
          itemId: randomUUID(),
          requestId: '',
          name: 'Run',
          iteration: 0,
          method: '',
          url: '',
          ok: false,
          totalMs: 0,
          tests: [],
          scripts: [],
          errorCode: 'API_PROTOCOL_ERROR',
          errorMessage: error instanceof Error ? error.message : 'The run failed unexpectedly.',
        });
      } finally {
        report.finishedAt = new Date().toISOString();
        active.delete(runId);
        deps.emit({
          type: 'run-complete',
          runId,
          workspaceId: config.workspaceId,
          seq: (seq += 1),
          report,
        });
      }
    })();

    return { ok: true, runId };
  }

  return {
    start,

    cancel(runId) {
      const run = active.get(runId);
      if (!run) return false;
      run.cancelled = true;
      // Aborts the in-flight request and its script job together.
      run.controller.abort();
      return true;
    },

    report(runId) {
      return reports.get(runId);
    },

    activeRunId(workspaceId) {
      for (const run of active.values()) {
        if (run.workspaceId === workspaceId) return run.runId;
      }
      return undefined;
    },

    dispose() {
      for (const run of active.values()) {
        run.cancelled = true;
        run.controller.abort();
      }
      active.clear();
      reports.clear();
    },
  };
}
