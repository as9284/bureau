import { describe, it, expect } from 'vitest';
import { createLineAssembler, createLogRingBuffer } from '@main/processes/LogRingBuffer';

describe('createLogRingBuffer', () => {
  it('assigns monotonic seq and preserves order', () => {
    const buf = createLogRingBuffer();
    buf.push('stdout', 'a');
    buf.push('stderr', 'b');
    const { lines } = buf.snapshot();
    expect(lines.map((l) => l.text)).toEqual(['a', 'b']);
    expect(lines.map((l) => l.seq)).toEqual([0, 1]);
    expect(lines[1].stream).toBe('stderr');
  });

  it('bounds the buffer and flags truncation', () => {
    const buf = createLogRingBuffer(3);
    for (let i = 0; i < 5; i++) buf.push('stdout', `line-${i}`);
    const { lines, truncated } = buf.snapshot();
    expect(truncated).toBe(true);
    expect(lines.map((l) => l.text)).toEqual(['line-2', 'line-3', 'line-4']);
  });
});

describe('createLineAssembler', () => {
  it('splits on newlines and buffers partial trailing lines', () => {
    const asm = createLineAssembler();
    expect(asm.feed('hello\nwor')).toEqual(['hello']);
    expect(asm.feed('ld\n')).toEqual(['world']);
    expect(asm.flush()).toEqual([]);
  });

  it('collapses carriage-return progress rewrites', () => {
    const asm = createLineAssembler();
    expect(asm.feed('10%\r50%\r100%\n')).toEqual(['100%']);
  });

  it('flushes a remaining partial line', () => {
    const asm = createLineAssembler();
    asm.feed('no newline yet');
    expect(asm.flush()).toEqual(['no newline yet']);
  });
});
