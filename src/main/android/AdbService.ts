import { access } from 'node:fs/promises';
import type {
  AndroidDevice,
  AndroidPackagesResult,
  ApkInstallRequest,
  ApkInstallResult,
  ApkLaunchRequest,
  ApkUninstallRequest,
} from '@shared/contracts/android';
import type { OkResult } from '@shared/contracts/errors';
import { toBureauError } from '../ipc/errors';
import type { ExecutableAdapter } from './ExecutableAdapter';
import type { SdkResolver } from './SdkResolver';
import {
  launchFailureMessage,
  monkeyLaunchSucceeded,
  parseAdbDevices,
  parseInstallFailure,
  parsePackageList,
} from './parsers';

export type AdbService = ReturnType<typeof createAdbService>;

function deviceError(
  code: 'NO_DEVICES' | 'AMBIGUOUS_DEVICE' | 'DEVICE_UNAUTHORIZED' | 'DEVICE_OFFLINE',
  message: string,
  subjectId?: string
) {
  return toBureauError({ code, message, operation: 'android.device', subjectId, retryable: true });
}

export function createAdbService(resolver: SdkResolver, adapter: ExecutableAdapter) {
  async function adbPath(): Promise<string> {
    const status = await resolver.resolve();
    if (!status.adb.path) {
      throw toBureauError({
        code: 'ADB_UNAVAILABLE',
        message: 'ADB was not found in the Android SDK or PATH.',
        operation: 'android.adb',
        retryable: true,
      });
    }
    return status.adb.path;
  }

  async function run(args: string[], timeoutMs = 15_000) {
    return adapter.run(await adbPath(), args, { timeoutMs });
  }

  async function listDevices(): Promise<AndroidDevice[]> {
    const start = await run(['start-server']);
    if (start.code !== 0) {
      throw toBureauError({
        code: 'ADB_UNAVAILABLE',
        message: 'ADB server could not be started.',
        operation: 'android.devices.list',
        retryable: true,
        details: start.stderr,
      });
    }
    const result = await run(['devices', '-l']);
    if (result.code !== 0) {
      throw toBureauError({
        code: 'ADB_UNAVAILABLE',
        message: 'ADB could not list devices.',
        operation: 'android.devices.list',
        retryable: true,
        details: result.stderr,
      });
    }
    const devices = parseAdbDevices(result.stdout);
    await Promise.all(
      devices
        .filter((device) => device.type === 'emulator' && device.state === 'device')
        .map(async (device) => {
          const [avd, api] = await Promise.all([
            // Newer system images leave ro.kernel.qemu.avd_name empty and report the
            // name via ro.boot.qemu.avd_name instead; query both and take the first
            // non-empty line so the AVD row can match its running device.
            run(
              [
                '-s',
                device.id,
                'shell',
                'getprop ro.boot.qemu.avd_name; getprop ro.kernel.qemu.avd_name',
              ],
              4_000
            ),
            run(['-s', device.id, 'shell', 'getprop', 'ro.build.version.sdk'], 4_000),
          ]);
          if (avd.code === 0) {
            const name = avd.stdout
              .split(/\r?\n/)
              .map((line) => line.trim())
              .find(Boolean);
            if (name) device.avdName = name;
          }
          const level = Number(api.stdout.trim());
          if (api.code === 0 && Number.isFinite(level)) device.apiLevel = level;
        })
    );
    return devices;
  }

  async function restartServer(): Promise<void> {
    await run(['kill-server'], 10_000).catch(() => undefined);
    const result = await run(['start-server'], 15_000);
    if (result.code !== 0) {
      throw toBureauError({
        code: 'ADB_UNAVAILABLE',
        message: 'ADB server could not be restarted. Check whether another process owns port 5037.',
        operation: 'android.adb.restart',
        retryable: true,
        details: result.stderr,
      });
    }
  }

  async function selectDevice(deviceId?: string): Promise<AndroidDevice> {
    const devices = await listDevices();
    if (devices.length === 0) throw deviceError('NO_DEVICES', 'No Android devices are connected.');
    if (!deviceId && devices.length > 1)
      throw deviceError('AMBIGUOUS_DEVICE', 'Select a device before running this action.');
    const device = deviceId ? devices.find((item) => item.id === deviceId) : devices[0];
    if (!device)
      throw deviceError('NO_DEVICES', 'The selected device is no longer connected.', deviceId);
    if (device.state === 'unauthorized')
      throw deviceError(
        'DEVICE_UNAUTHORIZED',
        'Accept the USB debugging prompt on the device.',
        device.id
      );
    if (device.state !== 'device')
      throw deviceError(
        'DEVICE_OFFLINE',
        'The selected device is offline. Reconnect it or restart ADB.',
        device.id
      );
    return device;
  }

  async function install(input: ApkInstallRequest): Promise<ApkInstallResult> {
    try {
      await access(input.apkPath);
      const device = await selectDevice(input.deviceId);
      const args = ['-s', device.id, 'install'];
      if (input.replace) args.push('-r');
      args.push(input.apkPath);
      const result = await run(args, 180_000);
      if (result.code !== 0 || /Failure\s*\[/i.test(result.stdout + result.stderr)) {
        const failure = parseInstallFailure(`${result.stdout}\n${result.stderr}`);
        return {
          ok: false,
          error: toBureauError({
            code: 'APK_INSTALL_FAILED',
            message: failure.message,
            operation: 'android.apk.install',
            subjectId: device.id,
            details: result.stderr || result.stdout,
          }),
        };
      }
      return { ok: true, message: result.stdout.trim() || 'APK installed.' };
    } catch (error) {
      if (isDomainError(error)) return { ok: false, error };
      return {
        ok: false,
        error: toBureauError({
          code: 'APK_INSTALL_FAILED',
          message: error instanceof Error ? error.message : 'The APK could not be read.',
          operation: 'android.apk.install',
        }),
      };
    }
  }

  async function launch(input: ApkLaunchRequest): Promise<OkResult> {
    try {
      const device = await selectDevice(input.deviceId);
      const args = input.activity
        ? ['-s', device.id, 'shell', 'am', 'start', '-n', `${input.packageName}/${input.activity}`]
        : [
            '-s',
            device.id,
            'shell',
            'monkey',
            '-p',
            input.packageName,
            '-c',
            'android.intent.category.LAUNCHER',
            '1',
          ];
      const result = await run(args, 30_000);
      const output = `${result.stdout}\n${result.stderr}`;
      // `am start` reports failure as an "Error:" line (often with exit code 0), while
      // `monkey` only confirms success by injecting the launcher event.
      const launched = input.activity
        ? result.code === 0 && !/Error:|Exception|does not exist/i.test(output)
        : monkeyLaunchSucceeded(output);
      if (!launched) {
        throw toBureauError({
          code: 'COMMAND_FAILED',
          message: launchFailureMessage(output, input.packageName),
          operation: 'android.apk.launch',
          subjectId: input.packageName,
        });
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: isDomainError(error)
          ? error
          : toBureauError({
              code: 'COMMAND_FAILED',
              message: error instanceof Error ? error.message : 'The app could not be launched.',
              operation: 'android.apk.launch',
            }),
      };
    }
  }

  async function uninstall(input: ApkUninstallRequest): Promise<OkResult> {
    if (!input.confirmed)
      return {
        ok: false,
        error: toBureauError({
          code: 'INVALID_REQUEST',
          message: 'Uninstall requires confirmation.',
          operation: 'android.apk.uninstall',
        }),
      };
    try {
      const device = await selectDevice(input.deviceId);
      const result = await run(['-s', device.id, 'uninstall', input.packageName], 60_000);
      if (result.code !== 0 || !/Success/i.test(result.stdout))
        throw new Error(result.stderr || result.stdout);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: isDomainError(error)
          ? error
          : toBureauError({
              code: 'APK_UNINSTALL_FAILED',
              message:
                error instanceof Error ? error.message : 'The package could not be uninstalled.',
              operation: 'android.apk.uninstall',
            }),
      };
    }
  }

  async function listPackages(deviceId?: string): Promise<AndroidPackagesResult> {
    const device = await selectDevice(deviceId);
    const result = await run(['-s', device.id, 'shell', 'pm', 'list', 'packages'], 30_000);
    if (result.code !== 0) throw new Error(result.stderr || 'Could not list packages.');
    return { deviceId: device.id, packages: parsePackageList(result.stdout) };
  }

  async function bootStatus(deviceId: string): Promise<boolean> {
    const result = await run(['-s', deviceId, 'shell', 'getprop', 'sys.boot_completed'], 4_000);
    return result.code === 0 && result.stdout.trim() === '1';
  }

  async function stopEmulator(deviceId: string): Promise<void> {
    const result = await run(['-s', deviceId, 'emu', 'kill'], 10_000);
    if (result.code !== 0) throw new Error(result.stderr || 'The emulator did not stop.');
  }

  async function reversePort(deviceId: string | undefined, port: number): Promise<void> {
    const device = await selectDevice(deviceId);
    const endpoint = `tcp:${port}`;
    const result = await run(['-s', device.id, 'reverse', endpoint, endpoint], 15_000);
    if (result.code !== 0)
      throw new Error(result.stderr || 'ADB could not reverse the Metro port.');
  }

  async function openDevMenu(deviceId?: string): Promise<void> {
    const device = await selectDevice(deviceId);
    const result = await run(['-s', device.id, 'shell', 'input', 'keyevent', '82'], 10_000);
    if (result.code !== 0)
      throw new Error(result.stderr || 'ADB could not open the developer menu.');
  }

  async function reloadReactNative(
    deviceId: string | undefined,
    packageName: string
  ): Promise<void> {
    const device = await selectDevice(deviceId);
    const result = await run(
      [
        '-s',
        device.id,
        'shell',
        'am',
        'broadcast',
        '-a',
        `${packageName}.RELOAD_APP_ACTION`,
        '-p',
        packageName,
      ],
      10_000
    );
    if (result.code !== 0 || /Exception|Error:/i.test(result.stdout + result.stderr)) {
      throw new Error(result.stderr || result.stdout || 'The React Native app did not reload.');
    }
  }

  return {
    adbPath,
    run,
    listDevices,
    restartServer,
    selectDevice,
    install,
    launch,
    uninstall,
    listPackages,
    bootStatus,
    stopEmulator,
    reversePort,
    openDevMenu,
    reloadReactNative,
  };
}

function isDomainError(error: unknown): error is import('@shared/contracts/errors').BureauError {
  return typeof error === 'object' && error !== null && 'code' in error && 'operation' in error;
}
