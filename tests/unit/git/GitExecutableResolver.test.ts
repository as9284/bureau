import { describe, it, expect } from 'vitest';
import {
  createGitExecutableResolver,
  parseVersion,
  isSupported,
} from '../../../src/main/git/GitExecutableResolver';

describe('parseVersion', () => {
  it('parses a standard Git version string', () => {
    const version = parseVersion('git version 2.45.0');
    expect(version).toEqual({ raw: 'git version 2.45.0', major: 2, minor: 45, patch: 0 });
  });

  it('returns undefined for unrelated output', () => {
    expect(parseVersion('something else')).toBeUndefined();
  });
});

describe('isSupported', () => {
  it('accepts Git 2.25.0', () => {
    expect(isSupported({ raw: '', major: 2, minor: 25, patch: 0 })).toBe(true);
  });

  it('accepts newer versions', () => {
    expect(isSupported({ raw: '', major: 2, minor: 45, patch: 1 })).toBe(true);
    expect(isSupported({ raw: '', major: 3, minor: 0, patch: 0 })).toBe(true);
  });

  it('rejects older versions', () => {
    expect(isSupported({ raw: '', major: 2, minor: 24, patch: 0 })).toBe(false);
    expect(isSupported({ raw: '', major: 1, minor: 8, patch: 5 })).toBe(false);
  });
});

describe('createGitExecutableResolver', () => {
  it('discovers the installed Git executable', async () => {
    const resolver = createGitExecutableResolver();
    const capability = await resolver.resolve();
    expect(capability.kind).toBe('available');
    if (capability.kind === 'available') {
      expect(capability.version.major).toBeGreaterThanOrEqual(2);
    }
  });
});
