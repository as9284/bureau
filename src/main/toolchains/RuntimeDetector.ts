import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ProjectToolchains,
  RuntimeKind,
  RuntimeProbe,
  RuntimeRow,
  ToolchainConfig,
} from '@shared/contracts/toolchains';
import type {
  ProjectConfig,
  ProcessDefinition,
  ProjectStack,
} from '@shared/contracts/projects';
import type { ToolchainSettings } from '@shared/contracts/toolchains';
import { detectSimpleRuntimeRows } from './simpleRuntimes';
import {
  parseEnginesNode,
  parseFvmConfig,
  parseFvmrc,
  parseNodeVersionFile,
  parseNvmrc,
  parsePubspecSdk,
  parsePythonVersionFile,
  parseToolVersions,
  versionSatisfies,
  versionsMatch,
} from './versionFileParsers';
import {
  collectInstalledVersions,
  detectNodeManagers,
  nodeInstallHint,
  pickNodeManager,
  resolveNodeBinDir,
} from './nodeResolver';
import {
  detectPythonManagers,
  pickPythonManager,
  pythonInstallHint,
  resolvePythonBinDir,
} from './pythonResolver';
import {
  detectFlutterManagers,
  flutterInstallHint,
  pickFlutterManager,
  resolveFlutterBinDir,
} from './flutterResolver';

export type ExpectedVersions = {
  node: string | null;
  python: string | null;
  flutter: string | null;
};

export async function readExpectedVersions(projectRoot: string): Promise<ExpectedVersions> {
  const toolVersions = await readText(path.join(projectRoot, '.tool-versions'));
  const asdf = toolVersions ? parseToolVersions(toolVersions) : {};

  const nvmrc = await readText(path.join(projectRoot, '.nvmrc'));
  const nodeVersion = await readText(path.join(projectRoot, '.node-version'));
  const pkg = await readJson(path.join(projectRoot, 'package.json'));
  const pythonVersion = await readText(path.join(projectRoot, '.python-version'));
  const pubspec = await readText(path.join(projectRoot, 'pubspec.yaml'));
  const fvmConfig = await readText(path.join(projectRoot, '.fvm', 'fvm_config.json'));
  const fvmrc = await readText(path.join(projectRoot, '.fvmrc'));

  return {
    node:
      (nvmrc ? parseNvmrc(nvmrc) : null) ??
      (nodeVersion ? parseNodeVersionFile(nodeVersion) : null) ??
      (pkg ? parseEnginesNode((pkg as { engines?: unknown }).engines) : null) ??
      // asdf's canonical plugin name is `nodejs`; mise also accepts `node`.
      asdf.node ??
      asdf.nodejs ??
      null,
    python: (pythonVersion ? parsePythonVersionFile(pythonVersion) : null) ?? asdf.python ?? null,
    flutter:
      (fvmConfig ? parseFvmConfig(fvmConfig) : null) ??
      (fvmrc ? parseFvmrc(fvmrc) : null) ??
      (pubspec ? parsePubspecSdk(pubspec) : null) ??
      asdf.flutter ??
      null,
  };
}

export async function probeRuntimes(): Promise<RuntimeProbe[]> {
  const empty: RuntimeProbe[] = [
    { kind: 'node', installed: false, versions: [], manager: null },
    { kind: 'python', installed: false, versions: [], manager: null },
    { kind: 'flutter', installed: false, versions: [], manager: null },
  ];

  try {
    const [nodeManagers, flutterManagers, pythonManagers] = await Promise.all([
      detectNodeManagers().catch(() => []),
      detectFlutterManagers(process.cwd()).catch(() => []),
      detectPythonManagers(process.cwd()).catch(() => []),
    ]);
    const node = pickNodeManager(nodeManagers);
    const flutter = pickFlutterManager(flutterManagers);
    const python = pickPythonManager(pythonManagers);

    return [
      {
        kind: 'node',
        installed: Boolean(node),
        versions: node?.versions ?? [],
        manager: node?.manager ?? null,
      },
      {
        kind: 'python',
        installed: Boolean(python),
        versions: python?.versions ?? [],
        manager: python?.manager ?? null,
      },
      {
        kind: 'flutter',
        installed: Boolean(flutter),
        versions: flutter?.versions ?? [],
        manager: flutter?.manager ?? null,
      },
    ];
  } catch {
    return empty;
  }
}

