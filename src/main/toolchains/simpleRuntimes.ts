import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RuntimeKind, RuntimeRow } from '@shared/contracts/toolchains';
import type { ProjectStack } from '@shared/contracts/projects';
import { resolveExecutable } from '../system/executableResolver';
import { runCommand } from './runCommand';
import { normalizeVersion, versionSatisfies } from './versionFileParsers';

// ---------------------------------------------------------------------------
// Version-file parsers for the detect-only runtimes.
//
// Most pins are a single non-comment line; `parsePlainVersion` covers those.
// The structured ones (go.mod, rust-toolchain.toml, global.json, composer's
// `require.php`, package.json `packageManager`, Package.swift, mix.exs, Gemfile,
// .sdkmanrc) get their own small parser. Every parser returns a trimmed version
// string or `null`, never throws — malformed input is just "no pin".
// ---------------------------------------------------------------------------

/** First non-empty, non-comment line — the shape of .ruby-version / .swift-version / .dvmrc. */
export function parsePlainVersion(content: string): string | null {
  const line = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'));
  if (!line) return null;
  // `.ruby-version` may read `ruby-3.2.0`; `.tool-versions`-style prefixes are stripped elsewhere.
  const stripped = line.replace(/^ruby-/i, '').trim();
  return stripped || null;
}

/** `go 1.22` / `go 1.22.1` directive from a go.mod. */
export function parseGoMod(content: string): string | null {
  const match = content.match(/^\s*go\s+(\d+\.\d+(?:\.\d+)?)/m);
  return match ? match[1] : null;
}

/** `channel = "1.75.0"` (TOML) or a bare `1.75.0` / `stable` from a rust-toolchain file. */
export function parseRustToolchain(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  const channel = trimmed.match(/channel\s*=\s*['"]([^'"]+)['"]/);
  if (channel) return channel[1].trim() || null;
  // Legacy plain `rust-toolchain` file: a single token (version or channel name).
  if (!trimmed.includes('[') && !trimmed.includes('=')) {
    return parsePlainVersion(trimmed);
  }
  return null;
}

/** `.sdkmanrc` line `java=21.0.1-tem` → `21.0.1` (drops the vendor suffix). */
export function parseSdkmanrc(content: string, key: string): string | null {
  const match = content.match(new RegExp(`^\\s*${key}\\s*=\\s*([^\\s#]+)`, 'm'));
  if (!match) return null;
  const value = match[1].trim();
  const version = value.match(/^(\d+(?:\.\d+)*)/);
  return version ? version[1] : value || null;
}

/** `.NET` SDK pin from global.json: `{ "sdk": { "version": "8.0.100" } }`. */
export function parseGlobalJson(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as { sdk?: { version?: unknown } };
    const version = parsed.sdk?.version;
    return typeof version === 'string' && version.trim() ? version.trim() : null;
  } catch {
    return null;
  }
}

/** `require.php` constraint from composer.json (e.g. `">=8.1"`). */
export function parseComposerPhp(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as { require?: Record<string, unknown> };
    const php = parsed.require?.php;
    return typeof php === 'string' && php.trim() ? php.trim() : null;
  } catch {
    return null;
  }
}

/** `ruby "3.2.0"` (or `ruby '3.2.0'`) declaration from a Gemfile. */
export function parseGemfileRuby(content: string): string | null {
  const match = content.match(/^\s*ruby\s+['"]([^'"]+)['"]/m);
  return match ? match[1].trim() || null : null;
}

/** `bun` pin from package.json — `packageManager: "bun@1.1.0"` or `engines.bun`. */
export function parsePackageJsonBun(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as {
      packageManager?: unknown;
      engines?: { bun?: unknown };
    };
    if (typeof parsed.packageManager === 'string') {
      const match = parsed.packageManager.match(/^bun@(.+)$/);
      if (match) return match[1].trim() || null;
    }
    const engine = parsed.engines?.bun;
    return typeof engine === 'string' && engine.trim() ? engine.trim() : null;
  } catch {
    return null;
  }
}

