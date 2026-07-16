import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useAppStore, type ContextMenuItem } from '../../store/appStore';
import { XtermSurface, type XtermTransport } from '../../components/XtermSurface';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { StateDot } from '../../components/StateDot';
import { TextField } from '../../components/TextField';
import { ChevronDownIcon, CloseIcon } from '../../components/icons';
import type { TerminalDataEvent, TerminalSession } from '@shared/contracts/terminal';

/**
 * One live session's xterm view. Only the active session is mounted — the pty keeps
 * running in main either way, and the replay buffer restores the screen on return, so
 * there is nothing to gain from keeping hidden panes (which cannot be fitted anyway).
 */
function SessionPane({ projectId, sessionId }: { projectId: string; sessionId: string }) {
  const transport = useMemo<XtermTransport>(
    () => ({
      onInput: (data) => {
        void window.bureau.terminal.write({ projectId, sessionId, data });
      },
      subscribe: (write) => {
        // Subscribe *before* asking for the replay buffer and queue whatever lands in
        // between. The snapshot carries the seq of the last chunk it contains, so replaying
        // only the queued chunks newer than that closes the gap with no gap and no
        // double-write — rather than assuming the fetch wins the race.
        let ready = false;
        let cancelled = false;
        let queued: TerminalDataEvent[] = [];
        const unsubscribe = window.bureau.terminal.onData((event) => {
          if (event.projectId !== projectId || event.sessionId !== sessionId) return;
          if (ready) write(event.data);
          else queued.push(event);
        });
        void window.bureau.terminal.getBuffer({ projectId, sessionId }).then((buffer) => {
          if (cancelled) return;
          write(buffer.data);
          for (const event of queued) if (event.seq > buffer.seq) write(event.data);
          queued = [];
          ready = true;
        });
        return () => {
          cancelled = true;
          unsubscribe();
        };
      },
      onResize: (cols, rows) => {
        void window.bureau.terminal.resize({ projectId, sessionId, cols, rows });
      },
    }),
    [projectId, sessionId]
  );

  return <XtermSurface transport={transport} active autoFocus />;
}

