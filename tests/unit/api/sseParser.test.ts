import { describe, expect, it } from 'vitest';
import { createSseParser, type SseEvent } from '@main/api/SseTransport';

function collect() {
  const events: SseEvent[] = [];
  const comments: string[] = [];
  const retries: number[] = [];
  const parser = createSseParser({
    onEvent: (event) => events.push(event),
    onComment: (text) => comments.push(text),
    onRetry: (ms) => retries.push(ms),
    onId: () => undefined,
  });
  return { parser, events, comments, retries };
}

describe('SSE parser', () => {
  it('parses a simple event', () => {
    const { parser, events } = collect();
    parser.push('data: hello\n\n');
    expect(events).toEqual([{ eventName: undefined, data: 'hello', eventId: undefined }]);
  });

  it('joins multiline data with newlines', () => {
    const { parser, events } = collect();
    parser.push('data: line one\ndata: line two\ndata: line three\n\n');
    expect(events[0].data).toBe('line one\nline two\nline three');
  });

  it('reassembles events split across arbitrary chunk boundaries', () => {
    const { parser, events } = collect();
    const payload = 'event: tick\ndata: {"n":1}\nid: 42\n\nevent: tick\ndata: {"n":2}\n\n';
    // One byte at a time is the worst case a socket can produce.
    for (const char of payload) parser.push(char);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ eventName: 'tick', data: '{"n":1}', eventId: '42' });
    // The id persists to later events until replaced, per the EventSource model.
    expect(events[1].data).toBe('{"n":2}');
  });

  it('handles CRLF and bare CR line endings', () => {
    const { parser, events } = collect();
    parser.push('data: crlf\r\n\r\n');
    parser.push('data: cr\r\r');
    expect(events.map((event) => event.data)).toEqual(['crlf', 'cr']);
  });

  it('surfaces comments and retry directives without emitting events', () => {
    const { parser, events, comments, retries } = collect();
    parser.push(': keep-alive\n\nretry: 5000\n\n');
    expect(comments).toEqual(['keep-alive']);
    expect(retries).toEqual([5000]);
    expect(events).toHaveLength(0);
  });

  it('treats a field with no space after the colon the same as one with a space', () => {
    const { parser, events } = collect();
    parser.push('data:tight\n\n');
    expect(events[0].data).toBe('tight');
  });

  it('ignores unknown fields and non-numeric retry values', () => {
    const { parser, events, retries } = collect();
    parser.push('unknown: whatever\nretry: soon\ndata: kept\n\n');
    expect(retries).toEqual([]);
    expect(events[0].data).toBe('kept');
  });

  it('flushes a trailing block that was never terminated by a blank line', () => {
    const { parser, events } = collect();
    parser.push('data: partial');
    expect(events).toHaveLength(0);
    parser.end();
    expect(events[0].data).toBe('partial');
  });

  it('tracks the last event id for reconnect', () => {
    const { parser } = collect();
    parser.push('id: abc\ndata: x\n\n');
    expect(parser.lastEventId()).toBe('abc');
  });
});
