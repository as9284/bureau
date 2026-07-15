import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process';

export type SpawnOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
};

const PIPED_STDIO: StdioOptions = ['ignore', 'pipe', 'pipe'];

function quoteWindowsArg(value: string): string {
  return /[\s"&()[\]{}^=;!'+,`~]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

/**
 * Spawns a managed child with stdout/stderr piped and no shell. On Windows, `.cmd`/`.bat`
 * shims (npm, pnpm, flutter…) are run via `cmd.exe /c` so the tree can be killed with taskkill;
 * on POSIX the child is detached into its own process group for group-kill.
 */
export function spawnManaged(
  executable: string,
  args: string[],
  options: SpawnOptions
): ChildProcess {
  const base = {
    cwd: options.cwd,
    env: options.env,
    stdio: PIPED_STDIO,
    shell: false as const,
  };

  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
    // `cmd /d /s /c` strips exactly the OUTER pair of quotes, so wrap the whole
    // command in one — otherwise a shim path with spaces (C:\Program Files\…\npm.cmd)
    // loses its own quotes and cmd breaks it at the space. (cross-spawn's approach.)
    const commandLine = [executable, ...args].map(quoteWindowsArg).join(' ');
    return spawn('cmd.exe', ['/d', '/s', '/c', `"${commandLine}"`], {
      ...base,
      windowsVerbatimArguments: true,
    });
  }

  return spawn(executable, args, {
    ...base,
    detached: process.platform !== 'win32',
  });
}
