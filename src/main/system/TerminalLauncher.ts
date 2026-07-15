import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { TerminalConfig, TerminalPreset } from '@shared/contracts/settings';

export type TerminalLauncher = {
  open(repositoryRoot: string, config?: TerminalConfig): Promise<void>;
  isAvailable(config?: TerminalConfig): Promise<boolean>;
};

type TerminalCandidate = {
  executable: string;
  args: (repositoryRoot: string) => string[];
};

const PRESET_CANDIDATES: Record<TerminalPreset, TerminalCandidate> = {
  'windows-terminal': {
    executable: 'wt.exe',
    args: (cwd) => ['-d', cwd],
  },
  powershell: {
    executable: 'powershell.exe',
    args: (cwd) => ['-NoExit', '-Command', `Set-Location -LiteralPath "${cwd}"`],
  },
  cmd: {
    executable: 'cmd.exe',
    args: (cwd) => ['/K', 'cd', '/d', cwd],
  },
  'terminal-app': {
    executable: '/usr/bin/open',
    args: (cwd) => ['-a', 'Terminal', cwd],
  },
  'gnome-terminal': {
    executable: 'gnome-terminal',
    args: (cwd) => ['--working-directory', cwd],
  },
  konsole: {
    executable: 'konsole',
    args: (cwd) => ['--workdir', cwd],
  },
  'xfce4-terminal': {
    executable: 'xfce4-terminal',
    args: (cwd) => ['--working-directory', cwd],
  },
  alacritty: {
    executable: 'alacritty',
    args: (cwd) => ['--working-directory', cwd],
  },
  xterm: {
    executable: 'xterm',
    args: (cwd) => ['-cd', cwd],
  },
};

export function createTerminalLauncher(): TerminalLauncher {
  async function isAvailable(config: TerminalConfig = { kind: 'auto' }): Promise<boolean> {
    const candidate = await resolveCandidate(config);
    return candidate !== undefined;
  }

  async function open(
    repositoryRoot: string,
    config: TerminalConfig = { kind: 'auto' }
  ): Promise<void> {
    const candidate = await resolveCandidate(config);
    if (!candidate) {
      throw new Error('No supported terminal found.');
    }
    spawn(candidate.executable, candidate.args(repositoryRoot), {
      cwd: repositoryRoot,
      detached: true,
      stdio: 'ignore',
      shell: false,
    }).unref();
  }

  return { open, isAvailable };
}

async function resolveCandidate(config: TerminalConfig): Promise<TerminalCandidate | undefined> {
  if (config.kind === 'custom') {
    if (await commandExists(config.executablePath)) {
      return {
        executable: config.executablePath,
        args: (cwd) => customArgs(config.executablePath, cwd),
      };
    }
    return undefined;
  }

  if (config.kind === 'preset') {
    const candidate = PRESET_CANDIDATES[config.preset];
    if (candidate && (await commandExists(candidate.executable))) {
      return candidate;
    }
    return undefined;
  }

  for (const candidate of getAutoCandidates()) {
    if (await commandExists(candidate.executable)) {
      return candidate;
    }
  }
  return undefined;
}

function getAutoCandidates(): TerminalCandidate[] {
  if (process.platform === 'win32') {
    return [
      PRESET_CANDIDATES['windows-terminal'],
      PRESET_CANDIDATES.powershell,
      PRESET_CANDIDATES.cmd,
    ];
  }
  if (process.platform === 'darwin') {
    return [PRESET_CANDIDATES['terminal-app']];
  }
  return [
    PRESET_CANDIDATES['gnome-terminal'],
    PRESET_CANDIDATES.konsole,
    PRESET_CANDIDATES['xfce4-terminal'],
    PRESET_CANDIDATES.alacritty,
    PRESET_CANDIDATES.xterm,
  ];
}

function customArgs(executable: string, cwd: string): string[] {
  const base = path.basename(executable).toLowerCase();
  if (base.includes('wt')) return ['-d', cwd];
  if (base.includes('powershell') || base.includes('pwsh')) {
    return ['-NoExit', '-Command', `Set-Location -LiteralPath "${cwd}"`];
  }
  if (base.includes('cmd')) return ['/K', 'cd', '/d', cwd];
  if (base.includes('konsole')) return ['--workdir', cwd];
  if (base.includes('alacritty')) return ['--working-directory', cwd];
  if (base.includes('gnome-terminal') || base.includes('xfce4-terminal')) {
    return ['--working-directory', cwd];
  }
  // Best-effort: many terminals accept cwd via process options; spawn cwd is set below by caller.
  // We pass no args and rely on spawn cwd when launching custom unknowns.
  void cwd;
  return [];
}

function getPlatformPresetIds(): TerminalPreset[] {
  if (process.platform === 'win32') {
    return ['windows-terminal', 'powershell', 'cmd'];
  }
  if (process.platform === 'darwin') {
    return ['terminal-app'];
  }
  return ['gnome-terminal', 'konsole', 'xfce4-terminal', 'alacritty', 'xterm'];
}

/** Returns platform terminal presets whose executables exist on this machine. */
export async function listAvailableTerminalPresets(): Promise<TerminalPreset[]> {
  const available: TerminalPreset[] = [];
  for (const preset of getPlatformPresetIds()) {
    const candidate = PRESET_CANDIDATES[preset];
    if (candidate && (await commandExists(candidate.executable))) {
      available.push(preset);
    }
  }
  return available;
}

async function commandExists(executable: string): Promise<boolean> {
  if (process.platform === 'win32') {
    if (path.isAbsolute(executable)) {
      try {
        await fs.access(executable);
        return true;
      } catch {
        return false;
      }
    }
  } else if (path.isAbsolute(executable)) {
    try {
      await fs.access(executable);
      return true;
    } catch {
      return false;
    }
  }

  return new Promise((resolve) => {
    const child = spawn(process.platform === 'win32' ? 'where.exe' : 'which', [executable], {
      shell: false,
      stdio: 'ignore',
    });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}