/** `swift-tools-version:5.9` header from a Package.swift manifest. */
export function parseSwiftToolsVersion(content: string): string | null {
  const match = content.match(/swift-tools-version:\s*(\d+\.\d+(?:\.\d+)?)/i);
  return match ? match[1] : null;
}

/** `elixir: "~> 1.15"` constraint from a mix.exs project definition. */
export function parseMixExsElixir(content: string): string | null {
  const match = content.match(/elixir:\s*['"]([^'"]+)['"]/);
  return match ? match[1].trim() || null : null;
}

// ---------------------------------------------------------------------------
// Runtime registry.
// ---------------------------------------------------------------------------

type VersionFile = {
  /** Candidate filenames, tried in order; first that exists is parsed. */
  names: string[];
  parse: (content: string) => string | null;
};

type SimpleRuntime = {
  kind: RuntimeKind;
  label: string;
  /** Detected stacks that make this runtime relevant to a project. */
  relevantStacks: ProjectStack[];
  /** Additional presence files that make it relevant even without a stack tag. */
  markerFiles: string[];
  /** Executables to probe, in preference order (first resolvable wins). */
  executables: string[];
  /** Args passed to the probe executable to print its version. */
  versionArgs: string[];
  /** Extracts the version from combined stdout+stderr. */
  versionPattern: RegExp;
  /** `.tool-versions` (asdf/mise) plugin names that map to this runtime. */
  toolVersionNames: string[];
  /** Version-file sources for the expected/pinned version. */
  versionFiles: VersionFile[];
};

