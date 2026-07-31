import { describe, expect, it } from 'vitest';
import { importPostman } from '@main/api/import/PostmanImporter';
import { importOpenApi } from '@main/api/import/OpenApiImporter';
import { importHar } from '@main/api/import/HarImporter';
import { importBureau } from '@main/api/import/BureauImporter';
import { detectFormat, parseStructured } from '@main/api/import/importSupport';

const LIMITS = { maxBytes: 5_000_000, maxNodes: 500, maxDepth: 32 };

describe('format detection', () => {
  it('recognises each supported format from its content', () => {
    expect(detectFormat('curl https://x.test')).toBe('curl');
    expect(detectFormat(JSON.stringify({ info: { name: 'x' }, item: [] }))).toBe('postman');
    expect(detectFormat(JSON.stringify({ openapi: '3.1.0', paths: {} }))).toBe('openapi');
    expect(detectFormat(JSON.stringify({ swagger: '2.0', paths: {} }))).toBe('openapi');
    expect(detectFormat(JSON.stringify({ log: { entries: [] } }))).toBe('har');
    expect(detectFormat(JSON.stringify({ format: 'bureau-api', version: 1 }))).toBe('bureau');
    expect(detectFormat('openapi: 3.1.0\npaths: {}\n')).toBe('openapi');
    expect(detectFormat('nonsense')).toBeNull();
  });
});

describe('bounded parsing', () => {
  it('rejects a document nested past the depth bound', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 80; i += 1) deep = { nested: deep };
    expect(() => parseStructured(JSON.stringify(deep), LIMITS)).toThrow(/nested too deeply/i);
  });

  it('rejects a YAML alias bomb rather than expanding it', () => {
    // Classic billion-laughs: each level references the previous one nine times.
    const bomb = [
      'a: &a ["x","x","x","x","x","x","x","x","x"]',
      'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]',
      'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]',
      'd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c]',
      'e: &e [*d,*d,*d,*d,*d,*d,*d,*d,*d]',
      'f: [*e,*e,*e,*e,*e,*e,*e,*e,*e]',
    ].join('\n');
    expect(() => parseStructured(bomb, LIMITS)).toThrow();
  });

  it('rejects malformed JSON with a clear message', () => {
    expect(() => parseStructured('{"a":', LIMITS)).toThrow(/not valid JSON/i);
  });
});

