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
  const candidates = ['npm', 'pnpm', 'yarn', 'bun'] as const;
  const resolved = await Promise.all(candidates.map((pm) => resolveExecutable(pm)));
  return candidates.filter((_, index) => resolved[index]);
}

type SystemScan = {
  availableEditors: Awaited<ReturnType<typeof listAvailableEditorPresets>>;
  availableTerminals: Awaited<ReturnType<typeof listAvailableTerminalPresets>>;
  runtimes: Awaited<ReturnType<typeof probeRuntimes>>;
  packageManagers: Awaited<ReturnType<typeof detectPackageManagers>>;
};

export function createCapabilityService(
  gitResolver: GitExecutableResolver,
  settingsStore: SettingsStore,
  terminalLauncher: TerminalLauncher,
  sdkResolver: SdkResolver
): CapabilityService {
  // Spawn-heavy system scans that do not depend on settings — installed editors,
  // terminals, language runtimes, and package managers. They only change when the
  // user installs new tooling (which requires a relaunch to pick up), so memoize the
  // detection for the process lifetime. Caching the promise also dedupes concurrent
  // callers — startup and the Git tab's own bootstrap both request capabilities.
  let systemScan: Promise<SystemScan> | null = null;

  function scanSystem(): Promise<SystemScan> {
    if (!systemScan) {
      systemScan = Promise.all([
        listAvailableEditorPresets().catch(
          () => [] as Awaited<ReturnType<typeof listAvailableEditorPresets>>
        ),
        listAvailableTerminalPresets().catch(
          () => [] as Awaited<ReturnType<typeof listAvailableTerminalPresets>>
        ),
        probeRuntimes().catch(() => [] as Awaited<ReturnType<typeof probeRuntimes>>),
        detectPackageManagers().catch(
          () => [] as Awaited<ReturnType<typeof detectPackageManagers>>
        ),
      ]).then(([availableEditors, availableTerminals, runtimes, packageManagers]) => ({
        availableEditors,
        availableTerminals,
        runtimes,
        packageManagers,
      }));
    }
    return systemScan;
  }

  async function getCapabilities(): Promise<AppCapabilities> {
    const settings = settingsStore.get();
    // Settings-dependent capabilities are resolved on every call so a settings change
    // (custom git path, terminal, Android SDK path) is reflected immediately; the
    // system scan is served from the process-lifetime cache after the first call.
    const [scan, gitCapability, terminalAvailable, android] = await Promise.all([
      scanSystem(),
      gitResolver.resolve(),
      terminalLauncher.isAvailable(settings.terminal).catch(() => false),
      sdkResolver.resolve(),
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
      availableEditors: scan.availableEditors,
      availableTerminals: scan.availableTerminals,
      editor: settings.editor,
      terminal: settings.terminal,
      android,
      runtimes: scan.runtimes,
      packageManagers: scan.packageManagers,
    };
  }

  return { getCapabilities };
}
