import { describe, it, expect } from 'vitest';
import { normalizePathForComparison, pathsEqual } from '@main/projects/pathIdentity';

describe('pathIdentity', () => {
  it('treats equivalent normalized paths as equal', () => {
    expect(pathsEqual('/a/b/../b', '/a/b')).toBe(true);
  });

  it.runIf(process.platform === 'win32')('is case-insensitive on Windows', () => {
    expect(pathsEqual('C:\\Code\\App', 'c:\\code\\app')).toBe(true);
    expect(normalizePathForComparison('C:\\Code')).toBe('c:\\code');
  });

  it.runIf(process.platform !== 'win32')('is case-sensitive off Windows', () => {
    expect(pathsEqual('/Code/App', '/code/app')).toBe(false);
  });
});
