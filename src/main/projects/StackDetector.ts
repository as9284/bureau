import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  PackageManager,
  ProcessDefinition,
  ProjectStack,
  StackDetectionResult,
} from '@shared/contracts/projects';
import {
  COMMON_TARGETS,
  parseJsonObjectKeys,
  parseJustfileRecipes,
  parseMakefileTargets,
  parseProcfileEntries,
} from './commandParsers';
import { discoverNestedRoots } from './nestedRoots';

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function readJson(target: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(target, 'utf8'));
  } catch {
    return null;
  }
}

async function readText(target: string): Promise<string | null> {
  try {
    return await readFile(target, 'utf8');
  } catch {
    return null;
  }
}

/** First existing file among candidates, read as text (for alt filenames/extensions). */
async function readFirst(dir: string, names: string[]): Promise<string | null> {
  for (const name of names) {
    const text = await readText(path.join(dir, name));
    if (text !== null) return text;
  }
  return null;
}

async function anyExists(dir: string, names: string[]): Promise<boolean> {
  for (const name of names) if (await exists(path.join(dir, name))) return true;
  return false;
}

/** True when a root-level entry name matches the pattern (for `*.sln`, `*.csproj`, …). */
async function hasFileMatching(dir: string, pattern: RegExp): Promise<boolean> {
  try {
    return (await readdir(dir)).some((name) => pattern.test(name));
  } catch {
    return false;
  }
}

/** Prefer a project's Gradle wrapper over a global `gradle` when present. */
async function gradleCommand(dir: string): Promise<string> {
  if (process.platform === 'win32' && (await exists(path.join(dir, 'gradlew.bat'))))
    return 'gradlew.bat';
  if (await exists(path.join(dir, 'gradlew'))) return './gradlew';
  return 'gradle';
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'task'
  );
}

function definition(
  partial: Omit<ProcessDefinition, 'env' | 'cwd' | 'runMode' | 'autoRestart' | 'runOnOpen'> & {
    cwd?: string;
  }
): ProcessDefinition {
  return {
    env: {},
    cwd: '.',
    runMode: 'log',
    autoRestart: false,
    runOnOpen: false,
    ...partial,
  };
}

