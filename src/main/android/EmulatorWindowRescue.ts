import type { ExecutableAdapter } from './ExecutableAdapter';

// The Android emulator (Qt) restores its own window geometry AFTER the window is
// created — repeatedly while booting — and on some machines that lands it off-screen
// and at an unwanted (often oversized) size no matter how or where it was launched.
// Config-level fixes (emulator-user.ini, emu-last-window-pos) cannot help because the
// emulator overrides them at runtime.
//
// This watcher is the counterpart that works: after an AVD launch it polls for that
// AVD's emulator window and acts ONLY while the window is off-screen — pulling it onto
// the primary display at the requested compact size. Because the emulator re-applies
// its geometry a few times during boot (flipping the window off-screen), the size gets
// re-set on each of those episodes and sticks. Crucially, size is NEVER touched while
// the window is on-screen: the emulator adjusts our size to keep its device aspect
// ratio, so re-checking size would never match and the watcher would resize on every
// poll, fighting both the emulator and the user (the "keeps getting resized" bug). It
// exits once the window has stayed on-screen for a few consecutive checks or at the
// deadline, after which the user is free to move and resize it. Windows-only.

const DEADLINE_SECONDS = 60;
const POLL_MS = 500;
const STABLE_CHECKS = 6; // ~3s of consecutive stability before the watcher exits.

// Default compact portrait size. Matches the value validated by hand on the dev machine;
// callers may override per launch.
export const DEFAULT_EMULATOR_SIZE = { width: 430, height: 820 };

export type EmulatorWindowSize = { width: number; height: number };

export function buildRescueScript(avdName: string, size: EmulatorWindowSize): string {
  // Embedded into a PowerShell single-quoted string and a regex: escape accordingly.
  const regexEscaped = avdName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll("'", "''");
  const w = Math.round(size.width);
  const h = Math.round(size.height);
  return `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Namespace Native -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool repaint);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
public struct RECT { public int Left, Top, Right, Bottom; }
'@
$avdPattern = '${regexEscaped}'
$targetW = ${w}
$targetH = ${h}
$deadline = (Get-Date).AddSeconds(${DEADLINE_SECONDS})
$stable = 0
while ((Get-Date) -lt $deadline -and $stable -lt ${STABLE_CHECKS}) {
  Start-Sleep -Milliseconds ${POLL_MS}
  $wins = Get-Process | Where-Object {
    $_.MainWindowHandle -ne 0 -and
    $_.MainWindowTitle -match 'Android Emulator' -and
    $_.MainWindowTitle -match $avdPattern
  }
  if (-not $wins) { continue }
  $allGood = $true
  foreach ($p in $wins) {
    $wh = $p.MainWindowHandle
    if ([Native.Win]::IsIconic($wh)) { continue }
    $r = New-Object Native.Win+RECT
    if (-not [Native.Win]::GetWindowRect($wh, [ref]$r)) { continue }
    $onScreen = $false
    foreach ($s in [System.Windows.Forms.Screen]::AllScreens) {
      $wa = $s.WorkingArea
      # Reachable: title bar within reach and a grabbable sliver on the display.
      if ($r.Top -ge ($wa.Top - 32) -and $r.Top -le ($wa.Bottom - 60) -and
          $r.Right -ge ($wa.Left + 60) -and $r.Left -le ($wa.Right - 60)) { $onScreen = $true; break }
    }
    # Only ever act when off-screen; on-screen windows are left completely alone so a
    # user resize is never fought. Repositioning also applies the compact target size.
    if (-not $onScreen) {
      $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
      [Native.Win]::MoveWindow($wh, $wa.Left + 40, $wa.Top + 40, $targetW, $targetH, $true) | Out-Null
      $allGood = $false
    }
  }
  if ($allGood) { $stable++ } else { $stable = 0 }
}
`.trim();
}

export function watchEmulatorWindow(
  adapter: ExecutableAdapter,
  avdName: string,
  size: EmulatorWindowSize = DEFAULT_EMULATOR_SIZE,
  platform: NodeJS.Platform = process.platform
): void {
  if (platform !== 'win32') return;
  const encoded = Buffer.from(buildRescueScript(avdName, size), 'utf16le').toString('base64');
  const child = adapter.spawn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encoded,
  ]);
  child.on('error', () => undefined);
  child.unref?.();
}
