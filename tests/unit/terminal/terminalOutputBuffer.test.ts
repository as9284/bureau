import { describe, it, expect } from 'vitest';
import { createTerminalOutputBuffer } from '@main/terminal/TerminalOutputBuffer';

describe('createTerminalOutputBuffer', () => {
  it('accumulates chunks verbatim and numbers them from 1', () => {
    const buffer = createTerminalOutputBuffer();
    expect(buffer.push('one ')).toBe(1);
    expect(buffer.push('two')).toBe(2);
    expect(buffer.snapshot()).toEqual({ data: 'one two', seq: 2, truncated: false });
  });

  it('preserves escape sequences rather than stripping them', () => {
    const buffer = createTerminalOutputBuffer();
    buffer.push('[31mred[0m');
    expect(buffer.snapshot().data).toBe('[31mred[0m');
  });

  it('keeps the newest output and flags truncation once over the cap', () => {
    const buffer = createTerminalOutputBuffer(10);
    buffer.push('aaaaa');
    expect(buffer.snapshot().truncated).toBe(false);
    buffer.push('bbbbbbbbbb');
    const snapshot = buffer.snapshot();
    expect(snapshot.data.length).toBeLessThanOrEqual(10);
    expect(snapshot.data.endsWith('bbbbb')).toBe(true);
    expect(snapshot.truncated).toBe(true);
  });

  it('trims at a newline so a replay cannot start mid-escape-sequence', () => {
    const buffer = createTerminalOutputBuffer(20);
    // The cut lands inside the escape sequence on the first line; the newline just after
    // it is within the search window, so the buffer drops that whole line instead.
    buffer.push('[31mstale line[0m\nfresh line here\n');
    const { data } = buffer.snapshot();
    expect(data).toBe('fresh line here\n');
    expect(data.includes('[31m')).toBe(false);
  });

  it('falls back to an exact cut when no newline is near the cut point', () => {
    const buffer = createTerminalOutputBuffer(5);
    buffer.push('abcdefghij');
    expect(buffer.snapshot().data).toBe('fghij');
  });

  it('clears the data but keeps seq monotonic, so replay filtering stays correct', () => {
    const buffer = createTerminalOutputBuffer();
    buffer.push('first');
    buffer.clear();
    expect(buffer.snapshot()).toEqual({ data: '', seq: 1, truncated: false });
    expect(buffer.push('second')).toBe(2);
  });
});