function SessionChip({
  session,
  selected,
  onSelect,
  onClose,
  onRename,
}: {
  session: TerminalSession;
  selected: boolean;
  onSelect(): void;
  onClose(): void;
  onRename(title: string): void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = (): void => {
    setEditing(false);
    const title = draft.trim();
    if (title && title !== session.title) onRename(title);
    else setDraft(session.title);
  };

  if (editing) {
    return (
      <div className="terminal-chip editing">
        <TextField
          ref={inputRef}
          value={draft}
          aria-label={`Rename ${session.title}`}
          maxLength={60}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setDraft(session.title);
              setEditing(false);
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className={['terminal-chip', selected ? 'selected' : ''].join(' ')}>
      <button
        type="button"
        className="terminal-chip__label"
        role="tab"
        aria-selected={selected}
        onClick={onSelect}
        onDoubleClick={() => {
          setDraft(session.title);
          setEditing(true);
        }}
        title={`${session.title} — ${session.cwdLabel}`}
      >
        <StateDot status={session.status} />
        <span className="terminal-chip__title">{session.title}</span>
        {session.cwdLabel !== '.' && (
          <span className="terminal-chip__cwd mono">{session.cwdLabel}</span>
        )}
        {session.status === 'exited' && (
          <span className="terminal-chip__exit mono">exit {session.exitCode ?? 0}</span>
        )}
      </button>
      <IconButton label={`Close ${session.title}`} onClick={onClose}>
        <CloseIcon size={12} />
      </IconButton>
    </div>
  );
}

export function TerminalTab({ projectId }: { projectId: string }) {
  const state = useAppStore((s) => s.terminalByProject[projectId]);
  const nestedRoots = useAppStore(
    (s) => s.projects.find((p) => p.projectId === projectId)?.nestedRoots
  );
  const ensureTerminalProject = useAppStore((s) => s.ensureTerminalProject);
  const createTerminalSession = useAppStore((s) => s.createTerminalSession);
  const closeTerminalSession = useAppStore((s) => s.closeTerminalSession);
  const renameTerminalSession = useAppStore((s) => s.renameTerminalSession);
  const setActiveTerminalSession = useAppStore((s) => s.setActiveTerminalSession);
  const openInExternalTerminal = useAppStore((s) => s.openInExternalTerminal);
  const openContextMenu = useAppStore((s) => s.openContextMenu);

  useEffect(() => {
    if (!state) void ensureTerminalProject(projectId);
  }, [projectId, state, ensureTerminalProject]);

  if (!state || (state.loading && state.sessions.length === 0)) {
    return <div className="tab-loading">Loading…</div>;
  }

  const { sessions, shells, ptyAvailable, activeSessionId } = state;
  const active = sessions.find((session) => session.sessionId === activeSessionId);

  // Anchored under the caret via the event target, so the menu does not need a ref into
  // the IconButton primitive.
  const openShellMenu = (event: MouseEvent<HTMLButtonElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    const items: ContextMenuItem[] = shells.map((shell) => ({
      type: 'item',
      label: `New ${shell.label} session`,
      onSelect: () => void createTerminalSession(projectId, { shellId: shell.id }),
    }));
    for (const root of nestedRoots ?? []) {
      if (items.length === shells.length) items.push({ type: 'separator' });
      items.push({
        type: 'item',
        label: `New session in ${root}`,
        onSelect: () => void createTerminalSession(projectId, { rootRelative: root }),
      });
    }
    openContextMenu({ x: rect.left, y: rect.bottom, items });
  };

  const externalButton = (
    <Button variant="ghost" onClick={() => void openInExternalTerminal()}>
      Open external terminal
    </Button>
  );

  // node-pty's native binding failed to load for this Electron build: no session can ever
  // start, so say so and offer the OS terminal rather than showing an empty tab.
  if (!ptyAvailable) {
    return (
      <div className="terminal-tab">
        <div className="terminal-tab__header">
          <span className="terminal-tab__title">Terminal</span>
        </div>
        <div className="empty-state">
          <h1>The built-in terminal is unavailable</h1>
          <p>
            Bureau could not load node-pty for this build, so it cannot host a shell. Your
            system terminal still works.
          </p>
          {externalButton}
        </div>
      </div>
    );
  }

  return (
    <div className="terminal-tab">
      <div className="terminal-tab__header">
        <span className="terminal-tab__title">Terminal</span>
        <div className="terminal-tab__actions">
          {externalButton}
          <div className="terminal-tab__new">
            <Button
              variant="secondary"
              disabled={shells.length === 0}
              onClick={() => void createTerminalSession(projectId)}
            >
              New session
            </Button>
            <IconButton
              label="Choose a shell"
              disabled={shells.length === 0}
              onClick={openShellMenu}
            >
              <ChevronDownIcon size={12} />
            </IconButton>
          </div>
        </div>
      </div>

      {state.error && (
        <div className="terminal-tab__error" role="alert">
          <span>{state.error.message}</span>
          <Button variant="ghost" onClick={() => void ensureTerminalProject(projectId)}>
            Retry
          </Button>
        </div>
      )}

      {sessions.length > 0 && (
        <div className="terminal-tab__strip" role="tablist" aria-label="Terminal sessions">
          {sessions.map((session) => (
            <SessionChip
              key={session.sessionId}
              session={session}
              selected={session.sessionId === activeSessionId}
              onSelect={() => setActiveTerminalSession(projectId, session.sessionId)}
              onClose={() => void closeTerminalSession(projectId, session.sessionId)}
              onRename={(title) => void renameTerminalSession(projectId, session.sessionId, title)}
            />
          ))}
        </div>
      )}

      <div className="terminal-tab__body">
        {active ? (
          <SessionPane
            key={active.sessionId}
            projectId={projectId}
            sessionId={active.sessionId}
          />
        ) : shells.length === 0 ? (
          <div className="empty-state">
            <h1>No shell found</h1>
            <p>
              Bureau could not find PowerShell, Git Bash, or another supported shell on this
              machine.
            </p>
          </div>
        ) : (
          <div className="empty-state">
            <h1>No terminal sessions</h1>
            <p>Open a shell in this project&rsquo;s folder without leaving Bureau.</p>
            <Button variant="secondary" onClick={() => void createTerminalSession(projectId)}>
              New session
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
