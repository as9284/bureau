import { spawn } from 'node:child_process';
import pidusage from 'pidusage';
import type { ProcessRuntime } from '@shared/contracts/processes';

const SAMPLE_MS = 2000;
// The process tree changes rarely (children are spawned at start and persist), so we enumerate
// it at most this often and reuse the map between CPU/mem samples to keep the overhead low.
const TREE_TTL_MS = 5000;

export type MetricsSample = { cpu: number; memoryBytes: number };

let cachedChildren: Map<number, number[]> | undefined;
let cachedChildrenAt = 0;

/**
 * Samples CPU/memory for each root PID, **aggregated across its whole process tree**. Managed
 * processes usually run under a launcher whose own PID is near-idle — on Windows a `.cmd`/`.bat`
 * command runs via a `cmd.exe` shim, and `npm`/`node`/`flutter` launchers spawn the real dev
 * server as a descendant. Measuring only the root PID reports ~0; we enumerate each root's
 * descendants, sample them all in one `pidusage` call, and sum per root. Missing PIDs are omitted.
 */
export async function samplePids(rootPids: number[]): Promise<Map<number, MetricsSample>> {
  const out = new Map<number, MetricsSample>();
  if (rootPids.length === 0) return out;

  const children = await getChildrenMap();
  const trees = collectTrees(rootPids, children);

  const allPids = new Set<number>();
  for (const pids of trees.values()) for (const pid of pids) allPids.add(pid);

  let stats: Record<string, { cpu: number; memory: number } | undefined> = {};
  try {
    stats = await pidusage([...allPids]);
  } catch {
    // pidusage throws if every PID is gone — treat as empty.
  }

  return aggregateTreeSamples(trees, stats);
}

/** Sums per-root CPU/memory over the root and its descendants. Roots with no live member are omitted. */
export function aggregateTreeSamples(
  trees: Map<number, number[]>,
  stats: Record<string, { cpu: number; memory: number } | undefined>
): Map<number, MetricsSample> {
  const out = new Map<number, MetricsSample>();
  for (const [root, pids] of trees) {
    let cpu = 0;
    let memoryBytes = 0;
    let any = false;
    for (const pid of pids) {
      const stat = stats[String(pid)];
      if (stat) {
        cpu += stat.cpu;
        memoryBytes += stat.memory;
        any = true;
      }
    }
    if (any) out.set(root, { cpu, memoryBytes });
  }
  return out;
}

/** For each root, the set of PIDs in its subtree (including the root), walked cycle-safe. */
export function collectTrees(
  roots: number[],
  childrenByParent: Map<number, number[]>
): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const root of roots) {
    const seen = new Set<number>([root]);
    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop() as number;
      for (const child of childrenByParent.get(current) ?? []) {
        if (!seen.has(child)) {
          seen.add(child);
          stack.push(child);
        }
      }
    }
    out.set(root, [...seen]);
  }
  return out;
}

/** Parses `pid ppid` (POSIX `ps`) or `pid,ppid` (Windows PowerShell) rows into [pid, ppid] pairs. */
export function parseProcessPairs(stdout: string): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)[\s,]+(\d+)/);
    if (!match) continue;
    pairs.push([Number(match[1]), Number(match[2])]);
  }
  return pairs;
}

export function buildChildrenMap(pairs: Array<[number, number]>): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (const [pid, ppid] of pairs) {
    const existing = map.get(ppid);
    if (existing) existing.push(pid);
    else map.set(ppid, [pid]);
  }
  return map;
}

async function getChildrenMap(): Promise<Map<number, number[]>> {
  const now = Date.now();
  if (cachedChildren && now - cachedChildrenAt < TREE_TTL_MS) return cachedChildren;
  try {
    const stdout =
      process.platform === 'win32'
        ? await runCapture('powershell.exe', [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId),$($_.ParentProcessId)" }',
          ])
        : await runCapture('ps', ['-axo', 'pid=,ppid=']);
    cachedChildren = buildChildrenMap(parseProcessPairs(stdout));
    cachedChildrenAt = now;
  } catch {
    // Enumeration failed — fall back to sampling each root PID alone (empty child map).
    cachedChildren = new Map();
    cachedChildrenAt = now;
  }
  return cachedChildren;
}

function runCapture(executable: string, args: string[], timeoutMs = 4000): Promise<string> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(executable, args, { shell: false, windowsHide: true });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    let stdout = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('process enumeration timed out'));
    }, timeoutMs);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => (stdout += chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(stdout);
    });
  });
}

export function createMetricsSampler(options: {
  listPids: () => Array<{ pid: number; apply: (sample: MetricsSample) => void }>;
  onTick?: () => void;
}): { start(): void; stop(): void } {
  let timer: NodeJS.Timeout | undefined;

  async function tick(): Promise<void> {
    const entries = options.listPids();
    const samples = await samplePids(entries.map((e) => e.pid));
    for (const entry of entries) {
      const sample = samples.get(entry.pid);
      if (sample) entry.apply(sample);
    }
    options.onTick?.();
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => void tick(), SAMPLE_MS);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}

export function patchRuntimeMetrics(
  runtime: ProcessRuntime,
  sample: MetricsSample
): ProcessRuntime {
  return {
    ...runtime,
    cpu: Math.round(sample.cpu * 10) / 10,
    memoryBytes: sample.memoryBytes,
  };
}
