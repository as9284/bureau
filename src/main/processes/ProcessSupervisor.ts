import path from 'node:path';
import { access } from 'node:fs/promises';
import type { ChildProcess } from 'node:child_process';
import type {
  LogLine,
  LogSnapshot,
  ProcessOutputEvent,
  ProcessRuntime,
  ProcessStatusEvent,
} from '@shared/contracts/processes';
import type { ProcessDefinition } from '@shared/contracts/projects';
import { toBureauError } from '../ipc/errors';
import { resolveExecutable } from '../system/executableResolver';
import { createLineAssembler, createLogRingBuffer, type LogRingBuffer } from './LogRingBuffer';
import { spawnManaged } from './spawnProcess';
import { stopProcessTree, killPidTree } from './treeKill';
import { detectLocalUrl } from './urlDetection';
import { createMetricsSampler, patchRuntimeMetrics } from './processMetrics';
import { isPidAlive, type OrphanRecord, type OrphanStore } from './orphanState';
import { spawnPty, type PtySession } from './PtyBridge';

const FLUSH_INTERVAL_MS = 60;
const MAX_CONSECUTIVE_CRASHES = 5;
const RESTART_BACKOFF_MS = 1000;
const RUNNING_STABLE_MS = 8000;

export type PtyOutputEvent = {
  projectId: string;
  processId: string;
  data: string;
};

export type SupervisorEvent =
  | { type: 'output'; event: ProcessOutputEvent }
  | { type: 'status'; event: ProcessStatusEvent }
  | { type: 'pty'; event: PtyOutputEvent };

export type StartInput = {
  projectId: string;
  projectRoot: string;
  definition: ProcessDefinition;
};

export type ResolveEnvInput = {
  projectRoot: string;
  definition: ProcessDefinition;
  overrides: Record<string, string>;
};

export type EnvResolver = (input: ResolveEnvInput) => Promise<NodeJS.ProcessEnv>;

export type ProcessSupervisorOptions = {
  resolveEnv?: EnvResolver;
  orphanStore?: OrphanStore;
};

export type ProcessSupervisor = {
  start(input: StartInput): Promise<void>;
  stop(projectId: string, processId: string): Promise<void>;
  restart(input: StartInput): Promise<void>;
  stopAllForProject(projectId: string): Promise<void>;
  stopAll(): Promise<void>;
  getLog(projectId: string, processId: string): LogSnapshot;
  listRuntimes(projectId: string): ProcessRuntime[];
  listRunning(): Array<{ projectId: string; processId: string; label: string }>;
  listRunningPids(): number[];
  runningCount(): number;
  writePty(projectId: string, processId: string, data: string): void;
  resizePty(projectId: string, processId: string, cols: number, rows: number): void;
  adoptOrphans(): Promise<OrphanRecord[]>;
  persistRunningSnapshot(): Promise<void>;
  onEvent(listener: (event: SupervisorEvent) => void): () => void;
};

type Instance = {
  projectId: string;
  processId: string;
  projectRoot: string;
  definition: ProcessDefinition;
  child?: ChildProcess;
  pty?: PtySession;
  buffer: LogRingBuffer;
  runtime: ProcessRuntime;
  stopping: boolean;
  consecutiveCrashes: number;
  pendingLines: LogLine[];
  flushTimer?: NodeJS.Timeout;
  restartTimer?: NodeJS.Timeout;
  stableTimer?: NodeJS.Timeout;
  exitCode?: number;
};

function key(projectId: string, processId: string): string {
  return `${projectId}:${processId}`;
}

export function createDefaultEnvResolver(): EnvResolver {
  return async ({ overrides }) => buildBaseEnv(overrides);
}

