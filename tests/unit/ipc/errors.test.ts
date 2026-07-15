import { describe, it, expect } from 'vitest';
import { mapUnknownError, toBureauError } from '@main/ipc/errors';

describe('mapUnknownError', () => {
  it('maps zod-like issues to INVALID_REQUEST', () => {
    const zodLike = { issues: [{ path: ['appearance', 'theme'], message: 'Invalid' }] };
    const error = mapUnknownError(zodLike, 'settings.update');
    expect(error.code).toBe('INVALID_REQUEST');
    expect(error.message).toContain('appearance.theme');
  });

  it('maps a generic Error to COMMAND_FAILED', () => {
    const error = mapUnknownError(new Error('boom'), 'projects.list');
    expect(error.code).toBe('COMMAND_FAILED');
    expect(error.message).toBe('boom');
  });

  it('passes through an existing BureauError', () => {
    const original = toBureauError({ code: 'PROJECT_NOT_FOUND', message: 'nope', operation: 'x' });
    expect(mapUnknownError(original, 'x')).toBe(original);
  });
});

describe('toBureauError', () => {
  it('sanitizes control characters and newlines from details', () => {
    const error = toBureauError({
      code: 'COMMAND_FAILED',
      message: 'failed',
      operation: 'process.start',
      details: 'line one\nline two',
    });
    expect(error.details).toBe('line one line two');
    expect(error.retryable).toBe(false);
  });
});
