import { describe, expect, it } from 'vitest';
import {
  buildHunkPatch,
  computeChangedRanges,
  parseUnifiedDiff,
} from '../../../src/renderer/features/git/diff/parseUnifiedDiff';

const SAMPLE = `diff --git a/app/api/match/route.ts b/app/api/match/route.ts
index 54faac6..fe3184e 100644
--- a/app/api/match/route.ts
+++ b/app/api/match/route.ts
@@ -1,5 +1,6 @@
 import { NextRequest, NextResponse } from 'next/server';
-import { MatchRequestSchema } from '@/lib/schemas/match';
+import { MatchRequestSchema, MatchResponseSchema } from '@/lib/schemas/match';
 import { matchCandidates } from '@/lib/match/engine';
 
 export async function POST(request: NextRequest) {
+  const startedAt = Date.now();
   const body = await request.json();
`;

describe('parseUnifiedDiff', () => {
  it('strips git headers and builds numbered hunks', () => {
    const parsed = parseUnifiedDiff(SAMPLE);
    expect(parsed.isRawFallback).toBe(false);
    expect(parsed.hunks).toHaveLength(1);

    const kinds = parsed.hunks[0]!.lines.map((line) => line.kind);
    expect(kinds[0]).toBe('hunk');
    expect(kinds).toContain('add');
    expect(kinds).toContain('del');
    expect(kinds).toContain('context');

    const added = parsed.hunks[0]!.lines.find((line) => line.text.includes('startedAt'));
    expect(added?.kind).toBe('add');
    expect(added?.newLine).toBe(6);

    const removed = parsed.hunks[0]!.lines.find((line) =>
      line.text.includes("import { MatchRequestSchema } from '@/lib/schemas/match';")
    );
    expect(removed?.kind).toBe('del');
    expect(removed?.oldLine).toBe(2);
  });

  it('adds intra-line highlights for paired changes', () => {
    const parsed = parseUnifiedDiff(SAMPLE);
    const add = parsed.hunks[0]!.lines.find(
      (line) => line.kind === 'add' && line.text.includes('MatchResponseSchema')
    );
    expect(add?.highlightRanges).toEqual([
      {
        start: 'import { MatchRequestSchema'.length,
        end: 'import { MatchRequestSchema, MatchResponseSchema'.length,
      },
    ]);
  });

  it('handles empty and fallback content', () => {
    expect(parseUnifiedDiff(undefined).isEmpty).toBe(true);
    expect(parseUnifiedDiff('(no changes)').isEmpty).toBe(true);
    expect(parseUnifiedDiff('Error: boom').isRawFallback).toBe(true);
  });

  it('buildHunkPatch produces valid unified patch with recounted lines', () => {
    const parsed = parseUnifiedDiff(SAMPLE);
    const hunk = parsed.hunks[0]!;
    const patch = buildHunkPatch('app/api/match/route.ts', hunk);
    expect(patch).toContain('--- a/app/api/match/route.ts');
    expect(patch).toContain('+++ b/app/api/match/route.ts');
    expect(patch).toMatch(/^@@ -\d+,\d+ \+\d+,\d+ @@/m);
    expect(patch).toContain('+import { MatchRequestSchema, MatchResponseSchema }');
    expect(patch).toContain('-import { MatchRequestSchema }');
  });
});

describe('computeChangedRanges', () => {
  it('marks only the changed segment', () => {
    const ranges = computeChangedRanges('hello world', 'hello there');
    expect(ranges).toEqual([{ start: 6, end: 11 }]);
    expect('hello world'.slice(6, 11)).toBe('world');
  });
});
