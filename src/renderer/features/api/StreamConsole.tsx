import { useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useTailWindow } from './useTailWindow';
import { Button } from '@renderer/components/Button';
import { Dropdown } from '@renderer/components/Dropdown';
import { TextArea } from '@renderer/components/TextArea';
import { copyText } from '@renderer/lib/contextMenu';
import { useAppStore } from '@renderer/store/appStore';
import type { ApiSessionState } from '@renderer/store/apiStore';
import type { ApiStreamEntry } from '@shared/contracts/apiWorkbench';
import { buildStreamEntryMenuItems, formatStreamLine } from './apiContextMenu';

type Props = {
  protocol: 'websocket' | 'sse';
  session?: ApiSessionState;
  onConnect(): void;
  onDisconnect(sessionId: string): void;
  onSend(sessionId: string, format: 'text' | 'json' | 'binary-hex', payload: string): void;
  onTogglePause(sessionId: string, paused: boolean): void;
  onClear(sessionId: string): void;
};

const STATUS_LABEL: Record<string, string> = {
  connecting: 'Connecting',
  open: 'Connected',
  closing: 'Closing',
  closed: 'Disconnected',
  error: 'Error',
  reconnecting: 'Reconnecting',
};

/**
 * Shared transcript surface for WebSocket and SSE. Colour is always paired with text, and every
 * machine-generated value (timestamps, byte counts, frames) uses the mono token.
 */
export function StreamConsole({
  protocol,
  session,
  onConnect,
  onDisconnect,
  onSend,
  onTogglePause,
  onClear,
}: Props) {
  const [message, setMessage] = useState('');
  const [format, setFormat] = useState<'text' | 'json' | 'binary-hex'>('text');

  const status = session?.streamStatus ?? 'closed';
  const connected = status === 'open';
  const entries = session?.entries ?? [];
  // The ring holds up to 5,000 entries; rendering them all is thousands of DOM rows for a
  // transcript that is read from the bottom.
  const transcript = useTailWindow(entries, 200);
  const paused = session?.paused ?? false;

  return (
    <div className="api-stream">
      <div className="api-stream__toolbar">
        <span className={`api-stream__status api-stream__status--${status}`}>
          <span className="api-stream__dot" aria-hidden="true" />
          {STATUS_LABEL[status] ?? status}
        </span>
        {session?.subprotocol ? (
          <span className="api-stream__meta mono">subprotocol: {session.subprotocol}</span>
        ) : null}
        {session?.closeCode !== undefined ? (
          <span className="api-stream__meta mono">
            close {session.closeCode}
            {session.closeReason ? ` · ${session.closeReason}` : ''}
          </span>
        ) : null}
        {session?.dropped ? (
          <span className="api-stream__meta api-stream__meta--warning mono">
            {session.dropped} dropped
          </span>
        ) : null}

        <span className="api-stream__actions">
          {connected && session ? (
            <>
              <Button size="compact" variant="secondary" onClick={() => onTogglePause(session.sessionId, !paused)}>
                {paused ? 'Resume display' : 'Pause display'}
              </Button>
              <Button size="compact" variant="secondary" onClick={() => onDisconnect(session.sessionId)}>
                Disconnect
              </Button>
            </>
          ) : (
            <Button size="compact" variant="primary" onClick={onConnect}>
              Connect
            </Button>
          )}
          {session && entries.length > 0 ? (
            <Button size="compact" variant="ghost" onClick={() => onClear(session.sessionId)}>
              Clear
            </Button>
          ) : null}
        </span>
      </div>

      {paused ? (
        <p className="api-stream__notice" role="status">
          Display paused. The connection stays open and events keep buffering in the background.
        </p>
      ) : null}

      {session?.error ? (
        <div className="api-banner api-banner--danger" role="alert">
          <strong>{protocol === 'sse' ? 'Stream error' : 'Connection error'}</strong>
          <span>{session.error.message}</span>
        </div>
      ) : null}

      <div className="api-stream__transcript" role="log" aria-label={`${protocol} transcript`}>
        {entries.length === 0 ? (
          <div className="api-pane-empty">
            {connected ? 'Connected. Waiting for events.' : 'Not connected yet.'}
          </div>
        ) : (
          <>
            {transcript.hidden > 0 ? (
              <div className="api-stream__more">
                <span>
                  {transcript.hidden} earlier entr{transcript.hidden === 1 ? 'y' : 'ies'} not shown
                </span>
                <Button size="compact" variant="quiet" onClick={transcript.showMore}>
                  Show more
                </Button>
                <Button size="compact" variant="quiet" onClick={transcript.showAll}>
                  Show all
                </Button>
              </div>
            ) : null}
            {transcript.visible.map((entry) => (
              <StreamRow key={entry.entryId} entry={entry} />
            ))}
          </>
        )}
      </div>

      {protocol === 'websocket' ? (
        <div className="api-stream__composer">
          <Dropdown
            label="Message format"
            value={format}
            options={[
              { value: 'text', label: 'Text' },
              { value: 'json', label: 'JSON' },
              { value: 'binary-hex', label: 'Binary (hex)' },
            ]}
            onChange={(value) => setFormat(value as typeof format)}
          />
          <TextArea
            label="Message"
            className="mono"
            rows={3}
            value={message}
            disabled={!connected}
            onChange={(event) => setMessage(event.target.value)}
          />
          <Button
            variant="primary"
            size="compact"
            disabled={!connected || !message.trim() || !session}
            onClick={() => {
              if (!session) return;
              onSend(session.sessionId, format, message);
              setMessage('');
            }}
          >
            Send message
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function StreamRow({ entry }: { entry: ApiStreamEntry }) {
  const openContextMenu = useAppStore((s) => s.openContextMenu);
  const time = entry.at.slice(11, 23);
  const label =
    entry.kind === 'sse-event'
      ? (entry.eventName ?? 'message')
      : entry.kind === 'close'
        ? `close ${entry.code ?? ''}`
        : entry.kind;

  const openEntryMenu = (event: ReactMouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    openContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: buildStreamEntryMenuItems(entry, {
        copyPayload: () => copyText(entry.text ?? entry.reason ?? ''),
        copyLine: () => copyText(formatStreamLine(entry)),
      }),
    });
  };

  return (
    <div
      className={`api-stream__row api-stream__row--${entry.direction}`}
      onContextMenu={openEntryMenu}
    >
      <span className="api-stream__time mono">{time}</span>
      <span className="api-stream__direction mono">
        {entry.direction === 'out' ? '↑' : entry.direction === 'in' ? '↓' : '•'}
      </span>
      <span className="api-stream__kind mono">{label}</span>
      <span className="api-stream__payload mono">
        {entry.bodyId ? (
          <em>binary payload stored ({entry.byteLength?.toLocaleString() ?? '?'} bytes)</em>
        ) : (
          (entry.text ?? entry.reason ?? '')
        )}
        {entry.truncated ? <em className="api-stream__truncated"> — truncated</em> : null}
      </span>
      {entry.byteLength !== undefined && !entry.bodyId ? (
        <span className="api-stream__bytes mono">{entry.byteLength.toLocaleString()} B</span>
      ) : null}
    </div>
  );
}
