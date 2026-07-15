import { describe, it, expect } from 'vitest';
import { detectLocalUrl } from '@main/processes/urlDetection';

describe('detectLocalUrl', () => {
  it('detects common dev-server URLs', () => {
    expect(detectLocalUrl('  Local:   http://localhost:3000/')).toBe('http://localhost:3000/');
    expect(detectLocalUrl('listening on http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
    expect(detectLocalUrl('vite v5 ready at https://localhost:5173')).toBe(
      'https://localhost:5173'
    );
  });

  it('rewrites unbrowsable hosts to localhost', () => {
    expect(detectLocalUrl('http://0.0.0.0:4000')).toBe('http://localhost:4000');
  });

  it('returns undefined when there is no URL', () => {
    expect(detectLocalUrl('compiling modules...')).toBeUndefined();
    expect(detectLocalUrl('see https://example.com/docs')).toBeUndefined();
  });
});
