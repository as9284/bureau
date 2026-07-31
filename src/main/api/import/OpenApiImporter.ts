import type { ApiAuth, ApiBody, ApiKeyValue } from '@shared/contracts/apiWorkbench';
import {
  ImportError,
  asString,
  draftRequest,
  isRecord,
  keyValue,
  newDraft,
  note,
  parseStructured,
  pushNode,
  tempId,
  type ImportDraft,
  type ImportLimits,
} from './importSupport';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

/** Bounds on `$ref` expansion, independent of the document's own size. */
const MAX_REF_DEPTH = 32;
const MAX_REF_RESOLUTIONS = 20_000;

/**
 * Resolves local `#/...` JSON pointers.
 *
 * Remote and file references are **not** followed. §14.4 allows local file refs confined to the
 * import root, but Bureau imports a single document (pasted text or one picked file), so there
 * is no root to confine to — an external ref is reported as an omission instead of opening a
 * path-traversal and SSRF surface for a document that is untrusted by definition.
 */
class RefResolver {
  private resolutions = 0;
  private readonly resolving = new Set<string>();

  constructor(
    private readonly root: Record<string, unknown>,
    private readonly draft: ImportDraft
  ) {}

  /** Follows `$ref` chains on a node, returning the concrete value (or null on a bad ref). */
  resolve(value: unknown, depth = 0): unknown {
    if (depth > MAX_REF_DEPTH) {
      throw new ImportError('API_IMPORT_LIMIT_EXCEEDED', 'A `$ref` chain is nested too deeply.');
    }
    if (!isRecord(value) || typeof value.$ref !== 'string') return value;

    const ref = value.$ref;
    this.resolutions += 1;
    if (this.resolutions > MAX_REF_RESOLUTIONS) {
      throw new ImportError('API_IMPORT_LIMIT_EXCEEDED', 'The document has too many `$ref` entries.');
    }

    if (!ref.startsWith('#/')) {
      this.draft.warnings.push(
        note(
          'external-ref-blocked',
          `External reference \`${ref.slice(0, 120)}\` was not followed. Bundle the document before importing.`,
          ref
        )
      );
      return null;
    }

    // A cycle is reported once and then broken, rather than being allowed to recurse.
    if (this.resolving.has(ref)) {
      this.draft.warnings.push(note('ref-cycle', `Reference cycle at \`${ref}\` was broken.`, ref));
      return null;
    }

    const target = this.pointer(ref);
    if (target === undefined) {
      this.draft.warnings.push(note('ref-missing', `Reference \`${ref}\` could not be resolved.`, ref));
      return null;
    }

    this.resolving.add(ref);
    try {
      return this.resolve(target, depth + 1);
    } finally {
      this.resolving.delete(ref);
    }
  }

  private pointer(ref: string): unknown {
    const segments = ref
      .slice(2)
      .split('/')
      .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
    let current: unknown = this.root;
    for (const segment of segments) {
      if (!isRecord(current)) return undefined;
      current = current[segment];
      if (current === undefined) return undefined;
    }
    return current;
  }
}

