import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createShellSessionService } from '@main/terminal/ShellSessionService';
import type { ShellSessionEvent } from '@main/terminal/ShellSessionService';
import type { ResolvedShell, ShellRegistry } from '@main/terminal/ShellRegistry';
import type { PtySession, PtySpawnOptions } from '@main/processes/PtyBridge';
import type { TrackedProject } from '@shared/contracts/projects';

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';

const POWERSHELL: ResolvedShell = {
  id: 'powershell',
  label: 'Windows PowerShell',
  executable: 'C:\\powershell.exe',
  args: ['-NoLogo'],
};
const GIT_BASH: ResolvedShell = {
  id: 'git-bash',
  label: 'Git Bash',
  executable: 'C:\\Git\\bin\\bash.exe',
  args: ['--login', '-i'],
};

function fakeRegistry(shells: ResolvedShell[]): ShellRegistry {
  return {
    list: async () => shells,
    get: async (id) => shells.find((shell) => shell.id === id),
    resolveDefault: async (preferred) =>
      (preferred && shells.find((shell) => shell.id === preferred)) ?? shells[0],
  };
}

/** Records spawns and lets a test drive the pty's data/exit callbacks. */
function fakeSpawner() {
  const spawns: Array<{
    executable: string;
    args: string[];
    options: PtySpawnOptions;
    killed: boolean;
    written: string[];
    resized: Array<[number, number]>;
  }> = [];
  let nextPid = 4000;

  const spawnPty = (
    executable: string,
    args: string[],
    options: PtySpawnOptions
  ): PtySession => {
    const record = {
      executable,
      args,
      options,
      killed: false,
      written: [] as string[],
      resized: [] as Array<[number, number]>,
    };
    spawns.push(record);
    const pid = nextPid++;
    return {
      pid,
      write: (data) => record.written.push(data),
      resize: (cols, rows) => record.resized.push([cols, rows]),
      kill: () => {
        record.killed = true;
      },
    };
  };

  return { spawns, spawnPty };
}

let root: string;
let project: TrackedProject;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'bureau-shell-'));
  project = {
    projectId: PROJECT_ID,
    name: 'demo',
    path: root,
    canonicalPath: root.toLowerCase(),
    stack: ['node'],
    addedAt: new Date('2026-07-01').toISOString(),
    nestedRoots: ['packages/api'],
  };
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function makeService(
  overrides: {
    shells?: ResolvedShell[];
    defaultShellId?: ResolvedShell['id'];
    ptyAvailable?: boolean;
    maxSessionsPerProject?: number;
    spawner?: ReturnType<typeof fakeSpawner>;
    projectExists?: boolean;
  } = {}
) {
  const spawner = overrides.spawner ?? fakeSpawner();
  const events: ShellSessionEvent[] = [];
  // These pids are invented, so the real tree-kill must not run here — it would shell out
  // to taskkill against whatever real process happens to own that pid.
  const killedTrees: number[] = [];
  const service = createShellSessionService({
    catalogue: { get: () => (overrides.projectExists === false ? undefined : project) },
    shells: fakeRegistry(overrides.shells ?? [POWERSHELL, GIT_BASH]),
    resolveEnv: async () => ({ PATH: '/pinned/toolchain/bin' }),
    getDefaultShellId: () => overrides.defaultShellId,
    maxSessionsPerProject: overrides.maxSessionsPerProject,
    spawnPty: spawner.spawnPty,
    isPtyAvailable: () => overrides.ptyAvailable ?? true,
    killTree: async (pid) => {
      killedTrees.push(pid);
    },
  });
  service.onEvent((event) => events.push(event));
  return { service, spawner, events, killedTrees };
}

