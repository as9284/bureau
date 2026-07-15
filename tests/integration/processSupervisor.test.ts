import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProcessSupervisor } from '@main/processes/ProcessSupervisor';
import type { ProcessDefinition } from '@shared/contracts/projects';
import type { ProcessStatus, ProcessRuntime } from '@shared/contracts/processes';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'bureau-proc-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function nodeProcess(
  id: string,
  script: string,
  extra: Partial<ProcessDefinition> = {}
): ProcessDefinition {
  return {
    id,
    label: id,
    command: process.execPath,
    args: ['-e', script],
    cwd: '.',
    env: {},
    runMode: 'log',
    autoRestart: false,
    runOnOpen: false,
    ...extra,
  };
}

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

function trackStatus(supervisor: ReturnType<typeof createProcessSupervisor>) {
  const statuses: ProcessStatus[] = [];
  let last: ProcessRuntime | undefined;
  supervisor.onEvent((evt) => {
    if (evt.type === 'status') {
      statuses.push(evt.event.runtime.status);
      last = evt.event.runtime;
    }
  });
  return { statuses, current: () => last };
}

describe('ProcessSupervisor (real spawn)', () => {
  it('runs a process, streams output, detects a URL, and stops it', async () => {
    const supervisor = createProcessSupervisor();
    const tracker = trackStatus(supervisor);
    const def = nodeProcess(
      'server',
      "console.log('ready http://localhost:4321'); setInterval(() => {}, 1000);"
    );

    await supervisor.start({ projectId: 'p1', projectRoot: root, definition: def });

    await waitFor(() => tracker.current()?.detectedUrl !== undefined);
    expect(tracker.current()?.status).toBe('running');
    expect(tracker.current()?.detectedUrl).toBe('http://localhost:4321');
    expect(supervisor.runningCount()).toBe(1);
    const pid = tracker.current()?.pid;
    expect(pid).toBeGreaterThan(0);

    await supervisor.stop('p1', 'server');
    await waitFor(() => supervisor.runningCount() === 0);
    expect(tracker.current()?.status).toBe('exited');

    // The process (and its tree) should be gone.
    expect(() => process.kill(pid as number, 0)).toThrow();

    const snapshot = supervisor.getLog('p1', 'server');
    expect(snapshot.lines.some((l) => l.text.includes('ready http://localhost:4321'))).toBe(true);
  });

  it('marks a nonzero exit as crashed', async () => {
    const supervisor = createProcessSupervisor();
    const tracker = trackStatus(supervisor);
    await supervisor.start({
      projectId: 'p2',
      projectRoot: root,
      definition: nodeProcess('boom', 'process.exit(3)'),
    });
    await waitFor(() => tracker.current()?.status === 'crashed');
    expect(tracker.current()?.exitCode).toBe(3);
    expect(supervisor.runningCount()).toBe(0);
  });

  it('rejects an executable that cannot be found', async () => {
    const supervisor = createProcessSupervisor();
    const def = { ...nodeProcess('nope', ''), command: 'definitely-not-a-real-binary-xyz' };
    await expect(
      supervisor.start({ projectId: 'p3', projectRoot: root, definition: def })
    ).rejects.toMatchObject({ code: 'EXECUTABLE_NOT_FOUND' });
  });

  // Regression: a .cmd shim (npm/pnpm/flutter) resolves to a path with a space
  // (C:\Program Files\…). The cmd.exe quoting must not break it at the space.
  it.runIf(process.platform === 'win32')(
    'runs a .cmd shim whose path contains spaces',
    async () => {
      const supervisor = createProcessSupervisor();
      const tracker = trackStatus(supervisor);
      const spacedRoot = path.join(root, 'with space');
      await fs.mkdir(spacedRoot, { recursive: true });
      const cmdPath = path.join(spacedRoot, 'serve.cmd');
      await fs.writeFile(cmdPath, '@echo off\r\necho ready http://localhost:7777\r\n');

      await supervisor.start({
        projectId: 'pw',
        projectRoot: spacedRoot,
        definition: {
          id: 'shim',
          label: 'shim',
          command: cmdPath,
          args: [],
          cwd: '.',
          env: {},
          runMode: 'log',
          autoRestart: false,
          runOnOpen: false,
        },
      });

      await waitFor(() => {
        const status = tracker.current()?.status;
        return status === 'exited' || status === 'crashed';
      });

      const text = supervisor
        .getLog('pw', 'shim')
        .lines.map((l) => l.text)
        .join('\n');
      expect(text).toContain('ready http://localhost:7777');
      expect(text).not.toContain('is not recognized');
      expect(tracker.current()?.status).toBe('exited');
    }
  );
});
