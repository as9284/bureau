import { readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Running emulators advertise themselves through small ini files
// (pid_<pid>.ini) in a per-user discovery directory; Android Studio uses the
// same mechanism to attach to emulators it did not launch. We read them as a
// fallback so the embedded display can attach to externally started emulators
// that expose a gRPC port.

export type DiscoveredEmulator = { avdName: string; grpcPort: number | null };

export function discoveryDirectories(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const dirs: string[] = [];
  if (platform === 'win32') {
    if (env.LOCALAPPDATA) dirs.push(path.join(env.LOCALAPPDATA, 'Temp', 'avd', 'running'));
    dirs.push(path.join(os.tmpdir(), 'avd', 'running'));
  } else if (platform === 'darwin') {
    dirs.push(path.join(os.homedir(), 'Library', 'Caches', 'TemporaryItems', 'avd', 'running'));
  } else {
    if (env.XDG_RUNTIME_DIR) dirs.push(path.join(env.XDG_RUNTIME_DIR, 'avd', 'running'));
    dirs.push(path.join(os.tmpdir(), `android-${env.USER ?? ''}`, 'avd', 'running'));
  }
  return [...new Set(dirs)];
}

/** Parse one pid_<pid>.ini discovery file (key=value per line). */
export function parseDiscoveryFile(content: string): DiscoveredEmulator | null {
  const entries = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    entries.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  const avdName = entries.get('avd.name');
  if (!avdName) return null;
  const portText = entries.get('grpc.port');
  const port = portText ? Number.parseInt(portText, 10) : NaN;
  return {
    avdName,
    grpcPort: Number.isInteger(port) && port > 0 && port <= 65535 ? port : null,
  };
}

/** Best-effort scan; returns avdName → grpc port for every discoverable emulator. */
export async function discoverRunningEmulators(
  directories: string[] = discoveryDirectories()
): Promise<Map<string, number>> {
  const found = new Map<string, number>();
  for (const dir of directories) {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!/^pid_\d+\.ini$/.test(name)) continue;
      try {
        const parsed = parseDiscoveryFile(await readFile(path.join(dir, name), 'utf8'));
        if (parsed?.grpcPort && !found.has(parsed.avdName))
          found.set(parsed.avdName, parsed.grpcPort);
      } catch {
        // Stale or unreadable discovery entry — ignore.
      }
    }
  }
  return found;
}
