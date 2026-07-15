import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  parseEnginesNode,
  parseFvmrc,
  parseNvmrc,
  parsePubspecSdk,
  parsePythonVersionFile,
  parseToolVersions,
  versionSatisfies,
  versionsMatch,
} from '@main/toolchains/versionFileParsers';
import { readExpectedVersions } from '@main/toolchains/RuntimeDetector';
import { prependPath } from '@main/toolchains/pathMerge';
import { collectInstalledVersions } from '@main/toolchains/nodeResolver';
import { classifyTask, classifyStackTask, discoverProjectTasks } from '@main/tasks/taskDiscovery';
import { parseNetstatOutput, parseLsofOutput, extractPortFromUrl } from '@main/ports/portParsers';
import { classifyPorts } from '@main/ports/PortScanner';
import {
  parseProcessPairs,
  collectTrees,
  aggregateTreeSamples,
} from '@main/processes/processMetrics';
import type { ProcessDefinition } from '@shared/contracts/projects';

describe('versionFileParsers', () => {
  it('parses .nvmrc and engines.node', () => {
    expect(parseNvmrc('20.11.0\n')).toBe('20.11.0');
    expect(parseEnginesNode({ node: '>=18' })).toBe('>=18');
  });

  it('parses python and tool-versions files', () => {
    expect(parsePythonVersionFile('3.12.1')).toBe('3.12.1');
    expect(parseToolVersions('nodejs 20.11.0\npython 3.12.0')).toEqual({
      nodejs: '20.11.0',
      python: '3.12.0',
    });
  });

  it('parses fvmrc and compares versions loosely', () => {
    expect(parseFvmrc('3.24.0')).toBe('3.24.0');
    expect(versionsMatch('20', '20.11.0')).toBe(true);
    expect(versionsMatch('21', '20.11.0')).toBe(false);
  });

  it('treats engines ranges as satisfied by newer majors', () => {
    expect(versionSatisfies('>=22', '24.15.0')).toBe(true);
    expect(versionSatisfies('^22.0.0', '24.15.0')).toBe(false);
    expect(versionSatisfies('22', '24.15.0')).toBe(false);
    expect(versionSatisfies('22', '22.11.0')).toBe(true);
  });

  it('honors compound AND ranges (Dart-style upper bounds)', () => {
    expect(versionSatisfies('>=3.0.0 <4.0.0', '3.5.0')).toBe(true);
    expect(versionSatisfies('>=3.0.0 <4.0.0', '24.0.0')).toBe(false);
    expect(versionSatisfies('>=3.0.0 <4.0.0', '2.9.0')).toBe(false);
  });

  it('honors OR alternatives and tilde/caret edges', () => {
    expect(versionSatisfies('^18 || ^20', '18.4.0')).toBe(true);
    expect(versionSatisfies('^18 || ^20', '20.1.0')).toBe(true);
    expect(versionSatisfies('^18 || ^20', '19.0.0')).toBe(false);
    expect(versionSatisfies('^18 || ^20', '21.0.0')).toBe(false);
    // ~3 (major only) allows the whole 3.x line; ~3.1 locks the minor.
    expect(versionSatisfies('~3', '3.5.0')).toBe(true);
    expect(versionSatisfies('~3.1', '3.1.9')).toBe(true);
    expect(versionSatisfies('~3.1', '3.2.0')).toBe(false);
  });

  it('parses modern .fvmrc JSON and pubspec flutter constraints', () => {
    expect(parseFvmrc('{"flutter":"3.24.0"}')).toBe('3.24.0');
    expect(
      parsePubspecSdk('environment:\n  sdk: ">=3.0.0 <4.0.0"\n  flutter: ">=3.13.0"\n')
    ).toBe('>=3.13.0');
    // The top-level asset `flutter:` section (no inline version) is not mistaken for a constraint.
    expect(parsePubspecSdk('flutter:\n  uses-material-design: true\n')).toBeNull();
  });
});

describe('readExpectedVersions', () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('reads the asdf-canonical `nodejs` key from .tool-versions', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bureau-tv-'));
    await writeFile(path.join(dir, '.tool-versions'), 'nodejs 20.11.0\npython 3.12.0\n');
    const expected = await readExpectedVersions(dir);
    expect(expected.node).toBe('20.11.0');
    expect(expected.python).toBe('3.12.0');
  });
});

describe('pathMerge', () => {
  it('prepends PATH entries without duplicates', () => {
    const sep = process.platform === 'win32' ? ';' : ':';
    const env = prependPath({ PATH: `/usr/bin${sep}/bin` }, ['/opt/node/bin']);
    expect(env.PATH).toBe(`/opt/node/bin${sep}/usr/bin${sep}/bin`);
  });
});

describe('nodeResolver', () => {
  it('merges manager and system versions without duplicates', () => {
    expect(
      collectInstalledVersions([
        { manager: 'fnm', available: true, versions: ['22.11.0', '20.11.0'] },
        { manager: 'system', available: true, versions: ['24.15.0', '22.11.0'] },
      ])
    ).toEqual(['22.11.0', '20.11.0', '24.15.0']);
  });
});

