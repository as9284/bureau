import type { ApiVariableDefinition } from '@shared/contracts/apiWorkbench';
import { toBureauError } from '../ipc/errors';
import { MAX_GUEST_VARIABLE_BYTES } from './script/limits';

export type VariableScope = {
  name: string;
  value: string;
  secret: boolean;
};

export type VariableResolverInput = {
  requestVariables: ApiVariableDefinition[];
  folderVariables: ApiVariableDefinition[][];
  environmentVariables: ApiVariableDefinition[];
  workspaceVariables: ApiVariableDefinition[];
  /**
   * Values written by the current script, already plain strings. Second-highest precedence
   * (§7.2 tier 2) — above every stored scope, below collection-run iteration data.
   */
  runtimeValues?: Map<string, string>;
  /** One row of a collection run's data set. The highest-precedence layer (§7.2 tier 1). */
  iterationValues?: Map<string, string>;
  sendUnresolvedLiterals: boolean;
  resolveSecret: (secretId: string) => string | undefined;
};

export type VariableResolverResult =
  | { ok: true; resolved: string }
  | { ok: false; error: ReturnType<typeof toBureauError> };

const VARIABLE_PATTERN = /\{\{([^}]+)\}\}/g;

/** Backstop in case a scope map is mutated between cycle detection and expansion. */
const MAX_EXPANSION_DEPTH = 32;

function enabledVariables(
  definitions: ApiVariableDefinition[],
  resolveSecret: (secretId: string) => string | undefined
): VariableScope[] {
  const scopes: VariableScope[] = [];
  for (const variable of definitions) {
    if (!variable.enabled) continue;
    const name = variable.name.trim();
    if (!name) continue;
    if (variable.secret) {
      const plain = variable.secretId ? resolveSecret(variable.secretId) : undefined;
      // An unresolvable secret stays absent so the template reports it as unresolved rather
      // than silently sending an empty value.
      if (plain !== undefined) {
        scopes.push({ name, value: plain, secret: true });
      }
      continue;
    }
    if (variable.value !== undefined) {
      scopes.push({ name, value: variable.value, secret: false });
    }
  }
  return scopes;
}

function buildScopeMap(input: VariableResolverInput): Map<string, VariableScope> {
  const map = new Map<string, VariableScope>();
  // Lowest → highest precedence so later layers overwrite.
  const layers = [
    ...input.workspaceVariables,
    ...input.environmentVariables,
    ...input.folderVariables.flat(),
    ...input.requestVariables,
  ];
  for (const scope of enabledVariables(layers, input.resolveSecret)) {
    map.set(scope.name, scope);
  }
  // Runtime and iteration values are already resolved strings, so they are inserted last. They are
  // treated as non-secret: a script that copies a secret into a runtime variable has chosen to.
  for (const [name, value] of input.runtimeValues ?? []) {
    map.set(name, { name, value, secret: false });
  }
  for (const [name, value] of input.iterationValues ?? []) {
    map.set(name, { name, value, secret: false });
  }
  return map;
}

/**
 * The variable bag a script sees: every enabled variable resolved to a plain string, including
 * secret values (§13.2). Secret names are reported separately so the host can redact them from
 * everything the script emits.
 */
export function scriptVariableBag(input: VariableResolverInput): {
  variables: Record<string, string>;
  secretNames: string[];
  secretValues: string[];
} {
  const map = buildScopeMap(input);
  const variables: Record<string, string> = {};
  const secretNames: string[] = [];
  const secretValues: string[] = [];
  for (const scope of map.values()) {
    // A variable larger than the guest bound is omitted rather than truncated: a silently
    // shortened value would be worse than a missing one. Templates still resolve it in full.
    if (scope.value.length > MAX_GUEST_VARIABLE_BYTES) continue;
    variables[scope.name] = scope.value;
    if (scope.secret) {
      secretNames.push(scope.name);
      secretValues.push(scope.value);
    }
  }
  return { variables, secretNames, secretValues };
}

function detectCycle(template: string, scopeMap: Map<string, VariableScope>): string[] | null {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function resolveName(name: string, chain: string[]): string[] | null {
    const trimmed = name.trim();
    if (!trimmed) return null;
    if (visiting.has(trimmed)) return [...chain, trimmed];
    if (visited.has(trimmed)) return null;
    visiting.add(trimmed);
    const scope = scopeMap.get(trimmed);
    if (scope) {
      const inner = scope.value.matchAll(VARIABLE_PATTERN);
      for (const match of inner) {
        const nested = resolveName(match[1], [...chain, trimmed]);
        if (nested) return nested;
      }
    }
    visiting.delete(trimmed);
    visited.add(trimmed);
    return null;
  }

  for (const match of template.matchAll(VARIABLE_PATTERN)) {
    const cycle = resolveName(match[1], []);
    if (cycle) return cycle;
  }
  return null;
}

export function resolveTemplate(
  template: string,
  input: VariableResolverInput,
  operation: string
): VariableResolverResult {
  const scopeMap = buildScopeMap(input);
  const cycle = detectCycle(template, scopeMap);
  if (cycle) {
    return {
      ok: false,
      error: toBureauError({
        code: 'API_VARIABLE_CYCLE',
        message: `Variable cycle detected: ${cycle.join(' → ')}.`,
        operation,
        retryable: false,
      }),
    };
  }

  const unresolved: string[] = [];
  // A variable's value may itself reference variables. `detectCycle` has already proven the
  // reference graph is acyclic, so this expansion terminates.
  const expand = (text: string, depth: number): string =>
    text.replace(VARIABLE_PATTERN, (_full, rawName: string) => {
      const name = rawName.trim();
      const scope = scopeMap.get(name);
      if (!scope) {
        unresolved.push(name);
        // Left visibly unresolved either way; the caller decides whether that blocks the send.
        return `{{${name}}}`;
      }
      if (depth >= MAX_EXPANSION_DEPTH) return scope.value;
      return expand(scope.value, depth + 1);
    });
  const resolved = expand(template, 0);

  if (!input.sendUnresolvedLiterals && unresolved.length > 0) {
    return {
      ok: false,
      error: toBureauError({
        code: 'API_VARIABLE_UNRESOLVED',
        message: `Unresolved variable${unresolved.length === 1 ? '' : 's'}: ${unresolved.join(', ')}.`,
        operation,
        retryable: false,
        details: unresolved.join(', '),
      }),
    };
  }

  return { ok: true, resolved };
}

export function resolveVariableDefinitions(
  definitions: ApiVariableDefinition[],
  input: Omit<VariableResolverInput, 'requestVariables'>,
  operation: string
): { ok: true; variables: ApiVariableDefinition[] } | { ok: false; error: ReturnType<typeof toBureauError> } {
  const resolved: ApiVariableDefinition[] = [];
  for (const variable of definitions) {
    if (!variable.enabled || variable.secret) {
      resolved.push(variable);
      continue;
    }
    if (variable.value === undefined) {
      resolved.push(variable);
      continue;
    }
    const result = resolveTemplate(variable.value, { ...input, requestVariables: [] }, operation);
    if (!result.ok) return result;
    resolved.push({ ...variable, value: result.resolved });
  }
  return { ok: true, variables: resolved };
}
