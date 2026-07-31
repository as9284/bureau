import { randomUUID } from 'node:crypto';
import type { ApiCollectionNode, ApiRequestDefinition } from '@shared/contracts/apiWorkbench';
import {
  noteUnsupported,
  omission,
  orderedTree,
  safeFileStem,
  type ExportResult,
  type ExportSource,
} from './exportSupport';

const SCHEMA_V21 = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

type PostmanItem = Record<string, unknown>;

/**
 * Exports the HTTP and GraphQL subset as a Postman Collection v2.1 document.
 *
 * WebSocket and SSE requests have no v2.1 representation and are omitted with a note rather
 * than degraded into an HTTP request that would not do what it says.
 */
export function exportPostman(source: ExportSource, rootId: string | null): ExportResult {
  const omissions: ReturnType<typeof omission>[] = [];
  const ordered = orderedTree(source.nodes, rootId);

  // Build folder shells first so children can be appended by parent id.
  const itemsByNode = new Map<string, PostmanItem>();
  const childrenOf = new Map<string | null, PostmanItem[]>();

  const appendTo = (parentId: string | null, item: PostmanItem): void => {
    const bucket = childrenOf.get(parentId) ?? [];
    bucket.push(item);
    childrenOf.set(parentId, bucket);
  };

  for (const node of ordered) {
    if (node.kind === 'folder') {
      const folder: PostmanItem = { name: node.name, item: [] };
      itemsByNode.set(node.collectionId, folder);
      appendTo(node.parentId === rootId ? null : node.parentId, folder);
      continue;
    }

    const request = node.requestId ? source.requests.get(node.requestId) : undefined;
    if (!request) continue;

    const notes = noteUnsupported(request, 'postman');
    omissions.push(...notes);
    if (request.protocol === 'websocket' || request.protocol === 'sse') continue;

    appendTo(node.parentId === rootId ? null : node.parentId, toPostmanItem(request, omissions));
  }

  // Attach children to their folders now that every shell exists.
  for (const [parentId, children] of childrenOf) {
    if (parentId === null) continue;
    const folder = itemsByNode.get(parentId);
    if (folder) folder.item = children;
  }

  const collection = {
    info: {
      _postman_id: randomUUID(),
      name: source.workspaceName,
      schema: SCHEMA_V21,
      description: 'Exported from Bureau.',
    },
    item: childrenOf.get(null) ?? [],
    variable: source.environments
      .flatMap((environment) => environment.variables)
      .filter((variable) => !variable.secret && variable.enabled)
      .map((variable) => ({ key: variable.name, value: variable.value ?? '' })),
  };

  if (source.environments.some((environment) => environment.variables.some((v) => v.secret))) {
    omissions.push(
      omission(
        'secret-variables-omitted',
        'Secret variables were exported without values. Postman collections carry no encrypted storage.'
      )
    );
  }
  if (source.environments.length > 1) {
    omissions.push(
      omission(
        'environments-flattened',
        `Bureau's ${source.environments.length} environments were flattened into one collection variable list.`
      )
    );
  }

  return {
    content: JSON.stringify(collection, null, 2),
    omissions,
    suggestedFileName: `${safeFileStem(source.workspaceName, 'collection')}.postman_collection.json`,
  };
}

function toPostmanItem(
  request: ApiRequestDefinition,
  omissions: ReturnType<typeof omission>[]
): PostmanItem {
  const url = splitUrl(request);

  const item: PostmanItem = {
    name: request.name,
    request: {
      method: request.protocol === 'graphql' ? 'POST' : request.method.toUpperCase(),
      header: request.headers
        .filter((header) => header.name)
        .map((header) => ({
          key: header.name,
          value: header.value,
          disabled: header.enabled ? undefined : true,
        })),
      url,
      auth: toPostmanAuth(request, omissions),
      body: toPostmanBody(request, omissions),
    },
  };

  // Scripts are exported as-is but flagged: they target Bureau's API, not Postman's `pm.*`.
  const event: Array<Record<string, unknown>> = [];
  if (request.scripts.preRequest) {
    event.push({
      listen: 'prerequest',
      script: { type: 'text/javascript', exec: request.scripts.preRequest.split('\n') },
    });
  }
  if (request.scripts.postResponse) {
    event.push({
      listen: 'test',
      script: { type: 'text/javascript', exec: request.scripts.postResponse.split('\n') },
    });
  }
  if (event.length > 0) item.event = event;

  return item;
}

