import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createRedactor, REDACTED_PLACEHOLDER } from '@main/api/script/redact';
import { folderChain, scriptLocations, scriptsForRequest } from '@main/api/script/scriptHolders';
import { parseCsv, parseRunData } from '@main/api/script/RunDataStore';
import { resolveRunOrder } from '@main/api/script/CollectionRunner';
import { runReportToJUnit, runReportToJson } from '@main/api/script/runReport';
import { scriptVariableBag } from '@main/api/VariableResolver';
import type {
  ApiCollectionNode,
  ApiRequestDefinition,
  ApiRunReport,
  ApiVariableDefinition,
} from '@shared/contracts/apiWorkbench';

const WORKSPACE = randomUUID();

function folder(name: string, parentId: string | null, order = 0): ApiCollectionNode {
  return {
    collectionId: randomUUID(),
    workspaceId: WORKSPACE,
    parentId,
    kind: 'folder',
    name,
    order,
    variables: [],
    revision: 1,
  };
}

function request(name: string): ApiRequestDefinition {
  return {
    requestId: randomUUID(),
    workspaceId: WORKSPACE,
    name,
    protocol: 'http',
    urlTemplate: 'https://api.test/x',
    method: 'GET',
    query: [],
    headers: [],
    auth: { kind: 'inherit' },
    body: { kind: 'none' },
    protocolOptions: {},
    scripts: {},
    settings: {},
    variables: [],
    revision: 1,
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
  };
}

function requestNode(target: ApiRequestDefinition, parentId: string | null, order = 0): ApiCollectionNode {
  return {
    collectionId: randomUUID(),
    workspaceId: WORKSPACE,
    parentId,
    kind: 'request',
    name: target.name,
    order,
    requestId: target.requestId,
    variables: [],
    revision: 1,
  };
}

describe('secret redaction', () => {
  it('replaces every occurrence of every secret, longest first', () => {
    const redact = createRedactor(['abcdef', 'abcdefghij']);
    // The longer secret contains the shorter one; it must not be left half-redacted.
    expect(redact('value abcdefghij and abcdef')).toBe(
      `value ${REDACTED_PLACEHOLDER} and ${REDACTED_PLACEHOLDER}`
    );
  });

  it('ignores values too short to be a credential', () => {
    // Redacting `1` would corrupt every number in every log line.
    const redact = createRedactor(['1', 'ab', undefined, '']);
    expect(redact('status 1 after ab attempts')).toBe('status 1 after ab attempts');
  });

  it('is a no-op when there is nothing to redact', () => {
    expect(createRedactor([])('unchanged')).toBe('unchanged');
  });
});

describe('script holder resolution', () => {
  it('runs ancestor folder scripts before the request, in both phases', () => {
    const outer = folder('Outer', null);
    const inner = folder('Inner', outer.collectionId);
    outer.scripts = { preRequest: 'a', postResponse: 'ta', enabled: true };
    inner.scripts = { preRequest: 'b', postResponse: 'tb', enabled: true };
    const target = request('Get user');
    target.scripts = { preRequest: 'c', postResponse: 'tc', enabled: true };
    const node = requestNode(target, inner.collectionId);
    const file = { collections: [outer, inner, node], requests: [target] };

    expect(
      scriptsForRequest(file, target, node, 'pre-request').map((entry) => entry.source)
    ).toEqual(['a', 'b', 'c']);
    // Same order in both phases: a folder's relationship to its children must not depend on phase.
    expect(
      scriptsForRequest(file, target, node, 'post-response').map((entry) => entry.source)
    ).toEqual(['ta', 'tb', 'tc']);
  });

  it('skips a holder whose scripts are disabled', () => {
    const parent = folder('Parent', null);
    parent.scripts = { preRequest: 'folder', enabled: false };
    const target = request('Get user');
    target.scripts = { preRequest: 'own', enabled: true };
    const node = requestNode(target, parent.collectionId);
    const file = { collections: [parent, node], requests: [target] };

    expect(scriptsForRequest(file, target, node, 'pre-request').map((e) => e.source)).toEqual(['own']);
  });

  it('skips a holder with source but no enabled flag at all', () => {
    const target = request('Get user');
    target.scripts = { preRequest: 'never runs' };
    const node = requestNode(target, null);
    const file = { collections: [node], requests: [target] };
    expect(scriptsForRequest(file, target, node, 'pre-request')).toEqual([]);
  });

  it('ignores whitespace-only source', () => {
    const target = request('Get user');
    target.scripts = { preRequest: '   \n  ', enabled: true };
    const node = requestNode(target, null);
    expect(scriptsForRequest({ collections: [node] }, target, node, 'pre-request')).toEqual([]);
  });

  it('does not spin on a parent cycle', () => {
    const a = folder('A', null);
    const b = folder('B', a.collectionId);
    a.parentId = b.collectionId;
    expect(folderChain({ collections: [a, b] }, b.collectionId).length).toBeLessThanOrEqual(2);
  });

  it('lists every script under a subtree with its provenance and path', () => {
    const root = folder('Payments', null);
    const nested = folder('Users', root.collectionId);
    nested.scripts = { postResponse: 'test', enabled: false, origin: 'imported' };
    const target = request('List users');
    target.scripts = { preRequest: 'setup', enabled: true, origin: 'authored' };
    const node = requestNode(target, nested.collectionId);

    const locations = scriptLocations(
      { collections: [root, nested, node], requests: [target] },
      root.collectionId
    );
    expect(locations).toEqual([
      {
        holder: { kind: 'folder', id: nested.collectionId, name: 'Users' },
        phases: ['post-response'],
        enabled: false,
        origin: 'imported',
        path: 'Payments / Users',
      },
      {
        holder: { kind: 'request', id: target.requestId, name: 'List users' },
        phases: ['pre-request'],
        enabled: true,
        origin: 'authored',
        path: 'Payments / Users / List users',
      },
    ]);
  });
});

