import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { AndroidAvd, StartAvdRequest, StopAvdRequest } from '@shared/contracts/android';
import type { OkResult } from '@shared/contracts/errors';
import { toBureauError } from '../ipc/errors';
import { stopProcessTree } from '../processes/treeKill';
import type { AdbService } from './AdbService';
import type { ExecutableAdapter } from './ExecutableAdapter';
import type { SdkResolver } from './SdkResolver';
import { parseAvdList } from './parsers';
import { watchEmulatorWindow } from './EmulatorWindowRescue';
import { sanitizeEmulatorWindowPos } from './windowPosGuard';

export type AvdService = ReturnType<typeof createAvdService>;

type LaunchRecord = { child: ChildProcess; stderr: string; state: 'starting' | 'error' };

export function createAvdService(
  resolver: SdkResolver,
  adapter: ExecutableAdapter,
  adb: AdbService,
  stopTree: typeof stopProcessTree = stopProcessTree
) {
  const launched = new Map<string, LaunchRecord>();

  async function list(): Promise<AndroidAvd[]> {
    const status = await resolver.resolve();
    if (!status.emulator.path) {
      if (!status.sdkPath) return [];
      throw toBureauError({
        code: 'SDK_NOT_FOUND',
        message: 'The Android SDK emulator tool is not installed.',
        operation: 'android.avd.list',
        retryable: true,
      });
    }
    const result = await adapter.run(status.emulator.path, ['-list-avds'], { timeoutMs: 10_000 });
    if (result.code !== 0)
      throw new Error(result.stderr || 'Could not list Android virtual devices.');
    const devices = status.adb.available ? await adb.listDevices().catch(() => []) : [];
    return Promise.all(
      parseAvdList(result.stdout).map(async (name): Promise<AndroidAvd> => {
        const device = devices.find((candidate) => candidate.avdName === name);
        const booted =
          device?.state === 'device' ? await adb.bootStatus(device.id).catch(() => false) : false;
        const metadata = await readAvdMetadata(name);
        const launch = launched.get(name);
        return {
          name,
          ...metadata,
          serial: device?.id,
          booted,
          state: device ? (booted ? 'running' : 'booting') : (launch?.state ?? 'stopped'),
          error: launch?.state === 'error' ? virtualizationHint(launch.stderr) : undefined,
        };
      })
    );
  }

  async function start(input: StartAvdRequest): Promise<OkResult> {
    if (input.options.wipeData && !input.confirmedWipe) {
      return {
        ok: false,
        error: toBureauError({
          code: 'INVALID_REQUEST',
          message: 'Wiping AVD data requires confirmation.',
          operation: 'android.avd.start',
          subjectId: input.name,
        }),
      };
    }
    try {
      const existing = (await list()).find((avd) => avd.name === input.name);
      if (!existing)
        return {
          ok: false,
          error: toBureauError({
            code: 'AVD_NOT_FOUND',
            message: 'The selected AVD no longer exists.',
            operation: 'android.avd.start',
            subjectId: input.name,
          }),
        };
      // The emulator restores its own window geometry after the window appears and can
      // land off-screen regardless of launch flags or config files. The watcher nudges
      // the window back on-screen only while it is unreachable, then exits. Running it
      // for an already-started AVD makes "Start" double as a rescue for a lost window.
      watchEmulatorWindow(adapter, input.name);
      if (existing.serial || launched.get(input.name)?.state === 'starting') return { ok: true };
      const status = await resolver.resolve();
      if (!status.emulator.path) throw new Error('Android emulator executable not found.');
      // Drop a stale saved window position that would open the emulator off-screen
      // (e.g. after a monitor was disconnected). Best effort — never blocks the launch.
      await sanitizeEmulatorWindowPos(input.name).catch(() => undefined);
      const args = ['-avd', input.name];
      if (input.options.coldBoot) args.push('-no-snapshot-load');
      if (input.options.wipeData) args.push('-wipe-data');
      if (input.options.gpu !== 'auto') args.push('-gpu', input.options.gpu);
      if (input.options.dnsServer) args.push('-dns-server', input.options.dnsServer);
      if (input.options.writableSystem) args.push('-writable-system');
      const child = adapter.spawn(status.emulator.path, args, {
        cwd: status.sdkPath ?? undefined,
        // GUI app: inheriting the hidden-window flag would launch it invisible.
        windowsHide: false,
      });
      const record: LaunchRecord = { child, stderr: '', state: 'starting' };
      launched.set(input.name, record);
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => {
        record.stderr = (record.stderr + chunk).slice(-8192);
      });
      child.on('error', (error) => {
        record.stderr = error.message;
        record.state = 'error';
      });
      child.on('close', (code) => {
        if (code && code !== 0) record.state = 'error';
        else launched.delete(input.name);
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 300);
        child.once('spawn', () => {
          clearTimeout(timer);
          resolve();
        });
        child.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: toBureauError({
          code: 'EMULATOR_LAUNCH_FAILED',
          message: virtualizationHint(error instanceof Error ? error.message : String(error)),
          operation: 'android.avd.start',
          subjectId: input.name,
          retryable: true,
        }),
      };
    }
  }

  async function stop(input: StopAvdRequest): Promise<OkResult> {
    try {
      const record = launched.get(input.name);
      let serial = input.deviceId;
      if (!serial) {
        try {
          serial = (await list()).find((candidate) => candidate.name === input.name)?.serial;
        } catch (error) {
          if (!record) throw error;
        }
      }
      if (!serial && !record) {
        return {
          ok: false,
          error: toBureauError({
            code: 'AVD_NOT_FOUND',
            message: 'The AVD is not running.',
            operation: 'android.avd.stop',
            subjectId: input.name,
          }),
        };
      }

      let gracefulError: unknown;
      if (serial) {
        try {
          await adb.stopEmulator(serial);
        } catch (error) {
          gracefulError = error;
        }
      }

      if (record) await stopTree(record.child);
      else if (gracefulError) throw gracefulError;

      launched.delete(input.name);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: toBureauError({
          code: 'COMMAND_FAILED',
          message: error instanceof Error ? error.message : 'The emulator could not be stopped.',
          operation: 'android.avd.stop',
          subjectId: input.name,
          retryable: true,
        }),
      };
    }
  }

  async function dispose(): Promise<void> {
    await Promise.allSettled([...launched.values()].map((record) => stopTree(record.child)));
    launched.clear();
  }

  return { list, start, stop, dispose };
}

async function readAvdMetadata(name: string): Promise<Pick<AndroidAvd, 'target' | 'apiLevel'>> {
  try {
    const ini = await readFile(path.join(os.homedir(), '.android', 'avd', `${name}.ini`), 'utf8');
    const avdPath = ini.match(/^path=(.+)$/m)?.[1]?.trim();
    if (!avdPath) return {};
    const config = await readFile(path.join(avdPath, 'config.ini'), 'utf8');
    const target = config.match(/^target=(.+)$/m)?.[1]?.trim();
    const apiText = target?.match(/android-(\d+)/i)?.[1];
    return { target, apiLevel: apiText ? Number(apiText) : undefined };
  } catch {
    return {};
  }
}

function virtualizationHint(stderr: string): string {
  const text = stderr.replace(/\s+/g, ' ').trim();
  if (/WHPX|HAXM|Hyper-V|hypervisor|virtualization|accel/i.test(text)) {
    return `Emulator acceleration failed. Check BIOS virtualization and WHPX, Hyper-V, or HAXM configuration. ${text}`.trim();
  }
  return text || 'The Android emulator failed to launch.';
}
