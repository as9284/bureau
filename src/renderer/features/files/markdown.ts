import DOMPurify from 'dompurify';

export type MarkdownHeading = { depth: number; text: string; slug: string };
export type MarkdownStats = { words: number; characters: number; readMinutes: number };

export function markdownFrontMatter(source: string): Record<string, string> {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n|$)/.exec(source);
  if (!match) return {};
  const metadata: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([A-Za-z0-9_-]{1,64}):\s*(.*?)\s*$/.exec(line);
    if (!field || !field[2]) continue;
    metadata[field[1]] = field[2].replace(/^(['"])(.*)\1$/, '$2').slice(0, 500);
  }
  return metadata;
}

export function markdownStats(source: string): MarkdownStats {
  const plain = source
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!?(?:\[[^\]]*\])\([^)]*\)/g, ' ')
    .replace(/[#>*_~|-]/g, ' ');
  const words = plain.trim() ? plain.trim().split(/\s+/u).length : 0;
  return { words, characters: source.length, readMinutes: Math.max(1, Math.ceil(words / 220)) };
}

function slugify(value: string): string {
  return value.toLocaleLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').replace(/-+/g, '-');
}

export function markdownOutline(source: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  const counts = new Map<string, number>();
  let fenced = false;
  for (const line of source.split(/\r\n|\r|\n/)) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const text = match[2].replace(/[*_`[\]]/g, '').trim();
    const base = slugify(text);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    headings.push({ depth: match[1].length, text, slug: count ? `${base}-${count}` : base });
  }
  return headings;
}

/** Sanitize SVG markup for safe DOM injection (Mermaid diagrams). Standalone SVG previews use a blob <img> instead. */
export function sanitizedSvgPreview(markup: string): string {
  return DOMPurify.sanitize(markup, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'object', 'embed', 'animate', 'set', 'animateTransform', 'animateMotion'],
  });
}
