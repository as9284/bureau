import { spawn, type ChildProcess } from 'node:child_process';

const FORCE_TIMEOUT_MS = 4000;

function taskkill(pid: number, force: boolean): Promise<void> {
  return new Promise((resolve) => {
    const args = force ? ['/PID', String(pid), '/T', '/F'] : ['/PID', String(pid), '/T'];
    const child = spawn('taskkill.exe', args, { stdio: 'ignore', shell: false });
    child.on('close', () => resolve());
    child.on('error', () => resolve());
  });
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    // Negative pid targets the whole process group (child spawned detached).
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone.
    }
  }
}

/**
 * Terminates a child and its descendants: graceful first, then force after a timeout.
 * Windows uses `taskkill /T`; POSIX signals the process group.
 */
export function stopProcessTree(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) return Promise.resolve();
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer);
      resolve();
    };

    child.once('close', finish);
    child.once('exit', finish);

    if (process.platform === 'win32') {
      void taskkill(pid, false);
    } else {
      killGroup(pid, 'SIGTERM');
    }

    const forceTimer = setTimeout(() => {
      if (process.platform === 'win32') {
        void taskkill(pid, true).then(finish);
      } else {
        killGroup(pid, 'SIGKILL');
        finish();
      }
    }, FORCE_TIMEOUT_MS);
  });
}

/**
 * Kill a process by PID when we no longer hold a ChildProcess handle
 * (e.g. orphans adopted from a previous Bureau session).
 */
export async function killPidTree(pid: number): Promise<void> {
  if (!Number.isFinite(pid) || pid <= 0) return;
  if (process.platform === 'win32') {
    await taskkill(pid, false);
    await new Promise((r) => setTimeout(r, 400));
    if (isAlive(pid)) await taskkill(pid, true);
    return;
  }
  killGroup(pid, 'SIGTERM');
  await new Promise((r) => setTimeout(r, 400));
  if (isAlive(pid)) killGroup(pid, 'SIGKILL');
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
