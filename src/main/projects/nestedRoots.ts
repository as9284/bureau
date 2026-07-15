import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.turbo',
  'coverage',
  'vendor',
  'target',
  '.venv',
  'venv',
  '__pycache__',
]);

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Discovers nested package roots under a monorepo (workspaces + common folders).
 * Returns paths relative to `root`, POSIX-style, sorted.
 */
export async function discoverNestedRoots(root: string): Promise<string[]> {
  const found = new Set<string>();

  // package.json workspaces (npm/yarn/pnpm)
  const pkg = await readJson(path.join(root, 'package.json'));
  if (pkg && typeof pkg === 'object') {
    const workspaces = (pkg as { workspaces?: unknown }).workspaces;
    const patterns = Array.isArray(workspaces)
      ? workspaces.filter((w): w is string => typeof w === 'string')
      : workspaces && typeof workspaces === 'object' && Array.isArray((workspaces as { packages?: unknown }).packages)
        ? ((workspaces as { packages: unknown[] }).packages.filter(
            (w): w is string => typeof w === 'string'
          ) as string[])
        : [];
    for (const pattern of patterns) {
      // Only support simple globs like "apps/*" / "packages/*"
      const match = pattern.match(/^([^/*]+)\/\*$/);
      if (match) {
        const base = path.join(root, match[1]);
        if (await exists(base)) {
          try {
            const entries = await readdir(base, { withFileTypes: true });
            for (const entry of entries) {
              if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
              const child = path.join(base, entry.name);
              if (await hasPackageMarker(child)) {
                found.add(toRel(root, child));
              }
            }
          } catch {
            // ignore
          }
        }
      } else if (!pattern.includes('*')) {
        const child = path.join(root, pattern);
        if (await hasPackageMarker(child)) found.add(toRel(root, child));
      }
    }
  }

  // pnpm-workspace.yaml
  const pnpmWs = await readText(path.join(root, 'pnpm-workspace.yaml'));
  if (pnpmWs) {
    for (const line of pnpmWs.split(/\r?\n/)) {
      const m = line.match(/^\s*-\s*['"]?([^'"#\s]+)['"]?/);
      if (!m) continue;
      const pattern = m[1];
      const glob = pattern.match(/^([^/*]+)\/\*$/);
      if (glob) {
        const base = path.join(root, glob[1]);
        if (!(await exists(base))) continue;
        try {
          for (const entry of await readdir(base, { withFileTypes: true })) {
            if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
            const child = path.join(base, entry.name);
            if (await hasPackageMarker(child)) found.add(toRel(root, child));
          }
        } catch {
          // ignore
        }
      }
    }
  }

  // Bounded walk of common monorepo folders (depth 2)
  for (const folder of ['apps', 'packages', 'services', 'libs', 'modules']) {
    const base = path.join(root, folder);
    if (!(await exists(base))) continue;
    try {
      for (const entry of await readdir(base, { withFileTypes: true })) {
        if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
        const child = path.join(base, entry.name);
        if (await hasPackageMarker(child)) found.add(toRel(root, child));
      }
    } catch {
      // ignore
    }
  }

  return [...found].sort();
}

async function hasPackageMarker(dir: string): Promise<boolean> {
  return (
    (await exists(path.join(dir, 'package.json'))) ||
    (await exists(path.join(dir, 'pubspec.yaml'))) ||
    (await exists(path.join(dir, 'Cargo.toml'))) ||
    (await exists(path.join(dir, 'go.mod'))) ||
    (await exists(path.join(dir, 'pyproject.toml')))
  );
}

function toRel(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join('/');
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