describe('Postman import', () => {
  const collection = {
    info: {
      name: 'Payments',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    variable: [
      { key: 'base-url', value: 'https://api.test' },
      { key: 'api_token', value: 'live-secret-value', type: 'secret' },
    ],
    item: [
      {
        name: 'Users',
        item: [
          {
            name: 'List users',
            request: {
              method: 'GET',
              url: { raw: 'https://api.test/users?page=1', query: [{ key: 'page', value: '1' }] },
              header: [{ key: 'Accept', value: 'application/json' }],
            },
            event: [
              { listen: 'test', script: { exec: ['pm.test("ok", () => {})'] } },
            ],
          },
          {
            name: 'Create user',
            request: {
              method: 'POST',
              url: 'https://api.test/users',
              body: { mode: 'raw', raw: '{"name":"ada"}', options: { raw: { language: 'json' } } },
              auth: { type: 'bearer', bearer: [{ key: 'token', value: 'super-secret-token' }] },
            },
          },
        ],
      },
    ],
  };

  it('imports folders, requests, bodies, and query rows', () => {
    const draft = importPostman(JSON.stringify(collection), LIMITS, 'x.json');
    const names = draft.nodes.map((node) => node.name);
    expect(names).toEqual(['Payments', 'Users', 'List users', 'Create user']);

    const create = draft.nodes.find((node) => node.name === 'Create user')!;
    const request = draft.requests.get(create.tempId)!;
    expect(request.method).toBe('POST');
    expect(request.body).toEqual({ kind: 'json', text: '{"name":"ada"}' });
  });

  it('never carries credential values into the draft', () => {
    const draft = importPostman(JSON.stringify(collection), LIMITS, 'x.json');
    const serialised = JSON.stringify({
      nodes: draft.nodes,
      requests: [...draft.requests.values()],
      environments: draft.environments,
    });
    expect(serialised).not.toContain('super-secret-token');
    expect(serialised).not.toContain('live-secret-value');
    expect(draft.warnings.some((w) => w.code === 'credential-dropped')).toBe(true);
  });

  it('imports scripts flagged and disabled', () => {
    const draft = importPostman(JSON.stringify(collection), LIMITS, 'x.json');
    const list = draft.nodes.find((node) => node.name === 'List users')!;
    expect(list.hasScripts).toBe(true);
    expect(draft.warnings.some((w) => w.code === 'script-disabled')).toBe(true);
  });

  it('turns collection variables into an environment with secrets marked', () => {
    const draft = importPostman(JSON.stringify(collection), LIMITS, 'x.json');
    expect(draft.environments).toHaveLength(1);
    const variables = draft.environments[0].variables;
    // Names are sanitised into identifiers.
    expect(variables.map((v) => v.name)).toEqual(['base_url', 'api_token']);
    expect(variables.find((v) => v.name === 'api_token')).toMatchObject({ secret: true, value: '' });
  });

  it('imports a GraphQL body as a GraphQL request', () => {
    const draft = importPostman(
      JSON.stringify({
        info: { name: 'g', schema: 'v2.1' },
        item: [
          {
            name: 'Viewer',
            request: {
              method: 'POST',
              url: 'https://api.test/graphql',
              body: { mode: 'graphql', graphql: { query: 'query { viewer { id } }', variables: '{}' } },
            },
          },
        ],
      }),
      LIMITS,
      'g.json'
    );
    const node = draft.nodes.find((n) => n.name === 'Viewer')!;
    const request = draft.requests.get(node.tempId)!;
    expect(request.protocol).toBe('graphql');
    expect(request.protocolOptions.graphql?.query).toContain('viewer');
  });

  it('rejects a file that is not a Postman collection', () => {
    expect(() => importPostman(JSON.stringify({ hello: 1 }), LIMITS, 'x')).toThrow(/Postman/i);
  });
});

describe('OpenAPI import', () => {
  const document = {
    openapi: '3.1.0',
    info: { title: 'Widgets' },
    servers: [
      { url: 'https://{region}.api.test/v1', variables: { region: { default: 'eu' } } },
    ],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      schemas: {
        Widget: {
          type: 'object',
          properties: { id: { type: 'integer' }, name: { type: 'string' } },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      '/widgets': {
        get: {
          tags: ['Widgets'],
          summary: 'List widgets',
          parameters: [{ name: 'limit', in: 'query', required: true, schema: { type: 'integer', default: 10 } }],
        },
        post: {
          tags: ['Widgets'],
          summary: 'Create widget',
          requestBody: {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Widget' } },
            },
          },
        },
      },
      '/widgets/{id}': {
        get: { tags: ['Widgets'], summary: 'Get widget' },
      },
    },
  };

  it('creates tag folders and operations with a resolved server URL', () => {
    const draft = importOpenApi(JSON.stringify(document), LIMITS, 'api.json');
    expect(draft.nodes.map((n) => n.name)).toEqual([
      'Widgets',
      'Widgets',
      'List widgets',
      'Create widget',
      'Get widget',
    ]);
    const list = draft.nodes.find((n) => n.name === 'List widgets')!;
    // Server variables become Bureau templates plus an environment.
    expect(draft.requests.get(list.tempId)!.urlTemplate).toBe('https://{{region}}.api.test/v1/widgets');
    expect(draft.environments[0].variables).toEqual([
      { name: 'region', value: 'eu', enabled: true, secret: false },
    ]);
  });

  it('rewrites path templates into Bureau variables', () => {
    const draft = importOpenApi(JSON.stringify(document), LIMITS, 'api.json');
    const get = draft.nodes.find((n) => n.name === 'Get widget')!;
    expect(draft.requests.get(get.tempId)!.urlTemplate).toContain('/widgets/{{id}}');
  });

  it('builds a body example by resolving a $ref schema', () => {
    const draft = importOpenApi(JSON.stringify(document), LIMITS, 'api.json');
    const create = draft.nodes.find((n) => n.name === 'Create widget')!;
    const body = draft.requests.get(create.tempId)!.body;
    expect(body.kind).toBe('json');
    if (body.kind === 'json') {
      expect(JSON.parse(body.text)).toEqual({ id: 0, name: 'string' });
    }
  });

  it('maps a security scheme to auth without inventing a credential', () => {
    const draft = importOpenApi(JSON.stringify(document), LIMITS, 'api.json');
    const list = draft.nodes.find((n) => n.name === 'List widgets')!;
    expect(draft.requests.get(list.tempId)!.auth).toEqual({ kind: 'bearer' });
  });

  it('refuses to follow an external $ref', () => {
    const draft = importOpenApi(
      JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'x' },
        paths: {
          '/a': {
            post: {
              requestBody: {
                content: { 'application/json': { schema: { $ref: '../../../etc/passwd' } } },
              },
            },
          },
        },
      }),
      LIMITS,
      'x.json'
    );
    expect(draft.warnings.some((w) => w.code === 'external-ref-blocked')).toBe(true);
  });

  it('refuses to follow a remote $ref', () => {
    const draft = importOpenApi(
      JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'x' },
        paths: {
          '/a': {
            get: { parameters: [{ $ref: 'https://evil.test/params.json#/p' }] },
          },
        },
      }),
      LIMITS,
      'x.json'
    );
    expect(draft.warnings.some((w) => w.code === 'external-ref-blocked')).toBe(true);
  });

  it('breaks a self-referential $ref cycle instead of recursing', () => {
    const draft = importOpenApi(
      JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'x' },
        components: { schemas: { Node: { $ref: '#/components/schemas/Node' } } },
        paths: {
          '/a': {
            post: {
              requestBody: {
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } },
              },
            },
          },
        },
      }),
      LIMITS,
      'x.json'
    );
    expect(draft.warnings.some((w) => w.code === 'ref-cycle')).toBe(true);
  });

  it('reads Swagger 2.0 as a compatibility input', () => {
    const draft = importOpenApi(
      JSON.stringify({
        swagger: '2.0',
        info: { title: 'Legacy' },
        host: 'legacy.test',
        basePath: '/v1',
        schemes: ['https'],
        paths: { '/ping': { get: { summary: 'Ping' } } },
      }),
      LIMITS,
      'legacy.json'
    );
    const ping = draft.nodes.find((n) => n.name === 'Ping')!;
    expect(draft.requests.get(ping.tempId)!.urlTemplate).toBe('https://legacy.test/v1/ping');
    expect(draft.warnings.some((w) => w.code === 'swagger-2')).toBe(true);
  });

  it('rejects an unsupported version', () => {
    expect(() =>
      importOpenApi(JSON.stringify({ openapi: '4.0.0', paths: {} }), LIMITS, 'x')
    ).toThrow(/not supported/i);
  });

  it('stops at the node cap and says so', () => {
    const paths: Record<string, unknown> = {};
    for (let i = 0; i < 50; i += 1) paths[`/p${i}`] = { get: { summary: `Op ${i}` } };
    const draft = importOpenApi(
      JSON.stringify({ openapi: '3.0.0', info: { title: 'big' }, paths }),
      { ...LIMITS, maxNodes: 10 },
      'big.json'
    );
    expect(draft.truncated).toBe(true);
    expect(draft.nodes).toHaveLength(10);
    expect(draft.warnings.some((w) => w.code === 'node-cap')).toBe(true);
  });
});

