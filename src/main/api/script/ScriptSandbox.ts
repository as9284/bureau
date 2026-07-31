import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import type {
  ApiScriptHolder,
  ApiScriptOutcome,
  ApiScriptPhase,
  ApiValidateScriptResult,
} from '@shared/contracts/apiWorkbench';
import workerSource from './scriptWorker.js?raw';
import { MAX_SCRIPT_SOURCE_BYTES, limitsForPhase } from './limits';
import type { ScriptContext, ScriptWorkerMessage, ScriptWorkerResult } from './protocol';
import { createRedactor } from './redact';

export type ScriptRunInput = {
  phase: ApiScriptPhase;
  holder: ApiScriptHolder;
  source: string;
  context: ScriptContext;
  /** Values to redact from every string the guest produced. */
  secretValues: string[];
  signal?: AbortSignal;
};

export type ScriptRunOutput = {
  outcome: ApiScriptOutcome;
  /** Applied by the caller as the highest-precedence variable layer. */
  writes: Array<{ name: string; value: string | null }>;
};

export type ScriptSandbox = {
  run(input: ScriptRunInput): Promise<ScriptRunOutput>;
  /** Parse-only check, so the editor can report a syntax error without running anything. */
  validate(source: string, phase: ApiScriptPhase): Promise<ApiValidateScriptResult>;
  dispose(): void;
};

/**
 * Resolves the QuickJS packages for the worker.
 *
 * The worker is started from an inlined source string, so its own `require` resolves relative to
 * the process working directory — unknowable in a packaged app. The main bundle is CommonJS at
 * runtime, so `require.resolve` here produces absolute, asar-aware paths. Under Vitest the module
 * graph is ESM and `require` is absent; the bare specifiers then resolve from the repo root, which
 * is correct for a checkout.
 */
function resolveQuickJsPaths(): { quickjsPath: string; variantPath: string } {
  const specifiers = {
    // `-core` rather than the `quickjs-emscripten` umbrella: the umbrella depends on four
    // separate-Wasm-file variants Bureau does not use, and they would all have to be packaged.
    quickjsPath: 'quickjs-emscripten-core',
    variantPath: '@jitl/quickjs-singlefile-cjs-release-sync',
  };
  try {
    // The same sanctioned bare-`require` exception as PtyBridge's lazy native load: the main
    // bundle is CommonJS at runtime, and the guard lets the ESM test graph fall through.
    /* eslint-disable-next-line no-restricted-globals */
    const resolver = typeof require === 'function' ? require.resolve : undefined;
    if (!resolver) return specifiers;
    return {
      quickjsPath: resolver(specifiers.quickjsPath),
      variantPath: resolver(specifiers.variantPath),
    };
  } catch {
    return specifiers;
  }
}

function emptyOutcome(
  input: ScriptRunInput,
  patch: Partial<ApiScriptOutcome>
): ApiScriptOutcome {
  return {
    phase: input.phase,
    holder: input.holder,
    ran: false,
    ok: true,
    durationMs: 0,
    console: [],
    consoleDropped: 0,
    tests: [],
    variableWrites: [],
    ...patch,
  };
}