const RUNTIMES: SimpleRuntime[] = [
  {
    kind: 'go',
    label: 'Go',
    relevantStacks: ['go'],
    markerFiles: [],
    executables: ['go'],
    versionArgs: ['version'],
    versionPattern: /go(\d+\.\d+(?:\.\d+)?)/,
    toolVersionNames: ['golang', 'go'],
    versionFiles: [
      { names: ['go.mod'], parse: parseGoMod },
      { names: ['.go-version'], parse: parsePlainVersion },
    ],
  },
  {
    kind: 'rust',
    label: 'Rust',
    relevantStacks: ['rust'],
    markerFiles: [],
    executables: ['rustc'],
    versionArgs: ['--version'],
    versionPattern: /rustc\s+(\d+\.\d+\.\d+)/,
    toolVersionNames: ['rust'],
    versionFiles: [
      { names: ['rust-toolchain.toml', 'rust-toolchain'], parse: parseRustToolchain },
    ],
  },
  {
    kind: 'java',
    label: 'Java',
    relevantStacks: ['java'],
    markerFiles: [],
    executables: ['java'],
    versionArgs: ['-version'], // prints to stderr
    versionPattern: /version\s+"?(\d[\d._]*)/,
    toolVersionNames: ['java'],
    versionFiles: [
      { names: ['.java-version'], parse: parsePlainVersion },
      { names: ['.sdkmanrc'], parse: (c) => parseSdkmanrc(c, 'java') },
    ],
  },
  {
    kind: 'ruby',
    label: 'Ruby',
    relevantStacks: ['ruby'],
    markerFiles: [],
    executables: ['ruby'],
    versionArgs: ['--version'],
    versionPattern: /ruby\s+(\d+\.\d+\.\d+)/,
    toolVersionNames: ['ruby'],
    versionFiles: [
      { names: ['.ruby-version'], parse: parsePlainVersion },
      { names: ['Gemfile'], parse: parseGemfileRuby },
    ],
  },
  {
    kind: 'php',
    label: 'PHP',
    relevantStacks: ['php'],
    markerFiles: [],
    executables: ['php'],
    versionArgs: ['--version'],
    versionPattern: /^PHP\s+(\d+\.\d+\.\d+)/m,
    toolVersionNames: ['php'],
    versionFiles: [
      { names: ['.php-version'], parse: parsePlainVersion },
      { names: ['composer.json'], parse: parseComposerPhp },
    ],
  },
  {
    kind: 'dotnet',
    label: '.NET',
    relevantStacks: ['dotnet'],
    markerFiles: [],
    executables: ['dotnet'],
    versionArgs: ['--version'],
    versionPattern: /(\d+\.\d+\.\d+)/,
    toolVersionNames: ['dotnet', 'dotnet-core'],
    versionFiles: [{ names: ['global.json'], parse: parseGlobalJson }],
  },
  {
    kind: 'bun',
    label: 'Bun',
    relevantStacks: [],
    markerFiles: ['bun.lockb', 'bun.lock'],
    executables: ['bun'],
    versionArgs: ['--version'],
    versionPattern: /(\d+\.\d+\.\d+)/,
    toolVersionNames: ['bun'],
    versionFiles: [
      { names: ['.bun-version'], parse: parsePlainVersion },
      { names: ['package.json'], parse: parsePackageJsonBun },
    ],
  },
  {
    kind: 'deno',
    label: 'Deno',
    relevantStacks: ['deno'],
    markerFiles: [],
    executables: ['deno'],
    versionArgs: ['--version'],
    versionPattern: /deno\s+(\d+\.\d+\.\d+)/,
    toolVersionNames: ['deno'],
    versionFiles: [{ names: ['.dvmrc'], parse: parsePlainVersion }],
  },
  {
    kind: 'elixir',
    label: 'Elixir',
    relevantStacks: ['elixir'],
    markerFiles: [],
    executables: ['elixir'],
    versionArgs: ['--version'],
    versionPattern: /Elixir\s+(\d+\.\d+\.\d+)/,
    toolVersionNames: ['elixir'],
    versionFiles: [
      { names: ['.exenv-version'], parse: parsePlainVersion },
      { names: ['mix.exs'], parse: parseMixExsElixir },
    ],
  },
  {
    kind: 'erlang',
    label: 'Erlang/OTP',
    relevantStacks: ['elixir'],
    markerFiles: [],
    executables: ['erl'],
    // Print the OTP release (e.g. "26") and exit, without dropping into a shell.
    versionArgs: ['-noshell', '-eval', 'io:fwrite(erlang:system_info(otp_release)),halt().'],
    versionPattern: /(\d+(?:\.\d+)*)/,
    toolVersionNames: ['erlang'],
    versionFiles: [],
  },
  {
    kind: 'kotlin',
    label: 'Kotlin',
    relevantStacks: [],
    markerFiles: ['build.gradle.kts', 'settings.gradle.kts'],
    executables: ['kotlinc', 'kotlin'],
    versionArgs: ['-version'], // prints to stderr
    versionPattern: /Kotlin(?:c)?\s+version\s+(\d+\.\d+\.\d+)/i,
    toolVersionNames: ['kotlin'],
    versionFiles: [],
  },
  {
    kind: 'swift',
    label: 'Swift',
    relevantStacks: [],
    markerFiles: ['Package.swift'],
    executables: ['swift'],
    versionArgs: ['--version'],
    versionPattern: /Swift\s+version\s+(\d+\.\d+(?:\.\d+)?)/,
    toolVersionNames: ['swift'],
    versionFiles: [
      { names: ['.swift-version'], parse: parsePlainVersion },
      { names: ['Package.swift'], parse: parseSwiftToolsVersion },
    ],
  },
  {
    kind: 'zig',
    label: 'Zig',
    relevantStacks: [],
    markerFiles: ['build.zig', 'build.zig.zon'],
    executables: ['zig'],
    versionArgs: ['version'],
    versionPattern: /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/,
    toolVersionNames: ['zig'],
    versionFiles: [],
  },
  {
    kind: 'dart',
    label: 'Dart',
    // Relevance is custom (a pure-Dart pubspec, not a Flutter one) — see isDartRelevant.
    relevantStacks: [],
    markerFiles: [],
    executables: ['dart'],
    versionArgs: ['--version'], // prints to stderr
    versionPattern: /(?:Dart SDK version:|version)\s+(\d+\.\d+\.\d+)/,
    toolVersionNames: ['dart'],
    versionFiles: [{ names: ['.dart-version'], parse: parsePlainVersion }],
  },
];

// ---------------------------------------------------------------------------
// Detection.
// ---------------------------------------------------------------------------

export type RuntimeVersionProbe = (
  executables: string[],
  args: string[]
) => Promise<string | null>;

