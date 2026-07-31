import type {
  ApiCollectionNode,
  ApiVariableDefinition,
  ApiWorkspaceSnapshot,
} from '@shared/contracts/apiWorkbench';

/**
 * Renderer-side preview of variable resolution.
 *
 * This mirrors `src/main/api/VariableResolver.ts` (same `{{name}}` pattern, same
 * workspace → environment → folder → request precedence, same cycle guard) so the composer can
 * show what a request will actually send. It is a *preview*: the renderer never holds secret
 * plaintext, so a secret-backed variable resolves to a mask rather than a value, and main stays the
 * only place that performs the real substitution.
 */

const VARIABLE_PATTERN = /\{\{([^}]*)\}\}/g;
const MAX_EXPANSION_DEPTH = 32;
const SECRET_MASK = '••••••';

export type VariableOrigin = 'workspace' | 'environment' | 'folder' | 'request';

export type VariableScopeEntry = {
  name: string;
  /** Absent for secret-backed variables — the renderer never sees the plaintext. */
  value?: string;
  secret: boolean;
  origin: VariableOrigin;
};

export type VariableScope = Map<string, VariableScopeEntry>;

export type TokenStatus = 'resolved' | 'secret' | 'missing' | 'cycle';

export type VariableToken = {
  /** Trimmed variable name; empty when the template contains a bare `{{}}`. */
  name: string;
  /** Offsets of the whole `{{…}}` span in the source template. */
  start: number;
  end: number;
  status: TokenStatus;
  origin?: VariableOrigin;
};

export type TemplateScan = {
  tokens: VariableToken[];
  /** The template with resolvable variables substituted; secrets masked, misses left literal. */
  preview: string;
  /** Distinct names that no scope provides, in first-seen order. */
  missing: string[];
  /** Distinct names whose expansion is cyclic. */
  cyclic: string[];
};

function collectEnabled(
  definitions: readonly ApiVariableDefinition[] | undefined,
  origin: VariableOrigin,
  into: VariableScope
): void {
  for (const variable of definitions ?? []) {
    if (!variable.enabled) continue;
    const name = variable.name.trim();
    if (!name) continue;
    if (variable.secret) {
      // An unbound secret is absent, exactly as main treats it: reported unresolved rather than
      // silently sent as an empty string.
      if (!variable.secretId && !variable.hasSecretValue) continue;
      into.set(name, { name, secret: true, origin });
      continue;
    }
    if (variable.value === undefined) continue;
    into.set(name, { name, value: variable.value, secret: false, origin });
  }
}

/** Ancestor folders of a request's collection node, outermost first (main's folder order). */
function folderChain(
  collections: readonly ApiCollectionNode[],
  requestId: string
): ApiCollectionNode[] {
  const byId = new Map(collections.map((node) => [node.collectionId, node]));
  const own = collections.find((node) => node.requestId === requestId);
  const chain: ApiCollectionNode[] = [];
  let parent = own?.parentId ? byId.get(own.parentId) : undefined;
  while (parent) {
    chain.unshift(parent);
    parent = parent.parentId ? byId.get(parent.parentId) : undefined;
  }
  return chain;
}

/**
 * Builds the scope a request resolves against. Later layers overwrite earlier ones, matching
 * `buildScopeMap` in main.
 */
export function buildVariableScope(input: {
  snapshot: ApiWorkspaceSnapshot | null;
  environmentId: string | null;
  requestId?: string;
  requestVariables?: readonly ApiVariableDefinition[];
}): VariableScope {
  const scope: VariableScope = new Map();
  if (!input.snapshot) return scope;

  collectEnabled(input.snapshot.variables, 'workspace', scope);

  const environment = input.snapshot.environments.find(
    (entry) => entry.environmentId === input.environmentId
  );
  collectEnabled(environment?.variables, 'environment', scope);

  if (input.requestId) {
    for (const folder of folderChain(input.snapshot.collections, input.requestId)) {
      collectEnabled(folder.variables, 'folder', scope);
    }
  }

  collectEnabled(input.requestVariables, 'request', scope);
  return scope;
}

/** True when expanding `name` re-enters itself. Mirrors main's `detectCycle`. */
function isCyclic(name: string, scope: VariableScope): boolean {
  const walk = (current: string, seen: Set<string>): boolean => {
    if (seen.has(current)) return true;
    const entry = scope.get(current);
    if (!entry?.value) return false;
    const next = new Set(seen).add(current);
    for (const match of entry.value.matchAll(VARIABLE_PATTERN)) {
      if (walk(match[1].trim(), next)) return true;
    }
    return false;
  };
  return walk(name, new Set());
}

function expand(text: string, scope: VariableScope, depth: number): string {
  if (depth >= MAX_EXPANSION_DEPTH) return text;
  return text.replace(VARIABLE_PATTERN, (full, rawName: string) => {
    const name = rawName.trim();
    const entry = scope.get(name);
    if (!entry) return full;
    if (entry.secret) return SECRET_MASK;
    if (entry.value === undefined) return full;
    return expand(entry.value, scope, depth + 1);
  });
}

/** Scans one template for variable tokens and produces the preview string. */
export function scanTemplate(template: string, scope: VariableScope): TemplateScan {
  const tokens: VariableToken[] = [];
  const missing: string[] = [];
  const cyclic: string[] = [];

  for (const match of template.matchAll(VARIABLE_PATTERN)) {
    const name = match[1].trim();
    const start = match.index ?? 0;
    const entry = name ? scope.get(name) : undefined;
    let status: TokenStatus;
    if (!entry) {
      status = 'missing';
      if (name && !missing.includes(name)) missing.push(name);
    } else if (isCyclic(name, scope)) {
      status = 'cycle';
      if (!cyclic.includes(name)) cyclic.push(name);
    } else {
      status = entry.secret ? 'secret' : 'resolved';
    }
    tokens.push({ name, start, end: start + match[0].length, status, origin: entry?.origin });
  }

  // A cyclic template would not terminate meaningfully; show it raw and let the banner explain.
  const preview = cyclic.length > 0 ? template : expand(template, scope, 0);
  return { tokens, preview, missing, cyclic };
}

/** Variable names offered by `{{` autocomplete, in precedence order with their origin. */
export function scopeSuggestions(scope: VariableScope): VariableScopeEntry[] {
  return [...scope.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export { SECRET_MASK };
