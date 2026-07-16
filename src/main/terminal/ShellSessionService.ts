import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { access } from 'node:fs/promises';
import { spawnPty as defaultSpawnPty, isPtyAvailable, type PtySession } from '../processes/PtyBridge';
import { killPidTree } from '../processes/treeKill';
import { toBureauError } from '../ipc/errors';
import { createTerminalOutputBuffer, type TerminalOutputBuffer } from './TerminalOutputBuffer';
import type { ShellRegistry } from './ShellRegistry';
import type { TrackedProject } from '@shared/contracts/projects';
import type { OkResult, Result } from '@shared/contracts/errors';
import type {
  CreateTerminalSessionRequest,
  RenameTerminalSessionRequest,
  ResizeTerminalRequest,
  ShellId,
  TerminalBuffer,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalSession,
  TerminalSessionRequest,
  TerminalSnapshot,
  WriteTerminalRequest,
} from '@shared/contracts/terminal';

/** Bounds memory: each live session holds a pty plus a replay buffer. */
const MAX_SESSIONS_PER_PROJECT = 8;

const MAX_TITLE_LENGTH = 60;

export type ShellSessionEvent =
  | { type: 'data'; event: TerminalDataEvent }
  | { type: 'exit'; event: TerminalExitEvent };

export type ShellSessionServiceDeps = {
  catalogue: { get(projectId: string): TrackedProject | undefined };
  shells: ShellRegistry;
  /** Reuses the toolchain env resolver so a shell sees the project's pinned runtimes. */
  resolveEnv(input: { projectId: string; projectRoot: string }): Promise<NodeJS.ProcessEnv>;
  /** Read per-create so a settings change applies without a restart. */
  getDefaultShellId(): ShellId | undefined;
  maxSessionsPerProject?: number;
  /** Injectable for tests. */
  spawnPty?: typeof defaultSpawnPty;
  isPtyAvailable?(): boolean;
  /**
   * Injectable for tests: the real one shells out to `taskkill`/`kill` by pid, which a
   * test using a fake pty must never do — the pid would belong to some real process.
   */
  killTree?: (pid: number) => Promise<void>;
};

export type ShellSessionService = {
  list(input: { projectId: string }): Promise<TerminalSnapshot>;
  create(input: CreateTerminalSessionRequest): Promise<Result<{ session: TerminalSession }>>;
  close(input: TerminalSessionRequest): Promise<OkResult>;
  rename(input: RenameTerminalSessionRequest): Promise<Result<{ session: TerminalSession }>>;
  write(input: WriteTerminalRequest): Promise<void>;
  resize(input: ResizeTerminalRequest): Promise<void>;
  getBuffer(input: TerminalSessionRequest): Promise<TerminalBuffer>;
  /** Close every session for a project (project removed). */
  closeProject(projectId: string): Promise<void>;
  /** Close everything (app quit). */
  dispose(): Promise<void>;
  onEvent(listener: (event: ShellSessionEvent) => void): () => void;
};

type Instance = {
  session: TerminalSession;
  pty?: PtySession;
  buffer: TerminalOutputBuffer;
};

