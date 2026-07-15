const PATH_KEY = process.platform === 'win32' ? 'Path' : 'PATH';

/** Prepends entries to PATH without duplicating segments. */
export function prependPath(
  env: NodeJS.ProcessEnv,
  entries: string[]
): NodeJS.ProcessEnv {
  const current = env[PATH_KEY] ?? env.PATH ?? '';
  const sep = process.platform === 'win32' ? ';' : ':';
  const existing = new Set(
    current
      .split(sep)
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const prepend = entries.filter((entry) => entry && !existing.has(entry));
  if (prepend.length === 0) return { ...env };
  const merged = [...prepend, ...existing].join(sep);
  return { ...env, [PATH_KEY]: merged, PATH: merged };
}

export function sanitizeEnv(): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) base[k] = v;
  }
  return base;
}

export function mergeEnv(
  base: Record<string, string>,
  pathEntries: string[],
  overrides: Record<string, string>
): NodeJS.ProcessEnv {
  let env: NodeJS.ProcessEnv = { ...base, ...overrides };
  if (pathEntries.length > 0) {
    env = prependPath(env, pathEntries);
  }
  return env;
}
