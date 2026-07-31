import { describe, expect, it } from 'vitest';
import {
  buildVariableScope,
  scanTemplate,
  SECRET_MASK,
} from '@renderer/features/api/variablePreview';
import type {
  ApiVariableDefinition,
  ApiWorkspaceSnapshot,
} from '@shared/contracts/apiWorkbench';

function variable(patch: Partial<ApiVariableDefinition> & { name: string }): ApiVariableDefinition {
  return {
    variableId: `var-${patch.name}`,
    enabled: true,
    secret: false,
    ...patch,
  };
}

function snapshot(patch: Partial<ApiWorkspaceSnapshot> = {}): ApiWorkspaceSnapshot {
  return {
    summary: {
      workspaceId: 'ws-1',
      name: 'Workspace',
      revision: 1,
      createdAt: '2026-07-31T00:00:00.000Z',
      updatedAt: '2026-07-31T00:00:00.000Z',
    } as ApiWorkspaceSnapshot['summary'],
    variables: [],
    auth: { kind: 'none' },
    collections: [],
    requests: [],
    environments: [],
    tlsProfiles: [],
    proxyProfiles: [],
    oauthProfiles: [],
    oauthTokens: [],
    ...patch,
  };
}

describe('variablePreview', () => {
  it('applies workspace → environment → folder → request precedence', () => {
    const scope = buildVariableScope({
      snapshot: snapshot({
        variables: [variable({ name: 'host', value: 'workspace' })],
        environments: [
          {
            environmentId: 'env-1',
            workspaceId: 'ws-1',
            name: 'Staging',
            variables: [variable({ name: 'host', value: 'environment' })],
            revision: 1,
            createdAt: '',
            updatedAt: '',
          },
        ],
        collections: [
          {
            collectionId: 'folder-1',
            workspaceId: 'ws-1',
            parentId: null,
            kind: 'folder',
            name: 'Folder',
            order: 0,
            variables: [variable({ name: 'host', value: 'folder' })],
            revision: 1,
          },
          {
            collectionId: 'node-1',
            workspaceId: 'ws-1',
            parentId: 'folder-1',
            kind: 'request',
            name: 'Request',
            order: 0,
            requestId: 'req-1',
            variables: [],
            revision: 1,
          },
        ],
      }),
      environmentId: 'env-1',
      requestId: 'req-1',
    });

    expect(scanTemplate('{{host}}', scope).preview).toBe('folder');

    const withRequest = buildVariableScope({
      snapshot: snapshot({ variables: [variable({ name: 'host', value: 'workspace' })] }),
      environmentId: null,
      requestVariables: [variable({ name: 'host', value: 'request' })],
    });
    expect(scanTemplate('{{host}}', withRequest).preview).toBe('request');
  });

  it('marks unset names missing and leaves them literal', () => {
    const scope = buildVariableScope({ snapshot: snapshot(), environmentId: null });
    const scan = scanTemplate('https://{{host}}/v1/{{id}}', scope);

    expect(scan.missing).toEqual(['host', 'id']);
    expect(scan.preview).toBe('https://{{host}}/v1/{{id}}');
    expect(scan.tokens.map((token) => token.status)).toEqual(['missing', 'missing']);
    expect(scan.tokens[0]).toMatchObject({ name: 'host', start: 8, end: 16 });
  });

  it('masks secret-backed variables instead of revealing or dropping them', () => {
    const scope = buildVariableScope({
      snapshot: snapshot(),
      environmentId: null,
      requestVariables: [
        variable({ name: 'token', secret: true, secretId: 'sec-1' }),
        // A secret variable with no binding stays absent, exactly as main treats it.
        variable({ name: 'unbound', secret: true }),
      ],
    });
    const scan = scanTemplate('Bearer {{token}} {{unbound}}', scope);

    expect(scan.preview).toBe(`Bearer ${SECRET_MASK} {{unbound}}`);
    expect(scan.tokens[0].status).toBe('secret');
    expect(scan.tokens[1].status).toBe('missing');
  });

  it('expands nested variables and reports cycles without hanging', () => {
    const nested = buildVariableScope({
      snapshot: snapshot(),
      environmentId: null,
      requestVariables: [
        variable({ name: 'base', value: 'https://{{host}}' }),
        variable({ name: 'host', value: 'example.com' }),
      ],
    });
    expect(scanTemplate('{{base}}/v1', nested).preview).toBe('https://example.com/v1');

    const cyclic = buildVariableScope({
      snapshot: snapshot(),
      environmentId: null,
      requestVariables: [
        variable({ name: 'a', value: '{{b}}' }),
        variable({ name: 'b', value: '{{a}}' }),
      ],
    });
    const scan = scanTemplate('{{a}}', cyclic);
    expect(scan.cyclic).toEqual(['a']);
    expect(scan.preview).toBe('{{a}}');
  });

  it('ignores disabled variables', () => {
    const scope = buildVariableScope({
      snapshot: snapshot(),
      environmentId: null,
      requestVariables: [variable({ name: 'host', value: 'example.com', enabled: false })],
    });
    expect(scanTemplate('{{host}}', scope).missing).toEqual(['host']);
  });
});
