import { describe, it, expect } from 'vitest';
import { bodyLanguageId } from '@renderer/features/api/apiFormat';

describe('bodyLanguageId', () => {
  it('maps text body kinds to CodeMirror language ids', () => {
    expect(bodyLanguageId('json')).toBe('json');
    expect(bodyLanguageId('xml')).toBe('xml');
    expect(bodyLanguageId('html')).toBe('html');
    expect(bodyLanguageId('text')).toBe('');
  });
});
