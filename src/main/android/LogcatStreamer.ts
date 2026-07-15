import type { ChildProcess } from 'node:child_process';
import type {
  LogcatEvent,
  LogcatFilter,
  LogcatLine,
  LogcatSnapshot,
} from '@shared/contracts/android';
import type { AdbService } from './AdbService';
import type { ExecutableAdapter } from './ExecutableAdapter';
import { parseLogcatLine, parsePidPackageMap } from './parsers';

const CAP = 4000;
const BATCH_MS = 80;
const PRIORITY_ORDER = ['V', 'D', 'I', 'W', 'E', 'F'] as const;

export type LogcatStreamer = ReturnType<typeof createLogcatStreamer>;

export function createLogcatStreamer(adb: AdbService, adapter: ExecutableAdapter) {
  let child: ChildProcess | null = null;
  let deviceId: string | null = null;
  let running = false;
  let paused = false;
  let filter: LogcatFilter = { priority: 'V' };
  let lines: LogcatLine[] = [];
  let seq = 0;
  let textBuffer = '';
  let pending: LogcatLine[] = [];
  let batchTimer: ReturnType<typeof setTimeout> | null = null;
  let packageByPid = new Map<number, string>();
  const listeners = new Set<(event: LogcatEvent) => void>();

  async function start(
    requestedDeviceId: string | undefined,
    nextFilter: LogcatFilter
  ): Promise<void> {
    await stop();
    const device = await adb.selectDevice(requestedDeviceId);
    validateRegex(nextFilter.regex);
    filter = normalizeFilter(nextFilter);
    deviceId = device.id;
    const ps = await adb
      .run(['-s', device.id, 'shell', 'ps', '-A', '-o', 'PID,NAME'], 8_000)
      .catch(() => null);
    packageByPid = ps?.code === 0 ? parsePidPackageMap(ps.stdout) : new Map();
    child = adapter.spawn(await adb.adbPath(), ['-s', device.id, 'logcat', '-v', 'threadtime']);
    running = true;
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', consume);
    child.on('error', () => stopState());
    child.on('close', () => stopState());
  }

  function consume(chunk: string): void {
    textBuffer += chunk;
    const chunks = textBuffer.split(/\r?\n/);
    textBuffer = chunks.pop() ?? '';
    for (const raw of chunks) {
      const line = parseLogcatLine(raw, ++seq, packageByPid);
      if (!line || !matches(line, filter)) continue;
      lines.push(line);
      if (lines.length > CAP) lines = lines.slice(-CAP);
      if (!paused) pending.push(line);
    }
    scheduleFlush();
  }

  function scheduleFlush(): void {
    if (batchTimer || pending.length === 0 || !deviceId) return;
    batchTimer = setTimeout(() => {
      batchTimer = null;
      if (!deviceId || pending.length === 0) return;
      const event = { deviceId, running: true, lines: pending };
      pending = [];
      for (const listener of listeners) listener(event);
    }, BATCH_MS);
  }

  function stopState(): void {
    const stoppedDevice = deviceId;
    running = false;
    child = null;
    textBuffer = '';
    pending = [];
    if (batchTimer) clearTimeout(batchTimer);
    batchTimer = null;
    if (stoppedDevice) {
      for (const listener of listeners)
        listener({ deviceId: stoppedDevice, running: false, lines: [] });
    }
  }

  async function stop(): Promise<void> {
    if (child && !child.killed) child.kill();
    stopState();
    deviceId = null;
  }

  function setPaused(value: boolean): LogcatSnapshot {
    paused = value;
    pending = [];
    return snapshot();
  }

  function clear(): LogcatSnapshot {
    lines = [];
    pending = [];
    return snapshot();
  }

  function snapshot(): LogcatSnapshot {
    return { deviceId, running, paused, filter, lines: [...lines] };
  }

  function onEvent(listener: (event: LogcatEvent) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { start, stop, setPaused, clear, snapshot, onEvent };
}

function validateRegex(value?: string): void {
  if (!value) return;
  try {
    new RegExp(value, 'i');
  } catch {
    throw new Error('The logcat regular expression is invalid.');
  }
}

function normalizeFilter(filter: LogcatFilter): LogcatFilter {
  const clean = (value?: string) => value?.trim() || undefined;
  return {
    priority: filter.priority,
    tag: clean(filter.tag),
    packageName: clean(filter.packageName),
    regex: clean(filter.regex),
  };
}

function matches(line: LogcatLine, filter: LogcatFilter): boolean {
  if (filter.priority === 'S') return false;
  if (PRIORITY_ORDER.indexOf(line.priority) < PRIORITY_ORDER.indexOf(filter.priority as never))
    return false;
  if (filter.tag && !line.tag.toLowerCase().includes(filter.tag.toLowerCase())) return false;
  if (filter.packageName && line.packageName !== filter.packageName) return false;
  if (filter.regex && !new RegExp(filter.regex, 'i').test(`${line.tag} ${line.message}`))
    return false;
  return true;
}
