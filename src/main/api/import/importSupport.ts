import { randomUUID } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import type {
  ApiImportDraftEnvironment,
  ApiImportDraftNode,
  ApiInterchangeFormat,
  ApiInterchangeNote,
  ApiKeyValue,
  ApiProtocol,
  ApiRequestDefinition,
} from '@shared/contracts/apiWorkbench';

/** Bounds every importer shares. Enforced in main, never only in a renderer control. */
export type ImportLimits = {
  maxBytes: number;
  maxNodes: number;
  /** Guards against a deeply nested document exhausting the stack. */
  maxDepth: number;
};

export const DEFAULT_IMPORT_DEPTH = 64;

/**
 * The in-memory draft every importer normalises to. Nothing here has touched storage yet —
 * `ImportService` turns it into one atomic commit.
 */
export type ImportDraft = {
  format: ApiInterchangeFormat;
  sourceLabel: string;
  nodes: ApiImportDraftNode[];
  /** Full request definitions keyed by the node's tempId. */
  requests: Map<string, DraftRequest>;
  environments: DraftEnvironment[];
  warnings: ApiInterchangeNote[];
  truncated: boolean;
};

export type DraftRequest = Omit<
  ApiRequestDefinition,
  'requestId' | 'workspaceId' | 'collectionId' | 'revision' | 'createdAt' | 'updatedAt'
>;

export type DraftEnvironment = {
  tempId: string;
  name: string;
  variables: Array<{ name: string; value: string; enabled: boolean; secret: boolean }>;
};

export function newDraft(format: ApiInterchangeFormat, sourceLabel: string): ImportDraft {
  return {
    format,
    sourceLabel,
    nodes: [],
    requests: new Map(),
    environments: [],
    warnings: [],
    truncated: false,
  };
}

export function note(code: string, message: string, path?: string): ApiInterchangeNote {
  return { code, message, path };
}

export function tempId(): string {
  return randomUUID();
}

/** A request skeleton with every field an `ApiRequestDefinition` needs except its identity. */
export function draftRequest(overrides: Partial<DraftRequest> = {}): DraftRequest {
  return {
    name: 'Imported request',
    protocol: 'http' as ApiProtocol,
    urlTemplate: '',
    method: 'GET',
    query: [],
    headers: [],
    auth: { kind: 'inherit' },
    body: { kind: 'none' },
    protocolOptions: {},
    scripts: {},
    settings: {},
    variables: [],
    ...overrides,
  };
}

export function keyValue(name: string, value: string, enabled = true): ApiKeyValue {
  return { id: randomUUID(), name, value, enabled };
}

/**
 * Header and variable names that conventionally carry credentials. Used to classify imported
 * values as secret so they are never written to disk as plaintext.
 */
const SECRET_NAME_RE =
  /(^|[-_.])(authorization|cookie|token|secret|password|passwd|pwd|apikey|api[-_]key|client[-_]secret|access[-_]token|refresh[-_]token|private[-_]key|session)([-_.]|$)/i;

export function looksSecret(name: string): boolean {
  return SECRET_NAME_RE.test(name.trim());
}

/** Postman-style `{{var}}` is Bureau's syntax too, so templates survive import unchanged. */
export function isTemplated(value: string): boolean {
  return /\{\{[^}]+\}\}/.test(value);
}

export class ImportError extends Error {
  constructor(
    readonly code: 'API_IMPORT_INVALID' | 'API_IMPORT_LIMIT_EXCEEDED',
    message: string
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

export function assertWithinBytes(text: string, limits: ImportLimits): void {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > limits.maxBytes) {
    throw new ImportError(
      'API_IMPORT_LIMIT_EXCEEDED',
      `The import is ${Math.round(bytes / 1024 / 1024)} MiB, over the ${Math.round(
        limits.maxBytes / 1024 / 1024
      )} MiB limit.`
    );
  }
}

/**
 * Parses JSON or YAML with a depth bound.
 *
 * `yaml` is given `maxAliasCount` so a billion-laughs style alias bomb cannot expand: the
 * classic YAML denial-of-service is exponential alias expansion, not document size.
 */
export function parseStructured(text: string, limits: ImportLimits): unknown {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return guardDepth(JSON.parse(text), limits.maxDepth);
    } catch (error) {
      if (error instanceof ImportError) throw error;
      throw new ImportError('API_IMPORT_INVALID', 'The document is not valid JSON.');
    }
  }
  try {
    const value = parseYaml(text, { maxAliasCount: 100, prettyErrors: false }) as unknown;
    return guardDepth(value, limits.maxDepth);
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError('API_IMPORT_INVALID', 'The document is not valid JSON or YAML.');
  }
}

/** Walks the parsed value, failing fast if it nests deeper than the bound allows. */
export function guardDepth<T>(value: T, maxDepth: number): T {
  const walk = (node: unknown, depth: number): void => {
    if (depth > maxDepth) {
      throw new ImportError('API_IMPORT_LIMIT_EXCEEDED', 'The document is nested too deeply.');
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (node && typeof node === 'object') {
      for (const item of Object.values(node)) walk(item, depth + 1);
    }
  };
  walk(value, 0);
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** Adds a node to the draft, enforcing the node cap and flagging truncation once. */
export function pushNode(
  draft: ImportDraft,
  limits: ImportLimits,
  node: ApiImportDraftNode
): boolean {
  if (draft.nodes.length >= limits.maxNodes) {
    if (!draft.truncated) {
      draft.truncated = true;
      draft.warnings.push(
        note(
          'node-cap',
          `The import was truncated at ${limits.maxNodes} items. Split the source and import it in parts.`
        )
      );
    }
    return false;
  }
  draft.nodes.push(node);
  return true;
}

export function summarizeEnvironments(draft: ImportDraft): ApiImportDraftEnvironment[] {
  return draft.environments.map((environment) => ({
    tempId: environment.tempId,
    name: environment.name,
    variableCount: environment.variables.length,
    secretCount: environment.variables.filter((variable) => variable.secret).length,
  }));
}

/**
 * Sniffs the interchange format from the content itself rather than a file extension, which a
 * user can trivially get wrong when pasting.
 */
export function detectFormat(text: string): ApiInterchangeFormat | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/^\s*curl[\s\\]/i.test(trimmed)) return 'curl';

  let parsed: unknown;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }
  } else {
    try {
      parsed = parseYaml(trimmed, { maxAliasCount: 100 }) as unknown;
    } catch {
      return null;
    }
  }
  if (!isRecord(parsed)) return null;

  if (parsed.format === 'bureau-api') return 'bureau';
  if (isRecord(parsed.log) && Array.isArray((parsed.log as Record<string, unknown>).entries)) {
    return 'har';
  }
  if (isRecord(parsed.info) && Array.isArray(parsed.item)) return 'postman';
  if (typeof parsed.openapi === 'string' || typeof parsed.swagger === 'string') return 'openapi';
  return null;
}
