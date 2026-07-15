import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process';

function quoteWindowsArg(value: string): string {
  return /[\s"&()[\]{}^=;!'+,`~]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

/**
 * Spawns a short-lived probe/helper command. On Windows, `.cmd`/`.bat` shims are
 * routed through `cmd.exe /c` — Electron/Node reject those with `spawn EINVAL`
 * when `shell:false`. Sync spawn failures are swallowed as a non-zero exit.
 */
export async function runCommand(
  executable: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnProbe(executable, args, options);
    } catch {
      resolve({ code: 1, stdout: '', stderr: '' });
      return;
    }

    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => (stdout += chunk));
    child.stderr?.on('data', (chunk: string) => (stderr += chunk));

    const timer =
      options?.timeoutMs &&
      setTimeout(() => {
        child.kill();
      }, options.timeoutMs);

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on('error', () => {
      if (timer) clearTimeout(timer);
      resolve({ code: 1, stdout, stderr });
    });
  });
}

function spawnProbe(
  executable: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv }
): ChildProcess {
  const stdio: StdioOptions = ['ignore', 'pipe', 'pipe'];
  const base = {
    cwd: options?.cwd,
    env: options?.env ?? process.env,
    shell: false as const,
    windowsHide: true,
    stdio,
  };

  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
    const commandLine = [executable, ...args].map(quoteWindowsArg).join(' ');
    return spawn('cmd.exe', ['/d', '/s', '/c', `"${commandLine}"`], {
      ...base,
      windowsVerbatimArguments: true,
    });
  }

  return spawn(executable, args, base);
}