/** Default probe: resolve the first executable on PATH and read its version output. */
const defaultProbe: RuntimeVersionProbe = async (executables, args) => {
  for (const name of executables) {
    const exe = await resolveExecutable(name);
    if (!exe) continue;
    const { stdout, stderr } = await runCommand(exe, args, { timeoutMs: 6000 });
    // Version output lands on stdout for most tools, stderr for java/kotlin/dart/erl.
    return `${stdout}\n${stderr}`;
  }
  return null;
};

async function readText(target: string): Promise<string | null> {
  try {
    return await readFile(target, 'utf8');
  } catch {
    return null;
  }
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function expectedFor(
  runtime: SimpleRuntime,
  projectRoot: string,
  toolVersions: Record<string, string>
): Promise<string | null> {
  for (const file of runtime.versionFiles) {
    for (const name of file.names) {
      const content = await readText(path.join(projectRoot, name));
      if (content === null) continue;
      const parsed = file.parse(content);
      if (parsed) return parsed;
    }
  }
  for (const alias of runtime.toolVersionNames) {
    if (toolVersions[alias]) return toolVersions[alias];
  }
  return null;
}

/**
 * Dart is relevant only for a *standalone* Dart project — a pubspec.yaml with a
 * Dart SDK constraint but no Flutter SDK. A Flutter project already gets its own
 * (switchable) Flutter row, so we don't double it up here.
 */
async function isDartRelevant(
  projectRoot: string,
  expected: string | null,
  toolVersions: Record<string, string>
): Promise<boolean> {
  if (expected || toolVersions['dart']) return true;
  const pubspec = await readText(path.join(projectRoot, 'pubspec.yaml'));
  if (pubspec === null) return false;
  const hasDartSdk = /^\s*sdk:\s*['"]?[^'"\n#]*\d/m.test(pubspec);
  const hasFlutterSdk = /^\s*flutter:\s*['"]?[^'"\n#]*\d/m.test(pubspec);
  return hasDartSdk && !hasFlutterSdk;
}

async function isRelevant(
  runtime: SimpleRuntime,
  projectRoot: string,
  stack: ProjectStack[],
  expected: string | null,
  toolVersions: Record<string, string>
): Promise<boolean> {
  if (runtime.kind === 'dart') return isDartRelevant(projectRoot, expected, toolVersions);
  if (expected) return true;
  if (runtime.relevantStacks.some((s) => stack.includes(s))) return true;
  for (const marker of runtime.markerFiles) {
    if (await fileExists(path.join(projectRoot, marker))) return true;
  }
  return false;
}

function extractVersion(output: string, pattern: RegExp): string | null {
  const match = output.match(pattern);
  return match ? match[1] : null;
}

/**
 * Builds detect-and-display rows for every non-switchable runtime relevant to the
 * project. Relevant = pins an expected version, or its ecosystem/marker files are
 * present. Never switchable; the version shown is whatever is on PATH.
 */
export async function detectSimpleRuntimeRows(
  projectRoot: string,
  stack: ProjectStack[],
  toolVersions: Record<string, string>,
  probe: RuntimeVersionProbe = defaultProbe
): Promise<RuntimeRow[]> {
  const rows = await Promise.all(
    RUNTIMES.map(async (runtime): Promise<RuntimeRow | null> => {
      const expected = await expectedFor(runtime, projectRoot, toolVersions);
      if (!(await isRelevant(runtime, projectRoot, stack, expected, toolVersions))) {
        return null;
      }
      const output = await probe(runtime.executables, runtime.versionArgs);
      const detected = output ? extractVersion(output, runtime.versionPattern) : null;
      const missing = Boolean(expected) && !detected;
      const mismatch = Boolean(
        expected && detected && !versionSatisfies(expected, detected)
      );
      return {
        kind: runtime.kind,
        label: runtime.label,
        activeVersion: detected,
        expectedVersion: expected,
        installedVersions: detected ? [detected] : [],
        manager: null,
        mismatch,
        missing,
        installHint:
          missing && expected
            ? `Install ${runtime.label} ${normalizeVersion(expected)}`
            : null,
        switchable: false,
      };
    })
  );
  return rows.filter((row): row is RuntimeRow => row !== null);
}
