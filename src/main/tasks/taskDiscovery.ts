import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { DiscoveredTask, TaskKind } from '@shared/contracts/tasks';
import type { PackageManager, ProcessDefinition } from '@shared/contracts/projects';
import { detectPackageManager, detectStack } from '../projects/StackDetector';

const LONG_RUNNING = new Set(['dev', 'start', 'serve', 'watch']);
const ONE_SHOT = new Set(['build', 'test', 'lint', 'check', 'format']);
const PACKAGE_MANAGERS = new Set<string>(['npm', 'pnpm', 'yarn', 'bun']);

export async function discoverProjectTasks(projectRoot: string): Promise<DiscoveredTask[]> {
  const tasks: DiscoveredTask[] = [];
  const packageManager = await detectPackageManager(projectRoot);
  tasks.push(...(await discoverNpmScripts(projectRoot, packageManager)));

  // Non-Node ecosystems (flutter/dart, python, rust, go, .NET, gradle/maven, make, docker…)
  // reuse the same per-stack command detection the process manager uses, so the task palette
  // stays in sync with it instead of maintaining a parallel command list. Package-manager script
  // wrappers are skipped — those are already covered, comprehensively, by discoverNpmScripts above.
  const detection = await detectStack(projectRoot).catch(() => null);
  if (detection) {
    const seen = new Set(tasks.map((t) => `${t.command} ${t.args.join(' ')}`));
    for (const definition of detection.suggestedProcesses) {
      if (PACKAGE_MANAGERS.has(definition.command)) continue;
      const key = `${definition.command} ${definition.args.join(' ')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tasks.push(processDefinitionToTask(definition));
    }
  }
  return tasks;
}

function processDefinitionToTask(definition: ProcessDefinition): DiscoveredTask {
  return {
    id: `stack:${definition.id}`,
    name: definition.label,
    label: definition.label,
    command: definition.command,
    args: definition.args,
    kind: classifyStackTask(definition),
  };
}

/**
 * Conservative: only well-known dev-server / watch commands auto-restart (become `long-running`).
 * Everything else stays `one-shot`, since misclassifying a build/test as long-running would make
 * it restart-loop on a clean exit, whereas the reverse just means no auto-restart on crash.
 */
export function classifyStackTask(definition: ProcessDefinition): TaskKind {
  const text = `${definition.command} ${definition.args.join(' ')}`.toLowerCase();
  if (/\b(serve|watch|uvicorn|runserver)\b/.test(text)) return 'long-running';
  if (text.includes('compose up')) return 'long-running';
  if (text === 'flutter run' || text.startsWith('flask ')) return 'long-running';
  return 'one-shot';
}

async function discoverNpmScripts(
  projectRoot: string,
  packageManager: PackageManager
): Promise<DiscoveredTask[]> {
  const pkgPath = path.join(projectRoot, 'package.json');
  let pkg: { scripts?: Record<string, string> } | null = null;
  try {
    pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
  } catch {
    return [];
  }
  if (!pkg?.scripts) return [];

  return Object.keys(pkg.scripts).map((name) => {
    const kind = classifyTask(name);
    return {
      id: `script:${name}`,
      name,
      label: name,
      command: packageManager,
      args: scriptArgs(packageManager, name),
      kind,
      packageManager,
    };
  });
}

export function classifyTask(name: string): TaskKind {
  const lower = name.toLowerCase();
  if (LONG_RUNNING.has(lower)) return 'long-running';
  if (ONE_SHOT.has(lower)) return 'one-shot';
  if (/^(dev|start|serve|watch)/.test(lower)) return 'long-running';
  return 'one-shot';
}

export function scriptArgs(packageManager: PackageManager, scriptName: string): string[] {
  if (packageManager === 'npm' || packageManager === 'bun') {
    return ['run', scriptName];
  }
  return ['run', scriptName];
}

export function taskToProcessDefinition(task: DiscoveredTask): ProcessDefinition {
  return {
    id: task.id,
    label: task.label,
    command: task.command,
    args: task.args,
    cwd: '.',
    env: {},
    runMode: 'log',
    autoRestart: task.kind === 'long-running',
    runOnOpen: false,
  };
}
