import type { ChildProcess } from 'node:child_process';
import type { AndroidDeviceRequest, ScrcpyLaunchRequest } from '@shared/contracts/android';
import type { OkResult } from '@shared/contracts/errors';
import { toBureauError } from '../ipc/errors';
import type { AdbService } from './AdbService';
import type { ExecutableAdapter } from './ExecutableAdapter';
import type { SdkResolver } from './SdkResolver';

export type ScrcpyLauncher = ReturnType<typeof createScrcpyLauncher>;

export function createScrcpyLauncher(
  resolver: SdkResolver,
  adapter: ExecutableAdapter,
  adb: AdbService
) {
  const running = new Map<string, ChildProcess>();

  async function launch(input: ScrcpyLaunchRequest): Promise<OkResult> {
    try {
      const status = await resolver.resolve();
      if (!status.scrcpy.path)
        return {
          ok: false,
          error: toBureauError({
            code: 'SCRCPY_NOT_FOUND',
            message:
              'scrcpy was not found. Install it or configure its executable in Android settings.',
            operation: 'android.scrcpy.start',
            retryable: true,
          }),
        };
      const device = await adb.selectDevice(input.deviceId);
      const existing = running.get(device.id);
      if (existing && !existing.killed) return { ok: true };
      const args = ['--serial', device.id, `--video-bit-rate=${input.bitrateMbps}M`];
      if (input.maxSize) args.push(`--max-size=${input.maxSize}`);
      if (input.recordPath) args.push(`--record=${input.recordPath}`);
      // GUI app: inheriting the hidden-window flag would launch it invisible.
      const child = adapter.spawn(status.scrcpy.path, args, { windowsHide: false });
      running.set(device.id, child);
      child.on('close', () => running.delete(device.id));
      child.on('error', () => running.delete(device.id));
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: isDomainError(error)
          ? error
          : toBureauError({
              code: 'COMMAND_FAILED',
              message: error instanceof Error ? error.message : 'scrcpy could not be launched.',
              operation: 'android.scrcpy.start',
              retryable: true,
            }),
      };
    }
  }

  async function stop(input: AndroidDeviceRequest): Promise<OkResult> {
    try {
      const device = await adb.selectDevice(input.deviceId);
      running.get(device.id)?.kill();
      running.delete(device.id);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: isDomainError(error)
          ? error
          : toBureauError({
              code: 'COMMAND_FAILED',
              message: 'scrcpy could not be stopped.',
              operation: 'android.scrcpy.stop',
            }),
      };
    }
  }

  function dispose(): void {
    for (const child of running.values()) child.kill();
    running.clear();
  }

  return { launch, stop, dispose };
}

function isDomainError(error: unknown): error is import('@shared/contracts/errors').BureauError {
  return typeof error === 'object' && error !== null && 'code' in error && 'operation' in error;
}
