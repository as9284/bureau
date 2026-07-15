import { spawn } from 'node:child_process';
import { stopProcessTree } from '../processes/treeKill';

export async function killPid(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    await runDetached('taskkill', ['/PID', String(pid), '/T', '/F']);
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    process.kill(pid, 'SIGTERM');
  }
}

export async function killPidTree(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    await killPid(pid);
    return;
  }
  const child = spawn('ps', ['-p', String(pid), '-o', 'pid='], { shell: false });
  await new Promise<void>((resolve) => child.on('close', () => resolve()));
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    await killPid(pid);
  }
}

function runDetached(executable: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${executable} exited with code ${code}`));
    });
  });
}

export async function killChildProcess(child: { pid?: number }): Promise<void> {
  if (!child.pid) return;
  await stopProcessTree(child as import('node:child_process').ChildProcess);
}
