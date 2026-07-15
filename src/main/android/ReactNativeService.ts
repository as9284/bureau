import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ReactNativeDeviceRequest, ReactNativeProjectStatus } from '@shared/contracts/android';
import type { OkResult } from '@shared/contracts/errors';
import type { PackageManager, ProcessDefinition } from '@shared/contracts/projects';
import type { ProcessApplicationService } from '../processes/ProcessApplicationService';
import type { ProjectCatalogue } from '../projects/ProjectCatalogue';
import type { SettingsStore } from '../settings/SettingsStore';
import { toBureauError } from '../ipc/errors';
import type { AdbService } from './AdbService';

const METRO_PROCESS_ID = 'react-native-metro';
const ANDROID_PROCESS_PREFIX = 'react-native-android-';

type ProjectInspection = {
  root: string;
  detected: boolean;
  nativeAndroid: boolean;
  packageManager?: PackageManager;
  startScriptAvailable: boolean;
  androidScriptAvailable: boolean;
  packageName?: string;
  reason?: string;
};

export type ReactNativeService = ReturnType<typeof createReactNativeService>;

export function createReactNativeService(params: {
  catalogue: ProjectCatalogue;
  processes: ProcessApplicationService;
  adb: AdbService;
  settingsStore: SettingsStore;
}) {
  const { catalogue, processes, adb, settingsStore } = params;

  async function inspect(projectId: string): Promise<ProjectInspection> {
    const project = catalogue.get(projectId);
    if (!project) {
      throw toBureauError({
        code: 'PROJECT_NOT_FOUND',
        message: 'Project not found.',
        operation: 'android.reactNative.inspect',
      });
    }

    const root = project.path;
    const pkg = await readPackageJson(root);
    if (!pkg) {
      return unavailable(root, 'No readable package.json was found.');
    }
    const detected = hasStringDependency(pkg, 'react-native');
    if (!detected) {
      return unavailable(root, 'This project does not declare react-native.');
    }

    const scripts = asRecord(pkg.scripts);
    const startScript = typeof scripts?.start === 'string' ? scripts.start : '';
    const androidScript = typeof scripts?.android === 'string' ? scripts.android : '';
    const nativeAndroid = await exists(path.join(root, 'android'));
    const startScriptAvailable = /(?:react-native|rnc-cli)\s+start\b/.test(startScript);
    const androidScriptAvailable = /(?:react-native|rnc-cli)\s+run-android\b/.test(androidScript);
    const packageName = nativeAndroid ? await detectAndroidPackage(root) : undefined;
    let reason: string | undefined;
    if (!nativeAndroid)
      reason =
        'No native android directory was found. Run an Expo prebuild first if this is a managed Expo project.';
    else if (!startScriptAvailable)
      reason = 'The start script does not launch the React Native CLI development server.';
    else if (!androidScriptAvailable)
      reason = 'The android script does not run the React Native Android CLI.';

    return {
      root,
      detected,
      nativeAndroid,
      packageManager: await detectPackageManager(root),
      startScriptAvailable,
      androidScriptAvailable,
      packageName,
      reason,
    };
  }

  async function getStatus(projectId: string): Promise<ReactNativeProjectStatus> {
    const inspection = await inspect(projectId);
    const projectProcesses = await processes.list({ projectId });
    const metro = projectProcesses.runtimes.find(
      (runtime) => runtime.processId === METRO_PROCESS_ID
    );
    const android = [...projectProcesses.runtimes]
      .reverse()
      .find((runtime) => runtime.processId.startsWith(ANDROID_PROCESS_PREFIX));
    const androidSettings = settingsStore.get().android;
    return {
      detected: inspection.detected,
      nativeAndroid: inspection.nativeAndroid,
      packageManager: inspection.packageManager,
      metroPort: androidSettings.reactNativeMetroPort,
      autoReverse: androidSettings.reactNativeAutoReverse,
      metroProcessId: METRO_PROCESS_ID,
      metroStatus: metro?.status ?? 'idle',
      androidProcessId: android?.processId,
      androidStatus: android?.status,
      startScriptAvailable: inspection.startScriptAvailable,
      androidScriptAvailable: inspection.androidScriptAvailable,
      packageName: inspection.packageName,
      reason: inspection.reason,
    };
  }

  async function startMetro(projectId: string): Promise<OkResult> {
    return protect('android.reactNative.metro.start', async () => {
      const inspection = await requireRunnable(projectId);
      const existing = await processes.list({ projectId });
      const runtime = existing.runtimes.find((item) => item.processId === METRO_PROCESS_ID);
      if (runtime?.status === 'running' || runtime?.status === 'starting') return { ok: true };
      const port = settingsStore.get().android.reactNativeMetroPort;
      await processes.saveDefinition({
        projectId,
        definition: processDefinition(
          METRO_PROCESS_ID,
          `React Native Metro :${port}`,
          inspection.packageManager!,
          scriptArgs(inspection.packageManager!, 'start', ['--port', String(port)]),
          { RCT_METRO_PORT: String(port) }
        ),
      });
      return processes.start({ projectId, processId: METRO_PROCESS_ID });
    });
  }

  async function stopMetro(projectId: string): Promise<OkResult> {
    return protect('android.reactNative.metro.stop', async () => {
      const current = await processes.list({ projectId });
      const runtime = current.runtimes.find((item) => item.processId === METRO_PROCESS_ID);
      if (!runtime || !['starting', 'running'].includes(runtime.status)) return { ok: true };
      return processes.stop({ projectId, processId: METRO_PROCESS_ID });
    });
  }

  async function runAndroid(input: ReactNativeDeviceRequest): Promise<OkResult> {
    return protect('android.reactNative.run', async () => {
      const inspection = await requireRunnable(input.projectId);
      const device = await adb.selectDevice(input.deviceId);
      const metro = await startMetro(input.projectId);
      if (!metro.ok) return metro;
      const port = input.port ?? settingsStore.get().android.reactNativeMetroPort;
      if (settingsStore.get().android.reactNativeAutoReverse) {
        await adb.reversePort(device.id, port);
      }
      const processId = `${ANDROID_PROCESS_PREFIX}${slug(device.id)}`.slice(0, 64);
      const cliArgs = ['--device', device.id, '--no-packager', '--port', String(port)];
      await processes.saveDefinition({
        projectId: input.projectId,
        definition: processDefinition(
          processId,
          `React Native Android on ${device.model ?? device.id}`,
          inspection.packageManager!,
          scriptArgs(inspection.packageManager!, 'android', cliArgs),
          { ANDROID_SERIAL: device.id, RCT_METRO_PORT: String(port) }
        ),
      });
      return processes.start({ projectId: input.projectId, processId });
    });
  }

  async function reversePort(input: ReactNativeDeviceRequest): Promise<OkResult> {
    return protect('android.reactNative.reverse', async () => {
      await requireDetected(input.projectId);
      await adb.reversePort(
        input.deviceId,
        input.port ?? settingsStore.get().android.reactNativeMetroPort
      );
      return { ok: true };
    });
  }

  async function reload(input: ReactNativeDeviceRequest): Promise<OkResult> {
    return protect('android.reactNative.reload', async () => {
      const inspection = await requireDetected(input.projectId);
      const packageName = input.packageName || inspection.packageName;
      if (!packageName) {
        return {
          ok: false,
          error: toBureauError({
            code: 'DETECTION_FAILED',
            message: 'Enter the running Android package name before reloading.',
            operation: 'android.reactNative.reload',
          }),
        };
      }
      await adb.reloadReactNative(input.deviceId, packageName);
      return { ok: true };
    });
  }

  async function openDevMenu(input: ReactNativeDeviceRequest): Promise<OkResult> {
    return protect('android.reactNative.devMenu', async () => {
      await requireDetected(input.projectId);
      await adb.openDevMenu(input.deviceId);
      return { ok: true };
    });
  }

  async function requireDetected(projectId: string): Promise<ProjectInspection> {
    const inspection = await inspect(projectId);
    if (!inspection.detected) throw new Error(inspection.reason);
    return inspection;
  }

  async function requireRunnable(projectId: string): Promise<ProjectInspection> {
    const inspection = await requireDetected(projectId);
    if (
      !inspection.nativeAndroid ||
      !inspection.startScriptAvailable ||
      !inspection.androidScriptAvailable ||
      !inspection.packageManager
    ) {
      throw new Error(inspection.reason || 'This React Native Android project is not runnable.');
    }
    return inspection;
  }

  return { getStatus, startMetro, stopMetro, runAndroid, reversePort, reload, openDevMenu };
}