export function createProcessSupervisor(options: ProcessSupervisorOptions = {}): ProcessSupervisor {
  const resolveEnv = options.resolveEnv ?? createDefaultEnvResolver();
  const orphanStore = options.orphanStore;
  const instances = new Map<string, Instance>();
  const listeners = new Set<(event: SupervisorEvent) => void>();

  const metrics = createMetricsSampler({
    listPids: () =>
      [...instances.values()]
        .filter((i) => i.runtime.pid && isTrackedLive(i))
        .map((i) => ({
          pid: i.runtime.pid as number,
          apply: (sample) => {
            // Orphan may have died since last tick — reconcile.
            if (i.runtime.pid && !i.child && !i.pty && !isPidAlive(i.runtime.pid)) {
              markOrphanExited(i);
              return;
            }
            i.runtime = patchRuntimeMetrics(i.runtime, sample);
            emit({ type: 'status', event: { runtime: i.runtime } });
          },
        })),
  });
  metrics.start();

  function isTrackedLive(instance: Instance): boolean {
    if (instance.child || instance.pty) return true;
    return (
      Boolean(instance.runtime.pid) &&
      (instance.runtime.status === 'running' || instance.runtime.status === 'starting')
    );
  }

  function markOrphanExited(instance: Instance): void {
    if (instance.runtime.status === 'exited' || instance.runtime.status === 'crashed') return;
    pushLine(instance, 'system', `Orphan PID ${instance.runtime.pid} is no longer running.`);
    setStatus(instance, {
      status: 'exited',
      pid: undefined,
      exitedAt: new Date().toISOString(),
      ready: false,
      detectedUrl: undefined,
      cpu: undefined,
      memoryBytes: undefined,
    });
    void persistRunningSnapshot();
  }

  function emit(event: SupervisorEvent): void {
    for (const listener of listeners) listener(event);
  }

  function ensureInstance(input: StartInput): Instance {
    const k = key(input.projectId, input.definition.id);
    let instance = instances.get(k);
    if (!instance) {
      instance = {
        projectId: input.projectId,
        processId: input.definition.id,
        projectRoot: input.projectRoot,
        definition: input.definition,
        buffer: createLogRingBuffer(),
        runtime: {
          projectId: input.projectId,
          processId: input.definition.id,
          status: 'idle',
          restartCount: 0,
          ready: false,
        },
        stopping: false,
        consecutiveCrashes: 0,
        pendingLines: [],
      };
      instances.set(k, instance);
    } else {
      instance.projectRoot = input.projectRoot;
      instance.definition = input.definition;
    }
    return instance;
  }

  function setStatus(instance: Instance, patch: Partial<ProcessRuntime>): void {
    instance.runtime = { ...instance.runtime, ...patch };
    emit({ type: 'status', event: { runtime: instance.runtime } });
  }

  function scheduleFlush(instance: Instance): void {
    if (instance.flushTimer) return;
    instance.flushTimer = setTimeout(() => {
      instance.flushTimer = undefined;
      if (instance.pendingLines.length === 0) return;
      const lines = instance.pendingLines;
      instance.pendingLines = [];
      emit({
        type: 'output',
        event: { projectId: instance.projectId, processId: instance.processId, lines },
      });
    }, FLUSH_INTERVAL_MS);
  }

  function pushLine(instance: Instance, stream: LogLine['stream'], text: string): void {
    const line = instance.buffer.push(stream, text);
    instance.pendingLines.push(line);
    scheduleFlush(instance);

    if (!instance.runtime.detectedUrl && stream !== 'system') {
      const url = detectLocalUrl(text);
      if (url) setStatus(instance, { detectedUrl: url, ready: true });
    }
  }

  function wireStreams(instance: Instance, child: ChildProcess): void {
    const stdoutAsm = createLineAssembler();
    const stderrAsm = createLineAssembler();

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      for (const line of stdoutAsm.feed(chunk)) pushLine(instance, 'stdout', line);
    });
    child.stderr?.on('data', (chunk: string) => {
      for (const line of stderrAsm.feed(chunk)) pushLine(instance, 'stderr', line);
    });

    child.on('exit', (code) => {
      instance.exitCode = code ?? undefined;
    });

    child.on('error', (error) => {
      pushLine(instance, 'system', `Process error: ${error.message}`);
    });

    child.on('close', () => {
      for (const line of stdoutAsm.flush()) pushLine(instance, 'stdout', line);
      for (const line of stderrAsm.flush()) pushLine(instance, 'stderr', line);
      handleExit(instance);
    });
  }

  function clearTimers(instance: Instance): void {
    if (instance.stableTimer) {
      clearTimeout(instance.stableTimer);
      instance.stableTimer = undefined;
    }
  }

  function handleExit(instance: Instance): void {
    clearTimers(instance);
    const code = instance.exitCode;
    const wasStopping = instance.stopping;
    instance.child = undefined;
    instance.pty = undefined;
    instance.stopping = false;
    void persistRunningSnapshot();

    const status = wasStopping || code === 0 || code === undefined ? 'exited' : 'crashed';
    if (status === 'crashed') {
      instance.consecutiveCrashes += 1;
      pushLine(instance, 'system', `Process exited with code ${code}.`);
    } else {
      pushLine(instance, 'system', 'Process stopped.');
    }
    setStatus(instance, {
      status,
      pid: undefined,
      exitedAt: new Date().toISOString(),
      exitCode: code,
      ready: false,
      detectedUrl: undefined,
      cpu: undefined,
      memoryBytes: undefined,
    });

    if (
      status === 'crashed' &&
      instance.definition.autoRestart &&
      instance.consecutiveCrashes < MAX_CONSECUTIVE_CRASHES
    ) {
      pushLine(instance, 'system', `Auto-restarting in ${RESTART_BACKOFF_MS}ms…`);
      instance.restartTimer = setTimeout(() => {
        instance.restartTimer = undefined;
        void launch(instance).catch(() => undefined);
      }, RESTART_BACKOFF_MS);
    } else if (status === 'crashed' && instance.definition.autoRestart) {
      pushLine(
        instance,
        'system',
        `Auto-restart stopped after ${MAX_CONSECUTIVE_CRASHES} crashes.`
      );
    }
  }

  async function launch(instance: Instance): Promise<void> {
    const { definition, projectRoot } = instance;

    const cwd = path.resolve(projectRoot, definition.cwd || '.');
    const normalizedRoot = path.resolve(projectRoot);
    if (cwd !== normalizedRoot && !cwd.startsWith(normalizedRoot + path.sep)) {
      throw toBureauError({
        code: 'INVALID_REQUEST',
        message: 'Process working directory must be inside the project.',
        operation: 'processes.start',
      });
    }
    if (!(await pathExists(cwd))) {
      throw toBureauError({
        code: 'CWD_NOT_FOUND',
        message: `Working directory does not exist: ${cwd}`,
        operation: 'processes.start',
      });
    }

    const env = await resolveEnv({
      projectRoot,
      definition,
      overrides: definition.env,
    });
    const executable = await resolveExecutable(definition.command, env);
    if (!executable) {
      throw toBureauError({
        code: 'EXECUTABLE_NOT_FOUND',
        message: `Could not find "${definition.command}" on PATH.`,
        operation: 'processes.start',
        retryable: false,
      });
    }

    setStatus(instance, {
      status: 'starting',
      startedAt: new Date().toISOString(),
      exitCode: undefined,
    });
    pushLine(instance, 'system', `$ ${definition.command} ${definition.args.join(' ')}`);

    if (definition.runMode === 'terminal') {
      try {
        const session = spawnPty(executable, definition.args, {
          cwd,
          env,
          onData: (data) => {
            emit({
              type: 'pty',
              event: { projectId: instance.projectId, processId: instance.processId, data },
            });
            const url = detectLocalUrl(data);
            if (url && !instance.runtime.detectedUrl) {
              setStatus(instance, { detectedUrl: url, ready: true });
            }
          },
          onExit: (code) => {
            instance.exitCode = code;
            handleExit(instance);
          },
        });
        instance.pty = session;
        setStatus(instance, { status: 'running', pid: session.pid });
        void persistRunningSnapshot();
        instance.stableTimer = setTimeout(() => {
          instance.consecutiveCrashes = 0;
        }, RUNNING_STABLE_MS);
        return;
      } catch (error) {
        pushLine(
          instance,
          'system',
          `Terminal mode unavailable (${error instanceof Error ? error.message : 'pty error'}); falling back to log mode.`
        );
      }
    }

    let child: ChildProcess;
    try {
      child = spawnManaged(executable, definition.args, { cwd, env });
    } catch (error) {
      setStatus(instance, { status: 'crashed' });
      throw toBureauError({
        code: 'SPAWN_FAILED',
        message: error instanceof Error ? error.message : 'Failed to start process.',
        operation: 'processes.start',
      });
    }

    instance.child = child;
    setStatus(instance, { status: 'running', pid: child.pid });
    wireStreams(instance, child);
    void persistRunningSnapshot();

    instance.stableTimer = setTimeout(() => {
      instance.consecutiveCrashes = 0;
    }, RUNNING_STABLE_MS);
  }

  async function start(input: StartInput): Promise<void> {
    const instance = ensureInstance(input);
    if (instance.child || instance.pty) {
      throw toBureauError({
        code: 'PROCESS_ALREADY_RUNNING',
        message: 'This process is already running.',
        operation: 'processes.start',
      });
    }
    instance.consecutiveCrashes = 0;
    setStatus(instance, { restartCount: instance.runtime.restartCount });
    await launch(instance);
  }

  async function stop(projectId: string, processId: string): Promise<void> {
    const instance = instances.get(key(projectId, processId));
    if (!instance) return;
    if (instance.restartTimer) {
      clearTimeout(instance.restartTimer);
      instance.restartTimer = undefined;
    }
    if (instance.pty) {
      instance.stopping = true;
      instance.pty.kill();
      return;
    }
    if (instance.child) {
      instance.stopping = true;
      await stopProcessTree(instance.child);
      return;
    }
    // Adopted orphan: no ChildProcess handle — kill by recorded PID.
    const pid = instance.runtime.pid;
    if (pid) {
      instance.stopping = true;
      pushLine(instance, 'system', `Stopping orphan PID ${pid}…`);
      try {
        await killPidTree(pid);
      } catch (error) {
        pushLine(
          instance,
          'system',
          `Failed to kill orphan PID ${pid}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      setStatus(instance, {
        status: 'exited',
        pid: undefined,
        exitedAt: new Date().toISOString(),
        ready: false,
        detectedUrl: undefined,
        cpu: undefined,
        memoryBytes: undefined,
      });
      pushLine(instance, 'system', 'Process stopped.');
      void persistRunningSnapshot();
    }
  }

  async function restart(input: StartInput): Promise<void> {
    const instance = ensureInstance(input);
    await stop(input.projectId, input.definition.id);
    instance.runtime.restartCount += 1;
    await start(input);
  }

  async function stopAllForProject(projectId: string): Promise<void> {
    const targets = [...instances.values()].filter(
      (i) => i.projectId === projectId && isTrackedLive(i)
    );
    await Promise.all(targets.map((i) => stop(i.projectId, i.processId)));
  }

  async function stopAll(): Promise<void> {
    const targets = [...instances.values()].filter((i) => isTrackedLive(i));
    await Promise.all(targets.map((i) => stop(i.projectId, i.processId)));
  }

  function getLog(projectId: string, processId: string): LogSnapshot {
    const instance = instances.get(key(projectId, processId));
    const snapshot = instance?.buffer.snapshot() ?? { lines: [], truncated: false };
    return { projectId, processId, lines: snapshot.lines, truncated: snapshot.truncated };
  }

  function listRuntimes(projectId: string): ProcessRuntime[] {
    return [...instances.values()].filter((i) => i.projectId === projectId).map((i) => i.runtime);
  }

  function listRunning(): Array<{ projectId: string; processId: string; label: string }> {
    return [...instances.values()]
      .filter((i) => isTrackedLive(i))
      .map((i) => ({
        projectId: i.projectId,
        processId: i.processId,
        label: i.definition.label,
      }));
  }

  function listRunningPids(): number[] {
    return [...instances.values()]
      .filter((i) => isTrackedLive(i))
      .map((i) => i.runtime.pid)
      .filter((pid): pid is number => typeof pid === 'number');
  }

  function runningCount(): number {
    return [...instances.values()].filter((i) => isTrackedLive(i)).length;
  }

  function writePty(projectId: string, processId: string, data: string): void {
    instances.get(key(projectId, processId))?.pty?.write(data);
  }

  function resizePty(projectId: string, processId: string, cols: number, rows: number): void {
    instances.get(key(projectId, processId))?.pty?.resize(cols, rows);
  }

  async function persistRunningSnapshot(): Promise<void> {
    if (!orphanStore) return;
    const records: OrphanRecord[] = [...instances.values()]
      .filter((i) => i.runtime.pid && isTrackedLive(i))
      .map((i) => ({
        projectId: i.projectId,
        processId: i.processId,
        projectRoot: i.projectRoot,
        label: i.definition.label,
        pid: i.runtime.pid as number,
        command: `${i.definition.command} ${i.definition.args.join(' ')}`.trim(),
        cwd: path.resolve(i.projectRoot, i.definition.cwd || '.'),
        detectedUrl: i.runtime.detectedUrl,
        recordedAt: new Date().toISOString(),
      }));
    await orphanStore.replace(records).catch(() => undefined);
  }

  async function adoptOrphans(): Promise<OrphanRecord[]> {
    if (!orphanStore) return [];
    const previous = orphanStore.list();
    const alive = previous.filter((r) => isPidAlive(r.pid));
    await orphanStore.clear().catch(() => undefined);
    for (const record of alive) {
      const k = key(record.projectId, record.processId);
      let instance = instances.get(k);
      if (!instance) {
        instance = {
          projectId: record.projectId,
          processId: record.processId,
          projectRoot: record.projectRoot || path.dirname(record.cwd),
          definition: {
            id: record.processId,
            label: record.label,
            command: record.command.split(/\s+/)[0] ?? 'unknown',
            args: record.command.split(/\s+/).slice(1),
            cwd: '.',
            env: {},
            runMode: 'log',
            autoRestart: false,
            runOnOpen: false,
          },
          buffer: createLogRingBuffer(),
          runtime: {
            projectId: record.projectId,
            processId: record.processId,
            status: 'running',
            pid: record.pid,
            restartCount: 0,
            ready: Boolean(record.detectedUrl),
            detectedUrl: record.detectedUrl,
            startedAt: record.recordedAt,
          },
          stopping: false,
          consecutiveCrashes: 0,
          pendingLines: [],
        };
        instances.set(k, instance);
        pushLine(
          instance,
          'system',
          `Adopted orphan process PID ${record.pid} from previous session. Stop will kill it.`
        );
        emit({ type: 'status', event: { runtime: instance.runtime } });
      }
    }
    return alive;
  }

  function onEvent(listener: (event: SupervisorEvent) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    start,
    stop,
    restart,
    stopAllForProject,
    stopAll,
    getLog,
    listRuntimes,
    listRunning,
    listRunningPids,
    runningCount,
    writePty,
    resizePty,
    adoptOrphans,
    persistRunningSnapshot,
    onEvent,
  };
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function buildBaseEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) base[k] = v;
  }
  return { ...base, ...overrides };
}
