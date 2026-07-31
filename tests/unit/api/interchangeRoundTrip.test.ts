import { describe, expect, it } from 'vitest';
import { exportBureau } from '@main/api/export/BureauExporter';
import { exportPostman } from '@main/api/export/PostmanExporter';
import { exportOpenApi } from '@main/api/export/OpenApiExporter';
import { exportHar } from '@main/api/export/HarExporter';
import { importBureau } from '@main/api/import/BureauImporter';
import { importPostman } from '@main/api/import/PostmanImporter';
import { importOpenApi } from '@main/api/import/OpenApiImporter';
import { importHar } from '@main/api/import/HarImporter';
import type { ExportSource } from '@main/api/export/exportSupport';
import type {
  ApiCollectionNode,
  ApiEnvironment,
  ApiRequestDefinition,
} from '@shared/contracts/apiWorkbench';

const LIMITS = { maxBytes: 5_000_000, maxNodes: 500, maxDepth: 32 };
const NOW = '2026-07-29T00:00:00.000Z';

function request(overrides: Partial<ApiRequestDefinition>): ApiRequestDefinition {
  return {
    requestId: 'r1',
    workspaceId: 'w1',
    name: 'Request',
    protocol: 'http',
    urlTemplate: 'https://api.test/thing',
    method: 'GET',
    query: [],
    headers: [],
    auth: { kind: 'none' },
    body: { kind: 'none' },
    protocolOptions: {},
    scripts: {},
    settings: {},
    variables: [],
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function node(overrides: Partial<ApiCollectionNode>): ApiCollectionNode {
  return {
    collectionId: 'c1',
    workspaceId: 'w1',
    parentId: null,
    kind: 'request',
    name: 'Request',
    order: 0,
    variables: [],
    revision: 1,
    ...overrides,
  };
}

/** A workspace exercising folders, both protocols, auth, bodies, and a secret variable. */
function source(): ExportSource {
  const list = request({
    requestId: 'req-list',
    name: 'List users',
    urlTemplate: 'https://api.test/users',
    query: [{ id: '11111111-1111-4111-8111-111111111111', name: 'page', value: '1', enabled: true }],
    headers: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Accept', value: 'application/json', enabled: true }],
    auth: { kind: 'bearer', tokenSecretId: '33333333-3333-4333-8333-333333333333' },
  });
  const create = request({
    requestId: 'req-create',
    name: 'Create user',
    method: 'POST',
    urlTemplate: 'https://api.test/users',
    body: { kind: 'json', text: '{"name":"ada","age":36}' },
  });
  const graph = request({
    requestId: 'req-graph',
    name: 'Viewer',
    protocol: 'graphql',
    method: 'POST',
    urlTemplate: 'https://api.test/graphql',
    protocolOptions: {
      graphql: { query: 'query { viewer { id } }', variables: '{}', transport: 'POST' },
    },
  });
  const socket = request({
    requestId: 'req-socket',
    name: 'Live feed',
    protocol: 'websocket',
    urlTemplate: 'wss://api.test/socket',
    protocolOptions: { websocket: { subprotocols: [] } },
  });

  const environments: ApiEnvironment[] = [
    {
      environmentId: 'env-1',
      workspaceId: 'w1',
      name: 'Staging',
      variables: [
          {
          variableId: 'v1',
          name: 'base',
          value: 'https://staging.test',
          enabled: true,
          secret: false,
        },
        {
          variableId: 'v2',
          name: 'token',
          secretId: '33333333-3333-4333-8333-333333333333',
          enabled: true,
          secret: true,
        },
      ],
      revision: 1,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ];

  return {
    workspaceName: 'Payments',
    nodes: [
      node({ collectionId: 'folder-users', kind: 'folder', name: 'Users', order: 0 }),
      node({ collectionId: 'c-list', parentId: 'folder-users', name: 'List users', requestId: 'req-list', order: 0 }),
      node({ collectionId: 'c-create', parentId: 'folder-users', name: 'Create user', requestId: 'req-create', order: 1 }),
      node({ collectionId: 'c-graph', name: 'Viewer', requestId: 'req-graph', order: 1 }),
      node({ collectionId: 'c-socket', name: 'Live feed', requestId: 'req-socket', order: 2 }),
    ],
    requests: new Map([
      ['req-list', list],
      ['req-create', create],
      ['req-graph', graph],
      ['req-socket', socket],
    ]),
    environments,
  };
}

describe('native Bureau format', () => {
  it('round-trips every protocol and structure losslessly', () => {
    const exported = exportBureau(source(), null);
    const draft = importBureau(exported.content, LIMITS, 'w.json');

    expect(draft.nodes.map((n) => n.name)).toEqual([
      'Users',
      'List users',
      'Create user',
      'Viewer',
      'Live feed',
    ]);

    // The WebSocket request survives — only the native format can carry it.
    const socket = draft.nodes.find((n) => n.name === 'Live feed')!;
    expect(draft.requests.get(socket.tempId)!.protocol).toBe('websocket');

    const graph = draft.nodes.find((n) => n.name === 'Viewer')!;
    expect(draft.requests.get(graph.tempId)!.protocolOptions.graphql?.query).toContain('viewer');

    const list = draft.nodes.find((n) => n.name === 'List users')!;
    const listRequest = draft.requests.get(list.tempId)!;
    expect(listRequest.query.map((p) => [p.name, p.value])).toEqual([['page', '1']]);
    expect(listRequest.auth).toEqual({
      kind: 'bearer',
      tokenSecretId: '33333333-3333-4333-8333-333333333333',
    });

    // Nesting is preserved.
    const folder = draft.nodes.find((n) => n.name === 'Users')!;
    expect(list.parentTempId).toBe(folder.tempId);
  });

  it('exports no secret values and reports the omission', () => {
    const exported = exportBureau(source(), null);
    expect(exported.content).not.toContain('staging-secret');
    const parsed = JSON.parse(exported.content) as {
      environments: Array<{ variables: Array<{ name: string; value?: string; secret: boolean }> }>;
      secretPolicy: string;
    };
    const token = parsed.environments[0].variables.find((v) => v.name === 'token')!;
    expect(token.secret).toBe(true);
    expect(token.value).toBeUndefined();
    expect(parsed.secretPolicy).toBe('omitted');
    expect(exported.omissions.some((o) => o.code === 'secrets-omitted')).toBe(true);
  });

  it('strips references that only mean something in this installation', () => {
    const withTls = source();
    withTls.requests.get('req-list')!.protocolOptions = { tlsProfileId: 'tls-local-1' };
    const exported = exportBureau(withTls, null);
    expect(exported.content).not.toContain('tls-local-1');
  });
});

describe('Postman export', () => {
  it('round-trips the HTTP subset back through the importer', () => {
    const exported = exportPostman(source(), null);
    const draft = importPostman(exported.content, LIMITS, 'c.json');

    const names = draft.nodes.map((n) => n.name);
    expect(names).toContain('Users');
    expect(names).toContain('List users');
    expect(names).toContain('Create user');
    expect(names).toContain('Viewer');

    const create = draft.nodes.find((n) => n.name === 'Create user')!;
    expect(draft.requests.get(create.tempId)!.body).toEqual({
      kind: 'json',
      text: '{"name":"ada","age":36}',
    });

    const graph = draft.nodes.find((n) => n.name === 'Viewer')!;
    expect(draft.requests.get(graph.tempId)!.protocol).toBe('graphql');
  });

  it('omits stream protocols and reports them before writing', () => {
    const exported = exportPostman(source(), null);
    expect(exported.content).not.toContain('Live feed');
    expect(
      exported.omissions.some(
        (o) => o.code === 'protocol-unsupported' && o.message.includes('Live feed')
      )
    ).toBe(true);
  });

  it('emits placeholders instead of secret handles', () => {
    const exported = exportPostman(source(), null);
    expect(exported.content).toContain('{{bearer_token}}');
    expect(exported.content).not.toContain('33333333-3333-4333-8333-333333333333');
  });

  it('produces a document the importer recognises as Postman', () => {
    const exported = exportPostman(source(), null);
    const parsed = JSON.parse(exported.content) as { info: { schema: string } };
    expect(parsed.info.schema).toContain('v2.1.0');
  });
});

describe('OpenAPI export', () => {
  it('produces a document that re-imports as operations', () => {
    const exported = exportOpenApi(source(), null);
    const draft = importOpenApi(exported.content, LIMITS, 'api.json');
    const names = draft.nodes.map((n) => n.name);
    expect(names).toContain('List users');
    expect(names).toContain('Create user');
  });

  it('reports every lossy concept before writing', () => {
    const exported = exportOpenApi(source(), null);
    const codes = exported.omissions.map((o) => o.code);
    expect(codes).toContain('protocol-unsupported');
    expect(codes).toContain('graphql-as-post');
  });

  it('exports request bodies as examples with an inferred schema', () => {
    const exported = exportOpenApi(source(), null);
    const parsed = JSON.parse(exported.content) as {
      paths: Record<string, Record<string, { requestBody?: { content: Record<string, { example: unknown }> } }>>;
    };
    const post = parsed.paths['/users'].post;
    expect(post.requestBody?.content['application/json'].example).toEqual({ name: 'ada', age: 36 });
  });

  it('omits a request whose host is templated', () => {
    const templated = source();
    templated.requests.get('req-list')!.urlTemplate = 'https://{{host}}/users';
    const exported = exportOpenApi(templated, null);
    expect(exported.omissions.some((o) => o.code === 'unresolvable-url')).toBe(true);
  });
});

describe('HAR export', () => {
  const entries = [
    {
      historyId: 'h1',
      name: 'Login',
      method: 'POST',
      url: 'https://api.test/login?next=%2Fhome',
      createdAt: NOW,
      response: {
        sessionId: 's1',
        workspaceId: 'w1',
        requestId: 'r1',
        ok: true,
        status: 200,
        statusText: 'OK',
        url: 'https://api.test/login',
        method: 'POST',
        headers: [
          { name: 'content-type', value: 'application/json' },
          { name: 'set-cookie', value: 'session=live-session-value' },
        ],
        timings: { totalMs: 42, dnsMs: 1, connectMs: 2, firstByteMs: 30, downloadMs: 9 },
        redirects: [],
        wireBytes: 20,
        decodedBytes: 20,
        truncated: false,
        bodyText: '{"ok":true}',
        bodyIsBinary: false,
      },
    },
  ];

  it('redacts credential headers by default', () => {
    const exported = exportHar(entries, 'Payments', { redactSecrets: true });
    expect(exported.content).not.toContain('live-session-value');
    expect(exported.content).toContain('[redacted by Bureau]');
    expect(exported.omissions.some((o) => o.code === 'headers-redacted')).toBe(true);
  });

  it('always states the privacy implication', () => {
    const exported = exportHar(entries, 'Payments', { redactSecrets: true });
    expect(exported.omissions.some((o) => o.code === 'har-privacy')).toBe(true);
  });

  it('produces a HAR the importer accepts', () => {
    const exported = exportHar(entries, 'Payments', { redactSecrets: true });
    const draft = importHar(exported.content, LIMITS, 'out.har');
    const login = draft.nodes.find((n) => n.kind === 'request')!;
    const reimported = draft.requests.get(login.tempId)!;
    expect(reimported.method).toBe('POST');
    expect(reimported.query.map((p) => [p.name, p.value])).toEqual([['next', '/home']]);
  });

  it('names the risk when redaction is off', () => {
    const exported = exportHar(entries, 'Payments', { redactSecrets: false });
    expect(exported.content).toContain('live-session-value');
    expect(
      exported.omissions.some((o) => o.code === 'har-privacy' && o.message.includes('UNREDACTED'))
    ).toBe(true);
  });
});
