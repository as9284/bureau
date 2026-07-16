import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createShellSessionService } from '@main/terminal/ShellSessionService';
import type { ResolvedShell, ShellRegistry } from '@main/terminal/ShellRegistry';
import { createShellRegistry } from '@main/terminal/ShellRegistry';
import type { PtySession, PtySpawnOptions } from '@main/processes/PtyBridge';
import type { TrackedProject } from '@shared/contracts/projects';

const PROJECT_ID = '22222222-2222-2222-2222-222222222222';

const FAKE_SHELL: ResolvedShell = {
  id: 'bash',
  label: 'bash',
  executable: '/bin/bash',
  args: [],
};

const registry: ShellRegistry = {
  list: async () => [FAKE_SHELL],
  get: async () => FAKE_SHELL,
  resolveDefault: async () => FAKE_SHELL,
};

function waitFor(check: () => boolean, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const timer = setInterval(() => {
      if (check()) {
        clearInterval(timer);
        resolve();
      } else if (performance.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error('waitFor timed out'));
      }
    }, 25);
  });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

let root: string;
let project: TrackedProject;
const strays: ChildProcess[] = [];

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'bureau-shell-int-'));
  project = {
    projectId: PROJECT_ID,
    name: 'demo',
    path: root,
    canonicalPath: root.toLowerCase(),
    stack: ['node'],
    addedAt: new Date('2026-07-01').toISOString(),
  };
});

afterEach(async () => {
  for (const child of strays.splice(0)) {
    if (child.pid && isAlive(child.pid)) {
      try {
        process.kill(child.pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    }
  }
  await fs.rm(root, { recursive: true, force: true });
});

/**
 * node-pty is built against Electron's ABI by `postinstall`, so it cannot be loaded from a
 * plain-node vitest run — a real pty is out of reach here. What matters and *is* reachable
 * is the part that reaches back into the OS: closing a session must kill the process tree,
 * not just the shell. So the pty is faked around a real, live child process and we assert
 * against the actual pid.
 */
describe('ShellSessionService (real process teardown)', () => {
  it('kills the real process behind a session on close', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
      detached: process.platform !== 'win32',
    });
    strays.push(child);
    await waitFor(() => child.pid !== undefined);
    const pid = child.pid as number;

    const service = createShellSessionService({
      catalogue: { get: () => project },
      shells: registry,
      resolveEnv: async () => ({}),
      getDefaultShellId: () => undefined,
      isPtyAvailable: () => true,
      spawnPty: (_executable: string, _args: string[], _options: PtySpawnOptions): PtySession => ({
        pid,
        write: () => undefined,
        resize: () => undefined,
        kill: () => undefined,
      }),
    });

    const created = await service.create({ projectId: PROJECT_ID });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(isAlive(pid)).toBe(true);

    const closed = await service.close({
      projectId: PROJECT_ID,
      sessionId: created.session.sessionId,
    });

    expect(closed.ok).toBe(true);
    await waitFor(() => !isAlive(pid));
    expect(isAlive(pid)).toBe(false);
  });
});

describe('createShellRegistry (real detection)', () => {
  it.runIf(process.platform === 'win32')('finds Windows PowerShell', async () => {
    const shells = await createShellRegistry().list();
    const powershell = shells.find((shell) => shell.id === 'powershell');

    expect(powershell).toBeDefined();
    expect(powershell?.executable.toLowerCase()).toContain('powershell.exe');
  });

  it.runIf(process.platform !== 'win32')('finds a POSIX shell', async () => {
    const shells = await createShellRegistry().list();
    expect(shells.length).toBeGreaterThan(0);
  });

  it('memoizes detection so repeated calls do not re-probe', async () => {
    const registry = createShellRegistry();
    const [first, second] = await Promise.all([registry.list(), registry.list()]);
    expect(first).toBe(second);
  });

  it('reports nothing launchable on a platform whose shells are absent', async () => {
    // A win32 probe on a POSIX box (and vice versa) finds no candidates; resolveDefault
    // must return undefined rather than a half-built shell.
    const foreign = createShellRegistry(process.platform === 'win32' ? 'linux' : 'win32');
    const shells = await foreign.list();
    if (shells.length === 0) {
      await expect(foreign.resolveDefault()).resolves.toBeUndefined();
    }
  });
});
