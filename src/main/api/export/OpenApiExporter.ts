import type { ApiRequestDefinition } from '@shared/contracts/apiWorkbench';
import {
  noteUnsupported,
  omission,
  orderedTree,
  safeFileStem,
  type ExportResult,
  type ExportSource,
} from './exportSupport';

const OPENAPI_VERSION = '3.2.0';

/**
 * Exports the HTTP/GraphQL subset as OpenAPI 3.2.
 *
 * OpenAPI describes an interface, while Bureau stores concrete calls, so this is inherently
 * lossy: request bodies become examples, and anything with no OpenAPI concept (streams,
 * scripts, runner behaviour, TLS profiles) is reported as an omission before writing.
 */
export function exportOpenApi(source: ExportSource, rootId: string | null): ExportResult {
  const omissions: ReturnType<typeof omission>[] = [];
  const ordered = orderedTree(source.nodes, rootId);

  // Group operations by server origin so the most common one becomes the declared server.
  const originCounts = new Map<string, number>();
  const paths: Record<string, Record<string, unknown>> = {};
  const folderNameById = new Map<string, string>();
  for (const node of ordered) {
    if (node.kind === 'folder') folderNameById.set(node.collectionId, node.name);
  }

  let exported = 0;

  for (const node of ordered) {
    if (node.kind !== 'request') continue;
    const request = node.requestId ? source.requests.get(node.requestId) : undefined;
    if (!request) continue;

    const notes = noteUnsupported(request, 'openapi');
    omissions.push(...notes);
    if (request.protocol === 'websocket' || request.protocol === 'sse') continue;

    const split = splitOrigin(request.urlTemplate);
    if (!split) {
      omissions.push(
        omission(
          'unresolvable-url',
          `\`${request.name}\` has a templated host, which OpenAPI cannot express as a path. It was omitted.`,
          request.name
        )
      );
      continue;
    }
    originCounts.set(split.origin, (originCounts.get(split.origin) ?? 0) + 1);

    // OpenAPI path templating is `{name}`; Bureau's is `{{name}}`.
    const pathKey = split.path.replace(/\{\{([^}]+)\}\}/g, (_full, name: string) => `{${name.trim()}}`);
    const method = (request.protocol === 'graphql' ? 'post' : request.method.toLowerCase());
    if (!/^(get|put|post|delete|options|head|patch|trace)$/.test(method)) {
      omissions.push(
        omission(
          'custom-method-omitted',
          `\`${request.name}\` uses the custom method \`${request.method}\`, which OpenAPI cannot express. It was omitted.`,
          request.name
        )
      );
      continue;
    }

    const parentName = node.parentId ? folderNameById.get(node.parentId) : undefined;
    const entry = (paths[pathKey] ??= {});
    if (entry[method]) {
      omissions.push(
        omission(
          'duplicate-operation',
          `\`${request.name}\` collides with another ${method.toUpperCase()} ${pathKey} operation and was omitted.`,
          request.name
        )
      );
      continue;
    }

    entry[method] = buildOperation(request, pathKey, parentName, omissions);
    exported += 1;
  }

  const servers = [...originCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([url]) => ({ url }));
  if (servers.length > 1) {
    omissions.push(
      omission(
        'multiple-servers',
        `Requests spanned ${servers.length} origins; all are listed under \`servers\`, but OpenAPI applies them to every path.`
      )
    );
  }

  const document = {
    openapi: OPENAPI_VERSION,
    info: {
      title: source.workspaceName,
      version: '1.0.0',
      description: 'Exported from Bureau. Request bodies are exported as examples.',
    },
    servers: servers.length > 0 ? servers : [{ url: '/' }],
    paths,
  };

  if (exported === 0) {
    omissions.push(omission('nothing-exported', 'No request could be expressed as an OpenAPI operation.'));
  }

  return {
    content: JSON.stringify(document, null, 2),
    omissions,
    suggestedFileName: `${safeFileStem(source.workspaceName, 'api')}.openapi.json`,
  };
}