export function createScriptSandbox(): ScriptSandbox {
  const paths = resolveQuickJsPaths();
  let worker: Worker | null = null;
  /** Serialises jobs: one QuickJS runtime at a time keeps the memory ceiling meaningful. */
  let queue: Promise<unknown> = Promise.resolve();
  let disposed = false;

  function startWorker(): Worker {
    const next = new Worker(workerSource, {
      eval: true,
      workerData: paths,
      // A script cannot reach process.env, but neither should the worker carry it around.
      env: {},
      resourceLimits: {
        // Bounds the worker's own JS heap (not the wasm heap, which QuickJS accounts for itself),
        // so a fault in the host half of the sandbox kills the thread rather than the process.
        maxOldGenerationSizeMb: 256,
      },
    });
    next.unref();
    return next;
  }

  function ensureWorker(): Worker {
    if (!worker) worker = startWorker();
    return worker;
  }

  /** Any limit breach or protocol fault retires the worker; the next job gets a clean one. */
  function retireWorker(): void {
    const retiring = worker;
    worker = null;
    void retiring?.terminate();
  }

  function execute(input: ScriptRunInput): Promise<ScriptRunOutput> {
    const limits = limitsForPhase(input.phase);
    const redact = createRedactor(input.secretValues);
    const startedAt = Date.now();

    if (input.source.length > MAX_SCRIPT_SOURCE_BYTES) {
      return Promise.resolve({
        outcome: emptyOutcome(input, {
          ok: false,
          errorCode: 'API_SCRIPT_LIMIT_EXCEEDED',
          errorMessage: 'The script is larger than the sandbox allows.',
        }),
        writes: [],
      });
    }
    if (input.signal?.aborted) {
      return Promise.resolve({
        outcome: emptyOutcome(input, {
          ok: false,
          errorCode: 'API_CANCELLED',
          errorMessage: 'Cancelled before the script ran.',
        }),
        writes: [],
      });
    }

    const jobId = randomUUID();
    const active = ensureWorker();

    return new Promise<ScriptRunOutput>((resolve) => {
      let settled = false;
      let hardTimer: NodeJS.Timeout | null = null;

      const cleanup = (): void => {
        if (hardTimer) clearTimeout(hardTimer);
        active.off('message', onMessage);
        active.off('error', onError);
        active.off('exit', onExit);
        input.signal?.removeEventListener('abort', onAbort);
      };

      const finish = (outcome: ApiScriptOutcome, writes: ScriptRunOutput['writes']): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ outcome: { ...outcome, durationMs: Date.now() - startedAt }, writes });
      };

      const fail = (
        errorCode: 'API_SCRIPT_FAILED' | 'API_SCRIPT_LIMIT_EXCEEDED' | 'API_CANCELLED',
        message: string
      ): void => {
        finish(emptyOutcome(input, { ran: true, ok: false, errorCode, errorMessage: message }), []);
      };

      const onMessage = (raw: ScriptWorkerMessage): void => {
        if (raw.type === 'fatal') {
          if (raw.jobId && raw.jobId !== jobId) return;
          retireWorker();
          fail('API_SCRIPT_FAILED', raw.message);
          return;
        }
        if (raw.jobId !== jobId) return;
        const result: ScriptWorkerResult = raw;
        const outcome: ApiScriptOutcome = {
          phase: input.phase,
          holder: input.holder,
          ran: true,
          ok: result.ok,
          durationMs: 0,
          console: result.console.map((entry) => ({ ...entry, text: redact(entry.text) })),
          consoleDropped: result.consoleDropped,
          tests: result.tests.map((test) => ({
            name: redact(test.name),
            passed: test.passed,
            message: test.message === undefined ? undefined : redact(test.message),
          })),
          variableWrites: result.writes.map((write) => write.name),
        };
        if (result.error) {
          outcome.ok = false;
          outcome.errorCode =
            result.error.kind === 'limit' ? 'API_SCRIPT_LIMIT_EXCEEDED' : 'API_SCRIPT_FAILED';
          outcome.errorMessage = redact(result.error.message);
          outcome.errorLine = result.error.line;
          // A protocol fault means the worker misbehaved, not the script.
          if (result.error.kind === 'protocol') retireWorker();
        }
        // A failed script's variable writes are discarded: a half-run script must not leave a
        // partial variable state behind for the request that follows it.
        finish(outcome, outcome.ok ? result.writes : []);
      };

      const onError = (error: Error): void => {
        retireWorker();
        fail('API_SCRIPT_FAILED', `The script sandbox failed: ${error.message}`);
      };

      const onExit = (code: number): void => {
        retireWorker();
        fail('API_SCRIPT_FAILED', `The script sandbox stopped unexpectedly (exit ${code}).`);
      };

      const onAbort = (): void => {
        // The guest is mid-evaluation and cannot be asked to stop, so the worker goes.
        retireWorker();
        fail('API_CANCELLED', 'The script was cancelled.');
      };

      active.on('message', onMessage);
      active.on('error', onError);
      active.on('exit', onExit);
      input.signal?.addEventListener('abort', onAbort, { once: true });

      // The backstop for a worker that never answers — including one wedged inside wasm.
      hardTimer = setTimeout(() => {
        retireWorker();
        fail(
          'API_SCRIPT_LIMIT_EXCEEDED',
          `The script exceeded its ${limits.deadlineMs} ms deadline and was terminated.`
        );
      }, limits.hardDeadlineMs);
      hardTimer.unref();

      active.postMessage({
        type: 'run',
        jobId,
        phase: input.phase,
        source: input.source,
        limits,
        context: input.context,
      });
    });
  }

  function run(input: ScriptRunInput): Promise<ScriptRunOutput> {
    if (disposed) {
      return Promise.resolve({
        outcome: emptyOutcome(input, {
          ok: false,
          errorCode: 'API_CANCELLED',
          errorMessage: 'Bureau is shutting down.',
        }),
        writes: [],
      });
    }
    const job = queue.then(() => execute(input));
    // Keep the chain alive even if a job rejects, so one failure cannot wedge the queue.
    queue = job.then(
      () => undefined,
      () => undefined
    );
    return job;
  }

  return {
    run,

    async validate(source, phase) {
      if (source.length > MAX_SCRIPT_SOURCE_BYTES) {
        return { ok: false, message: 'The script is larger than the sandbox allows.' };
      }
      if (source.trim().length === 0) return { ok: true };
      // Validation runs the source in a guest with no context and every side effect inert: the
      // point is to surface a syntax error, and `bureau` is present so a reference to it parses.
      const result = await run({
        phase,
        holder: { kind: 'request', id: '', name: 'validation' },
        source: `(function(){\n${source}\n})`,
        context: {
          request: { name: '', protocol: 'http', method: 'GET', url: '', headers: [] },
          variables: {},
          secretNames: [],
        },
        secretValues: [],
      });
      if (result.outcome.ok) return { ok: true };
      return {
        ok: false,
        message: result.outcome.errorMessage ?? 'The script could not be parsed.',
        // The wrapper adds one line before the user's source.
        line: result.outcome.errorLine === undefined ? undefined : result.outcome.errorLine - 1,
      };
    },

    dispose() {
      disposed = true;
      retireWorker();
    },
  };
}
