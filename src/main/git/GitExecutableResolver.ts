import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import type { GitCapability, GitVersion } from './gitTypes';

const execFileAsync = promisify(execFile);
const MINIMUM_GIT_VERSION = { major: 2, minor: 25, patch: 0 };

export type GitExecutableResolver = {
  resolve(configuredPath?: string): Promise<GitCapability>;
};

export function createGitExecutableResolver(): GitExecutableResolver {
  async function resolve(configuredPath?: string): Promise<GitCapability> {
    const candidates: Array<string | undefined> = [
      configuredPath,
      ...(await pathCandidates()),
      ...platformCandidates(),
    ];

    for (const candidate of candidates) {
      if (!candidate) continue;
      const capability = await validateExecutable(candidate);
      if (capability.kind !== 'notFound') {
        return capability;
      }
    }

    return { kind: 'notFound' };
  }

  return { resolve };
}

async function pathCandidates(): Promise<string[]> {
  const gitOnPath = await findOnPath();
  return gitOnPath ? [gitOnPath] : [];
}

async function findOnPath(): Promise<string | undefined> {
  const command = process.platform === 'win32' ? 'where.exe' : 'which';
  const args = process.platform === 'win32' ? ['git.exe'] : ['git'];
  try {
    const { stdout } = await execFileAsync(command, args, { shell: false });
    const first = stdout.split(/\r?\n/)[0]?.trim();
    return first && first.length > 0 ? first : undefined;
  } catch {
    return undefined;
  }
}

function platformCandidates(): string[] {
  if (process.platform === 'win32') {
    return ['C:\\Program Files\\Git\\bin\\git.exe', 'C:\\Program Files (x86)\\Git\\bin\\git.exe'];
  }
  if (process.platform === 'darwin') {
    return ['/usr/local/bin/git', '/opt/homebrew/bin/git', '/usr/bin/git'];
  }
  return ['/usr/bin/git', '/usr/local/bin/git'];
}

async function validateExecutable(executablePath: string): Promise<GitCapability> {
  try {
    await fs.access(executablePath);
  } catch {
    return { kind: 'notFound' };
  }

  try {
    const { stdout } = await execFileAsync(executablePath, ['--version'], {
      shell: false,
      timeout: 5000,
    });
    const version = parseVersion(stdout);
    if (!version) {
      return { kind: 'notFound' };
    }
    if (!isSupported(version)) {
      return { kind: 'unsupportedVersion', executablePath, version };
    }
    return { kind: 'available', executablePath, version };
  } catch {
    return { kind: 'notFound' };
  }
}

export function parseVersion(output: string): GitVersion | undefined {
  const match = output.trim().match(/git version (\d+)\.(\d+)\.(\d+)/);
  if (!match) return undefined;
  const [, major, minor, patch] = match;
  return {
    raw: output.trim(),
    major: parseInt(major!, 10),
    minor: parseInt(minor!, 10),
    patch: parseInt(patch!, 10),
  };
}

export function isSupported(version: GitVersion): boolean {
  const min = MINIMUM_GIT_VERSION;
  if (version.major !== min.major) return version.major > min.major;
  if (version.minor !== min.minor) return version.minor > min.minor;
  return version.patch >= min.patch;
}