function splitOrigin(urlTemplate: string): { origin: string; path: string } | null {
  // `new URL` happily accepts `https://{{host}}/x`, so a templated authority has to be
  // rejected explicitly — otherwise it would become a bogus OpenAPI `servers` entry.
  const authority = urlTemplate.replace(/^[a-zA-Z][\w+.-]*:\/\//, '').split('/')[0] ?? '';
  if (authority.includes('{{')) return null;

  try {
    const parsed = new URL(urlTemplate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return { origin: parsed.origin, path: parsed.pathname || '/' };
  } catch {
    return null;
  }
}

function buildOperation(
  request: ApiRequestDefinition,
  pathKey: string,
  tag: string | undefined,
  omissions: ReturnType<typeof omission>[]
): Record<string, unknown> {
  const parameters: Array<Record<string, unknown>> = [];

  // Path placeholders become required path parameters.
  for (const match of pathKey.matchAll(/\{([^}]+)\}/g)) {
    parameters.push({
      name: match[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
    });
  }

  for (const param of request.query) {
    if (!param.name) continue;
    parameters.push({
      name: param.name,
      in: 'query',
      required: param.enabled,
      schema: { type: 'string' },
      example: param.value || undefined,
    });
  }

  for (const header of request.headers) {
    if (!header.name) continue;
    const lower = header.name.toLowerCase();
    // Content-Type is expressed by requestBody, and Authorization by security schemes.
    if (lower === 'content-type' || lower === 'authorization') continue;
    parameters.push({
      name: header.name,
      in: 'header',
      required: header.enabled,
      schema: { type: 'string' },
      example: header.value || undefined,
    });
  }

  const operation: Record<string, unknown> = {
    summary: request.name,
    operationId: toOperationId(request.name, request.method, pathKey),
    responses: { '200': { description: 'Successful response' } },
  };
  if (tag) operation.tags = [tag];
  if (parameters.length > 0) operation.parameters = parameters;

  const requestBody = buildRequestBody(request, omissions);
  if (requestBody) operation.requestBody = requestBody;

  const security = buildSecurity(request);
  if (security) operation.security = security;

  return operation;
}

function buildRequestBody(
  request: ApiRequestDefinition,
  omissions: ReturnType<typeof omission>[]
): Record<string, unknown> | undefined {
  if (request.protocol === 'graphql') {
    const graphql = request.protocolOptions.graphql;
    return {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              variables: { type: 'object' },
              operationName: { type: 'string' },
            },
            required: ['query'],
          },
          example: { query: graphql?.query ?? '', variables: parseOrEmpty(graphql?.variables) },
        },
      },
    };
  }

  const body = request.body;
  switch (body.kind) {
    case 'none':
      return undefined;
    case 'json':
      return jsonBody(body.text);
    case 'xml':
      return rawBody('application/xml', body.text);
    case 'html':
      return rawBody('text/html', body.text);
    case 'text':
      return rawBody(body.contentType ?? 'text/plain', body.text);
    case 'form-urlencoded':
      return objectBody(
        'application/x-www-form-urlencoded',
        body.fields.filter((field) => field.name)
      );
    case 'multipart':
      return objectBody('multipart/form-data', body.fields.filter((field) => field.name));
    case 'binary':
      omissions.push(
        omission('binary-body-omitted', `The binary body of \`${request.name}\` was exported as a schema only.`)
      );
      return {
        content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
      };
  }
}

function jsonBody(text: string): Record<string, unknown> {
  const example = parseOrEmpty(text);
  return {
    required: true,
    content: {
      'application/json': {
        schema: inferSchema(example),
        example,
      },
    },
  };
}

function rawBody(mediaType: string, text: string): Record<string, unknown> {
  return {
    required: true,
    content: { [mediaType]: { schema: { type: 'string' }, example: text } },
  };
}

function objectBody(
  mediaType: string,
  fields: Array<{ name: string; value: string }>
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const example: Record<string, string> = {};
  for (const field of fields) {
    properties[field.name] = { type: 'string' };
    example[field.name] = field.value;
  }
  return {
    required: fields.length > 0,
    content: { [mediaType]: { schema: { type: 'object', properties }, example } },
  };
}

/** Shallow structural schema inferred from an example value. */
function inferSchema(value: unknown): Record<string, unknown> {
  if (value === null) return { nullable: true };
  if (Array.isArray(value)) {
    return { type: 'array', items: value.length > 0 ? inferSchema(value[0]) : {} };
  }
  switch (typeof value) {
    case 'string':
      return { type: 'string' };
    case 'number':
      return { type: Number.isInteger(value) ? 'integer' : 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'object': {
      const properties: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        properties[key] = inferSchema(item);
      }
      return { type: 'object', properties };
    }
    default:
      return {};
  }
}

function buildSecurity(request: ApiRequestDefinition): Array<Record<string, unknown>> | undefined {
  switch (request.auth.kind) {
    case 'basic':
      return [{ basicAuth: [] }];
    case 'bearer':
      return [{ bearerAuth: [] }];
    case 'api-key':
      return [{ apiKeyAuth: [] }];
    default:
      return undefined;
  }
}

function parseOrEmpty(text: string | undefined): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function toOperationId(name: string, method: string, pathKey: string): string {
  const base = name.replace(/[^A-Za-z0-9]+/g, ' ').trim();
  if (base) {
    const camel = base
      .split(' ')
      .map((word, index) => (index === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1)))
      .join('');
    return camel.slice(0, 80);
  }
  return `${method.toLowerCase()}${pathKey.replace(/[^A-Za-z0-9]+/g, '_')}`.slice(0, 80);
}