describe('run order', () => {
  it('walks the tree in sidebar order', () => {
    const first = folder('A', null, 0);
    const second = folder('B', null, 1);
    const r1 = request('one');
    const r2 = request('two');
    const r3 = request('three');
    const collections = [
      first,
      second,
      requestNode(r2, first.collectionId, 1),
      requestNode(r1, first.collectionId, 0),
      requestNode(r3, second.collectionId, 0),
    ];
    expect(
      resolveRunOrder(collections, [r1, r2, r3], { kind: 'workspace' }).map((r) => r.name)
    ).toEqual(['one', 'two', 'three']);
    expect(
      resolveRunOrder(collections, [r1, r2, r3], {
        kind: 'collection',
        collectionId: second.collectionId,
      }).map((r) => r.name)
    ).toEqual(['three']);
    expect(
      resolveRunOrder(collections, [r1, r2, r3], { kind: 'request', requestId: r2.requestId }).map(
        (r) => r.name
      )
    ).toEqual(['two']);
  });

  it('returns nothing for a target that no longer exists', () => {
    expect(resolveRunOrder([], [], { kind: 'collection', collectionId: randomUUID() })).toEqual([]);
  });
});

describe('iteration data parsing', () => {
  it('parses RFC 4180 CSV including quotes, escapes, and embedded newlines', () => {
    expect(parseCsv('a,b\r\n"x,1","he said ""hi"""\r\n"multi\nline",2\r\n')).toEqual([
      ['a', 'b'],
      ['x,1', 'he said "hi"'],
      ['multi\nline', '2'],
    ]);
  });

  it('reads a CSV header into variable rows and drops unusable columns', () => {
    const result = parseRunData('user_id,not a name,email\n1,x,a@test\n2,y,b@test\n', 100);
    expect(result.columns).toEqual(['user_id', 'email']);
    expect(result.rows).toEqual([
      { user_id: '1', email: 'a@test' },
      { user_id: '2', email: 'b@test' },
    ]);
    expect(result.warnings[0].code).toBe('column-dropped');
  });

  it('reads a JSON array of objects and coerces scalars', () => {
    const result = parseRunData('[{"id":1,"ok":true},{"id":2,"ok":false}]', 100);
    expect(result.rows).toEqual([
      { id: '1', ok: 'true' },
      { id: '2', ok: 'false' },
    ]);
  });

  it('drops a structured value rather than stringifying it into a variable', () => {
    const result = parseRunData('[{"id":1,"nested":{"a":1}}]', 100);
    expect(result.rows[0]).toEqual({ id: '1' });
    expect(result.warnings.some((note) => note.code === 'value-dropped')).toBe(true);
  });

  it('stops at the row cap', () => {
    const rows = Array.from({ length: 50 }, (_, index) => `{"id":${index}}`).join(',');
    expect(parseRunData(`[${rows}]`, 10).rows).toHaveLength(10);
  });

  it('rejects a file with nothing usable', () => {
    expect(() => parseRunData('', 100)).toThrow();
    expect(() => parseRunData('not json', 100)).toThrow();
    expect(() => parseRunData('1,2,3\n4,5,6\n', 100)).toThrow(/no usable variable names/);
  });
});

