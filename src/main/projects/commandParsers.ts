// Pure parsers that turn task-runner / manifest files into runnable target names.
// Kept side-effect-free so they can be unit-tested against real file fixtures.

// Common target names we surface in "conservative" mode; a runner's full set is not
// enumerated (that is the "comprehensive" behaviour we deliberately do not use here).
export const COMMON_TARGETS = ['dev', 'start', 'run', 'serve', 'build', 'test', 'lint', 'up'];

/** Make target names (excludes variable assignments, pattern rules, and .PHONY-style). */
export function parseMakefileTargets(content: string): string[] {
  const targets: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    // A rule starts at column 0 as `name:` (not `:=`/`::=` assignment, not `.dotted`,
    // not a `%` pattern rule, and with no `=` before the colon).
    const match = /^([A-Za-z][A-Za-z0-9_.-]*)\s*:(?![=:])/.exec(line);
    if (!match) continue;
    const name = match[1];
    if (name.includes('%') || line.slice(0, line.indexOf(':')).includes('=')) continue;
    if (!targets.includes(name)) targets.push(name);
  }
  return targets;
}

/** just recipe names (top-level, non-indented; excludes `:=` assignments and settings). */
export function parseJustfileRecipes(content: string): string[] {
  const recipes: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (/^\s/.test(line) || /^[#@]/.test(line)) continue; // recipe bodies are indented
    if (/:=/.test(line)) continue; // assignment (excluded first so params may contain `=`)
    const match = /^([a-zA-Z_][a-zA-Z0-9_-]*)\b[^\n]*?:/.exec(line);
    if (!match) continue;
    const name = match[1];
    if (name === 'set' || name === 'export' || name === 'alias') continue;
    if (!recipes.includes(name)) recipes.push(name);
  }
  return recipes;
}

export type ProcfileEntry = { name: string; command: string; args: string[] };

/**
 * Procfile `name: command` entries. Because processes run without a shell, entries whose
 * command uses shell features (pipes, redirects, env-prefixes, substitution) are skipped
 * rather than mis-split.
 */
export function parseProcfileEntries(content: string): ProcfileEntry[] {
  const entries: ProcfileEntry[] = [];
  for (const line of content.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.+?)\s*$/.exec(line);
    if (!match) continue;
    const [, name, command] = match;
    if (/[|&;<>$`(){}]/.test(command)) continue; // needs a shell — skip
    const tokens = command.split(/\s+/);
    if (tokens.length === 0 || tokens[0].includes('=')) continue; // env-prefixed — skip
    entries.push({ name, command: tokens[0], args: tokens.slice(1) });
  }
  return entries;
}

/** Object keys from a JSON manifest field (deno.json `tasks`, composer.json `scripts`). */
export function parseJsonObjectKeys(raw: string, field: string): string[] {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const group = parsed[field];
    if (typeof group !== 'object' || group === null || Array.isArray(group)) return [];
    return Object.keys(group as Record<string, unknown>);
  } catch {
    return [];
  }
}