describe('ShellSessionService', () => {
  it('spawns the first detected shell at the project root with the toolchain env', async () => {
    const { service, spawner } = makeService();

    const result = await service.create({ projectId: PROJECT_ID });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.shellId).toBe('powershell');
    expect(result.session.title).toBe('Windows PowerShell');
    expect(result.session.cwdLabel).toBe('.');
    expect(result.session.status).toBe('running');
    expect(spawner.spawns).toHaveLength(1);
    expect(spawner.spawns[0].executable).toBe(POWERSHELL.executable);
    expect(spawner.spawns[0].args).toEqual(['-NoLogo']);
    expect(spawner.spawns[0].options.cwd).toBe(path.resolve(root));
    expect(spawner.spawns[0].options.env.PATH).toBe('/pinned/toolchain/bin');
  });

  it('honours the configured default shell', async () => {
    const { service, spawner } = makeService({ defaultShellId: 'git-bash' });

    await service.create({ projectId: PROJECT_ID });

    expect(spawner.spawns[0].executable).toBe(GIT_BASH.executable);
    expect(spawner.spawns[0].args).toEqual(['--login', '-i']);
  });

  it('lets an explicit request override the default shell', async () => {
    const { service, spawner } = makeService({ defaultShellId: 'git-bash' });

    await service.create({ projectId: PROJECT_ID, shellId: 'powershell' });

    expect(spawner.spawns[0].executable).toBe(POWERSHELL.executable);
  });

  it('fails rather than silently substituting when the requested shell is absent', async () => {
    const { service, spawner } = makeService({ shells: [POWERSHELL] });

    const result = await service.create({ projectId: PROJECT_ID, shellId: 'git-bash' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EXECUTABLE_NOT_FOUND');
    expect(spawner.spawns).toHaveLength(0);
  });

  it('reports an unknown project', async () => {
    const { service } = makeService({ projectExists: false });

    const result = await service.create({ projectId: PROJECT_ID });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PROJECT_NOT_FOUND');
  });

  it('degrades instead of throwing when node-pty is unavailable', async () => {
    const { service, spawner } = makeService({ ptyAvailable: false });

    const result = await service.create({ projectId: PROJECT_ID });
    const snapshot = await service.list({ projectId: PROJECT_ID });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CAPABILITY_MISSING');
    expect(snapshot.ptyAvailable).toBe(false);
    expect(spawner.spawns).toHaveLength(0);
  });

  it('reports no shell found when nothing is installed', async () => {
    const { service } = makeService({ shells: [] });

    const result = await service.create({ projectId: PROJECT_ID });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EXECUTABLE_NOT_FOUND');
  });

  it('caps the number of sessions per project', async () => {
    const { service } = makeService({ maxSessionsPerProject: 2 });

    await service.create({ projectId: PROJECT_ID });
    await service.create({ projectId: PROJECT_ID });
    const third = await service.create({ projectId: PROJECT_ID });

    expect(third.ok).toBe(false);
    if (third.ok) return;
    expect(third.error.code).toBe('INVALID_REQUEST');
  });

  describe('working directory', () => {
    it('starts in a declared nested root', async () => {
      const nested = path.join(root, 'packages', 'api');
      await fs.mkdir(nested, { recursive: true });
      const { service, spawner } = makeService();

      const result = await service.create({
        projectId: PROJECT_ID,
        rootRelative: 'packages/api',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.session.cwdLabel).toBe('packages/api');
      expect(spawner.spawns[0].options.cwd).toBe(nested);
    });

    it('rejects a root the detector never reported', async () => {
      const { service, spawner } = makeService();

      const result = await service.create({ projectId: PROJECT_ID, rootRelative: 'packages/web' });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INVALID_REQUEST');
      expect(spawner.spawns).toHaveLength(0);
    });

    it('rejects an escape out of the project even if it is listed as a root', async () => {
      project.nestedRoots = ['../../elsewhere'];
      const { service, spawner } = makeService();

      const result = await service.create({
        projectId: PROJECT_ID,
        rootRelative: '../../elsewhere',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INVALID_REQUEST');
      expect(spawner.spawns).toHaveLength(0);
    });

    it('reports a declared root that does not exist on disk', async () => {
      const { service } = makeService();

      const result = await service.create({
        projectId: PROJECT_ID,
        rootRelative: 'packages/api',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('CWD_NOT_FOUND');
    });
  });

  it('buffers output, emits it with an increasing seq, and replays it', async () => {
    const { service, spawner, events } = makeService();
    const created = await service.create({ projectId: PROJECT_ID });
    if (!created.ok) throw new Error('expected a session');
    const sessionId = created.session.sessionId;

    spawner.spawns[0].options.onData('hello ');
    spawner.spawns[0].options.onData('world');

    expect(events).toEqual([
      { type: 'data', event: { projectId: PROJECT_ID, sessionId, data: 'hello ', seq: 1 } },
      { type: 'data', event: { projectId: PROJECT_ID, sessionId, data: 'world', seq: 2 } },
    ]);
    await expect(service.getBuffer({ projectId: PROJECT_ID, sessionId })).resolves.toEqual({
      sessionId,
      data: 'hello world',
      seq: 2,
      truncated: false,
    });
  });

  it('marks a session exited and keeps it listed until it is closed', async () => {
    const { service, spawner, events } = makeService();
    const created = await service.create({ projectId: PROJECT_ID });
    if (!created.ok) throw new Error('expected a session');

    spawner.spawns[0].options.onExit(3);
    const snapshot = await service.list({ projectId: PROJECT_ID });

    expect(events.at(-1)).toEqual({
      type: 'exit',
      event: { projectId: PROJECT_ID, sessionId: created.session.sessionId, exitCode: 3 },
    });
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.sessions[0].status).toBe('exited');
    expect(snapshot.sessions[0].exitCode).toBe(3);
  });

  it('forwards input and resizes to the session pty', async () => {
    const { service, spawner } = makeService();
    const created = await service.create({ projectId: PROJECT_ID });
    if (!created.ok) throw new Error('expected a session');
    const sessionId = created.session.sessionId;

    await service.write({ projectId: PROJECT_ID, sessionId, data: 'ls\r' });
    await service.resize({ projectId: PROJECT_ID, sessionId, cols: 100, rows: 40 });

    expect(spawner.spawns[0].written).toEqual(['ls\r']);
    expect(spawner.spawns[0].resized).toEqual([[100, 40]]);
  });

  it('ignores writes to an unknown session rather than throwing', async () => {
    const { service } = makeService();
    await expect(
      service.write({ projectId: PROJECT_ID, sessionId: 'gone', data: 'x' })
    ).resolves.toBeUndefined();
  });

  it('tree-kills the shell and drops the session on close', async () => {
    const { service, spawner, killedTrees } = makeService();
    const created = await service.create({ projectId: PROJECT_ID });
    if (!created.ok) throw new Error('expected a session');

    const result = await service.close({
      projectId: PROJECT_ID,
      sessionId: created.session.sessionId,
    });

    expect(result.ok).toBe(true);
    // pty.kill() only signals the shell; the descendants it started need the tree kill.
    expect(killedTrees).toEqual([created.session.pid]);
    expect(spawner.spawns[0].killed).toBe(true);
    await expect(service.list({ projectId: PROJECT_ID })).resolves.toMatchObject({ sessions: [] });
  });

  it('does not tree-kill a session that already exited, whose pid may be reused', async () => {
    const { service, spawner, killedTrees } = makeService();
    const created = await service.create({ projectId: PROJECT_ID });
    if (!created.ok) throw new Error('expected a session');
    spawner.spawns[0].options.onExit(0);

    await service.close({ projectId: PROJECT_ID, sessionId: created.session.sessionId });

    expect(killedTrees).toEqual([]);
  });

  it('reports closing a session that is not there', async () => {
    const { service } = makeService();

    const result = await service.close({ projectId: PROJECT_ID, sessionId: 'nope' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PROCESS_NOT_FOUND');
  });

  it('renames a session, trimming the title', async () => {
    const { service } = makeService();
    const created = await service.create({ projectId: PROJECT_ID });
    if (!created.ok) throw new Error('expected a session');

    const result = await service.rename({
      projectId: PROJECT_ID,
      sessionId: created.session.sessionId,
      title: '  build watch  ',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.title).toBe('build watch');
  });

  it('rejects a whitespace-only rename', async () => {
    const { service } = makeService();
    const created = await service.create({ projectId: PROJECT_ID });
    if (!created.ok) throw new Error('expected a session');

    const result = await service.rename({
      projectId: PROJECT_ID,
      sessionId: created.session.sessionId,
      title: '   ',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_REQUEST');
  });

  it('closes every session for a project when it is removed', async () => {
    const { service, spawner, killedTrees } = makeService();
    await service.create({ projectId: PROJECT_ID });
    await service.create({ projectId: PROJECT_ID });

    await service.closeProject(PROJECT_ID);

    expect(killedTrees).toHaveLength(2);
    expect(spawner.spawns.every((spawn) => spawn.killed)).toBe(true);
    await expect(service.list({ projectId: PROJECT_ID })).resolves.toMatchObject({ sessions: [] });
  });

  it('lists the detected shells so the UI can offer them', async () => {
    const { service } = makeService();

    const snapshot = await service.list({ projectId: PROJECT_ID });

    expect(snapshot.shells).toEqual([
      { id: 'powershell', label: 'Windows PowerShell', executable: 'C:\\powershell.exe' },
      { id: 'git-bash', label: 'Git Bash', executable: 'C:\\Git\\bin\\bash.exe' },
    ]);
  });
});