describe('script variable bag', () => {
  function variable(patch: Partial<ApiVariableDefinition>): ApiVariableDefinition {
    return {
      variableId: randomUUID(),
      name: 'name',
      enabled: true,
      secret: false,
      ...patch,
    };
  }

  it('exposes secret values but reports their names and values for redaction', () => {
    const secretId = randomUUID();
    const bag = scriptVariableBag({
      requestVariables: [],
      folderVariables: [],
      environmentVariables: [
        variable({ name: 'token', secret: true, secretId }),
        variable({ name: 'host', value: 'api.test' }),
      ],
      workspaceVariables: [],
      sendUnresolvedLiterals: false,
      resolveSecret: (id) => (id === secretId ? 'live-value' : undefined),
    });
    expect(bag.variables).toEqual({ token: 'live-value', host: 'api.test' });
    expect(bag.secretNames).toEqual(['token']);
    expect(bag.secretValues).toEqual(['live-value']);
  });

  it('lets a runtime value win over every stored scope, and iteration data over that', () => {
    const bag = scriptVariableBag({
      requestVariables: [variable({ name: 'id', value: 'request' })],
      folderVariables: [[variable({ name: 'id', value: 'folder' })]],
      environmentVariables: [variable({ name: 'id', value: 'environment' })],
      workspaceVariables: [variable({ name: 'id', value: 'workspace' })],
      runtimeValues: new Map([['id', 'runtime']]),
      sendUnresolvedLiterals: false,
      resolveSecret: () => undefined,
    });
    expect(bag.variables.id).toBe('runtime');

    const withData = scriptVariableBag({
      requestVariables: [],
      folderVariables: [],
      environmentVariables: [],
      workspaceVariables: [],
      runtimeValues: new Map([['id', 'runtime']]),
      iterationValues: new Map([['id', 'iteration']]),
      sendUnresolvedLiterals: false,
      resolveSecret: () => undefined,
    });
    expect(withData.variables.id).toBe('iteration');
  });

  it('omits a variable too large for the guest heap instead of truncating it', () => {
    const bag = scriptVariableBag({
      requestVariables: [variable({ name: 'huge', value: 'x'.repeat(100_000) })],
      folderVariables: [],
      environmentVariables: [],
      workspaceVariables: [],
      sendUnresolvedLiterals: false,
      resolveSecret: () => undefined,
    });
    expect(bag.variables.huge).toBeUndefined();
  });
});

describe('run report serialisation', () => {
  const report: ApiRunReport = {
    runId: '11111111-1111-4111-8111-111111111111',
    workspaceId: WORKSPACE,
    status: 'failed',
    startedAt: '2026-07-30T00:00:00.000Z',
    finishedAt: '2026-07-30T00:00:02.000Z',
    environmentName: 'Staging',
    iterations: 1,
    plannedItems: 2,
    items: [
      {
        itemId: 'a',
        requestId: 'r1',
        name: 'List users <prod>',
        iteration: 1,
        method: 'GET',
        url: 'https://api.test/users?a=1&b=2',
        status: 200,
        ok: false,
        totalMs: 120,
        tests: [
          { name: 'is ok', passed: true },
          { name: 'has "id"', passed: false, message: 'Expected 1 to be 2' },
        ],
        scripts: [
          {
            phase: 'post-response',
            holder: { kind: 'request', id: 'r1', name: 'List users' },
            ran: true,
            ok: false,
            durationMs: 4,
            console: [{ level: 'log', text: 'checking' }],
            consoleDropped: 0,
            tests: [],
            variableWrites: [],
          },
        ],
      },
      {
        itemId: 'b',
        requestId: 'r2',
        name: 'Create user',
        iteration: 1,
        method: 'POST',
        url: 'https://api.test/users',
        ok: false,
        totalMs: 30,
        tests: [],
        scripts: [],
        errorCode: 'API_CONNECT_FAILED',
        errorMessage: 'connect ECONNREFUSED',
      },
    ],
    totals: {
      requests: 2,
      failedRequests: 2,
      assertions: 2,
      failedAssertions: 1,
      scriptErrors: 1,
      totalMs: 150,
    },
    scriptsEnabled: true,
  };

  it('writes JSON without request or response bodies', () => {
    const parsed = JSON.parse(runReportToJson(report));
    expect(parsed.format).toBe('bureau-api-run');
    expect(parsed.totals.failedAssertions).toBe(1);
    expect(parsed.items[0].scripts[0].console).toEqual([{ level: 'log', text: 'checking' }]);
    // A report is a test result, not a capture.
    expect(runReportToJson(report)).not.toContain('bodyText');
  });

  it('writes JUnit XML that escapes every value it interpolates', () => {
    const xml = runReportToJUnit(report);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('List users &lt;prod&gt; (iteration 1)');
    expect(xml).toContain('has &quot;id&quot;');
    expect(xml).toContain('a=1&amp;b=2');
    expect(xml).toContain('<failure type="assertion">Expected 1 to be 2</failure>');
    expect(xml).toContain('<failure type="API_CONNECT_FAILED">connect ECONNREFUSED</failure>');
    // No raw `<` or `&` survives outside a tag or an entity.
    expect(xml.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|apos);/g, '')).not.toMatch(/[<>&]/);
  });

  it('strips control characters that would make the XML unparseable', () => {
    const withControl: ApiRunReport = {
      ...report,
      items: [{ ...report.items[0], name: `bad${String.fromCharCode(7)}name` }],
    };
    const xml = runReportToJUnit(withControl);
    expect(xml).toContain('badname');
    expect(xml).not.toContain(String.fromCharCode(7));
  });
});
