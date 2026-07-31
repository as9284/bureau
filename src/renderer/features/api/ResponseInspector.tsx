import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Button } from '@renderer/components/Button';
import { IconButton } from '@renderer/components/IconButton';
import { TextField } from '@renderer/components/TextField';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CollapseIcon,
  ExpandIcon,
  SearchIcon,
} from '@renderer/components/icons';
import { copyText } from '@renderer/lib/contextMenu';
import { useAppStore } from '@renderer/store/appStore';
import type { ApiSessionState } from '@renderer/store/apiStore';
import type {
  ApiAssertionResult,
  ApiResponsePreview,
  ApiScriptOutcome,
} from '@shared/contracts/apiWorkbench';
import { buildResponseMenuItems, formatResponseHeaders } from './apiContextMenu';

type ResponseTab = 'pretty' | 'raw' | 'headers' | 'timeline' | 'tests' | 'console';

const TAB_LABELS: Record<ResponseTab, string> = {
  pretty: 'Pretty',
  raw: 'Raw',
  headers: 'Headers',
  timeline: 'Timeline',
  tests: 'Tests',
  console: 'Console',
};

type Props = {
  session?: ApiSessionState;
  requestId: string;
  focusMode?: boolean;
  onToggleFocus?(): void;
};

export function ResponseInspector({ session, requestId, focusMode = false, onToggleFocus }: Props) {
  const openContextMenu = useAppStore((s) => s.openContextMenu);
  const [tab, setTab] = useState<ResponseTab>('pretty');
  const response = session?.response;
  const inFlight = session?.inFlight ?? false;

  const [forceFormat, setForceFormat] = useState(false);
  // Formatting is opted into per response, not once per session.
  useEffect(() => setForceFormat(false), [response?.sessionId]);
  const pretty = useMemo(() => formatPrettyBody(response, forceFormat), [response, forceFormat]);

  const scripts = response?.scripts ?? [];
  const tests = scripts.flatMap((outcome) => outcome.tests);
  const consoleEntries = scripts.flatMap((outcome) =>
    outcome.console.map((entry) => ({ ...entry, phase: outcome.phase, holder: outcome.holder.name }))
  );
  const failedTests = tests.filter((test) => !test.passed).length;
  const scriptErrors = scripts.filter((outcome) => outcome.errorCode);

  const visibleTabs = useMemo<ResponseTab[]>(() => {
    const list: ResponseTab[] = ['pretty', 'raw', 'headers', 'timeline'];
    // A script that never ran should not leave two empty tabs behind.
    if (scripts.length > 0) list.push('tests', 'console');
    return list;
  }, [scripts.length]);
  const activeTab = visibleTabs.includes(tab) ? tab : 'pretty';

  if (!session) {
    return (
      <div className="api-response api-response--empty">
        <div className="api-pane-empty">Send a request to inspect the response.</div>
      </div>
    );
  }

  if (inFlight) {
    return (
      <div className="api-response api-response--loading" role="status">
        <div className="tab-loading">
          Sending request…
          {session.phase ? <span className="mono"> {session.phase}</span> : null}
        </div>
      </div>
    );
  }

  if (session.error && !response) {
    return (
      <div className="api-response api-response--error" role="alert">
        <strong>Request failed</strong>
        <p>{session.error.message}</p>
      </div>
    );
  }

  if (!response) {
    return (
      <div className="api-response api-response--empty">
        <div className="api-pane-empty">No response yet.</div>
      </div>
    );
  }

  const openResponseMenu = (event: ReactMouseEvent): void => {
    if ((event.target as HTMLElement).closest('button, input, textarea')) return;
    event.preventDefault();
    event.stopPropagation();
    openContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: buildResponseMenuItems(response, {
        copyStatus: () => copyText(`${response.status} ${response.statusText}`),
        copyBody: () => copyText(response.bodyText ?? ''),
        copyHeaders: () => copyText(formatResponseHeaders(response)),
      }),
    });
  };

  return (
    <div className="api-response" onContextMenu={openResponseMenu}>
      <div className="api-response__summary">
        <span className={`api-response__status mono ${response.ok ? 'is-ok' : 'is-error'}`}>
          {response.status} {response.statusText}
        </span>
        <span className="api-response__timing mono">{response.timings.totalMs} ms</span>
        <span className="api-response__meta mono">
          {response.decodedBytes.toLocaleString()} bytes
          {response.truncated ? ' · truncated' : ''}
        </span>
        {response.redirects.length > 0 ? (
          <span className="api-response__meta mono">
            {response.redirects.length} redirect{response.redirects.length === 1 ? '' : 's'}
          </span>
        ) : null}
        <span className="api-response__summary-actions">
          {/* The context menu still has these; a first-time user should not have to find it. */}
          <Button
            size="compact"
            variant="quiet"
            onClick={() => copyText(formatResponseHeaders(response))}
          >
            Copy headers
          </Button>
          {onToggleFocus ? (
            <IconButton
              label={focusMode ? 'Exit response focus (Esc)' : 'Focus response'}
              onClick={onToggleFocus}
            >
              {focusMode ? <CollapseIcon /> : <ExpandIcon />}
            </IconButton>
          ) : null}
        </span>
      </div>

      {response.tlsExceptionApplied ? (
        <div className="api-banner api-banner--danger" role="alert">
          <strong>Certificate verification was disabled</strong>
          <span>
            This response was accepted without verifying the server certificate, so it could have
            been intercepted.
          </span>
        </div>
      ) : null}

      {response.graphqlErrors?.length ? (
        <div className="api-banner api-banner--danger" role="alert">
          <strong>
            GraphQL returned {response.graphqlErrors.length} error
            {response.graphqlErrors.length === 1 ? '' : 's'}
          </strong>
          <ul className="api-response__graphql-errors">
            {response.graphqlErrors.map((graphqlError, index) => (
              <li key={`${graphqlError.message}:${index}`}>
                <span>{graphqlError.message}</span>
                {graphqlError.path ? (
                  <span className="mono"> · at {graphqlError.path}</span>
                ) : null}
                {graphqlError.line !== undefined ? (
                  <span className="mono">
                    {' '}
                    · line {graphqlError.line}:{graphqlError.column ?? 0}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {scripts.length > 0 ? (
        <div
          className={
            failedTests > 0 || scriptErrors.length > 0
              ? 'api-banner api-banner--danger'
              : 'api-banner api-banner--success'
          }
          role={failedTests > 0 || scriptErrors.length > 0 ? 'alert' : 'status'}
        >
          <strong>
            {scriptErrors.length > 0
              ? `${scriptErrors.length} script${scriptErrors.length === 1 ? '' : 's'} failed`
              : failedTests > 0
                ? `${failedTests} of ${tests.length} test${tests.length === 1 ? '' : 's'} failed`
                : `${tests.length} test${tests.length === 1 ? '' : 's'} passed`}
          </strong>
          {scriptErrors.length > 0 ? <span>{scriptErrors[0].errorMessage}</span> : null}
        </div>
      ) : null}

      <div className="api-response__tabs" role="tablist" aria-label="Response inspector">
        {visibleTabs.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            className={activeTab === item ? 'is-active' : ''}
            aria-selected={activeTab === item}
            onClick={() => setTab(item)}
          >
            {TAB_LABELS[item]}
          </button>
        ))}
      </div>
      <div className="api-response__body" role="tabpanel">
        {activeTab === 'headers' ? (
          <table className="api-response__headers">
            <thead>
              <tr>
                <th>Name</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {response.headers.map((header) => (
                <tr key={`${requestId}:${header.name}:${header.value}`}>
                  <td className="mono">{header.name}</td>
                  <td className="mono">{header.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : activeTab === 'timeline' ? (
          <TimelineView response={response} />
        ) : activeTab === 'tests' ? (
          <TestsView tests={tests} scriptErrors={scriptErrors} />
        ) : activeTab === 'console' ? (
          <ConsoleView entries={consoleEntries} dropped={scripts.reduce((sum, o) => sum + o.consoleDropped, 0)} />
        ) : (
          <BodyView
            text={activeTab === 'pretty' ? pretty.text : (response.bodyText ?? response.bodyHexPreview ?? '')}
            deferred={activeTab === 'pretty' && pretty.deferred}
            onFormat={() => setForceFormat(true)}
          />
        )}
      </div>
    </div>
  );
}

function TimelineView({ response }: { response: ApiResponsePreview }) {
  const phases: Array<[string, number | undefined]> = [
    ['DNS', response.timings.dnsMs],
    ['Connect / TLS', response.timings.connectMs],
    ['First byte', response.timings.firstByteMs],
    ['Download', response.timings.downloadMs],
    ['Total', response.timings.totalMs],
  ];

  return (
    <div className="api-response__timeline">
      <table className="api-response__headers">
        <thead>
          <tr>
            <th>Phase</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          {phases.map(([label, value]) => (
            <tr key={label}>
              <td>{label}</td>
              <td className="mono">{value === undefined ? '—' : `${value} ms`}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {response.redirects.length > 0 ? (
        <>
          <h3 className="api-field-label">Redirects</h3>
          <ol className="api-response__redirects">
            {response.redirects.map((hop, index) => (
              <li key={`${hop.url}:${index}`} className="mono">
                {hop.status} → {hop.method} {hop.url}
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </div>
  );
}

/**
 * Above this, parsing and re-stringifying happens only on request.
 *
 * Measured on this machine: a 1 MiB JSON body costs ~9 ms to parse and re-stringify, 4 MiB ~34 ms,
 * and 10 MiB ~97 ms — and the *output* of a 10 MiB body is 17 MiB of text to hand to the DOM. The
 * first is tolerable on the render path; the last two are a visible stall, so a large body stays
 * raw until the user asks for it (§22).
 */
const AUTO_PRETTY_LIMIT_BYTES = 1024 * 1024;

/** How much body text reaches the DOM at once, regardless of format. */
const BODY_RENDER_LIMIT_BYTES = 2 * 1024 * 1024;

function looksJson(response: ApiResponsePreview, trimmed: string): boolean {
  return (
    Boolean(response.contentType?.includes('json')) ||
    trimmed.startsWith('{') ||
    trimmed.startsWith('[')
  );
}

function formatPrettyBody(
  response: ApiResponsePreview | undefined,
  force = false
): { text: string; deferred: boolean } {
  if (!response?.bodyText) return { text: response?.bodyHexPreview ?? '', deferred: false };
  if (response.bodyIsBinary) {
    return { text: response.bodyHexPreview ?? response.bodyText, deferred: false };
  }
  const trimmed = response.bodyText.trim();
  if (!trimmed) return { text: '', deferred: false };
  if (!looksJson(response, trimmed)) return { text: response.bodyText, deferred: false };
  if (!force && trimmed.length > AUTO_PRETTY_LIMIT_BYTES) {
    return { text: response.bodyText, deferred: true };
  }
  try {
    return { text: JSON.stringify(JSON.parse(trimmed), null, 2), deferred: false };
  } catch {
    return { text: response.bodyText, deferred: false };
  }
}

/**
 * Assertion results. A script that failed outright is shown above its assertions: the tests that
 * never got to run are not the same as tests that passed.
 */
function TestsView({
  tests,
  scriptErrors,
}: {
  tests: ApiAssertionResult[];
  scriptErrors: ApiScriptOutcome[];
}) {
  if (tests.length === 0 && scriptErrors.length === 0) {
    return <div className="api-pane-empty">This script registered no tests.</div>;
  }
  return (
    <div className="api-tests">
      {scriptErrors.map((outcome, index) => (
        <div key={`${outcome.holder.id}:${index}`} className="api-banner api-banner--danger" role="alert">
          <strong>
            {outcome.holder.name} · {outcome.phase === 'pre-request' ? 'pre-request' : 'tests'}
          </strong>
          <span>
            {outcome.errorMessage}
            {outcome.errorLine === undefined ? '' : ` (line ${outcome.errorLine})`}
          </span>
        </div>
      ))}
      <ul className="api-tests__list">
        {tests.map((test, index) => (
          <li key={`${test.name}:${index}`} className={test.passed ? 'api-test' : 'api-test is-failed'}>
            <span className={test.passed ? 'state-dot success' : 'state-dot danger'} />
            <span className="api-test__name">{test.name}</span>
            {test.message ? <span className="api-test__message mono">{test.message}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConsoleView({
  entries,
  dropped,
}: {
  entries: Array<{ level: string; text: string; truncated?: boolean; phase: string; holder: string }>;
  dropped: number;
}) {
  if (entries.length === 0 && dropped === 0) {
    return <div className="api-pane-empty">This script logged nothing.</div>;
  }
  return (
    <div className="api-script-console">
      {entries.map((entry, index) => (
        <div key={index} className={`api-script-console__line is-${entry.level}`}>
          <span className="api-script-console__origin mono">
            {entry.holder} · {entry.phase === 'pre-request' ? 'pre' : 'test'}
          </span>
          <span className="api-script-console__text mono">
            {entry.text}
            {entry.truncated ? ' …' : ''}
          </span>
        </div>
      ))}
      {dropped > 0 ? (
        <div className="api-script-console__dropped">
          {dropped} more line{dropped === 1 ? '' : 's'} were dropped by the console limit.
        </div>
      ) : null}
    </div>
  );
}

/**
 * Renders a bounded slice of the body. A 10 MiB response becomes a ~17 MiB formatted string, and
 * handing that to the DOM in one node is the stall §22 warns about — so the view says how much it
 * is showing rather than quietly rendering everything or quietly hiding it.
 */
/** Highlighting every hit in a multi-megabyte body is the stall this avoids. */
const MAX_HIGHLIGHTED_MATCHES = 500;

function findMatches(haystack: string, needle: string): number[] {
  if (!needle) return [];
  const found: number[] = [];
  const lowerHaystack = haystack.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  let index = lowerHaystack.indexOf(lowerNeedle);
  while (index !== -1 && found.length < MAX_HIGHLIGHTED_MATCHES) {
    found.push(index);
    index = lowerHaystack.indexOf(lowerNeedle, index + lowerNeedle.length);
  }
  return found;
}

function BodyView({
  text,
  deferred,
  onFormat,
}: {
  text: string;
  deferred: boolean;
  onFormat(): void;
}) {
  const [query, setQuery] = useState('');
  const [activeMatch, setActiveMatch] = useState(0);
  const [wrap, setWrap] = useState(true);
  const activeRef = useRef<HTMLSpanElement>(null);

  const truncated = text.length > BODY_RENDER_LIMIT_BYTES;
  const visible = truncated ? text.slice(0, BODY_RENDER_LIMIT_BYTES) : text;
  const matches = useMemo(() => findMatches(visible, query.trim()), [visible, query]);

  useEffect(() => setActiveMatch(0), [query]);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'auto' });
  }, [activeMatch, matches.length]);

  const step = (delta: number): void => {
    if (matches.length === 0) return;
    setActiveMatch((current) => (current + delta + matches.length) % matches.length);
  };

  return (
    <div className="api-response__body-view">
      {deferred ? (
        <div className="api-banner api-banner--warning" role="status">
          <strong>This body is too large to format automatically</strong>
          <span>
            {(text.length / 1024 / 1024).toFixed(1)} MiB of JSON. It is shown as received.
          </span>
          <Button size="compact" variant="secondary" onClick={onFormat}>
            Format anyway
          </Button>
        </div>
      ) : null}

      <div className="api-response__find">
        <div className="api-response__find-field">
          <span className="api-response__find-icon" aria-hidden="true">
            <SearchIcon size={14} />
          </span>
          <TextField
            type="search"
            aria-label="Find in response body"
            placeholder="Find in body"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              step(event.shiftKey ? -1 : 1);
            }}
          />
        </div>
        {query.trim() ? (
          <span className="api-response__find-count mono" role="status">
            {matches.length === 0
              ? 'No matches'
              : `${activeMatch + 1}/${matches.length}${matches.length === MAX_HIGHLIGHTED_MATCHES ? '+' : ''}`}
          </span>
        ) : null}
        <IconButton label="Previous match" disabled={matches.length === 0} onClick={() => step(-1)}>
          <ArrowUpIcon size={14} />
        </IconButton>
        <IconButton label="Next match" disabled={matches.length === 0} onClick={() => step(1)}>
          <ArrowDownIcon size={14} />
        </IconButton>
        <Button
          size="compact"
          variant="quiet"
          aria-pressed={wrap}
          onClick={() => setWrap((current) => !current)}
        >
          {wrap ? 'No wrap' : 'Wrap'}
        </Button>
        <Button size="compact" variant="quiet" onClick={() => copyText(text)}>
          Copy body
        </Button>
      </div>

      <pre className={`api-response__text mono${wrap ? '' : ' is-nowrap'}`}>
        {matches.length === 0
          ? visible
          : renderMatches(visible, query.trim().length, matches, activeMatch, activeRef)}
      </pre>
      {truncated ? (
        <p className="api-field-hint">
          Showing the first {(BODY_RENDER_LIMIT_BYTES / 1024 / 1024).toFixed(0)} MiB of{' '}
          {(text.length / 1024 / 1024).toFixed(1)} MiB.
        </p>
      ) : null}
    </div>
  );
}

function renderMatches(
  text: string,
  length: number,
  matches: number[],
  activeMatch: number,
  activeRef: RefObject<HTMLSpanElement | null>
) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [index, start] of matches.entries()) {
    if (start > cursor) parts.push(text.slice(cursor, start));
    const isActive = index === activeMatch;
    parts.push(
      <span
        key={`match-${start}`}
        ref={isActive ? activeRef : undefined}
        className={`api-response__match${isActive ? ' is-active' : ''}`}
      >
        {text.slice(start, start + length)}
      </span>
    );
    cursor = start + length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}