export async function buildProjectToolchains(
  projectId: string,
  projectRoot: string,
  config: ProjectConfig,
  settings: ToolchainSettings,
  stack: ProjectStack[] = []
): Promise<ProjectToolchains> {
  const expected = await readExpectedVersions(projectRoot);
  const toolchains = config.toolchains ?? {};

  // Only surface a switchable runtime when the project actually uses it: its stack
  // tag was detected, it pins an expected version, or it is pinned in config.
  const rows: RuntimeRow[] = [];
  if (stack.includes('node') || stack.includes('react-native') || expected.node || toolchains.node) {
    rows.push(
      await buildNodeRow(projectRoot, expected.node, toolchains, settings.preferredNodeManager)
    );
  }
  if (stack.includes('python') || expected.python || toolchains.python) {
    rows.push(
      await buildPythonRow(projectRoot, expected.python, toolchains, settings.preferredPythonManager)
    );
  }
  if (stack.includes('flutter') || expected.flutter || toolchains.flutter) {
    rows.push(
      await buildFlutterRow(
        projectRoot,
        expected.flutter,
        toolchains,
        settings.preferredFlutterManager
      )
    );
  }

  const toolVersions = parseToolVersions((await readText(path.join(projectRoot, '.tool-versions'))) ?? '');
  rows.push(...(await detectSimpleRuntimeRows(projectRoot, stack, toolVersions)));

  return { projectId, rows };
}

export async function resolveToolchainPathEntries(
  projectRoot: string,
  config: ProjectConfig,
  definition: ProcessDefinition,
  settings: ToolchainSettings
): Promise<string[]> {
  const entries: string[] = [];
  const toolchains = config.toolchains ?? {};
  const pin = definition.toolchain ?? {};

  if (pin.node || toolchains.node) {
    const version = pin.node ?? toolchains.node?.version;
    const manager =
      toolchains.node?.manager ?? settings.preferredNodeManager ?? undefined;
    const probes = await detectNodeManagers();
    const probe = pickNodeManager(probes, manager);
    if (probe && version) {
      const bin = await resolveNodeBinDir(probe.manager, version);
      if (bin) entries.push(bin);
    } else if (probe?.manager === 'system' && probe.binDir) {
      entries.push(probe.binDir);
    }
  }

  if (pin.python || toolchains.python) {
    const version = pin.python ?? toolchains.python?.version;
    const manager = toolchains.python?.manager ?? settings.preferredPythonManager ?? 'venv';
    const bin = await resolvePythonBinDir(
      manager,
      projectRoot,
      version ?? '',
      toolchains.python?.venv
    );
    if (bin) entries.push(bin);
  }

  if (pin.flutter || toolchains.flutter) {
    const version = pin.flutter ?? toolchains.flutter?.version;
    const manager = toolchains.flutter?.manager ?? settings.preferredFlutterManager ?? 'fvm';
    const bin = await resolveFlutterBinDir(manager, projectRoot, version ?? '');
    if (bin) entries.push(bin);
  }

  return entries;
}

