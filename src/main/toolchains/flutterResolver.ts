import { access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { FlutterManager } from '@shared/contracts/toolchains';
import { resolveExecutable } from '../system/executableResolver';
import { runCommand } from './runCommand';
import { normalizeVersion } from './versionFileParsers';

export type FlutterManagerProbe = {
  manager: FlutterManager;
  available: boolean;
  versions: string[];
};

export async function detectFlutterManagers(projectRoot: string): Promise<FlutterManagerProbe[]> {
  const probes: FlutterManagerProbe[] = [];
  const fvm = await probeFvm(projectRoot);
  if (fvm.available) probes.push(fvm);
  const flutter = await probeFlutter();
  if (flutter.available) probes.push(flutter);
  return probes;
}

export function pickFlutterManager(
  probes: FlutterManagerProbe[],
  preferred?: FlutterManager
): FlutterManagerProbe | null {
  if (probes.length === 0) return null;
  const order: FlutterManager[] = preferred
    ? ([preferred, 'fvm', 'flutter'] as FlutterManager[]).filter((v, i, a) => a.indexOf(v) === i)
    : ['fvm', 'flutter'];
  for (const manager of order) {
    const hit = probes.find((p) => p.manager === manager);
    if (hit) return hit;
  }
  return probes[0] ?? null;
}

export async function resolveFlutterBinDir(
  manager: FlutterManager,
  projectRoot: string,
  version: string
): Promise<string | null> {
  if (manager === 'fvm') {
    const sdk = path.join(projectRoot, '.fvm', 'flutter_sdk', 'bin');
    if (await exists(sdk)) return sdk;
    const cache = path.join(
      process.env.FVM_CACHE_PATH ?? path.join(os.homedir(), 'fvm', 'versions'),
      version,
      'bin'
    );
    if (await exists(cache)) return cache;
    const versions = path.join(os.homedir(), 'fvm', 'versions', version, 'bin');
    return (await exists(versions)) ? versions : null;
  }
  const exe = await resolveExecutable('flutter');
  return exe ? path.dirname(exe) : null;
}

async function probeFvm(projectRoot: string): Promise<FlutterManagerProbe> {
  try {
    const exe = await resolveExecutable('fvm');
    const localSdk = path.join(
      projectRoot,
      '.fvm',
      'flutter_sdk',
      'bin',
      process.platform === 'win32' ? 'flutter.bat' : 'flutter'
    );
    if (!exe && !(await exists(localSdk))) {
      return { manager: 'fvm', available: false, versions: [] };
    }
    if (exe) {
      const { code, stdout } = await runCommand(exe, ['list'], { timeoutMs: 8000 });
      if (code === 0) {
        const versions = stdout
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => /[0-9]/.test(l))
          .map((l) => normalizeVersion(l.split(/\s+/).pop() ?? l));
        return { manager: 'fvm', available: true, versions };
      }
    }
    if (await exists(localSdk)) {
      const { stdout } = await runCommand(localSdk, ['--version'], { timeoutMs: 8000 });
      const version = stdout.match(/Flutter\s+([0-9.]+)/)?.[1] ?? 'local';
      return { manager: 'fvm', available: true, versions: [version] };
    }
    return { manager: 'fvm', available: Boolean(exe), versions: [] };
  } catch {
    return { manager: 'fvm', available: false, versions: [] };
  }
}

async function probeFlutter(): Promise<FlutterManagerProbe> {
  try {
    const exe = await resolveExecutable('flutter');
    if (!exe) return { manager: 'flutter', available: false, versions: [] };
    const { stdout } = await runCommand(exe, ['--version'], { timeoutMs: 8000 });
    const version = stdout.match(/Flutter\s+([0-9.]+)/)?.[1];
    return { manager: 'flutter', available: true, versions: version ? [version] : [] };
  } catch {
    return { manager: 'flutter', available: false, versions: [] };
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

export function flutterInstallHint(manager: FlutterManager, version: string): string {
  if (manager === 'fvm') return `fvm install ${version}`;
  return 'flutter upgrade';
}
