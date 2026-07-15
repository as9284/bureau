import { access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { PythonManager } from '@shared/contracts/toolchains';
import { resolveExecutable } from '../system/executableResolver';
import { runCommand } from './runCommand';
import { normalizeVersion } from './versionFileParsers';

export type PythonManagerProbe = {
  manager: PythonManager;
  available: boolean;
  versions: string[];
  binDir?: string;
};

export async function detectPythonManagers(projectRoot: string): Promise<PythonManagerProbe[]> {
  const probes: PythonManagerProbe[] = [];
  const venv = await probeVenv(projectRoot);
  if (venv.available) probes.push(venv);
  const pyenv = await probePyenv();
  if (pyenv.available) probes.push(pyenv);
  const system = await probeSystemPython();
  if (system.available) probes.push(system);
  return probes;
}

export function pickPythonManager(
  probes: PythonManagerProbe[],
  preferred?: PythonManager
): PythonManagerProbe | null {
  if (probes.length === 0) return null;
  // Project venv wins, then pyenv, then a plain system interpreter.
  const order: PythonManager[] = preferred
    ? ([preferred, 'venv', 'pyenv', 'system'] as PythonManager[]).filter(
        (v, i, a) => a.indexOf(v) === i
      )
    : ['venv', 'pyenv', 'system'];
  for (const manager of order) {
    const hit = probes.find((p) => p.manager === manager);
    if (hit) return hit;
  }
  return probes[0] ?? null;
}

export async function resolvePythonBinDir(
  manager: PythonManager,
  projectRoot: string,
  version: string,
  venvRelative?: string
): Promise<string | null> {
  if (manager === 'venv') {
    const rel = venvRelative ?? '.venv';
    const root = path.resolve(projectRoot, rel);
    const bin =
      process.platform === 'win32' ? path.join(root, 'Scripts') : path.join(root, 'bin');
    return (await exists(bin)) ? bin : null;
  }
  if (manager === 'system') {
    const exe = (await resolveExecutable('python3')) ?? (await resolveExecutable('python'));
    return exe ? path.dirname(exe) : null;
  }
  const pyenvRoot = process.env.PYENV_ROOT ?? path.join(os.homedir(), '.pyenv');
  const candidate = path.join(pyenvRoot, 'versions', version, 'bin');
  if (await exists(candidate)) return candidate;
  const alt = path.join(pyenvRoot, 'versions', normalizeVersion(version), 'bin');
  return (await exists(alt)) ? alt : null;
}

async function probeSystemPython(): Promise<PythonManagerProbe> {
  try {
    const exe = (await resolveExecutable('python3')) ?? (await resolveExecutable('python'));
    if (!exe) return { manager: 'system', available: false, versions: [] };
    const { stdout } = await runCommand(exe, ['--version'], { timeoutMs: 5000 });
    const version = stdout.match(/([0-9]+\.[0-9]+(?:\.[0-9]+)?)/)?.[1];
    if (!version) return { manager: 'system', available: false, versions: [] };
    return { manager: 'system', available: true, versions: [version], binDir: path.dirname(exe) };
  } catch {
    return { manager: 'system', available: false, versions: [] };
  }
}

async function probeVenv(projectRoot: string): Promise<PythonManagerProbe> {
  try {
    const dirs = ['.venv', 'venv'];
    for (const dir of dirs) {
      const root = path.join(projectRoot, dir);
      const bin =
        process.platform === 'win32' ? path.join(root, 'Scripts') : path.join(root, 'bin');
      if (await exists(bin)) {
        const { stdout } = await runCommand(
          process.platform === 'win32' ? path.join(bin, 'python.exe') : path.join(bin, 'python'),
          ['--version'],
          { timeoutMs: 5000 }
        );
        const version = stdout.match(/([0-9]+\.[0-9]+(?:\.[0-9]+)?)/)?.[1] ?? 'local';
        return { manager: 'venv', available: true, versions: [version] };
      }
    }
    return { manager: 'venv', available: false, versions: [] };
  } catch {
    return { manager: 'venv', available: false, versions: [] };
  }
}

async function probePyenv(): Promise<PythonManagerProbe> {
  try {
    const exe = await resolveExecutable('pyenv');
    if (!exe) return { manager: 'pyenv', available: false, versions: [] };
    const { code, stdout } = await runCommand(exe, ['versions', '--bare'], { timeoutMs: 8000 });
    if (code !== 0) return { manager: 'pyenv', available: true, versions: [] };
    const versions = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.includes('system'));
    return { manager: 'pyenv', available: true, versions };
  } catch {
    return { manager: 'pyenv', available: false, versions: [] };
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export function pythonInstallHint(manager: PythonManager, version: string): string {
  if (manager === 'venv') return 'python -m venv .venv';
  return `pyenv install ${version}`;
}