export function importOpenApi(
  source: string,
  limits: ImportLimits,
  sourceLabel: string
): ImportDraft {
  const document = parseStructured(source, limits);
  if (!isRecord(document)) {
    throw new ImportError('API_IMPORT_INVALID', 'The OpenAPI document is not an object.');
  }

  const openapi = asString(document.openapi);
  const swagger = asString(document.swagger);
  if (!openapi && !swagger) {
    throw new ImportError(
      'API_IMPORT_INVALID',
      'The file has neither an `openapi` nor a `swagger` version field.'
    );
  }
  const major = Number.parseInt((openapi || swagger).split('.')[0] ?? '', 10);
  if (!Number.isFinite(major) || major < 2 || major > 3) {
    throw new ImportError(
      'API_IMPORT_INVALID',
      `OpenAPI version \`${openapi || swagger}\` is not supported. Bureau reads 2.0 through 3.2.`
    );
  }
  const isV2 = Boolean(swagger) && major === 2;

  const draft = newDraft('openapi', sourceLabel);
  if (isV2) {
    draft.warnings.push(
      note('swagger-2', 'Swagger 2.0 was read as a compatibility input; some 3.x concepts have no equivalent.')
    );
  }

  const resolver = new RefResolver(document, draft);
  const info = isRecord(document.info) ? document.info : {};
  const title = asString(info.title, 'Imported API');

  const rootId = tempId();
  pushNode(draft, limits, { tempId: rootId, parentTempId: null, kind: 'folder', name: title });

  const { baseUrl, serverVariables } = readServer(document, isV2, draft);
  if (serverVariables.length > 0) {
    draft.environments.push({
      tempId: tempId(),
      name: `${title} server`,
      variables: serverVariables,
    });
  }

  const securitySchemes = readSecuritySchemes(document, isV2, resolver);
  const tagFolders = new Map<string, string>();

  const folderForTag = (tag: string): string => {
    const existing = tagFolders.get(tag);
    if (existing) return existing;
    const id = tempId();
    pushNode(draft, limits, { tempId: id, parentTempId: rootId, kind: 'folder', name: tag });
    tagFolders.set(tag, id);
    return id;
  };

  const paths = isRecord(document.paths) ? document.paths : {};
  for (const [pathKey, rawPathItem] of Object.entries(paths)) {
    const pathItem = resolver.resolve(rawPathItem);
    if (!isRecord(pathItem)) continue;

    // Path-level parameters apply to every operation beneath them.
    const pathParameters = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];

    for (const method of HTTP_METHODS) {
      const rawOperation = pathItem[method];
      if (!isRecord(rawOperation)) continue;
      const operation = resolver.resolve(rawOperation);
      if (!isRecord(operation)) continue;

      const tags = Array.isArray(operation.tags) ? operation.tags.map((t) => asString(t)) : [];
      const parentTempId = tags[0] ? folderForTag(tags[0]) : rootId;

      const name =
        asString(operation.summary) ||
        asString(operation.operationId) ||
        `${method.toUpperCase()} ${pathKey}`;

      const parameters = [...pathParameters, ...(Array.isArray(operation.parameters) ? operation.parameters : [])];
      const { query, headers, pathTemplate } = readParameters(parameters, pathKey, resolver);

      const { body, contentType } = readRequestBody(operation, isV2, parameters, resolver, draft, name);
      if (contentType && !headers.some((h) => h.name.toLowerCase() === 'content-type')) {
        headers.push(keyValue('Content-Type', contentType));
      }

      const auth = readOperationAuth(operation, document, securitySchemes, draft, name);

      const request = draftRequest({
        name,
        method: method.toUpperCase(),
        // Path templates keep `{id}` rewritten as `{{id}}` so they resolve through variables.
        urlTemplate: `${baseUrl}${pathTemplate}`,
        query,
        headers,
        body,
        auth,
      });

      const nodeId = tempId();
      if (
        !pushNode(draft, limits, {
          tempId: nodeId,
          parentTempId,
          kind: 'request',
          name,
          protocol: 'http',
          method: request.method,
          url: request.urlTemplate,
        })
      ) {
        return draft;
      }
      draft.requests.set(nodeId, request);
    }
  }

  if (draft.requests.size === 0) {
    draft.warnings.push(note('no-operations', 'The document defined no operations.'));
  }
  return draft;
}

function readServer(
  document: Record<string, unknown>,
  isV2: boolean,
  draft: ImportDraft
): {
  baseUrl: string;
  serverVariables: Array<{ name: string; value: string; enabled: boolean; secret: boolean }>;
} {
  const variables: Array<{ name: string; value: string; enabled: boolean; secret: boolean }> = [];

  if (isV2) {
    const scheme = Array.isArray(document.schemes) ? asString(document.schemes[0], 'https') : 'https';
    const host = asString(document.host);
    const basePath = asString(document.basePath);
    if (!host) {
      draft.warnings.push(note('no-host', 'The document has no `host`; set the URL on each request.'));
      return { baseUrl: '', serverVariables: variables };
    }
    return { baseUrl: `${scheme}://${host}${basePath}`, serverVariables: variables };
  }

  const servers = Array.isArray(document.servers) ? document.servers : [];
  const first = servers.find(isRecord);
  if (!first) {
    draft.warnings.push(note('no-servers', 'The document has no `servers`; set the URL on each request.'));
    return { baseUrl: '', serverVariables: variables };
  }
  if (servers.length > 1) {
    draft.warnings.push(
      note('multiple-servers', `The document lists ${servers.length} servers; the first was used.`)
    );
  }

  let url = asString(first.url);
  // Server variables become environment variables and the URL keeps `{{name}}` placeholders.
  if (isRecord(first.variables)) {
    for (const [name, rawSpec] of Object.entries(first.variables)) {
      if (!isRecord(rawSpec)) continue;
      variables.push({
        name: name.replace(/[^A-Za-z0-9_]/g, '_'),
        value: asString(rawSpec.default),
        enabled: true,
        secret: false,
      });
    }
  }
  url = url.replace(/\{([^}]+)\}/g, (_full, name: string) => `{{${name.replace(/[^A-Za-z0-9_]/g, '_')}}}`);
  return { baseUrl: url.replace(/\/$/, ''), serverVariables: variables };
}

