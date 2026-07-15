import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import type { EditorConfig, EditorPreset } from '@shared/contracts/settings';

const PRESET_CANDIDATES: Record<EditorPreset, string[]> = {
  vscode: ['code', 'code.cmd', 'code.exe'],
  cursor: ['cursor', 'cursor.cmd', 'cursor.exe'],
  zed: ['zed'],
  sublime: ['subl', 'sublime_text', 'sublime_text.exe'],
};

export type EditorLauncher = {
  open(repositoryRoot: string, config: EditorConfig): Promise<void>;
};

export function createEditorLauncher(): EditorLauncher {
  async function open(repositoryRoot: string, config: EditorConfig): Promise<void> {
    let executable: string | undefined;

    if (config.kind === 'preset') {
      executable = await findPresetExecutable(config.preset);
    } else if (config.kind === 'custom') {
      executable = config.executablePath;
    }

    if (!executable) {
      throw new Error('Editor is not configured or executable not found.');
    }

    return new Promise((resolve, reject) => {
      const child = spawnEditor(executable!, repositoryRoot);
      child.on('error', reject);
      child.on('spawn', () => {
        child.unref();
        resolve();
      });
    });
  }

  return { open };
}

function spawnEditor(executable: string, repositoryRoot: string) {
  if (shouldUseShellForExecutable(executable)) {
    return spawn('cmd.exe', ['/d', '/s', '/c', `call "${executable}" "${repositoryRoot}"`], {
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsVerbatimArguments: true,
    });
  }

  return spawn(executable, [repositoryRoot], {
    detached: true,
    stdio: 'ignore',
    shell: false,
  });
}

export function shouldUseShellForExecutable(
  executable: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  return platform === 'win32' && /\.(cmd|bat)$/i.test(executable);
}

async function findPresetExecutable(preset: EditorPreset): Promise<string | undefined> {
  // Windows installs VS Code with a direct GUI executable. Prefer it over the
  // command-line shim, whose extensionless companion confuses `where.exe`.
  for (const candidate of knownPresetPaths(preset)) {
    if (await isExecutablePath(candidate)) return candidate;
  }

  for (const candidate of PRESET_CANDIDATES[preset]) {
    const executable = await resolveCommand(candidate);
    const usableExecutable = await resolveUsableExecutable(executable);
    if (usableExecutable) return usableExecutable;
  }

  return undefined;
}

function knownPresetPaths(preset: EditorPreset): string[] {
  if (process.platform !== 'win32') return [];

  const localAppData = process.env.LOCALAPPDATA;
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env['ProgramFiles(x86)'];

  if (preset === 'vscode') {
    return [
      localAppData ? path.join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe') : '',
      programFiles ? path.join(programFiles, 'Microsoft VS Code', 'Code.exe') : '',
      programFilesX86 ? path.join(programFilesX86, 'Microsoft VS Code', 'Code.exe') : '',
      localAppData
        ? path.join(localAppData, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd')
        : '',
      programFiles ? path.join(programFiles, 'Microsoft VS Code', 'bin', 'code.cmd') : '',
      programFilesX86 ? path.join(programFilesX86, 'Microsoft VS Code', 'bin', 'code.cmd') : '',
    ].filter(Boolean);
  }

  if (preset === 'cursor') {
    return [
      localAppData ? path.join(localAppData, 'Programs', 'cursor', 'Cursor.exe') : '',
      localAppData ? path.join(localAppData, 'Programs', 'Cursor', 'Cursor.exe') : '',
      localAppData
        ? path.join(localAppData, 'Programs', 'cursor', 'resources', 'app', 'bin', 'cursor.cmd')
        : '',
      localAppData
        ? path.join(localAppData, 'Programs', 'Cursor', 'resources', 'app', 'bin', 'cursor.cmd')
        : '',
    ].filter(Boolean);
  }

  if (preset === 'zed') {
    return [
      localAppData ? path.join(localAppData, 'Programs', 'Zed', 'Zed.exe') : '',
      programFiles ? path.join(programFiles, 'Zed', 'Zed.exe') : '',
    ].filter(Boolean);
  }

  if (preset === 'sublime') {
    return [
      programFiles ? path.join(programFiles, 'Sublime Text', 'sublime_text.exe') : '',
      programFilesX86 ? path.join(programFilesX86, 'Sublime Text', 'sublime_text.exe') : '',
    ].filter(Boolean);
  }

  return [];
}

const ALL_EDITOR_PRESETS: EditorPreset[] = ['vscode', 'cursor', 'zed', 'sublime'];

/** Returns presets whose executables can be resolved on this machine. */
export async function listAvailableEditorPresets(): Promise<EditorPreset[]> {
  const available: EditorPreset[] = [];
  for (const preset of ALL_EDITOR_PRESETS) {
    if (await findPresetExecutable(preset)) {
      available.push(preset);
    }
  }
  return available;
}

async function isExecutablePath(candidate: string): Promise<boolean> {
  if (!candidate) return false;
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function resolveUsableExecutable(candidate: string | undefined): Promise<string | undefined> {
  if (!candidate) return undefined;
  const candidates =
    process.platform === 'win32' && !/\.(cmd|bat|exe)$/i.test(candidate)
      ? [`${candidate}.cmd`, `${candidate}.exe`, `${candidate}.bat`, candidate]
      : [candidate];

  for (const resolved of candidates) {
    if (await isExecutablePath(resolved)) return resolved;
  }

  return undefined;
}

function resolveCommand(executable: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const command = process.platform === 'win32' ? 'where.exe' : 'which';
    const child = spawn(command, [executable], { shell: false });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.on('close', (code) => {
      if (code !== 0) {
        resolve(undefined);
        return;
      }
      resolve(
        stdout
          .split(/\r?\n/)
          .find((line) => line.trim().length > 0)
          ?.trim()
      );
    });
    child.on('error', () => resolve(undefined));
  });
}
