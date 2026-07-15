import { describe, expect, it } from 'vitest';
import { markdownFrontMatter, markdownOutline, markdownStats } from '@renderer/features/files/markdown';

describe('Markdown document helpers', () => {
  it('computes stable slugs and ignores headings inside fenced code', () => {
    const outline = markdownOutline('# Intro\n## Details\n```md\n# Not a heading\n```\n## Details');
    expect(outline).toEqual([
      { depth: 1, text: 'Intro', slug: 'intro' },
      { depth: 2, text: 'Details', slug: 'details' },
      { depth: 2, text: 'Details', slug: 'details-1' },
    ]);
  });

  it('excludes common Markdown syntax from word statistics', () => {
    const stats = markdownStats('---\ntitle: Hidden\n---\n# Hello world\n[Link](https://example.com) `code`');
    expect(stats.words).toBeGreaterThanOrEqual(2);
    expect(stats.words).toBeLessThan(7);
    expect(stats.readMinutes).toBe(1);
  });

  it('extracts bounded scalar front-matter metadata', () => {
    expect(markdownFrontMatter('---\ntitle: "Bureau"\ndraft: false\nnested:\n  value: ignored\n---\n# Body')).toEqual({
      title: 'Bureau',
      draft: 'false',
    });
  });
});
