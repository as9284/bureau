import { describe, expect, it } from 'vitest';
import { wrapExportDocumentHtml } from '@main/files/DocumentExportService';

describe('wrapExportDocumentHtml', () => {
  it('injects a locked CSP meta tag into fragment and full documents', () => {
    const fragment = wrapExportDocumentHtml('<h1>Hello</h1>');
    expect(fragment).toContain("default-src 'none'");
    expect(fragment).toContain("img-src data: blob:");
    expect(fragment).toContain('<body><h1>Hello</h1></body>');

    const full = wrapExportDocumentHtml('<!doctype html><html><head><title>x</title></head><body><p>y</p></body></html>');
    expect(full).toMatch(/<head[^>]*>[\s\S]*Content-Security-Policy/);
    expect(full).toContain('<title>x</title>');
  });
});
