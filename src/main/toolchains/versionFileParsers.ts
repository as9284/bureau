export function parseNvmrc(content: string): string | null {
  const line = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'));
  return line ? normalizeExactPin(line) : null;
}

export function parseNodeVersionFile(content: string): string | null {
  return parseNvmrc(content);
}

export function parsePythonVersionFile(content: string): string | null {
  const line = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'));
  return line ?? null;
}

export function parseToolVersions(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [tool, version] = line.split(/\s+/);
    if (tool && version) out[tool.toLowerCase()] = version;
  }
  return out;
}

/** Returns the raw engines.node constraint (e.g. ">=22", "^20.11.0"), not a stripped pin. */
export function parseEnginesNode(engines: unknown): string | null {
  if (!engines || typeof engines !== 'object') return null;
  const node = (engines as Record<string, unknown>).node;
  if (typeof node !== 'string') return null;
  const trimmed = node.trim();
  return trimmed || null;
}

export function parsePubspecSdk(content: string): string | null {
  // The Flutter constraint lives under `environment:` as its own `flutter:` key
  // (the sibling `sdk:` key is the Dart SDK). Match a `flutter:` line whose inline
  // value carries a version — the top-level `flutter:` asset section has none.
  const match = content.match(/^\s*flutter:\s*['"]?([^'"\n#]+)['"]?/m);
  if (!match) return null;
  const value = match[1].trim();
  return /\d/.test(value) ? value : null;
}

export function parseFvmConfig(content: string): string | null {
  try {
    // Legacy `.fvm/fvm_config.json` uses `flutterSdkVersion`; modern `.fvmrc` uses `flutter`.
    const parsed = JSON.parse(content) as { flutterSdkVersion?: string; flutter?: string };
    const version = parsed.flutter ?? parsed.flutterSdkVersion;
    return version ? normalizeVersion(version) : null;
  } catch {
    const match = content.match(/(?:flutterSdkVersion|flutter):\s*['"]?([^'"\n]+)['"]?/);
    return match ? normalizeVersion(match[1].trim()) : null;
  }
}

export function parseFvmrc(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) return parseFvmConfig(trimmed);
  return normalizeVersion(trimmed);
}

/** Loose equality for exact pins (22 matches 22.11.0). */
export function versionsMatch(expected: string, actual: string): boolean {
  const e = normalizeVersion(expected);
  const a = normalizeVersion(actual);
  if (!e || !a) return false;
  return a === e || a.startsWith(`${e}.`) || e.startsWith(`${a}.`);
}

/**
 * Whether `actual` satisfies a project constraint.
 * Exact pins (.nvmrc): prefix match.
 * Ranges from engines.node / Dart SDK are honored: `>=` `>` `<=` `<` `^` `~` `*`, plus
 * space-separated compound ranges (all must hold, e.g. `>=3.0.0 <4.0.0`) and `||` alternatives
 * (any may hold, e.g. `^18 || ^20`). So Node 24 satisfies ">=22" but not ">=3.0.0 <4.0.0".
 */
export function versionSatisfies(constraint: string, actual: string): boolean {
  const raw = constraint.trim();
  if (!raw || raw === '*' || raw === 'x' || raw === 'X') return true;

  // `||` — any alternative satisfying is enough.
  if (raw.includes('||')) {
    return raw.split('||').some((part) => versionSatisfies(part, actual));
  }

  const actualParts = parseSemver(normalizeVersion(actual));
  if (!actualParts) return versionsMatch(raw, actual);

  // Space-separated compound range — every comparator must hold (e.g. `>=3.0.0 <4.0.0`).
  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    return tokens.every((token) => satisfiesComparator(token, actualParts, actual));
  }

  // Single comparator with an operator prefix, else fall back to exact-pin prefix match.
  if (/^(>=|<=|>|<|\^|~|=)/.test(raw)) {
    return satisfiesComparator(raw, actualParts, actual);
  }
  return versionsMatch(raw, actual);
}

/** Evaluates one comparator token (`>=3.0.0`, `<4.0.0`, `^18`, `~3.1`, `3.2`) against a version. */
function satisfiesComparator(token: string, actualParts: Semver, actual: string): boolean {
  const trimmed = token.trim();
  if (!trimmed || trimmed === '*' || trimmed === 'x' || trimmed === 'X') return true;
  const opMatch = trimmed.match(/^(>=|<=|>|<|\^|~|=)?\s*(.+)$/);
  if (!opMatch) return false;
  const op = opMatch[1] ?? '';
  const rest = normalizeVersion(opMatch[2]);
  const target = parseSemver(rest);
  if (!target) return false;
  const cmp = compareSemver(actualParts, target);

  switch (op) {
    case '>=':
      return cmp >= 0;
    case '>':
      return cmp > 0;
    case '<=':
      return cmp <= 0;
    case '<':
      return cmp < 0;
    case '^':
      // Caret: allow changes that don't modify the left-most non-zero component.
      if (target[0] > 0) return actualParts[0] === target[0] && cmp >= 0;
      if (target[1] > 0)
        return actualParts[0] === 0 && actualParts[1] === target[1] && cmp >= 0;
      return actualParts[0] === 0 && actualParts[1] === 0 && actualParts[2] === target[2];
    case '~': {
      // Tilde: `~3.1` locks the minor; `~3` (major only) allows the whole 3.x line.
      const minorPinned = /^\d+\.\d+/.test(rest);
      if (minorPinned) {
        return actualParts[0] === target[0] && actualParts[1] === target[1] && cmp >= 0;
      }
      return actualParts[0] === target[0] && cmp >= 0;
    }
    default:
      return versionsMatch(rest, actual);
  }
}

export function normalizeVersion(value: string): string {
  return value
    .trim()
    .replace(/^v/, '')
    .replace(/^nodejs\s+/i, '')
    .replace(/^>=\s*/, '')
    .replace(/^>\s*/, '')
    .replace(/^<=\s*/, '')
    .replace(/^<\s*/, '')
    .replace(/^~\s*/, '')
    .replace(/^\^\s*/, '')
    .replace(/^=\s*/, '');
}

function normalizeExactPin(value: string): string {
  return value.trim().replace(/^v/, '');
}

type Semver = [number, number, number];

function parseSemver(value: string): Semver | null {
  const match = value.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function compareSemver(a: Semver, b: Semver): number {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}