describe('HAR import', () => {
  const har = {
    log: {
      version: '1.2',
      creator: { name: 'Chrome DevTools' },
      entries: [
        {
          request: {
            method: 'POST',
            url: 'https://api.test/login?next=%2Fhome',
            headers: [
              { name: 'Content-Type', value: 'application/json' },
              { name: 'Cookie', value: 'session=live-session-value' },
              { name: 'Authorization', value: 'Bearer live-token' },
              { name: 'Content-Length', value: '20' },
            ],
            queryString: [{ name: 'next', value: '/home' }],
            postData: { mimeType: 'application/json', text: '{"user":"ada"}' },
          },
        },
        { request: { method: 'GET', url: 'ws://api.test/socket' } },
      ],
    },
  };

  it('imports entries and preserves query rows', () => {
    const draft = importHar(JSON.stringify(har), LIMITS, 'capture.har');
    const login = draft.nodes.find((n) => n.name.includes('/login'))!;
    const request = draft.requests.get(login.tempId)!;
    expect(request.method).toBe('POST');
    expect(request.query.map((p) => [p.name, p.value])).toEqual([['next', '/home']]);
    expect(request.body).toEqual({ kind: 'json', text: '{"user":"ada"}' });
  });

  it('imports captured credentials disabled so they are not replayed', () => {
    const draft = importHar(JSON.stringify(har), LIMITS, 'capture.har');
    const login = draft.nodes.find((n) => n.name.includes('/login'))!;
    const headers = draft.requests.get(login.tempId)!.headers;

    const cookie = headers.find((h) => h.name === 'Cookie')!;
    const authorization = headers.find((h) => h.name === 'Authorization')!;
    expect(cookie.enabled).toBe(false);
    expect(authorization.enabled).toBe(false);
    // The value is kept so the user can inspect it, but it will not be sent.
    expect(cookie.value).toBe('session=live-session-value');
    expect(draft.warnings.some((w) => w.code === 'credential-disabled')).toBe(true);
  });

  it('always raises the privacy warning', () => {
    const draft = importHar(JSON.stringify(har), LIMITS, 'capture.har');
    expect(draft.warnings.some((w) => w.code === 'har-privacy')).toBe(true);
  });

  it('drops capture-only headers', () => {
    const draft = importHar(JSON.stringify(har), LIMITS, 'capture.har');
    const login = draft.nodes.find((n) => n.name.includes('/login'))!;
    const names = draft.requests.get(login.tempId)!.headers.map((h) => h.name);
    expect(names).not.toContain('Content-Length');
  });

  it('skips non-HTTP entries', () => {
    const draft = importHar(JSON.stringify(har), LIMITS, 'capture.har');
    expect(draft.warnings.some((w) => w.code === 'non-http-skipped')).toBe(true);
    expect(draft.requests.size).toBe(1);
  });

  it('decodes a base64 body within limits', () => {
    const draft = importHar(
      JSON.stringify({
        log: {
          version: '1.2',
          entries: [
            {
              request: {
                method: 'POST',
                url: 'https://api.test/x',
                postData: {
                  mimeType: 'application/json',
                  encoding: 'base64',
                  text: Buffer.from('{"a":1}', 'utf8').toString('base64'),
                },
              },
            },
          ],
        },
      }),
      LIMITS,
      'b.har'
    );
    const node = draft.nodes.find((n) => n.kind === 'request')!;
    expect(draft.requests.get(node.tempId)!.body).toEqual({ kind: 'json', text: '{"a":1}' });
  });
});