/** Postman prefers a decomposed URL; `raw` is kept so templates survive round-tripping. */
function splitUrl(request: ApiRequestDefinition): Record<string, unknown> {
  const query = request.query
    .filter((param) => param.name)
    .map((param) => ({
      key: param.name,
      value: param.value,
      disabled: param.enabled ? undefined : true,
    }));

  const raw = request.urlTemplate;
  const result: Record<string, unknown> = { raw };
  if (query.length > 0) result.query = query;

  // Only decompose a concrete URL; a templated host would be split into nonsense.
  try {
    const parsed = new URL(raw);
    result.protocol = parsed.protocol.replace(':', '');
    result.host = parsed.hostname.split('.');
    if (parsed.port) result.port = parsed.port;
    result.path = parsed.pathname.split('/').filter(Boolean);
  } catch {
    // Templated URL — `raw` alone is correct and Postman accepts it.
  }
  return result;
}

function toPostmanAuth(
  request: ApiRequestDefinition,
  omissions: ReturnType<typeof omission>[]
): Record<string, unknown> | undefined {
  switch (request.auth.kind) {
    case 'none':
      return { type: 'noauth' };
    case 'basic':
      omissions.push(
        omission('secret-placeholder', `The Basic password for \`${request.name}\` was exported as a placeholder.`)
      );
      return {
        type: 'basic',
        basic: [
          { key: 'username', value: request.auth.usernameTemplate },
          { key: 'password', value: '{{basic_password}}' },
        ],
      };
    case 'bearer':
      omissions.push(
        omission('secret-placeholder', `The bearer token for \`${request.name}\` was exported as a placeholder.`)
      );
      return { type: 'bearer', bearer: [{ key: 'token', value: '{{bearer_token}}' }] };
    case 'api-key':
      omissions.push(
        omission('secret-placeholder', `The API key for \`${request.name}\` was exported as a placeholder.`)
      );
      return {
        type: 'apikey',
        apikey: [
          { key: 'key', value: request.auth.nameTemplate },
          { key: 'value', value: '{{api_key}}' },
          { key: 'in', value: request.auth.placement },
        ],
      };
    case 'oauth2':
      // Already reported by noteUnsupported; emit no auth rather than a broken profile.
      return undefined;
    case 'inherit':
    default:
      return undefined;
  }
}

function toPostmanBody(
  request: ApiRequestDefinition,
  omissions: ReturnType<typeof omission>[]
): Record<string, unknown> | undefined {
  if (request.protocol === 'graphql') {
    const graphql = request.protocolOptions.graphql;
    return {
      mode: 'graphql',
      graphql: { query: graphql?.query ?? '', variables: graphql?.variables ?? '{}' },
    };
  }

  const body = request.body;
  switch (body.kind) {
    case 'none':
      return undefined;
    case 'json':
      return { mode: 'raw', raw: body.text, options: { raw: { language: 'json' } } };
    case 'xml':
      return { mode: 'raw', raw: body.text, options: { raw: { language: 'xml' } } };
    case 'html':
      return { mode: 'raw', raw: body.text, options: { raw: { language: 'html' } } };
    case 'text':
      return { mode: 'raw', raw: body.text, options: { raw: { language: 'text' } } };
    case 'form-urlencoded':
      return {
        mode: 'urlencoded',
        urlencoded: body.fields.map((field) => ({
          key: field.name,
          value: field.value,
          disabled: field.enabled ? undefined : true,
        })),
      };
    case 'multipart':
      return {
        mode: 'formdata',
        formdata: body.fields.map((field) => ({
          key: field.name,
          value: field.value,
          type: 'text',
          disabled: field.enabled ? undefined : true,
        })),
      };
    case 'binary':
      omissions.push(
        omission('binary-body-omitted', `The binary body of \`${request.name}\` was not exported.`)
      );
      return undefined;
  }
}

export function collectionNodeName(node: ApiCollectionNode): string {
  return node.name;
}