describe('taskDiscovery', () => {
  it('classifies common scripts', () => {
    expect(classifyTask('dev')).toBe('long-running');
    expect(classifyTask('build')).toBe('one-shot');
  });

  const def = (over: Partial<ProcessDefinition>): ProcessDefinition => ({
    id: 'x',
    label: 'x',
    command: 'x',
    args: [],
    cwd: '.',
    env: {},
    runMode: 'log',
    autoRestart: false,
    runOnOpen: false,
    ...over,
  });

  it('classifies stack tasks conservatively (only dev servers auto-restart)', () => {
    expect(classifyStackTask(def({ command: 'flutter', args: ['run'] }))).toBe('long-running');
    expect(classifyStackTask(def({ command: 'flutter', args: ['test'] }))).toBe('one-shot');
    expect(classifyStackTask(def({ command: 'uvicorn', args: ['main:app'] }))).toBe('long-running');
    expect(classifyStackTask(def({ command: 'cargo', args: ['build'] }))).toBe('one-shot');
    expect(classifyStackTask(def({ command: 'go', args: ['test', './...'] }))).toBe('one-shot');
  });

  it('discovers non-Node ecosystem tasks (flutter/dart, python) from the stack detector', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'bureau-tasks-'));
    try {
      await writeFile(path.join(dir, 'pubspec.yaml'), 'name: demo\n');
      await writeFile(path.join(dir, 'requirements.txt'), 'uvicorn==0.30\nfastapi\n');
      const tasks = await discoverProjectTasks(dir);
      const commands = tasks.map((t) => `${t.command} ${t.args.join(' ')}`.trim());
      expect(commands).toContain('flutter run');
      expect(commands).toContain('flutter test');
      expect(commands).toContain('uvicorn main:app --reload');
      expect(tasks.find((t) => t.command === 'uvicorn')?.kind).toBe('long-running');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('portScanner.classifyPorts', () => {
  const raw = [
    { protocol: 'tcp' as const, address: '127.0.0.1', port: 3000, pid: 111 },
    { protocol: 'tcp' as const, address: '127.0.0.1', port: 5432, pid: 222 },
    { protocol: 'tcp' as const, address: '0.0.0.0', port: 8080, pid: 333 },
  ];

  it('flags an expected port held by a non-Bureau owner, not Bureau’s own bound port', () => {
    // 3000 is Bureau's own (running) process; 8080 is expected but squatted by a foreign process.
    const ports = classifyPorts(raw, new Set([3000, 8080]), new Set([111]));
    const byPort = new Map(ports.map((p) => [p.port, p]));
    expect(byPort.get(3000)).toMatchObject({ owner: 'bureau', conflict: false });
    expect(byPort.get(8080)).toMatchObject({ owner: 'system', conflict: true });
    // 5432 is a foreign listener the project doesn't expect — not a conflict.
    expect(byPort.get(5432)).toMatchObject({ owner: 'system', conflict: false });
  });
});

describe('processMetrics tree sampling', () => {
  it('parses ps/PowerShell pid,ppid output', () => {
    expect(parseProcessPairs('  100 1\n200 100\nPID PPID\n300 200\n')).toEqual([
      [100, 1],
      [200, 100],
      [300, 200],
    ]);
    expect(parseProcessPairs('100,4\r\n200,100\r\n')).toEqual([
      [100, 4],
      [200, 100],
    ]);
  });

  it('collects a root’s whole subtree, cycle-safe', () => {
    const children = new Map<number, number[]>([
      [100, [200, 201]],
      [200, [300]],
      [300, [100]], // cycle back to root — must not loop
    ]);
    const trees = collectTrees([100], children);
    expect(trees.get(100)?.sort((a, b) => a - b)).toEqual([100, 200, 201, 300]);
  });

  it('sums cpu/memory across the tree and omits fully-dead roots', () => {
    const trees = new Map<number, number[]>([
      [100, [100, 200, 300]],
      [999, [999]],
    ]);
    const stats = {
      '100': { cpu: 0, memory: 1_000 }, // idle shim
      '200': { cpu: 40, memory: 50_000 }, // the real dev server
      '300': { cpu: 5, memory: 10_000 },
    };
    const out = aggregateTreeSamples(trees, stats);
    expect(out.get(100)).toEqual({ cpu: 45, memoryBytes: 61_000 });
    expect(out.has(999)).toBe(false);
  });
});

describe('portParsers', () => {
  it('parses netstat rows and urls', () => {
    const rows = parseNetstatOutput(
      'TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       4242\n'
    );
    expect(rows).toEqual([
      { protocol: 'tcp', address: '0.0.0.0', port: 3000, pid: 4242 },
    ]);
    expect(extractPortFromUrl('http://localhost:3000')).toBe(3000);
  });

  it('captures UDP PIDs (no state column) and IPv6 addresses', () => {
    const rows = parseNetstatOutput(
      ['UDP    0.0.0.0:53              *:*                                   900', 'TCP    [::]:135               [::]:0                 LISTENING       4'].join(
        '\n'
      )
    );
    expect(rows).toContainEqual({ protocol: 'udp', address: '0.0.0.0', port: 53, pid: 900 });
    expect(rows).toContainEqual({ protocol: 'tcp', address: '::', port: 135, pid: 4 });
  });

  it('parses lsof LISTEN rows (address before the state suffix)', () => {
    const rows = parseLsofOutput(
      [
        'COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME',
        'node    12345 user   23u  IPv4 0x0      0t0  TCP 127.0.0.1:3000 (LISTEN)',
        'node    12345 user   24u  IPv6 0x0      0t0  TCP [::1]:8080 (LISTEN)',
      ].join('\n')
    );
    expect(rows).toContainEqual({ protocol: 'tcp', address: '127.0.0.1', port: 3000, pid: 12345 });
    expect(rows).toContainEqual({ protocol: 'tcp', address: '::1', port: 8080, pid: 12345 });
  });
});
