import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('startup markup', () => {
  it('uses the canonical Bureau icon for the boot animation', () => {
    const markup = readFileSync(resolve(process.cwd(), 'src/renderer/index.html'), 'utf8');

    expect(markup).toContain('src="../../assets/icons/icon-64.png"');
    expect(markup).not.toContain('<div class="boot__mark">B</div>');
  });
});
