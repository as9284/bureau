import type { ApiAuth, ApiBody, ApiKeyValue } from '@shared/contracts/apiWorkbench';
import {
  ImportError,
  asString,
  draftRequest,
  isRecord,
  keyValue,
  looksSecret,
  newDraft,
  note,
  parseStructured,
  pushNode,
  tempId,
  type ImportDraft,
  type ImportLimits,
} from './importSupport';

/**
 * Postman Collection v2.1 importer.
 *
 * Validated structurally rather than against the published JSON Schema: pulling the schema in
 * would add a dependency and a network fetch, and every field we consume is checked here
 * anyway. Unsupported constructs become warnings instead of silent data loss.
 */
export function importPostman(
  source: string,
  limits: ImportLimits,
  sourceLabel: string
): ImportDraft {
  const document = parseStructured(source, limits);
  if (!isRecord(document)) {
    throw new ImportError('API_IMPORT_INVALID', 'The Postman collection is not an object.');
  }
  const info = isRecord(document.info) ? document.info : null;
  if (!info || !Array.isArray(document.item)) {
    throw new ImportError(
      'API_IMPORT_INVALID',
      'The file does not look like a Postman collection (missing `info` or `item`).'
    );
  }

  const schema = asString(info.schema);
  if (schema && !schema.includes('v2.1') && !schema.includes('v2.0')) {
    throw new ImportError(
      'API_IMPORT_INVALID',
      'Only Postman Collection v2.0 and v2.1 are supported.'
    );
  }
  const draft = newDraft('postman', sourceLabel);
  if (schema.includes('v2.0')) {
    // v2.0 is read with the v2.1 reader: every field consumed here is identical between them.
    draft.warnings.push(
      note('schema-v20', 'This is a v2.0 collection. It was read using the v2.1 reader.')
    );
  }

  const rootName = asString(info.name, 'Imported collection');
  const rootId = tempId();
  pushNode(draft, limits, {
    tempId: rootId,
    parentTempId: null,
    kind: 'folder',
    name: rootName,
  });

  // Collection-level variables become an environment so they stay editable and scoped.
  const collectionVariables = readVariables(document.variable, draft);
  if (collectionVariables.length > 0) {
    draft.environments.push({
      tempId: tempId(),
      name: `${rootName} variables`,
      variables: collectionVariables,
    });
  }

  collectScripts(document.event, draft, rootName);
  walkItems(document.item, rootId, draft, limits, 0);
  return draft;
}

function walkItems(
  items: unknown,
  parentTempId: string | null,
  draft: ImportDraft,
  limits: ImportLimits,
  depth: number
): void {
  if (!Array.isArray(items)) return;
  if (depth > limits.maxDepth) {
    throw new ImportError('API_IMPORT_LIMIT_EXCEEDED', 'The collection is nested too deeply.');
  }

  for (const raw of items) {
    if (!isRecord(raw)) continue;
    const name = asString(raw.name, 'Untitled');

    // A folder is an item that contains items; a request is an item that has `request`.
    if (Array.isArray(raw.item)) {
      const folderId = tempId();
      if (!pushNode(draft, limits, { tempId: folderId, parentTempId, kind: 'folder', name })) return;
      collectScripts(raw.event, draft, name);
      walkItems(raw.item, folderId, draft, limits, depth + 1);
      continue;
    }

    if (!isRecord(raw.request)) continue;
    const built = buildRequest(raw.request, name, draft);
    const nodeId = tempId();
    const hasScripts = collectScripts(raw.event, draft, name);
    if (
      !pushNode(draft, limits, {
        tempId: nodeId,
        parentTempId,
        kind: 'request',
        name,
        protocol: built.protocol,
        method: built.method,
        url: built.urlTemplate,
        hasScripts,
      })
    ) {
      return;
    }
    if (hasScripts) {
      // Source is preserved but never enabled by import.
      built.scripts = readScripts(raw.event);
    }
    draft.requests.set(nodeId, built);
  }
}

function buildRequest(
  request: Record<string, unknown>,
  name: string,
  draft: ImportDraft
): ReturnType<typeof draftRequest> {
  const method = asString(request.method, 'GET').toUpperCase();
  const { url, query } = readUrl(request.url, draft, name);
  const headers = readHeaders(request.header, draft, name);
  const { body, protocol, graphql } = readBody(request.body, draft, name);
  const auth = readAuth(request.auth, draft, name);

  return draftRequest({
    name,
    method: protocol === 'graphql' ? 'POST' : method,
    urlTemplate: url,
    query,
    headers,
    body,
    auth,
    protocol,
    protocolOptions: graphql ? { graphql } : {},
  });
}