describe('Bureau native import', () => {
  const nativeFile = {
    format: 'bureau-api',
    version: 1,
    workspace: { name: 'Payments' },
    nodes: [
      { tempId: 'f1', parentTempId: null, kind: 'folder', name: 'Users' },
      {
        tempId: 'r1',
        parentTempId: 'f1',
        kind: 'request',
        name: 'Get user',
        request: {
          protocol: 'http',
          urlTemplate: 'https://api.test/users/1',
          method: 'GET',
          query: [],
          headers: [],
          auth: { kind: 'none' },
          body: { kind: 'none' },
          protocolOptions: {},
          settings: {},
        },
      },
    ],
    environments: [
      {
        name: 'Staging',
        variables: [
          { name: 'base', value: 'https://staging.test', enabled: true, secret: false },
          { name: 'token', enabled: true, secret: true },
        ],
      },
    ],
    secretPolicy: 'omitted',
  };

  it('imports the tree and remaps ids', () => {
    const draft = importBureau(JSON.stringify(nativeFile), LIMITS, 'w.json');
    expect(draft.nodes.map((n) => n.name)).toEqual(['Users', 'Get user']);
    // Ids are regenerated so re-importing into the same workspace cannot collide.
    expect(draft.nodes[0].tempId).not.toBe('f1');
    expect(draft.nodes[1].parentTempId).toBe(draft.nodes[0].tempId);
  });

  it('keeps secret variables as handles with no value', () => {
    const draft = importBureau(JSON.stringify(nativeFile), LIMITS, 'w.json');
    const token = draft.environments[0].variables.find((v) => v.name === 'token')!;
    expect(token).toMatchObject({ secret: true, value: '' });
    expect(draft.warnings.some((w) => w.code === 'secret-variable')).toBe(true);
  });

  it('refuses a newer format version rather than downgrading it', () => {
    expect(() =>
      importBureau(JSON.stringify({ ...nativeFile, version: 99 }), LIMITS, 'w.json')
    ).toThrow(/newer than this build/i);
  });

  it('rejects a structurally invalid export', () => {
    expect(() =>
      importBureau(JSON.stringify({ format: 'bureau-api', version: 1, nodes: 'nope' }), LIMITS, 'w')
    ).toThrow(/not valid/i);
  });
});
