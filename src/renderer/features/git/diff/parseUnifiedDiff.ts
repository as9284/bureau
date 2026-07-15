export type DiffLineKind = 'context' | 'add' | 'del' | 'hunk' | 'meta';

export type ParsedDiffLine = {
  kind: DiffLineKind;
  text: string;
  oldLine?: number;
  newLine?: number;
  /** Character ranges within `text` that changed (intra-line highlight). */
  highlightRanges?: Array<{ start: number; end: number }>;
};

export type ParsedDiffHunk = {
  header: string;
  oldStart: number;
  newStart: number;
  lines: ParsedDiffLine[];
};

export type ParsedDiff = {
  hunks: ParsedDiffHunk[];
  isEmpty: boolean;
  isRawFallback: boolean;
  raw?: string;
};

const HUNK_RE = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s@@(.*)$/;

function isMetaLine(line: string): boolean {
  return (
    line.startsWith('diff --git') ||
    line.startsWith('index ') ||
    line.startsWith('--- ') ||
    line.startsWith('+++ ') ||
    line.startsWith('new file mode') ||
    line.startsWith('deleted file mode') ||
    line.startsWith('old mode') ||
    line.startsWith('new mode') ||
    line.startsWith('similarity index') ||
    line.startsWith('rename from') ||
    line.startsWith('rename to') ||
    line.startsWith('copy from') ||
    line.startsWith('copy to') ||
    line.startsWith('Binary files') ||
    line.startsWith('\\ No newline')
  );
}

/** Find changed character ranges in `source` relative to `other` via shared prefix/suffix. */
export function computeChangedRanges(
  source: string,
  other: string
): Array<{ start: number; end: number }> {
  if (source === other) {
    return [];
  }
  if (!source) {
    return [];
  }
  if (!other) {
    return [{ start: 0, end: source.length }];
  }

  let start = 0;
  const minLen = Math.min(source.length, other.length);
  while (start < minLen && source[start] === other[start]) {
    start += 1;
  }

  let endSource = source.length;
  let endOther = other.length;
  while (endSource > start && endOther > start && source[endSource - 1] === other[endOther - 1]) {
    endSource -= 1;
    endOther -= 1;
  }

  if (start >= endSource) {
    return [];
  }

  return [{ start, end: endSource }];
}

function applyIntraLineHighlights(lines: ParsedDiffLine[]): void {
  let index = 0;
  while (index < lines.length) {
    const delBlock: ParsedDiffLine[] = [];
    while (index < lines.length && lines[index]?.kind === 'del') {
      delBlock.push(lines[index]!);
      index += 1;
    }
    const addBlock: ParsedDiffLine[] = [];
    while (index < lines.length && lines[index]?.kind === 'add') {
      addBlock.push(lines[index]!);
      index += 1;
    }

    if (delBlock.length > 0 && addBlock.length > 0) {
      const pairCount = Math.min(delBlock.length, addBlock.length);
      for (let p = 0; p < pairCount; p += 1) {
        const delLine = delBlock[p]!;
        const addLine = addBlock[p]!;
        delLine.highlightRanges = computeChangedRanges(delLine.text, addLine.text);
        addLine.highlightRanges = computeChangedRanges(addLine.text, delLine.text);
      }
    }

    if (delBlock.length === 0 && addBlock.length === 0) {
      index += 1;
    }
  }
}

export function parseUnifiedDiff(raw: string | undefined): ParsedDiff {
  if (!raw || raw.trim().length === 0 || raw === '(no changes)') {
    return { hunks: [], isEmpty: true, isRawFallback: false };
  }

  if (raw.startsWith('Error:')) {
    return { hunks: [], isEmpty: false, isRawFallback: true, raw };
  }

  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const hunks: ParsedDiffHunk[] = [];
  let current: ParsedDiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;
  let sawHunk = false;

  for (const line of lines) {
    if (isMetaLine(line)) {
      continue;
    }

    const hunkMatch = HUNK_RE.exec(line);
    if (hunkMatch) {
      sawHunk = true;
      if (current) {
        applyIntraLineHighlights(current.lines);
        hunks.push(current);
      }
      oldLine = Number(hunkMatch[1]);
      newLine = Number(hunkMatch[3]);
      current = {
        header: line,
        oldStart: oldLine,
        newStart: newLine,
        lines: [
          {
            kind: 'hunk',
            text: line,
          },
        ],
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith('+')) {
      current.lines.push({
        kind: 'add',
        text: line.slice(1),
        newLine: newLine,
      });
      newLine += 1;
      continue;
    }

    if (line.startsWith('-')) {
      current.lines.push({
        kind: 'del',
        text: line.slice(1),
        oldLine: oldLine,
      });
      oldLine += 1;
      continue;
    }

    if (line.startsWith(' ') || line.length === 0) {
      const text = line.startsWith(' ') ? line.slice(1) : line;
      current.lines.push({
        kind: 'context',
        text,
        oldLine,
        newLine,
      });
      oldLine += 1;
      newLine += 1;
    }
  }

  if (current) {
    applyIntraLineHighlights(current.lines);
    hunks.push(current);
  }

  if (!sawHunk) {
    return { hunks: [], isEmpty: false, isRawFallback: true, raw };
  }

  return { hunks, isEmpty: hunks.length === 0, isRawFallback: false };
}

/** Build a unified patch for a single hunk suitable for applyHunk. */
export function buildHunkPatch(path: string, hunk: ParsedDiffHunk): string {
  let oldCount = 0;
  let newCount = 0;
  const bodyLines: string[] = [];

  for (const line of hunk.lines) {
    if (line.kind === 'hunk') continue;
    if (line.kind === 'del') {
      bodyLines.push(`-${line.text}`);
      oldCount += 1;
    } else if (line.kind === 'add') {
      bodyLines.push(`+${line.text}`);
      newCount += 1;
    } else if (line.kind === 'context') {
      bodyLines.push(` ${line.text}`);
      oldCount += 1;
      newCount += 1;
    }
  }

  const oldStart = hunk.oldStart;
  const newStart = hunk.newStart;
  const header = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;

  return [`--- a/${path}`, `+++ b/${path}`, header, ...bodyLines].join('\n');
}
