import { describe, expect, it } from 'vitest';
import { resolveTemplate } from '@main/api/VariableResolver';

describe('VariableResolver', () => {
  const baseInput = {
    requestVariables: [],
    folderVariables: [],
    environmentVariables: [],
    workspaceVariables: [],
    sendUnresolvedLiterals: false,
    resolveSecret: () => undefined,
  };

  it('resolves workspace variables into templates', () => {
    const result = resolveTemplate('https://{{host}}/api', {
      ...baseInput,
      workspaceVariables: [
        { variableId: '1', name: 'host', enabled: true, secret: false, value: 'example.com' },
      ],
    }, 'test');
    expect(result).toEqual({ ok: true, resolved: 'https://example.com/api' });
  });

  it('prefers request variables over workspace variables', () => {
    const result = resolveTemplate('{{name}}', {
      ...baseInput,
      workspaceVariables: [
        { variableId: '1', name: 'name', enabled: true, secret: false, value: 'workspace' },
      ],
      requestVariables: [
        { variableId: '2', name: 'name', enabled: true, secret: false, value: 'request' },
      ],
    }, 'test');
    expect(result).toEqual({ ok: true, resolved: 'request' });
  });

  it('prefers environment over workspace', () => {
    const result = resolveTemplate('{{token}}', {
      ...baseInput,
      workspaceVariables: [
        { variableId: '1', name: 'token', enabled: true, secret: false, value: 'ws' },
      ],
      environmentVariables: [
        { variableId: '2', name: 'token', enabled: true, secret: false, value: 'env' },
      ],
    }, 'test');
    expect(result).toEqual({ ok: true, resolved: 'env' });
  });

  it('prefers nearest folder ancestor over environment', () => {
    const result = resolveTemplate('{{color}}', {
      ...baseInput,
      environmentVariables: [
        { variableId: '1', name: 'color', enabled: true, secret: false, value: 'env' },
      ],
      folderVariables: [
        [
          { variableId: '2', name: 'color', enabled: true, secret: false, value: 'parent' },
        ],
        [
          { variableId: '3', name: 'color', enabled: true, secret: false, value: 'child' },
        ],
      ],
    }, 'test');
    expect(result).toEqual({ ok: true, resolved: 'child' });
  });

  it('returns API_VARIABLE_UNRESOLVED when a name is missing', () => {
    const result = resolveTemplate('{{missing}}', baseInput, 'test');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('API_VARIABLE_UNRESOLVED');
    }
  });

  it('detects variable cycles', () => {
    const result = resolveTemplate('{{a}}', {
      ...baseInput,
      workspaceVariables: [
        { variableId: '1', name: 'a', enabled: true, secret: false, value: '{{b}}' },
        { variableId: '2', name: 'b', enabled: true, secret: false, value: '{{a}}' },
      ],
    }, 'test');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('API_VARIABLE_CYCLE');
    }
  });

  it('sends unresolved literals when opted in', () => {
    const result = resolveTemplate('{{missing}}', {
      ...baseInput,
      sendUnresolvedLiterals: true,
    }, 'test');
    expect(result).toEqual({ ok: true, resolved: '{{missing}}' });
  });
});
