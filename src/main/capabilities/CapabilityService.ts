import { app } from 'electron';
import type { AppCapabilities } from '@shared/contracts/capabilities';
import type { SettingsStore } from '../settings/SettingsStore';
import type { TerminalLauncher } from '../system/TerminalLauncher';
import { listAvailableEditorPresets } from '../system/EditorLauncher';
import { listAvailableTerminalPresets } from '../system/TerminalLauncher';
import type { SdkResolver } from '../android/SdkResolver';
import type { GitExecutableResolver } from '../git/GitExecutableResolver';
import { probeRuntimes } from '../toolchains/RuntimeDetector';
import { resolveExecutable } from '../system/executableResolver';

export type CapabilityService = {
  getCapabilities(): Promise<AppCapabilities>;
};

async function detectPackageManagers(): Promise<Array<'npm' | 'pnpm' | 'yarn' | 'bun'>> {
  const managers: Array<'npm' | 'pnpm' | 'yarn' | 'bun'> = [];
  for (const pm of ['npm', 'pnpm', 'yarn', 'bun'] as const) {
    if (await resolveExecutable(pm)) managers.push(pm);
  }
  return managers;
}

export function createCapabilityService(
  gitResolver: GitExecutableResolver,
  settingsStore: SettingsStore,
  terminalLauncher: TerminalLauncher,
  sdkResolver: SdkResolver
): CapabilityService {
  async function getCapabilities(): Promise<AppCapabilities> {
    const settings = settingsStore.get();
    const [gitCapability, terminalAvailable, availableEditors, availableTerminals, android, runtimes, packageManagers] =
      await Promise.all([
        gitResolver.resolve(),
        terminalLauncher.isAvailable(settings.terminal).catch(() => false),
        listAvailableEditorPresets().catch(() => [] as Awaited<ReturnType<typeof listAvailableEditorPresets>>),
        listAvailableTerminalPresets().catch(
          () => [] as Awaited<ReturnType<typeof listAvailableTerminalPresets>>
        ),
        sdkResolver.resolve(),
        probeRuntimes().catch(() => []),
        detectPackageManagers().catch(() => [] as Array<'npm' | 'pnpm' | 'yarn' | 'bun'>),
      ]);

    return {
      apiVersion: 1,
      platform: `${process.platform}-${process.arch}`,
      appVersion: typeof app?.getVersion === 'function' ? app.getVersion() : '0.1.0',
      gitAvailable: gitCapability.kind === 'available',
      gitVersion:
        gitCapability.kind === 'available'
          ? `${gitCapability.version.major}.${gitCapability.version.minor}.${gitCapability.version.patch}`
          : undefined,
      terminalAvailable,
      availableEditors,
      availableTerminals,
      editor: settings.editor,
      terminal: settings.terminal,
      android,
      runtimes,
      packageManagers,
    };
  }

  return { getCapabilities };
}
