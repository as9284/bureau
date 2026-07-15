import { spawn, type ChildProcess } from 'node:child_process';

export type CommandResult = { code: number; stdout: string; stderr: string };
export type RunCommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxOutputBytes?: number;
};
// `windowsHide` defaults to true to suppress console windows for CLI tools. GUI apps
// (emulator, scrcpy) must pass false: the hide flag is inherited through STARTUPINFO
// and Qt/SDL honor it for their first window, which launches the app invisible or
// parked at the off-screen minimized position.
export type SpawnCommandOptions = { cwd?: string; env?: NodeJS.ProcessEnv; windowsHide?: boolean };

export type ExecutableAdapter = {
  run(executable: string, args: string[], options?: RunCommandOptions): Promise<CommandResult>;
  spawn(executable: string, args: string[], options?: SpawnCommandOptions): ChildProcess;
};

export function createExecutableAdapter(): ExecutableAdapter {
  return {
    run(executable, args, options = {}) {
      return new Promise((resolve, reject) => {
        const child = spawn(executable, args, {
          cwd: options.cwd,
          env: options.env ?? process.env,
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const cap = options.maxOutputBytes ?? 4_000_000;
        let stdout = '';
        let stderr = '';
        let settled = false;
        let exceeded = false;
        const finish = (code: number): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ code, stdout, stderr });
        };
        const timer = setTimeout(() => {
          child.kill();
          if (!settled) {
            settled = true;
            reject(new Error(`Command timed out after ${options.timeoutMs ?? 15_000}ms`));
          }
        }, options.timeoutMs ?? 15_000);
        child.stdout?.setEncoding('utf8');
        child.stderr?.setEncoding('utf8');
        child.stdout?.on('data', (chunk: string) => {
          if (exceeded) return;
          stdout += chunk;
          if (stdout.length + stderr.length > cap) {
            exceeded = true;
            child.kill();
          }
        });
        child.stderr?.on('data', (chunk: string) => {
          if (exceeded) return;
          stderr += chunk;
          if (stdout.length + stderr.length > cap) {
            exceeded = true;
            child.kill();
          }
        });
        child.on('error', (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        });
        child.on('close', (code) => finish(exceeded ? 137 : (code ?? 1)));
      });
    },
    spawn(executable, args, options = {}) {
      return spawn(executable, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        shell: false,
        windowsHide: options.windowsHide ?? true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    },
  };
}
