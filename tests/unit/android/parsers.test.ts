import { describe, expect, it } from 'vitest';
import {
  launchFailureMessage,
  monkeyLaunchSucceeded,
  parseAdbDevices,
  parseAvdList,
  parseInstallFailure,
  parseLogcatLine,
  parsePackageList,
} from '@main/android/parsers';

// Real output captured from `monkey -p <pkg> -c android.intent.category.LAUNCHER 1`.
const MONKEY_ABORT = `args: [-p, com.evolvlxp, -c, android.intent.category.LAUNCHER, 1]
 arg: "-p"
 arg: "com.evolvlxp"
data="com.evolvlxp"
data="android.intent.category.LAUNCHER"
** No activities found to run, monkey aborted.`;
const MONKEY_OK = `args: [-p, com.android.settings, -c, android.intent.category.LAUNCHER, 1]
data="com.android.settings"
Events injected: 1
## Network stats: elapsed time=35ms`;

describe('Android output parsers', () => {
  it('parses and deduplicates emulator AVD names', () => {
    expect(parseAvdList('Pixel_8_API_35\r\nTablet_API_34\nPixel_8_API_35\n')).toEqual([
      'Pixel_8_API_35',
      'Tablet_API_34',
    ]);
  });

  it('parses physical, emulator, offline, and unauthorized adb devices', () => {
    const devices = parseAdbDevices(`List of devices attached
emulator-5554 device product:sdk_gphone64 model:sdk_gphone64_x86_64 transport_id:1
R58M123 unauthorized usb:1-1 transport_id:2
192.168.1.20:5555 offline transport_id:3
`);
    expect(devices).toHaveLength(3);
    expect(devices[0]).toMatchObject({ id: 'emulator-5554', type: 'emulator', state: 'device' });
    expect(devices[1]).toMatchObject({ id: 'R58M123', type: 'physical', state: 'unauthorized' });
    expect(devices[2].state).toBe('offline');
  });

  it('parses threadtime logcat lines with PID package enrichment', () => {
    const line = parseLogcatLine(
      '07-14 10:22:31.123  1234  1250 E ActivityManager: Process crashed',
      7,
      new Map([[1234, 'com.example.app']])
    );
    expect(line).toEqual({
      seq: 7,
      timestamp: '07-14 10:22:31.123',
      pid: 1234,
      tid: 1250,
      priority: 'E',
      tag: 'ActivityManager',
      packageName: 'com.example.app',
      message: 'Process crashed',
    });
  });

  it('maps common APK installation failures', () => {
    expect(parseInstallFailure('Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]').cause).toBe(
      'signature-mismatch'
    );
    expect(parseInstallFailure('Failure [INSTALL_FAILED_OLDER_SDK]').cause).toBe('older-sdk');
    expect(parseInstallFailure('Failure [INSTALL_FAILED_VERSION_DOWNGRADE]').cause).toBe(
      'downgrade'
    );
  });

  it('parses package-manager output', () => {
    expect(parsePackageList('package:com.zeta\npackage:com.alpha\n')).toEqual([
      'com.alpha',
      'com.zeta',
    ]);
  });

  it('detects monkey launch success only via the injected-event line', () => {
    expect(monkeyLaunchSucceeded(MONKEY_OK)).toBe(true);
    expect(monkeyLaunchSucceeded(MONKEY_ABORT)).toBe(false);
    expect(monkeyLaunchSucceeded('Events injected: 0')).toBe(false);
  });

  it('turns a monkey abort into an actionable "not installed" message, not raw noise', () => {
    const message = launchFailureMessage(MONKEY_ABORT, 'com.evolvlxp');
    expect(message).toContain('com.evolvlxp');
    expect(message).toContain('not installed');
    expect(message).not.toContain('arg:');
    expect(message).not.toContain('data=');
  });

  it('surfaces an am start Error line for a bad activity', () => {
    const message = launchFailureMessage(
      'Starting: Intent { cmp=com.x/.Bad }\nError: Activity class {com.x/.Bad} does not exist.',
      'com.x'
    );
    expect(message).toContain('not installed');
  });

  it('falls back to a generic message when output is unrecognized', () => {
    expect(launchFailureMessage('weird unexpected text', 'com.x')).toBe(
      'The app could not be launched.'
    );
  });
});
