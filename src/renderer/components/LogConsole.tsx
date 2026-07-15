import { useLayoutEffect, useRef, useState } from 'react';
import type { LogLine } from '@shared/contracts/processes';

const STREAM_CLASS: Record<LogLine['stream'], string> = {
  stdout: 'out',
  stderr: 'err',
  system: 'sys',
};

export function LogConsole({ lines }: { lines: LogLine[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const [wrap, setWrap] = useState(true);

  useLayoutEffect(() => {
    if (follow && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, follow, wrap]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setFollow(atBottom);
  };

  const jumpToBottom = (): void => {
    setFollow(true);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  return (
    <div className="log-console">
      <div className="log-console__toolbar">
        <span className="log-console__count mono">{lines.length} lines</span>
        <div className="log-console__spacer" />
        <button
          type="button"
          className={['log-toggle', wrap ? 'active' : ''].join(' ')}
          onClick={() => setWrap((w) => !w)}
        >
          Wrap
        </button>
        <button
          type="button"
          className={['log-toggle', follow ? 'active' : ''].join(' ')}
          onClick={() => (follow ? setFollow(false) : jumpToBottom())}
        >
          Follow
        </button>
      </div>
      <div
        ref={scrollRef}
        className={['log-console__body', wrap ? 'wrap' : ''].join(' ')}
        onScroll={onScroll}
      >
        {lines.length === 0 ? (
          <div className="log-console__empty">No output yet.</div>
        ) : (
          lines.map((line) => (
            <div key={line.seq} className={['log-line', STREAM_CLASS[line.stream]].join(' ')}>
              {line.text || ' '}
            </div>
          ))
        )}
      </div>
      {!follow && (
        <button type="button" className="log-console__jump" onClick={jumpToBottom}>
          Jump to latest ↓
        </button>
      )}
    </div>
  );
}