async function buildNodeRow(
  _projectRoot: string,
  expected: string | null,
  toolchains: ToolchainConfig,
  preferred?: ToolchainSettings['preferredNodeManager']
): Promise<RuntimeRow> {
  const managers = await detectNodeManagers();
  const activeManager = pickNodeManager(managers, toolchains.node?.manager ?? preferred);
  const system = managers.find((m) => m.manager === 'system');
  const installed = collectInstalledVersions(managers);
  const activeVersion =
    toolchains.node?.version ??
    (expected && installed.find((v) => versionSatisfies(expected, v))) ??
    system?.versions[0] ??
    installed[0] ??
    null;
  const missing =
    Boolean(activeVersion) &&
    installed.length > 0 &&
    !installed.some((v) => versionsMatch(activeVersion!, v));
  const mismatch = Boolean(
    expected && activeVersion && !versionSatisfies(expected, activeVersion)
  );
  const managerLabel =
    activeManager?.manager === 'system'
      ? 'system'
      : (toolchains.node?.manager ?? activeManager?.manager ?? null);
  const expectedInstalled = Boolean(
    expected && installed.some((v) => versionSatisfies(expected, v))
  );

  return {
    kind: 'node',
    label: 'Node.js',
    activeVersion,
    expectedVersion: expected,
    installedVersions: installed,
    manager: managerLabel,
    mismatch,
    missing,
    installHint:
      missing && activeVersion
        ? nodeInstallHint(activeManager?.manager ?? null, activeVersion)
        : expected && !expectedInstalled
          ? nodeInstallHint(activeManager?.manager ?? null, expected)
          : null,
    switchable: true,
  };
}

async function buildPythonRow(
  projectRoot: string,
  expected: string | null,
  toolchains: ToolchainConfig,
  preferred?: ToolchainSettings['preferredPythonManager']
): Promise<RuntimeRow> {
  const managers = await detectPythonManagers(projectRoot);
  const activeManager = pickPythonManager(managers, toolchains.python?.manager ?? preferred);
  const activeVersion = toolchains.python?.version ?? activeManager?.versions[0] ?? null;
  const installed = activeManager?.versions ?? [];
  const missing =
    Boolean(activeVersion) &&
    installed.length > 0 &&
    !installed.some((v) => versionsMatch(activeVersion!, v));
  const mismatch = Boolean(
    expected && activeVersion && !versionSatisfies(expected, activeVersion)
  );

  return {
    kind: 'python',
    label: 'Python',
    activeVersion,
    expectedVersion: expected,
    installedVersions: installed,
    manager: activeManager?.manager ?? null,
    mismatch,
    missing,
    installHint:
      activeManager && activeVersion && missing
        ? pythonInstallHint(activeManager.manager, activeVersion)
        : null,
    switchable: true,
  };
}

async function buildFlutterRow(
  projectRoot: string,
  expected: string | null,
  toolchains: ToolchainConfig,
  preferred?: ToolchainSettings['preferredFlutterManager']
): Promise<RuntimeRow> {
  const managers = await detectFlutterManagers(projectRoot);
  const activeManager = pickFlutterManager(managers, toolchains.flutter?.manager ?? preferred);
  const activeVersion = toolchains.flutter?.version ?? activeManager?.versions[0] ?? null;
  const installed = activeManager?.versions ?? [];
  const missing =
    Boolean(activeVersion) &&
    installed.length > 0 &&
    !installed.some((v) => versionsMatch(activeVersion!, v));
  const mismatch = Boolean(
    expected && activeVersion && !versionSatisfies(expected, activeVersion)
  );

  return {
    kind: 'flutter',
    label: 'Flutter',
    activeVersion,
    expectedVersion: expected,
    installedVersions: installed,
    manager: activeManager?.manager ?? null,
    mismatch,
    missing,
    installHint:
      activeManager && activeVersion && missing
        ? flutterInstallHint(activeManager.manager, activeVersion)
        : null,
    switchable: true,
  };
}

async function readText(target: string): Promise<string | null> {
  try {
    return await readFile(target, 'utf8');
  } catch {
    return null;
  }
}

async function readJson(target: string): Promise<unknown | null> {
  const text = await readText(target);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function runtimeLabel(kind: RuntimeKind): string {
  if (kind === 'node') return 'Node.js';
  if (kind === 'python') return 'Python';
  if (kind === 'flutter') return 'Flutter';
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}