function readParameters(
  parameters: unknown[],
  pathKey: string,
  resolver: RefResolver
): { query: ApiKeyValue[]; headers: ApiKeyValue[]; pathTemplate: string } {
  const query: ApiKeyValue[] = [];
  const headers: ApiKeyValue[] = [];
  const pathNames = new Set<string>();

  for (const raw of parameters) {
    const parameter = resolver.resolve(raw);
    if (!isRecord(parameter)) continue;
    const name = asString(parameter.name);
    if (!name) continue;
    const location = asString(parameter.in);
    const example = readExampleScalar(parameter);
    const enabled = parameter.required === true;

    if (location === 'query') query.push(keyValue(name, example, enabled));
    else if (location === 'header') headers.push(keyValue(name, example, enabled));
    else if (location === 'path') pathNames.add(name);
  }

  // `/users/{id}` becomes `/users/{{id}}` so it resolves through Bureau's variable system.
  const pathTemplate = pathKey.replace(/\{([^}]+)\}/g, (_full, name: string) => {
    pathNames.add(name);
    return `{{${name.replace(/[^A-Za-z0-9_]/g, '_')}}}`;
  });

  return { query, headers, pathTemplate };
}

function readExampleScalar(parameter: Record<string, unknown>): string {
  if (parameter.example !== undefined && typeof parameter.example !== 'object') {
    return String(parameter.example);
  }
  const schema = isRecord(parameter.schema) ? parameter.schema : null;
  if (schema) {
    if (schema.default !== undefined && typeof schema.default !== 'object') return String(schema.default);
    if (schema.example !== undefined && typeof schema.example !== 'object') return String(schema.example);
    if (Array.isArray(schema.enum) && schema.enum.length > 0 && typeof schema.enum[0] !== 'object') {
      return String(schema.enum[0]);
    }
  }
  return '';
}

function readRequestBody(
  operation: Record<string, unknown>,
  isV2: boolean,
  parameters: unknown[],
  resolver: RefResolver,
  draft: ImportDraft,
  where: string
): { body: ApiBody; contentType?: string } {
  if (isV2) {
    // Swagger 2.0 models the body as a parameter with `in: body`.
    for (const raw of parameters) {
      const parameter = resolver.resolve(raw);
      if (!isRecord(parameter) || asString(parameter.in) !== 'body') continue;
      const schema = resolver.resolve(parameter.schema);
      const sample = sampleFromSchema(schema, resolver, 0);
      return {
        body: { kind: 'json', text: JSON.stringify(sample, null, 2) },
        contentType: 'application/json',
      };
    }
    return { body: { kind: 'none' } };
  }

  const requestBody = resolver.resolve(operation.requestBody);
  if (!isRecord(requestBody) || !isRecord(requestBody.content)) return { body: { kind: 'none' } };

  const content = requestBody.content;
  const preferred =
    Object.keys(content).find((type) => type.includes('json')) ??
    Object.keys(content).find((type) => type.includes('x-www-form-urlencoded')) ??
    Object.keys(content)[0];
  if (!preferred) return { body: { kind: 'none' } };

  const media = resolver.resolve(content[preferred]);
  if (!isRecord(media)) return { body: { kind: 'none' } };

  if (preferred.includes('x-www-form-urlencoded')) {
    const schema = resolver.resolve(media.schema);
    const fields: ApiKeyValue[] = [];
    if (isRecord(schema) && isRecord(schema.properties)) {
      for (const [name, rawProperty] of Object.entries(schema.properties)) {
        const property = resolver.resolve(rawProperty);
        fields.push(keyValue(name, isRecord(property) ? String(sampleFromSchema(property, resolver, 0) ?? '') : ''));
      }
    }
    return { body: { kind: 'form-urlencoded', fields }, contentType: preferred };
  }

  if (preferred.includes('multipart/form-data')) {
    draft.warnings.push(
      note('multipart-skeleton', `\`${where}\` uses multipart; fields were imported empty.`, where)
    );
    const schema = resolver.resolve(media.schema);
    const fields: ApiKeyValue[] = [];
    if (isRecord(schema) && isRecord(schema.properties)) {
      for (const name of Object.keys(schema.properties)) fields.push(keyValue(name, ''));
    }
    return { body: { kind: 'multipart', fields }, contentType: undefined };
  }

  // Prefer a declared example over one synthesised from the schema.
  const example = media.example ?? firstExampleValue(media.examples, resolver);
  const value = example ?? sampleFromSchema(resolver.resolve(media.schema), resolver, 0);
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2);

  if (preferred.includes('json')) return { body: { kind: 'json', text }, contentType: preferred };
  if (preferred.includes('xml')) return { body: { kind: 'xml', text }, contentType: preferred };
  return { body: { kind: 'text', text, contentType: preferred }, contentType: preferred };
}

