import type { AndroidDevice, LogcatLine, LogcatPriority } from '@shared/contracts/android';

export function parseAvdList(output: string): string[] {
  return [
    ...new Set(
      output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    ),
  ];
}

export function parseAdbDevices(output: string): AndroidDevice[] {
  const devices: AndroidDevice[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('List of devices attached') || line.startsWith('* daemon'))
      continue;
    const [id, stateRaw, ...fields] = line.split(/\s+/);
    if (!id || !stateRaw) continue;
    const state = ['device', 'offline', 'unauthorized'].includes(stateRaw)
      ? (stateRaw as AndroidDevice['state'])
      : 'unknown';
    const metadata = Object.fromEntries(
      fields.flatMap((field) => {
        const index = field.indexOf(':');
        return index > 0 ? [[field.slice(0, index), field.slice(index + 1)]] : [];
      })
    );
    devices.push({
      id,
      state,
      type: id.startsWith('emulator-') ? 'emulator' : 'physical',
      model: metadata.model?.replace(/_/g, ' '),
      product: metadata.product,
      transportId: metadata.transport_id,
    });
  }
  return devices;
}

const LOGCAT_RE =
  /^(\d\d-\d\d\s+\d\d:\d\d:\d\d\.\d+)\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+(.+?)\s*:\s?(.*)$/;

export function parseLogcatLine(
  raw: string,
  seq = 0,
  packageByPid: ReadonlyMap<number, string> = new Map()
): LogcatLine | null {
  const match = raw.match(LOGCAT_RE);
  if (!match) return null;
  const pid = Number(match[2]);
  return {
    seq,
    timestamp: match[1],
    pid,
    tid: Number(match[3]),
    priority: match[4] as Exclude<LogcatPriority, 'S'>,
    tag: match[5].trim(),
    packageName: packageByPid.get(pid),
    message: match[6],
  };
}

export type ApkInstallFailure =
  | 'signature-mismatch'
  | 'older-sdk'
  | 'downgrade'
  | 'already-exists'
  | 'insufficient-storage'
  | 'invalid-apk'
  | 'unknown';

export function parseInstallFailure(output: string): { cause: ApkInstallFailure; message: string } {
  const text = output.trim();
  if (/UPDATE_INCOMPATIBLE|signatures do not match/i.test(text)) {
    return {
      cause: 'signature-mismatch',
      message: 'The installed app has a different signature. Uninstall it first.',
    };
  }
  if (/OLDER_SDK/i.test(text))
    return {
      cause: 'older-sdk',
      message: 'The device Android version is below the APK minimum SDK.',
    };
  if (/VERSION_DOWNGRADE/i.test(text))
    return { cause: 'downgrade', message: 'The APK version is older than the installed app.' };
  if (/ALREADY_EXISTS/i.test(text))
    return { cause: 'already-exists', message: 'The package is already installed.' };
  if (/INSUFFICIENT_STORAGE/i.test(text))
    return {
      cause: 'insufficient-storage',
      message: 'The device does not have enough free storage.',
    };
  if (/INVALID_APK|NO_CERTIFICATES/i.test(text))
    return { cause: 'invalid-apk', message: 'The selected file is not a valid signed APK.' };
  return { cause: 'unknown', message: text || 'ADB could not install the APK.' };
}

// A `monkey ... LAUNCHER 1` launch succeeds only when it injects the event; on a missing
// package or one without a launchable activity it prints "No activities found to run,
// monkey aborted." and exits non-zero. Treat the injected-event line as the sole success
// signal so monkey's noisy argument echo is never mistaken for output.
export function monkeyLaunchSucceeded(output: string): boolean {
  return /Events injected:\s*[1-9]/.test(output);
}

// Turn raw launch output (monkey or `am start`) into a concise, actionable message.
export function launchFailureMessage(output: string, packageName: string): string {
  if (
    /No activities found|monkey aborted|does not exist|Unknown package|Package .* (is currently frozen|not found)/i.test(
      output
    )
  ) {
    return `${packageName} is not installed on this device, or has no launchable activity. Install the app first.`;
  }
  const line = output
    .split(/\r?\n/)
    .map((item) => item.trim())
    .reverse()
    .find((item) => /error|exception|denial|failure/i.test(item));
  return line ? `The app could not be launched: ${line}` : 'The app could not be launched.';
}

export function parsePackageList(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^package:/, ''))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

export function parsePidPackageMap(output: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const line of output.split(/\r?\n/).slice(1)) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (match) map.set(Number(match[1]), match[2].trim());
  }
  return map;
}
