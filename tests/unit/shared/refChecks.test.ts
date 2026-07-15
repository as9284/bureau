import { describe, it, expect } from 'vitest';
import {
  checkOidFormat,
  checkRefNameBasics,
  redactUrlCredentials,
} from '../../../src/shared/git/refChecks';

describe('refChecks', () => {
  it('rejects refs starting with dash', () => {
    expect(checkRefNameBasics('-main')?.code).toBe('REF_LOOKS_LIKE_OPTION');
  });

  it('rejects double dots', () => {
    expect(checkRefNameBasics('feature..bug')?.code).toBe('INVALID_REF');
  });

  it('accepts normal branch names', () => {
    expect(checkRefNameBasics('feature/login')).toBeUndefined();
  });

  it('validates oid hex', () => {
    expect(checkOidFormat('abc1234')).toBeUndefined();
    expect(checkOidFormat('not-hex')?.code).toBe('INVALID_REF');
  });

  it('redacts url credentials', () => {
    const redacted = redactUrlCredentials('https://user:pass@example.com/repo.git');
    expect(redacted).not.toContain('pass');
  });
});
