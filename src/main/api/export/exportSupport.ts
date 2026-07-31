import type {
  ApiCollectionNode,
  ApiEnvironment,
  ApiInterchangeNote,
  ApiRequestDefinition,
} from '@shared/contracts/apiWorkbench';

/** Everything an exporter is allowed to read. Secrets are resolved nowhere in this module. */
export type ExportSource = {
  workspaceName: string;
  nodes: ApiCollectionNode[];
  requests: Map<string, ApiRequestDefinition>;
  environments: ApiEnvironment[];
};

export type ExportResult = {
  content: string;
  omissions: ApiInterchangeNote[];
  suggestedFileName: string;
};

export function omission(code: string, message: string, path?: string): ApiInterchangeNote {
  return { code, message, path };
}

/** Filesystem-safe stem derived from a user-supplied name. */
export function safeFileStem(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9._ -]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
  return cleaned || fallback;
}

/** Depth-first order with siblings sorted the way the tree displays them. */
export function orderedTree(nodes: ApiCollectionNode[], rootId: string | null): ApiCollectionNode[] {
  const byParent = new Map<string | null, ApiCollectionNode[]>();
  for (const node of nodes) {
    const bucket = byParent.get(node.parentId) ?? [];
    bucket.push(node);
    byParent.set(node.parentId, bucket);
  }
  for (const bucket of byParent.values()) {
    bucket.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }

  const out: ApiCollectionNode[] = [];
  const walk = (parentId: string | null): void => {
    for (const node of byParent.get(parentId) ?? []) {
      out.push(node);
      if (node.kind === 'folder') walk(node.collectionId);
    }
  };
  walk(rootId);
  return out;
}

/**
 * Notes for concepts a target format cannot represent. Collected per request so the plan can
 * report exactly what will be lost before anything is written.
 */
export function noteUnsupported(
  request: ApiRequestDefinition,
  format: 'postman' | 'openapi' | 'har' | 'curl'
): ApiInterchangeNote[] {
  const notes: ApiInterchangeNote[] = [];
  const where = request.name;

  if (request.protocol === 'websocket' || request.protocol === 'sse') {
    notes.push(
      omission(
        'protocol-unsupported',
        `\`${where}\` is a ${request.protocol === 'sse' ? 'Server-Sent Events' : 'WebSocket'} request, which ${labelFor(format)} cannot represent. It was omitted.`,
        where
      )
    );
    return notes;
  }

  if (request.scripts.preRequest ?? request.scripts.postResponse) {
    notes.push(
      omission(
        'scripts-omitted',
        format === 'postman'
          ? `Scripts on \`${where}\` were exported disabled and use Bureau's script API, not Postman's.`
          : `Scripts on \`${where}\` have no representation in ${labelFor(format)} and were omitted.`,
        where
      )
    );
  }

  if (request.auth.kind === 'oauth2') {
    notes.push(
      omission(
        'oauth-omitted',
        `\`${where}\` uses an OAuth 2 profile. The profile and its tokens were not exported.`,
        where
      )
    );
  }

  if (request.protocolOptions.tlsProfileId) {
    notes.push(
      omission('tls-profile-omitted', `The TLS profile on \`${where}\` was not exported.`, where)
    );
  }

  if (format === 'openapi' && request.protocol === 'graphql') {
    notes.push(
      omission(
        'graphql-as-post',
        `\`${where}\` is a GraphQL request; it was exported as a plain POST operation.`,
        where
      )
    );
  }

  return notes;
}

function labelFor(format: 'postman' | 'openapi' | 'har' | 'curl'): string {
  switch (format) {
    case 'postman':
      return 'Postman Collection v2.1';
    case 'openapi':
      return 'OpenAPI';
    case 'har':
      return 'HAR 1.2';
    case 'curl':
      return 'cURL';
  }
}

/**
 * Values that must never leave Bureau in an export. Secret *handles* are meaningless outside
 * this machine, and secret *values* are never loaded here in the first place.
 */
export function redactAuthForExport(request: ApiRequestDefinition): {
  headers: Array<{ name: string; value: string }>;
  notes: ApiInterchangeNote[];
} {
  const notes: ApiInterchangeNote[] = [];
  const headers: Array<{ name: string; value: string }> = [];

  switch (request.auth.kind) {
    case 'basic':
      headers.push({ name: 'Authorization', value: 'Basic {{basic_credentials}}' });
      notes.push(
        omission('secret-placeholder', `The Basic password for \`${request.name}\` was exported as a placeholder.`)
      );
      break;
    case 'bearer':
      headers.push({ name: 'Authorization', value: 'Bearer {{bearer_token}}' });
      notes.push(
        omission('secret-placeholder', `The bearer token for \`${request.name}\` was exported as a placeholder.`)
      );
      break;
    case 'api-key':
      if (request.auth.placement === 'header') {
        headers.push({ name: request.auth.nameTemplate || 'X-API-Key', value: '{{api_key}}' });
      }
      notes.push(
        omission('secret-placeholder', `The API key for \`${request.name}\` was exported as a placeholder.`)
      );
      break;
    default:
      break;
  }

  return { headers, notes };
}
