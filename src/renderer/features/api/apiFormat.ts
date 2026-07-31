import type { ApiGraphqlOptions } from '@shared/contracts/apiWorkbench';

export const DEFAULT_GRAPHQL_OPTIONS: ApiGraphqlOptions = {
  query: '',
  variables: '{}',
  transport: 'POST',
};

/**
 * Tone modifier for a method badge. Colour is never the only signal — the badge always shows the
 * method text too.
 */
export function methodTone(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET':
      return 'get';
    case 'POST':
      return 'post';
    case 'PUT':
    case 'PATCH':
      return 'put';
    case 'DELETE':
      return 'delete';
    default:
      return 'other';
  }
}

/** What a request row shows in its badge: the protocol when it is not plain HTTP, else the method. */
export function requestBadge(request: { protocol: string; method: string }): string {
  switch (request.protocol) {
    case 'graphql':
      return 'GQL';
    case 'websocket':
      return 'WS';
    case 'sse':
      return 'SSE';
    default:
      return request.method.toUpperCase();
  }
}

/** Operation names in a multi-operation document, so the user can pick which one runs. */
export function parseOperationNames(query: string): string[] {
  const names: string[] = [];
  const pattern = /\b(query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  let match = pattern.exec(query);
  while (match) {
    if (!names.includes(match[2])) names.push(match[2]);
    match = pattern.exec(query);
  }
  return names;
}

/** Validates the GraphQL variables editor. Returns a message, or null when the text is usable. */
export function validateGraphqlVariables(text: string): string | null {
  const raw = text.trim();
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'Variables are not valid JSON.';
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'Variables must be a JSON object.';
  }
  return null;
}

/** Maps an API text-body kind to a CodeMirror language id (empty = plain text). */
export function bodyLanguageId(kind: 'json' | 'text' | 'xml' | 'html'): string {
  switch (kind) {
    case 'json':
      return 'json';
    case 'xml':
      return 'xml';
    case 'html':
      return 'html';
    default:
      return '';
  }
}
