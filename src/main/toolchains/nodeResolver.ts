import { access, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { NodeManager } from '@shared/contracts/toolchains';
import { resolveExecutable } from '../system/executableResolver';
import { normalizeVersion } from './versionFileParsers';
import { runCommand } from './runCommand';

export type NodeManagerProbe = {
  manager: NodeManager;
  available: boolean;
  versions: string[];
  /** Absolute bin/dir to prepend for this probe (system node only). */
  binDir?: string | null;
};

export async function detectNodeManagers(): Promise<NodeManagerProbe[]> {
  const probes = await Promise.all([probeFnm(), probeVolta(), probeNvm(), probeSystemNode()]);
  return probes.filter((p) => p.available);
}

export function pickNodeManager(
  probes: NodeManagerProbe[],
  preferred?: NodeManager
): NodeManagerProbe | null {
  if (probes.length === 0) return null;
  const order: NodeManager[] = preferred
    ? ([preferred, 'fnm', 'volta', 'nvm', 'system'] as NodeManager[]).filter(
        (v, i, a) => a.indexOf(v) === i
      )
    : ['fnm', 'volta', 'nvm', 'system'];
  for (const manager of order) {
    const hit = probes.find((p) => p.manager === manager);
    if (hit) return hit;
  }
  return probes[0] ?? null;
}

/** All installed versions across managers, de-duplicated, managers first then system. */
export function collectInstalledVersions(probes: NodeManagerProbe[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const probe of probes) {
    for (const version of probe.versions) {
      if (seen.has(version)) continue;
      seen.add(version);
      out.push(version);
    }
  }
  return out;
}

export async function resolveNodeBinDir(
  manager: NodeManager,
  version: string
): Promise<string | null> {
  const v = normalizeVersion(version);
  if (manager === 'system') {
    const exe = await resolveExecutable('node');
    return exe ? path.dirname(exe) : null;
  }
  if (manager === 'fnm') return resolveFnmBin(v);
  if (manager === 'volta') return resolveVoltaBin(v);
  return resolveNvmBin(v);
}

async function probeSystemNode(): Promise<NodeManagerProbe> {
  try {
    const exe = await resolveExecutable('node');
    if (!exe) return { manager: 'system', available: false, versions: [] };
    const { code, stdout, stderr } = await runCommand(exe, ['--version'], { timeoutMs: 5000 });
    if (code !== 0) return { manager: 'system', available: false, versions: [] };
    const raw = `${stdout}${stderr}`.trim();
    const match = raw.match(/v?([0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?)/);
    const version = match ? normalizeVersion(match[1]) : null;
    if (!version) return { manager: 'system', available: true, versions: [], binDir: path.dirname(exe) };
    return {
      manager: 'system',
      available: true,
      versions: [version],
      binDir: path.dirname(exe),
    };
  } catch {
    return { manager: 'system', available: false, versions: [] };
  }
}

async function probeFnm(): Promise<NodeManagerProbe> {
  try {
    const exe = await resolveExecutable('fnm');
    if (!exe) return { manager: 'fnm', available: false, versions: [] };
    const { code, stdout } = await runCommand(exe, ['list'], { timeoutMs: 8000 });
    if (code !== 0) return { manager: 'fnm', available: true, versions: [] };
    return { manager: 'fnm', available: true, versions: parseFnmList(stdout) };
  } catch {
    return { manager: 'fnm', available: false, versions: [] };
  }
}

async function probeVolta(): Promise<NodeManagerProbe> {
  try {
    const exe = await resolveExecutable('volta');
    if (!exe) return { manager: 'volta', available: false, versions: [] };
    const { code, stdout } = await runCommand(exe, ['list', 'node'], { timeoutMs: 8000 });
    if (code !== 0) return { manager: 'volta', available: true, versions: [] };
    const versions = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^\d/.test(l))
      .map((l) => normalizeVersion(l.split(/\s+/)[0]));
    return { manager: 'volta', available: true, versions };
  } catch {
    return { manager: 'volta', available: false, versions: [] };
  }
}

async function probeNvm(): Promise<NodeManagerProbe> {
  try {
    const candidates = [
      process.env.NVM_HOME,
      process.env.NVM_DIR,
      process.env.APPDATA ? path.join(process.env.APPDATA, 'nvm') : null,
      path.join(os.homedir(), 'AppData', 'Roaming', 'nvm'),
      path.join(os.homedir(), '.nvm'),
    ].filter(Boolean) as string[];

    let nvmHome: string | null = null;
    for (const candidate of candidates) {
      if (await exists(candidate)) {
        nvmHome = candidate;
        break;
      }
    }

    if (!nvmHome) {
      const exe = await resolveExecutable('nvm');
      if (!exe) return { manager: 'nvm', available: false, versions: [] };
      nvmHome = process.env.NVM_HOME ?? path.dirname(exe);
    }

    const versions = await listNvmVersions(nvmHome);
    return {
      manager: 'nvm',
      available: versions.length > 0 || Boolean(process.env.NVM_HOME) || Boolean(process.env.NVM_DIR),
      versions,
    };
  } catch {
    return { manager: 'nvm', available: false, versions: [] };
  }
}

function parseFnmList(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/\*?\s*v?([0-9][0-9a-zA-Z.+_-]*)/);
      return match ? normalizeVersion(match[1]) : '';
    })
    .filter(Boolean);
}