function readUrl(
  value: unknown,
  draft: ImportDraft,
  where: string
): { url: string; query: ApiKeyValue[] } {
  const query: ApiKeyValue[] = [];

  if (typeof value === 'string') return { url: value, query };
  if (!isRecord(value)) {
    draft.warnings.push(note('missing-url', `\`${where}\` has no URL.`, where));
    return { url: '', query };
  }

  // Postman stores either `raw` or a decomposed host/path structure.
  let url = asString(value.raw);
  if (!url) {
    const protocol = asString(value.protocol, 'https');
    const host = Array.isArray(value.host) ? value.host.map((h) => asString(h)).join('.') : asString(value.host);
    const path = Array.isArray(value.path)
      ? value.path.map((segment) => asString(segment)).join('/')
      : asString(value.path);
    const port = asString(value.port);
    url = host ? `${protocol}://${host}${port ? `:${port}` : ''}${path ? `/${path}` : ''}` : '';
  }

  // Strip the query string into rows; duplicates are preserved.
  if (Array.isArray(value.query)) {
    for (const entry of value.query) {
      if (!isRecord(entry)) continue;
      const key = asString(entry.key);
      if (!key) continue;
      query.push(keyValue(key, asString(entry.value), entry.disabled !== true));
    }
    const questionMark = url.indexOf('?');
    if (questionMark !== -1) url = url.slice(0, questionMark);
  }

  return { url, query };
}

function readHeaders(value: unknown, draft: ImportDraft, where: string): ApiKeyValue[] {
  const headers: ApiKeyValue[] = [];
  if (!Array.isArray(value)) return headers;
  const secretNames: string[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const key = asString(entry.key);
    if (!key) continue;
    headers.push(keyValue(key, asString(entry.value), entry.disabled !== true));
    if (looksSecret(key)) secretNames.push(key);
  }
  if (secretNames.length > 0) {
    draft.warnings.push(
      note(
        'secret-header',
        `\`${where}\` imports header${secretNames.length === 1 ? '' : 's'} ${secretNames.join(', ')} that may carry credentials.`,
        where
      )
    );
  }
  return headers;
}

