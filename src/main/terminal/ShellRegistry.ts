import path from 'node:path';
import { access } from 'node:fs/promises';
import { resolveExecutable } from '../system/executableResolver';
import type { DetectedShell, ShellId } from '@shared/contracts/terminal';

export type ResolvedShell = DetectedShell & { args: string[] };

type ShellCandidate = {
  id: ShellId;
  label: string;
  /** Args that give an interactive shell which still loads the user's profile. */
  args: string[];
  locate(): Promise<string | undefined>;
};

async function isFile(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function firstExisting(candidates: (string | undefined)[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (candidate && (await isFile(candidate))) return candidate;
  }
  return undefined;
}

/**
 * Git Bash is deliberately *not* looked up as `bash` on PATH: on Windows that resolves to
 * System32\bash.exe (the WSL launcher) on machines with WSL enabled, which is a different
 * shell with different semantics. Instead we find it where Git for Windows puts it —
 * derived from the resolved `git` executable (…\Git\cmd\git.exe → …\Git\bin\bash.exe),
 * falling back to the standard install locations.
 */
async function locateGitBash(): Promise<string | undefined> {
  const git = await resolveExecutable('git');
  const fromGit = git ? path.resolve(path.dirname(git), '..', 'bin', 'bash.exe') : undefined;
  return firstExisting([
    fromGit,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe'),
    process.env['ProgramFiles(x86)'] &&
      path.join(process.env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe'),
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'),
  ]);
}

function onPath(command: string): () => Promise<string | undefined> {
  return () => resolveExecutable(command);
}

/** Candidates in preference order per platform; the first detected one is the default. */
function candidatesForPlatform(platform: NodeJS.Platform): ShellCandidate[] {
  if (platform === 'win32') {
    return [
      { id: 'pwsh', label: 'PowerShell 7', args: ['-NoLogo'], locate: onPath('pwsh.exe') },
      {
        id: 'powershell',
        label: 'Windows PowerShell',
        args: ['-NoLogo'],
        locate: onPath('powershell.exe'),
      },
      { id: 'git-bash', label: 'Git Bash', args: ['--login', '-i'], locate: locateGitBash },
      { id: 'cmd', label: 'Command Prompt', args: [], locate: onPath('cmd.exe') },
    ];
  }
  const posix: ShellCandidate[] = [
    { id: 'zsh', label: 'zsh', args: ['-l'], locate: onPath('zsh') },
    { id: 'bash', label: 'bash', args: ['-l'], locate: onPath('bash') },
    { id: 'fish', label: 'fish', args: ['-l'], locate: onPath('fish') },
    { id: 'sh', label: 'sh', args: ['-l'], locate: onPath('sh') },
  ];
  // Linux defaults to bash, macOS to zsh; same set, different head.
  return platform === 'darwin' ? posix : [posix[1], posix[0], posix[2], posix[3]];
}

export type ShellRegistry = {
  /** Detected shells in preference order. Memoized — probing spawns `where`/`which`. */
  list(): Promise<ResolvedShell[]>;
  /** Resolve an id to a launchable shell, or undefined if it is not installed here. */
  get(id: ShellId): Promise<ResolvedShell | undefined>;
  /** The shell used when a request names none: `preferred` if installed, else the first found. */
  resolveDefault(preferred?: ShellId): Promise<ResolvedShell | undefined>;
};

export function createShellRegistry(
  platform: NodeJS.Platform = process.platform
): ShellRegistry {
  let cached: Promise<ResolvedShell[]> | undefined;

  function list(): Promise<ResolvedShell[]> {
    cached ??= (async () => {
      const found: ResolvedShell[] = [];
      for (const candidate of candidatesForPlatform(platform)) {
        const executable = await candidate.locate();
        if (executable) {
          found.push({
            id: candidate.id,
            label: candidate.label,
            executable,
            args: candidate.args,
          });
        }
      }
      return found;
    })();
    return cached;
  }

  async function get(id: ShellId): Promise<ResolvedShell | undefined> {
    return (await list()).find((shell) => shell.id === id);
  }

  async function resolveDefault(preferred?: ShellId): Promise<ResolvedShell | undefined> {
    const shells = await list();
    return (preferred && shells.find((shell) => shell.id === preferred)) ?? shells[0];
  }

  return { list, get, resolveDefault };
}