function processDefinition(
  id: string,
  label: string,
  command: string,
  args: string[],
  env: Record<string, string>
): ProcessDefinition {
  return {
    id,
    label,
    command,
    args,
    cwd: '.',
    env,
    runMode: 'log',
    autoRestart: false,
    runOnOpen: false,
  };
}

function scriptArgs(manager: PackageManager, script: string, args: string[]): string[] {
  if (manager === 'npm' || manager === 'bun') return ['run', script, '--', ...args];
  return ['run', script, ...args];
}

async function readPackageJson(root: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function hasStringDependency(pkg: Record<string, unknown>, name: string): boolean {
  return ['dependencies', 'devDependencies', 'peerDependencies'].some((group) => {
    const dependencies = asRecord(pkg[group]);
    return typeof dependencies?.[name] === 'string';
  });
}

async function detectPackageManager(root: string): Promise<PackageManager> {
  if (await exists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(path.join(root, 'yarn.lock'))) return 'yarn';
  if ((await exists(path.join(root, 'bun.lock'))) || (await exists(path.join(root, 'bun.lockb'))))
    return 'bun';
  return 'npm';
}

async function detectAndroidPackage(root: string): Promise<string | undefined> {
  const candidates = [
    path.join(root, 'android', 'app', 'build.gradle'),
    path.join(root, 'android', 'app', 'build.gradle.kts'),
    path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
  ];
  for (const candidate of candidates) {
    try {
      const source = await readFile(candidate, 'utf8');
      const match =
        source.match(/\bapplicationId\s*(?:=\s*)?["']([A-Za-z][A-Za-z0-9_.]+)["']/) ??
        source.match(/\bpackage\s*=\s*["']([A-Za-z][A-Za-z0-9_.]+)["']/);
      if (match?.[1]) return match[1];
    } catch {
      // Try the next conventional Android project file.
    }
  }
  return undefined;
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function unavailable(root: string, reason: string): ProjectInspection {
  return {
    root,
    detected: false,
    nativeAndroid: false,
    startScriptAvailable: false,
    androidScriptAvailable: false,
    reason,
  };
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'device'
  );
}

async function protect(operation: string, action: () => Promise<OkResult>): Promise<OkResult> {
  try {
    return await action();
  } catch (error) {
    if (isDomainError(error)) return { ok: false, error };
    return {
      ok: false,
      error: toBureauError({
        code: 'COMMAND_FAILED',
        message: error instanceof Error ? error.message : 'The React Native action failed.',
        operation,
        retryable: true,
      }),
    };
  }
}

function isDomainError(error: unknown): error is import('@shared/contracts/errors').BureauError {
  return typeof error === 'object' && error !== null && 'code' in error && 'operation' in error;
}
