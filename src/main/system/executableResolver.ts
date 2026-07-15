import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';

async function isFile(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function preferExecutable(candidates: string[]): string | undefined {
  if (process.platform === 'win32') {
    const runnable = candidates.find((c) => /\.(exe|cmd|bat|com)$/i.test(c));
    if (runnable) return runnable;
  }
  return candidates[0];
}

function resolveViaSystem(command: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  return new Promise((resolve) => {
    const tool = process.platform === 'win32' ? 'where.exe' : 'which';
    let child;
    try {
      child = spawn(tool, [command], { shell: false, env, windowsHide: true });
    } catch {
      resolve([]);
      return;
    }
    let out = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (d: string) => (out += d));
    child.on('close', (code) => {
      if (code !== 0) return resolve([]);
      resolve(
        out
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
      );
    });
    child.on('error', () => resolve([]));
  });
}

/** Resolves a command to a concrete, runnable executable path, or undefined if not found. */
export async function resolveExecutable(
  command: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<string | undefined> {
  if (path.isAbsolute(command)) {
    return (await isFile(command)) ? command : undefined;
  }
  const candidates = await resolveViaSystem(command, env);
  const chosen = preferExecutable(candidates);
  if (chosen && (await isFile(chosen))) return chosen;
  return undefined;
}
