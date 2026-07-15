import type { LogLine, LogStream } from '@shared/contracts/processes';

export type LogRingBuffer = {
  push(stream: LogStream, text: string): LogLine;
  snapshot(): { lines: LogLine[]; truncated: boolean };
  clear(): void;
};

/** Bounded, monotonic-seq log buffer. Drops oldest lines past `maxLines`. */
export function createLogRingBuffer(maxLines = 5000): LogRingBuffer {
  let lines: LogLine[] = [];
  let seq = 0;
  let truncated = false;

  function push(stream: LogStream, text: string): LogLine {
    const line: LogLine = { seq: seq++, stream, text, at: new Date().toISOString() };
    lines.push(line);
    if (lines.length > maxLines) {
      lines = lines.slice(lines.length - maxLines);
      truncated = true;
    }
    return line;
  }

  function snapshot(): { lines: LogLine[]; truncated: boolean } {
    return { lines: [...lines], truncated };
  }

  function clear(): void {
    lines = [];
    truncated = false;
  }

  return { push, snapshot, clear };
}

/**
 * Splits a byte stream into display lines, handling partial trailing lines and
 * carriage-return progress rewrites (keeps text after the last \r on a line).
 */
export function createLineAssembler() {
  let pending = '';

  function collapseCarriageReturns(line: string): string {
    const idx = line.lastIndexOf('\r');
    return idx === -1 ? line : line.slice(idx + 1);
  }

  function feed(chunk: string): string[] {
    pending += chunk;
    const parts = pending.split('\n');
    pending = parts.pop() ?? '';
    return parts.map((p) => collapseCarriageReturns(p.replace(/\r$/, '')));
  }

  function flush(): string[] {
    if (pending.length === 0) return [];
    const remaining = collapseCarriageReturns(pending);
    pending = '';
    return remaining.length > 0 ? [remaining] : [];
  }

  return { feed, flush };
}
