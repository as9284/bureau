import { access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AndroidSdkStatus, AndroidToolCapability } from '@shared/contracts/android';
import type { SettingsStore } from '../settings/SettingsStore';
import { resolveExecutable } from '../system/executableResolver';

export type SdkResolver = {
  resolve(): Promise<AndroidSdkStatus>;
};

type ResolverDeps = {
  canAccess(target: string): Promise<boolean>;
  resolveExecutable(command: string): Promise<string | undefined>;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  home: string;
};

const defaultDeps: ResolverDeps = {
  async canAccess(target) {
    try {
      await access(target);
      return true;
    } catch {
      return false;
    }
  },
  resolveExecutable: (command) => resolveExecutable(command),
  env: process.env,
  platform: process.platform,
  home: os.homedir(),
};

function sdkCandidates(settingsStore: SettingsStore, deps: ResolverDeps): string[] {
  const configured = settingsStore.get().android.sdkPath;
  const env = deps.env;
  const common =
    deps.platform === 'darwin'
      ? [path.join(deps.home, 'Library', 'Android', 'sdk')]
      : deps.platform === 'win32'
        ? [
            path.join(
              env.LOCALAPPDATA ?? path.join(deps.home, 'AppData', 'Local'),
              'Android',
              'Sdk'
            ),
          ]
        : [path.join(deps.home, 'Android', 'Sdk')];
  return [
    ...new Set(
      [configured, env.ANDROID_SDK_ROOT, env.ANDROID_HOME, ...common].filter(Boolean) as string[]
    ),
  ];
}

function sdkToolPath(
  sdkPath: string,
  folder: string,
  command: string,
  platform: NodeJS.Platform
): string {
  return path.join(sdkPath, folder, platform === 'win32' ? `${command}.exe` : command);
}

async function capability(
  candidates: Array<string | undefined>,
  deps: ResolverDeps
): Promise<AndroidToolCapability> {
  for (const candidate of candidates) {
    if (candidate && (await deps.canAccess(candidate))) return { available: true, path: candidate };
  }
  return { available: false, path: null };
}

export function createSdkResolver(
  settingsStore: SettingsStore,
  overrides: Partial<ResolverDeps> = {}
): SdkResolver {
  const deps = { ...defaultDeps, ...overrides };
  async function resolve(): Promise<AndroidSdkStatus> {
    let sdkPath: string | null = null;
    for (const candidate of sdkCandidates(settingsStore, deps)) {
      const adb = sdkToolPath(candidate, 'platform-tools', 'adb', deps.platform);
      const emulator = sdkToolPath(candidate, 'emulator', 'emulator', deps.platform);
      if ((await deps.canAccess(adb)) || (await deps.canAccess(emulator))) {
        sdkPath = candidate;
        break;
      }
    }

    const settings = settingsStore.get();
    const [pathAdb, pathEmulator, pathScrcpy, pathFlutter] = await Promise.all([
      deps.resolveExecutable('adb'),
      deps.resolveExecutable('emulator'),
      deps.resolveExecutable('scrcpy'),
      deps.resolveExecutable('flutter'),
    ]);
    const [adb, emulator, scrcpy, flutter] = await Promise.all([
      capability(
        [
          sdkPath ? sdkToolPath(sdkPath, 'platform-tools', 'adb', deps.platform) : undefined,
          pathAdb,
        ],
        deps
      ),
      capability(
        [
          sdkPath ? sdkToolPath(sdkPath, 'emulator', 'emulator', deps.platform) : undefined,
          pathEmulator,
        ],
        deps
      ),
      capability([settings.android.scrcpyPath, pathScrcpy], deps),
      capability([pathFlutter], deps),
    ]);
    return { sdkPath, adb, emulator, scrcpy, flutter };
  }
  return { resolve };
}