function readBody(
  value: unknown,
  draft: ImportDraft,
  where: string
): {
  body: ApiBody;
  protocol: 'http' | 'graphql';
  graphql?: { query: string; variables: string; transport: 'POST' };
} {
  if (!isRecord(value)) return { body: { kind: 'none' }, protocol: 'http' };
  const mode = asString(value.mode);

  switch (mode) {
    case 'raw': {
      const text = asString(value.raw);
      const language = isRecord(value.options) && isRecord(value.options.raw)
        ? asString(value.options.raw.language)
        : '';
      if (language === 'json' || /^\s*[[{]/.test(text)) return { body: { kind: 'json', text }, protocol: 'http' };
      if (language === 'xml') return { body: { kind: 'xml', text }, protocol: 'http' };
      if (language === 'html') return { body: { kind: 'html', text }, protocol: 'http' };
      return { body: { kind: 'text', text }, protocol: 'http' };
    }
    case 'urlencoded':
      return { body: { kind: 'form-urlencoded', fields: readKeyValues(value.urlencoded) }, protocol: 'http' };
    case 'formdata': {
      const fields: ApiKeyValue[] = [];
      if (Array.isArray(value.formdata)) {
        for (const entry of value.formdata) {
          if (!isRecord(entry)) continue;
          const key = asString(entry.key);
          if (!key) continue;
          if (asString(entry.type) === 'file') {
            draft.warnings.push(
              note('file-upload-skipped', `Form field \`${key}\` in \`${where}\` referenced a file and was imported empty.`, where)
            );
            fields.push(keyValue(key, '', entry.disabled !== true));
            continue;
          }
          fields.push(keyValue(key, asString(entry.value), entry.disabled !== true));
        }
      }
      return { body: { kind: 'multipart', fields }, protocol: 'http' };
    }
    case 'graphql': {
      const graphql = isRecord(value.graphql) ? value.graphql : {};
      const variables = asString(graphql.variables, '{}');
      return {
        body: { kind: 'none' },
        protocol: 'graphql',
        graphql: {
          query: asString(graphql.query),
          variables: variables.trim() || '{}',
          transport: 'POST',
        },
      };
    }
    case 'file':
      draft.warnings.push(
        note('file-body-skipped', `\`${where}\` used a file body, which was not imported.`, where)
      );
      return { body: { kind: 'none' }, protocol: 'http' };
    default:
      return { body: { kind: 'none' }, protocol: 'http' };
  }
}

function readKeyValues(value: unknown): ApiKeyValue[] {
  const out: ApiKeyValue[] = [];
  if (!Array.isArray(value)) return out;
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const key = asString(entry.key);
    if (!key) continue;
    out.push(keyValue(key, asString(entry.value), entry.disabled !== true));
  }
  return out;
}

/**
 * Maps Postman auth to Bureau auth. Secret material is deliberately dropped: an imported file
 * must never put a token or password on disk in plaintext, so the user re-supplies it through
 * the vault.
 */
function readAuth(value: unknown, draft: ImportDraft, where: string): ApiAuth {
  if (!isRecord(value)) return { kind: 'inherit' };
  const type = asString(value.type);

  const paramValue = (name: string): string => {
    const list = value[type];
    if (!Array.isArray(list)) return '';
    for (const entry of list) {
      if (isRecord(entry) && asString(entry.key) === name) return asString(entry.value);
    }
    return '';
  };

  switch (type) {
    case 'noauth':
      return { kind: 'none' };
    case 'basic':
      draft.warnings.push(
        note('credential-dropped', `The Basic password for \`${where}\` was not imported.`, where)
      );
      return { kind: 'basic', usernameTemplate: paramValue('username') };
    case 'bearer':
      draft.warnings.push(
        note('credential-dropped', `The bearer token for \`${where}\` was not imported.`, where)
      );
      return { kind: 'bearer' };
    case 'apikey': {
      const inValue = paramValue('in');
      draft.warnings.push(
        note('credential-dropped', `The API key value for \`${where}\` was not imported.`, where)
      );
      return {
        kind: 'api-key',
        placement: inValue === 'query' ? 'query' : 'header',
        nameTemplate: paramValue('key') || 'X-API-Key',
      };
    }
    case 'oauth2':
      draft.warnings.push(
        note(
          'oauth-manual',
          `\`${where}\` used OAuth 2. Create an OAuth profile and select it on the Auth tab.`,
          where
        )
      );
      return { kind: 'inherit' };
    default:
      if (type) {
        draft.warnings.push(
          note('unsupported-auth', `Auth type \`${type}\` on \`${where}\` is not supported.`, where)
        );
      }
      return { kind: 'inherit' };
  }
}

function readVariables(
  value: unknown,
  draft: ImportDraft
): Array<{ name: string; value: string; enabled: boolean; secret: boolean }> {
  const out: Array<{ name: string; value: string; enabled: boolean; secret: boolean }> = [];
  if (!Array.isArray(value)) return out;
  let droppedSecrets = 0;
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const key = asString(entry.key);
    if (!key) continue;
    // Postman marks these `secret`; either way the value is not carried in as plaintext.
    const secret = asString(entry.type) === 'secret' || looksSecret(key);
    if (secret) droppedSecrets += 1;
    out.push({
      name: sanitizeVariableName(key),
      value: secret ? '' : asString(entry.value),
      enabled: entry.disabled !== true,
      secret,
    });
  }
  if (droppedSecrets > 0) {
    draft.warnings.push(
      note(
        'secret-variable',
        `${droppedSecrets} variable${droppedSecrets === 1 ? '' : 's'} looked like a secret. ${
          droppedSecrets === 1 ? 'Its value was' : 'Their values were'
        } not imported — add ${droppedSecrets === 1 ? 'it' : 'them'} to the secret vault.`
      )
    );
  }
  return out;
}

/** Bureau variable names are identifiers; Postman allows anything. */
export function sanitizeVariableName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, '_');
  return /^[A-Za-z_]/.test(cleaned) ? cleaned.slice(0, 128) : `v_${cleaned}`.slice(0, 128);
}

function readScripts(value: unknown): { preRequest?: string; postResponse?: string } {
  const scripts: { preRequest?: string; postResponse?: string } = {};
  if (!Array.isArray(value)) return scripts;
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const listen = asString(entry.listen);
    const script = isRecord(entry.script) ? entry.script : null;
    if (!script) continue;
    const exec = Array.isArray(script.exec)
      ? script.exec.map((line) => asString(line)).join('\n')
      : asString(script.exec);
    if (!exec.trim()) continue;
    if (listen === 'prerequest') scripts.preRequest = exec.slice(0, 100_000);
    if (listen === 'test') scripts.postResponse = exec.slice(0, 100_000);
  }
  return scripts;
}

/** Records that a node carried scripts, and warns once per location. Never enables them. */
function collectScripts(value: unknown, draft: ImportDraft, where: string): boolean {
  const scripts = readScripts(value);
  const has = Boolean(scripts.preRequest ?? scripts.postResponse);
  if (has) {
    draft.warnings.push(
      note('script-disabled', `\`${where}\` carries a script. It was imported disabled.`, where)
    );
  }
  return has;
}