export function createShellSessionService(deps: ShellSessionServiceDeps): ShellSessionService {
  const spawn = deps.spawnPty ?? defaultSpawnPty;
  const ptyAvailable = deps.isPtyAvailable ?? isPtyAvailable;
  const killTree = deps.killTree ?? killPidTree;
  const maxSessions = deps.maxSessionsPerProject ?? MAX_SESSIONS_PER_PROJECT;

  const instances = new Map<string, Instance>();
  const listeners = new Set<(event: ShellSessionEvent) => void>();

  const key = (projectId: string, sessionId: string): string => `${projectId}:${sessionId}`;

  function emit(event: ShellSessionEvent): void {
    for (const listener of listeners) listener(event);
  }

  function forProject(projectId: string): Instance[] {
    return [...instances.values()].filter((i) => i.session.projectId === projectId);
  }

  function fail(
    code: Parameters<typeof toBureauError>[0]['code'],
    message: string,
    operation: string,
    subjectId?: string
  ): { ok: false; error: ReturnType<typeof toBureauError> } {
    return {
      ok: false,
      error: toBureauError({ code, message, operation, subjectId, retryable: false }),
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

  /**
   * The renderer never sends a path — it sends an optional project-relative nested root,
   * which must be one the detector actually found. That makes the cwd an allow-list choice
   * rather than attacker-controlled input; the containment check below is defence in depth.
   */
  function resolveCwd(
    project: TrackedProject,
    rootRelative: string | undefined
  ): { ok: true; cwd: string; label: string } | { ok: false; message: string } {
    if (!rootRelative || rootRelative === '.') {
      return { ok: true, cwd: path.resolve(project.path), label: '.' };
    }
    if (!(project.nestedRoots ?? []).includes(rootRelative)) {
      return { ok: false, message: 'Unknown project root.' };
    }
    const root = path.resolve(project.path);
    const cwd = path.resolve(root, rootRelative);
    if (cwd !== root && !cwd.startsWith(root + path.sep)) {
      return { ok: false, message: 'Working directory must be inside the project.' };
    }
    return { ok: true, cwd, label: rootRelative };
  }

  async function list({ projectId }: { projectId: string }): Promise<TerminalSnapshot> {
    const shells = await deps.shells.list();
    return {
      projectId,
      sessions: forProject(projectId).map((i) => ({ ...i.session })),
      shells: shells.map(({ id, label, executable }) => ({ id, label, executable })),
      ptyAvailable: ptyAvailable(),
    };
  }

  async function create(
    input: CreateTerminalSessionRequest
  ): Promise<Result<{ session: TerminalSession }>> {
    const operation = 'terminal.create';
    const project = deps.catalogue.get(input.projectId);
    if (!project) {
      return fail('PROJECT_NOT_FOUND', 'Project not found.', operation, input.projectId);
    }
    if (!ptyAvailable()) {
      return fail(
        'CAPABILITY_MISSING',
        'The embedded terminal is unavailable because node-pty could not be loaded for this build.',
        operation
      );
    }
    if (forProject(input.projectId).length >= maxSessions) {
      return fail(
        'INVALID_REQUEST',
        `Close a session first — ${maxSessions} is the maximum per project.`,
        operation
      );
    }

    const shell = await deps.shells.resolveDefault(input.shellId ?? deps.getDefaultShellId());
    if (!shell || (input.shellId && shell.id !== input.shellId)) {
      return fail(
        'EXECUTABLE_NOT_FOUND',
        input.shellId
          ? `${input.shellId} is not installed on this machine.`
          : 'No supported shell was found on this machine.',
        operation
      );
    }

    const resolved = resolveCwd(project, input.rootRelative);
    if (!resolved.ok) return fail('INVALID_REQUEST', resolved.message, operation);
    if (!(await pathExists(resolved.cwd))) {
      return fail('CWD_NOT_FOUND', `Working directory does not exist: ${resolved.cwd}`, operation);
    }

    const env = await deps.resolveEnv({
      projectId: input.projectId,
      projectRoot: project.path,
    });

    const sessionId = randomUUID();
    const session: TerminalSession = {
      sessionId,
      projectId: input.projectId,
      shellId: shell.id,
      title: shell.label,
      cwdLabel: resolved.label,
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    const instance: Instance = { session, buffer: createTerminalOutputBuffer() };

    let pty: PtySession;
    try {
      pty = spawn(shell.executable, shell.args, {
        cwd: resolved.cwd,
        env,
        onData: (data) => {
          const seq = instance.buffer.push(data);
          emit({ type: 'data', event: { projectId: input.projectId, sessionId, data, seq } });
        },
        onExit: (exitCode) => {
          instance.session.status = 'exited';
          instance.session.exitCode = exitCode;
          instance.pty = undefined;
          emit({ type: 'exit', event: { projectId: input.projectId, sessionId, exitCode } });
        },
      });
    } catch (error) {
      return fail(
        'SPAWN_FAILED',
        error instanceof Error ? error.message : 'Failed to start the shell.',
        operation
      );
    }

    instance.pty = pty;
    session.pid = pty.pid;
    instances.set(key(input.projectId, sessionId), instance);
    return { ok: true, session: { ...session } };
  }

  /**
   * A shell's children are the point of it (a dev server, a watch), and `pty.kill()` only
   * signals the shell itself — on Windows ConPTY that routinely leaves the descendants
   * running with no owner. Go through the same tree-kill the supervisor uses, then drop
   * the pty handle.
   */
  async function terminate(instance: Instance): Promise<void> {
    const pid = instance.session.pid;
    if (instance.session.status === 'running' && pid !== undefined) {
      await killTree(pid).catch(() => undefined);
    }
    try {
      instance.pty?.kill();
    } catch {
      // Already gone.
    }
    instance.pty = undefined;
  }

  async function close(input: TerminalSessionRequest): Promise<OkResult> {
    const instance = instances.get(key(input.projectId, input.sessionId));
    if (!instance) {
      return fail(
        'PROCESS_NOT_FOUND',
        'Terminal session not found.',
        'terminal.close',
        input.sessionId
      );
    }
    await terminate(instance);
    instances.delete(key(input.projectId, input.sessionId));
    return { ok: true };
  }

  async function rename(
    input: RenameTerminalSessionRequest
  ): Promise<Result<{ session: TerminalSession }>> {
    const instance = instances.get(key(input.projectId, input.sessionId));
    if (!instance) {
      return fail(
        'PROCESS_NOT_FOUND',
        'Terminal session not found.',
        'terminal.rename',
        input.sessionId
      );
    }
    const title = input.title.trim().slice(0, MAX_TITLE_LENGTH);
    if (!title) {
      return fail('INVALID_REQUEST', 'A session name cannot be empty.', 'terminal.rename');
    }
    instance.session.title = title;
    return { ok: true, session: { ...instance.session } };
  }

  async function write(input: WriteTerminalRequest): Promise<void> {
    instances.get(key(input.projectId, input.sessionId))?.pty?.write(input.data);
  }

  async function resize(input: ResizeTerminalRequest): Promise<void> {
    instances.get(key(input.projectId, input.sessionId))?.pty?.resize(input.cols, input.rows);
  }

  async function getBuffer(input: TerminalSessionRequest): Promise<TerminalBuffer> {
    const instance = instances.get(key(input.projectId, input.sessionId));
    const snapshot = instance?.buffer.snapshot() ?? { data: '', seq: 0, truncated: false };
    return { sessionId: input.sessionId, ...snapshot };
  }

  async function closeAll(targets: Instance[]): Promise<void> {
    await Promise.all(
      targets.map(async (instance) => {
        await terminate(instance);
        instances.delete(key(instance.session.projectId, instance.session.sessionId));
      })
    );
  }

  return {
    list,
    create,
    close,
    rename,
    write,
    resize,
    getBuffer,
    closeProject: (projectId) => closeAll(forProject(projectId)),
    dispose: () => closeAll([...instances.values()]),
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