async function resolveFnmBin(version: string): Promise<string | null> {
  const roots = [
    process.env.FNM_DIR,
    path.join(os.homedir(), '.fnm'),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'fnm') : null,
  ].filter(Boolean) as string[];

  for (const root of roots) {
    const candidates = [
      path.join(root, 'node-versions', `v${version}`, 'installation', 'bin'),
      path.join(root, 'node-versions', `v${version}`, 'installation'),
      path.join(root, 'aliases', version, 'bin'),
    ];
    if (process.platform === 'win32') {
      candidates.unshift(
        path.join(root, 'node-versions', `v${version}`, 'installation'),
        path.join(root, 'multishells', version)
      );
    }
    for (const candidate of candidates) {
      if (await exists(candidate)) return candidate;
    }
  }
  return null;
}

async function resolveVoltaBin(version: string): Promise<string | null> {
  const root = process.env.VOLTA_HOME ?? path.join(os.homedir(), '.volta');
  const candidates = [
    path.join(root, 'tools', 'image', 'node', version, 'bin'),
    path.join(root, 'tools', 'image', 'node', version),
  ];
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return path.join(root, 'bin');
}

async function resolveNvmBin(version: string): Promise<string | null> {
  const homes = [
    process.env.NVM_HOME,
    process.env.NVM_DIR,
    process.env.APPDATA ? path.join(process.env.APPDATA, 'nvm') : null,
    path.join(os.homedir(), '.nvm'),
  ].filter(Boolean) as string[];

  for (const nvmHome of homes) {
    const candidate = path.join(nvmHome, `v${version}`);
    if (await exists(candidate)) return candidate;
    const alt = path.join(nvmHome, version);
    if (await exists(alt)) return alt;
  }
  return null;
}

async function listNvmVersions(nvmHome: string): Promise<string[]> {
  try {
    const entries = await readdir(nvmHome, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && /^v?\d/.test(e.name))
      .map((e) => normalizeVersion(e.name.replace(/^v/, '')));
  } catch {
    return [];
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

export function nodeInstallHint(manager: NodeManager | null, version: string): string {
  if (manager === 'fnm') return `fnm install ${version}`;
  if (manager === 'volta') return `volta install node@${version}`;
  if (manager === 'nvm') return `nvm install ${version}`;
  return `Install Node ${version} (fnm / nvm / volta), or select the system version.`;
}
