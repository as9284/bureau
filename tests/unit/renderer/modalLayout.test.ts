import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('modal layout styles', () => {
  it('assigns form dialog height to the scrollable body while keeping its chrome fixed', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/styles/phase1.css'), 'utf8');

    expect(styles).toMatch(/\.dialog__header\s*{[^}]*flex:\s*0 0 auto;/s);
    expect(styles).toMatch(/\.dialog__body\s*{[^}]*flex:\s*1 1 auto;/s);
    expect(styles).toMatch(/\.dialog__footer\s*{[^}]*flex:\s*0 0 auto;/s);
  });
});