function firstExampleValue(examples: unknown, resolver: RefResolver): unknown {
  if (!isRecord(examples)) return undefined;
  for (const raw of Object.values(examples)) {
    const example = resolver.resolve(raw);
    if (isRecord(example) && 'value' in example) return example.value;
  }
  return undefined;
}

/** Builds a minimal example object from a schema. Depth-bounded; cycles are already broken. */
function sampleFromSchema(schema: unknown, resolver: RefResolver, depth: number): unknown {
  if (depth > 8) return null;
  const resolved = resolver.resolve(schema, depth);
  if (!isRecord(resolved)) return null;

  if (resolved.example !== undefined) return resolved.example;
  if (resolved.default !== undefined) return resolved.default;
  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) return resolved.enum[0];

  // Compose the first branch of a polymorphic schema rather than emitting nothing.
  for (const key of ['allOf', 'oneOf', 'anyOf'] as const) {
    const branches = resolved[key];
    if (Array.isArray(branches) && branches.length > 0) {
      if (key === 'allOf') {
        const merged: Record<string, unknown> = {};
        for (const branch of branches) {
          const value = sampleFromSchema(branch, resolver, depth + 1);
          if (isRecord(value)) Object.assign(merged, value);
        }
        return merged;
      }
      return sampleFromSchema(branches[0], resolver, depth + 1);
    }
  }

  const type = Array.isArray(resolved.type) ? asString(resolved.type[0]) : asString(resolved.type);
  switch (type) {
    case 'object':
      break;
    case 'array':
      return [sampleFromSchema(resolved.items, resolver, depth + 1)];
    case 'string':
      return asString(resolved.format) === 'date-time' ? '1970-01-01T00:00:00Z' : 'string';
    case 'integer':
      return 0;
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'null':
      return null;
    default:
      if (!isRecord(resolved.properties)) return null;
  }

  const out: Record<string, unknown> = {};
  if (isRecord(resolved.properties)) {
    for (const [name, property] of Object.entries(resolved.properties)) {
      out[name] = sampleFromSchema(property, resolver, depth + 1);
    }
  }
  return out;
}

type SecurityScheme = { type: string; name?: string; in?: string; scheme?: string };

function readSecuritySchemes(
  document: Record<string, unknown>,
  isV2: boolean,
  resolver: RefResolver
): Map<string, SecurityScheme> {
  const map = new Map<string, SecurityScheme>();
  const container = isV2
    ? document.securityDefinitions
    : isRecord(document.components)
      ? document.components.securitySchemes
      : undefined;
  if (!isRecord(container)) return map;

  for (const [name, raw] of Object.entries(container)) {
    const scheme = resolver.resolve(raw);
    if (!isRecord(scheme)) continue;
    map.set(name, {
      type: asString(scheme.type),
      name: asString(scheme.name) || undefined,
      in: asString(scheme.in) || undefined,
      scheme: asString(scheme.scheme) || undefined,
    });
  }
  return map;
}

function readOperationAuth(
  operation: Record<string, unknown>,
  document: Record<string, unknown>,
  schemes: Map<string, SecurityScheme>,
  draft: ImportDraft,
  where: string
): ApiAuth {
  const security = Array.isArray(operation.security)
    ? operation.security
    : Array.isArray(document.security)
      ? document.security
      : [];
  const first = security.find(isRecord);
  if (!first) return { kind: 'inherit' };

  const schemeName = Object.keys(first)[0];
  if (!schemeName) return { kind: 'none' };
  const scheme = schemes.get(schemeName);
  if (!scheme) return { kind: 'inherit' };

  // Credential values always come from the vault; a spec only tells us the shape.
  switch (scheme.type) {
    case 'http':
      if (scheme.scheme === 'basic') return { kind: 'basic', usernameTemplate: '' };
      if (scheme.scheme === 'bearer') return { kind: 'bearer' };
      return { kind: 'inherit' };
    case 'apiKey':
      return {
        kind: 'api-key',
        placement: scheme.in === 'query' ? 'query' : 'header',
        nameTemplate: scheme.name ?? 'X-API-Key',
      };
    case 'basic':
      return { kind: 'basic', usernameTemplate: '' };
    case 'oauth2':
    case 'openIdConnect':
      draft.warnings.push(
        note('oauth-manual', `\`${where}\` requires OAuth 2. Create an OAuth profile for it.`, where)
      );
      return { kind: 'inherit' };
    default:
      return { kind: 'inherit' };
  }
}