export async function detectPackageManager(dir: string): Promise<PackageManager> {
  if (await exists(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(path.join(dir, 'yarn.lock'))) return 'yarn';
  if ((await exists(path.join(dir, 'bun.lock'))) || (await exists(path.join(dir, 'bun.lockb'))))
    return 'bun';
  return 'npm';
}

/**
 * Surfaced first, in this order. These are the top-level commands worth a button; everything else
 * keeps package.json order and is trimmed to MAX_NODE_SCRIPTS. Nothing is lost by the trim — the
 * task palette (`discoverProjectTasks`) lists every script, uncapped.
 */
const NODE_SCRIPT_PRIORITY = ['dev', 'start', 'serve', 'build', 'test', 'lint', 'release'];
const MAX_NODE_SCRIPTS = 12;

/** Inspects a folder and returns its detected stack, package manager, and runnable commands. */
export async function detectStack(dir: string): Promise<StackDetectionResult> {
  const stack: ProjectStack[] = [];
  const suggestedProcesses: ProcessDefinition[] = [];
  const warnings: string[] = [];
  let packageManager: PackageManager | undefined;

  if (await exists(path.join(dir, '.git'))) {
    stack.push('git');
  }

  // Node
  if (await exists(path.join(dir, 'package.json'))) {
    stack.push('node');
    packageManager = await detectPackageManager(dir);
    const pkg = await readJson(path.join(dir, 'package.json'));
    if (pkg === null) {
      warnings.push('package.json could not be parsed; script suggestions were skipped.');
    } else {
      const record = pkg as Record<string, unknown>;
      const scripts =
        typeof pkg === 'object' && pkg !== null && 'scripts' in pkg
          ? ((pkg as { scripts?: Record<string, unknown> }).scripts ?? {})
          : {};
      const dependencyGroups = ['dependencies', 'devDependencies', 'peerDependencies']
        .map((key) => record[key])
        .filter(
          (value): value is Record<string, unknown> =>
            typeof value === 'object' && value !== null && !Array.isArray(value)
        );
      if (
        dependencyGroups.some((dependencies) => typeof dependencies['react-native'] === 'string')
      ) {
        stack.push('react-native');
      }
      const names = Object.keys(scripts).filter((n) => typeof scripts[n] === 'string');
      const ordered = [
        ...NODE_SCRIPT_PRIORITY.filter((n) => names.includes(n)),
        ...names.filter((n) => !NODE_SCRIPT_PRIORITY.includes(n)),
      ].slice(0, MAX_NODE_SCRIPTS);
      for (const name of ordered) {
        suggestedProcesses.push(
          definition({
            id: slug(name),
            label: `${packageManager} run ${name}`,
            command: packageManager,
            args: ['run', name],
          })
        );
      }
    }
  }

  // Flutter / Dart
  if (await exists(path.join(dir, 'pubspec.yaml'))) {
    stack.push('flutter');
    suggestedProcesses.push(
      definition({ id: 'flutter-run', label: 'flutter run', command: 'flutter', args: ['run'] })
    );
    suggestedProcesses.push(
      definition({ id: 'flutter-test', label: 'flutter test', command: 'flutter', args: ['test'] })
    );
  }

  // Native Android (Gradle). A Gradle wrapper at the PROJECT ROOT (not the nested
  // android/ folder that React Native / Expo projects carry) plus an AndroidManifest
  // marks a standalone Android app whose runnable commands are Gradle tasks.
  const hasRootGradlew =
    (await exists(path.join(dir, 'gradlew'))) || (await exists(path.join(dir, 'gradlew.bat')));
  const hasAndroidManifest =
    (await exists(path.join(dir, 'app', 'src', 'main', 'AndroidManifest.xml'))) ||
    (await exists(path.join(dir, 'src', 'main', 'AndroidManifest.xml')));
  if (hasRootGradlew && hasAndroidManifest && !stack.includes('react-native')) {
    stack.push('android');
    const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
    suggestedProcesses.push(
      definition({
        id: 'android-install-debug',
        label: 'Gradle installDebug',
        command: gradlew,
        args: ['installDebug'],
      })
    );
    suggestedProcesses.push(
      definition({
        id: 'android-assemble-debug',
        label: 'Gradle assembleDebug',
        command: gradlew,
        args: ['assembleDebug'],
      })
    );
  }

  // Python
  const pythonSignals = ['requirements.txt', 'pyproject.toml', 'Pipfile', 'manage.py'];
  let isPython = false;
  for (const signal of pythonSignals) {
    if (await exists(path.join(dir, signal))) {
      isPython = true;
      break;
    }
  }
  if (isPython) {
    stack.push('python');
    if (await exists(path.join(dir, 'manage.py'))) {
      suggestedProcesses.push(
        definition({
          id: 'django-runserver',
          label: 'Django dev server',
          command: 'python',
          args: ['manage.py', 'runserver'],
        })
      );
    } else if (await exists(path.join(dir, 'main.py'))) {
      suggestedProcesses.push(
        definition({
          id: 'python-main',
          label: 'python main.py',
          command: 'python',
          args: ['main.py'],
        })
      );
    }
    // Web-framework dev servers and the test runner, when their tooling is declared.
    const pyDeps = `${(await readText(path.join(dir, 'pyproject.toml'))) ?? ''}\n${
      (await readText(path.join(dir, 'requirements.txt'))) ?? ''
    }`;
    if (/\b(fastapi|uvicorn)\b/i.test(pyDeps)) {
      suggestedProcesses.push(
        definition({
          id: 'uvicorn',
          label: 'uvicorn dev',
          command: 'uvicorn',
          args: ['main:app', '--reload'],
        })
      );
    } else if (/\bflask\b/i.test(pyDeps)) {
      suggestedProcesses.push(
        definition({ id: 'flask-run', label: 'flask run', command: 'flask', args: ['run'] })
      );
    }
    if (
      (await exists(path.join(dir, 'pytest.ini'))) ||
      (await exists(path.join(dir, 'tests'))) ||
      /\bpytest\b/i.test(pyDeps)
    ) {
      suggestedProcesses.push(
        definition({ id: 'pytest', label: 'pytest', command: 'pytest', args: [] })
      );
    }
  }

  // Rust
  if (await exists(path.join(dir, 'Cargo.toml'))) {
    stack.push('rust');
    suggestedProcesses.push(
      definition({ id: 'cargo-run', label: 'cargo run', command: 'cargo', args: ['run'] }),
      definition({ id: 'cargo-build', label: 'cargo build', command: 'cargo', args: ['build'] }),
      definition({ id: 'cargo-test', label: 'cargo test', command: 'cargo', args: ['test'] })
    );
  }

  // Go
  if (await exists(path.join(dir, 'go.mod'))) {
    stack.push('go');
    suggestedProcesses.push(
      definition({ id: 'go-run', label: 'go run .', command: 'go', args: ['run', '.'] }),
      definition({ id: 'go-build', label: 'go build', command: 'go', args: ['build', './...'] }),
      definition({ id: 'go-test', label: 'go test', command: 'go', args: ['test', './...'] })
    );
  }

  // C / C++ (CMake)
  if (await exists(path.join(dir, 'CMakeLists.txt'))) {
    stack.push('cpp');
    suggestedProcesses.push(
      definition({
        id: 'cmake-configure',
        label: 'cmake configure',
        command: 'cmake',
        args: ['-B', 'build'],
      }),
      definition({
        id: 'cmake-build',
        label: 'cmake build',
        command: 'cmake',
        args: ['--build', 'build'],
      })
    );
  }

  // .NET
  if (await hasFileMatching(dir, /\.(sln|slnx|csproj|fsproj|vbproj)$/i)) {
    stack.push('dotnet');
    suggestedProcesses.push(
      definition({ id: 'dotnet-run', label: 'dotnet run', command: 'dotnet', args: ['run'] }),
      definition({ id: 'dotnet-build', label: 'dotnet build', command: 'dotnet', args: ['build'] }),
      definition({ id: 'dotnet-test', label: 'dotnet test', command: 'dotnet', args: ['test'] })
    );
  }

  // JVM — Maven, then Gradle (only the non-Android case; native Android handled above).
  if (await exists(path.join(dir, 'pom.xml'))) {
    if (!stack.includes('java')) stack.push('java');
    suggestedProcesses.push(
      definition({ id: 'mvn-package', label: 'mvn package', command: 'mvn', args: ['package'] }),
      definition({ id: 'mvn-test', label: 'mvn test', command: 'mvn', args: ['test'] })
    );
  }
  if (
    (await anyExists(dir, ['build.gradle', 'build.gradle.kts'])) &&
    !stack.includes('android') &&
    !stack.includes('react-native')
  ) {
    if (!stack.includes('java')) stack.push('java');
    const gradle = await gradleCommand(dir);
    suggestedProcesses.push(
      definition({ id: 'gradle-build', label: 'gradle build', command: gradle, args: ['build'] }),
      definition({ id: 'gradle-test', label: 'gradle test', command: gradle, args: ['test'] })
    );
  }

  // Ruby
  if (await exists(path.join(dir, 'Gemfile'))) {
    stack.push('ruby');
    const rails =
      (await exists(path.join(dir, 'bin', 'rails'))) ||
      (await exists(path.join(dir, 'config', 'application.rb')));
    if (rails) {
      suggestedProcesses.push(
        definition({
          id: 'rails-server',
          label: 'rails server',
          command: 'bundle',
          args: ['exec', 'rails', 'server'],
        }),
        definition({
          id: 'rails-test',
          label: 'rails test',
          command: 'bundle',
          args: ['exec', 'rails', 'test'],
        })
      );
    } else {
      suggestedProcesses.push(
        definition({
          id: 'bundle-rake',
          label: 'bundle exec rake',
          command: 'bundle',
          args: ['exec', 'rake'],
        })
      );
    }
  }

  // PHP
  const composerRaw = await readText(path.join(dir, 'composer.json'));
  if (composerRaw !== null) {
    stack.push('php');
    if (await exists(path.join(dir, 'artisan'))) {
      suggestedProcesses.push(
        definition({
          id: 'artisan-serve',
          label: 'php artisan serve',
          command: 'php',
          args: ['artisan', 'serve'],
        }),
        definition({
          id: 'artisan-test',
          label: 'php artisan test',
          command: 'php',
          args: ['artisan', 'test'],
        })
      );
    } else {
      for (const name of parseJsonObjectKeys(composerRaw, 'scripts').slice(0, 3)) {
        suggestedProcesses.push(
          definition({
            id: slug(`composer-${name}`),
            label: `composer ${name}`,
            command: 'composer',
            args: ['run', name],
          })
        );
      }
    }
  }

  // Elixir
  const mixRaw = await readText(path.join(dir, 'mix.exs'));
  if (mixRaw !== null) {
    stack.push('elixir');
    if (/:phoenix\b/.test(mixRaw)) {
      suggestedProcesses.push(
        definition({
          id: 'mix-phx-server',
          label: 'mix phx.server',
          command: 'mix',
          args: ['phx.server'],
        })
      );
    } else {
      suggestedProcesses.push(
        definition({ id: 'mix-run', label: 'mix run', command: 'mix', args: ['run'] })
      );
    }
    suggestedProcesses.push(
      definition({ id: 'mix-test', label: 'mix test', command: 'mix', args: ['test'] })
    );
  }

  // Deno
  const denoRaw = await readFirst(dir, ['deno.json', 'deno.jsonc']);
  if (denoRaw !== null) {
    stack.push('deno');
    const tasks = parseJsonObjectKeys(denoRaw, 'tasks');
    const ordered = [
      ...COMMON_TARGETS.filter((t) => tasks.includes(t)),
      ...tasks.filter((t) => !COMMON_TARGETS.includes(t)),
    ].slice(0, 4);
    if (ordered.length > 0) {
      for (const task of ordered) {
        suggestedProcesses.push(
          definition({
            id: slug(`deno-${task}`),
            label: `deno task ${task}`,
            command: 'deno',
            args: ['task', task],
          })
        );
      }
    } else {
      suggestedProcesses.push(
        definition({ id: 'deno-run', label: 'deno run', command: 'deno', args: ['run', '-A', 'main.ts'] })
      );
    }
  }

  // Docker Compose
  if (
    await anyExists(dir, [
      'docker-compose.yml',
      'docker-compose.yaml',
      'compose.yml',
      'compose.yaml',
    ])
  ) {
    stack.push('docker');
    suggestedProcesses.push(
      definition({
        id: 'docker-compose-up',
        label: 'docker compose up',
        command: 'docker',
        args: ['compose', 'up'],
      })
    );
  }

  // Makefile — surface only the common targets that exist.
  const makefile = await readFirst(dir, ['Makefile', 'makefile', 'GNUmakefile']);
  if (makefile !== null) {
    for (const target of parseMakefileTargets(makefile)
      .filter((t) => COMMON_TARGETS.includes(t))
      .slice(0, 5)) {
      suggestedProcesses.push(
        definition({
          id: slug(`make-${target}`),
          label: `make ${target}`,
          command: 'make',
          args: [target],
        })
      );
    }
  }

  // Procfile — one process per entry whose command runs without a shell.
  const procfile = await readText(path.join(dir, 'Procfile'));
  if (procfile !== null) {
    for (const entry of parseProcfileEntries(procfile).slice(0, 4)) {
      suggestedProcesses.push(
        definition({
          id: slug(`proc-${entry.name}`),
          label: `Procfile: ${entry.name}`,
          command: entry.command,
          args: entry.args,
        })
      );
    }
  }

  // justfile — surface only the common recipes that exist.
  const justfile = await readFirst(dir, ['justfile', '.justfile', 'Justfile']);
  if (justfile !== null) {
    for (const recipe of parseJustfileRecipes(justfile)
      .filter((r) => COMMON_TARGETS.includes(r))
      .slice(0, 5)) {
      suggestedProcesses.push(
        definition({
          id: slug(`just-${recipe}`),
          label: `just ${recipe}`,
          command: 'just',
          args: [recipe],
        })
      );
    }
  }

  // Static site (only when no language toolchain matched)
  const LANGUAGE_STACKS: ProjectStack[] = [
    'node',
    'react-native',
    'flutter',
    'android',
    'python',
    'rust',
    'go',
    'cpp',
    'dotnet',
    'java',
    'ruby',
    'php',
    'elixir',
    'deno',
  ];
  if (!stack.some((s) => LANGUAGE_STACKS.includes(s))) {
    if (await exists(path.join(dir, 'index.html'))) {
      stack.push('static');
    }
  }

  const nestedRoots = await discoverNestedRoots(dir);
  if (nestedRoots.length > 0) {
    warnings.push(
      `Detected ${nestedRoots.length} nested package root${nestedRoots.length === 1 ? '' : 's'}: ${nestedRoots.slice(0, 5).join(', ')}${nestedRoots.length > 5 ? '…' : ''}`
    );
    // Suggest one primary script per nested root (dev/start), capped.
    for (const rel of nestedRoots.slice(0, 12)) {
      const nestedDir = path.join(dir, ...rel.split('/'));
      const nestedPm = await detectPackageManager(nestedDir);
      const nestedPkg = await readJson(path.join(nestedDir, 'package.json'));
      if (!nestedPkg || typeof nestedPkg !== 'object') continue;
      const scripts =
        'scripts' in nestedPkg && nestedPkg.scripts && typeof nestedPkg.scripts === 'object'
          ? (nestedPkg.scripts as Record<string, unknown>)
          : {};
      const scriptName = ['dev', 'start', 'serve'].find((n) => typeof scripts[n] === 'string');
      if (!scriptName) continue;
      suggestedProcesses.push(
        definition({
          id: slug(`${rel}-${scriptName}`),
          label: `${rel}: ${nestedPm} run ${scriptName}`,
          command: nestedPm,
          args: ['run', scriptName],
          cwd: rel,
        })
      );
    }
  }

  return { stack, packageManager, suggestedProcesses, warnings, nestedRoots };
}
