import { useMemo } from 'react';
import { Button } from '@renderer/components/Button';
import { Dropdown } from '@renderer/components/Dropdown';
import { TextField } from '@renderer/components/TextField';
import type { ApiDraftPatch } from '@renderer/store/apiStore';
import type { ApiProtocol, ApiRequestDefinition } from '@shared/contracts/apiWorkbench';
import { DEFAULT_GRAPHQL_OPTIONS } from './apiFormat';
import { VariableField } from './VariableField';
import { scanTemplate, type TemplateScan, type VariableScope } from './variablePreview';

const STANDARD_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE'] as const;

type MethodOption = (typeof STANDARD_METHODS)[number] | 'CUSTOM';

const PROTOCOL_OPTIONS: Array<{ value: ApiProtocol; label: string }> = [
  { value: 'http', label: 'HTTP' },
  { value: 'graphql', label: 'GraphQL' },
  { value: 'websocket', label: 'WebSocket' },
  { value: 'sse', label: 'SSE' },
];

const URL_PLACEHOLDER: Record<ApiProtocol, string> = {
  http: 'https://api.example.com/resource',
  graphql: 'https://api.example.com/graphql',
  websocket: 'wss://api.example.com/socket',
  sse: 'https://api.example.com/events',
};

type Props = {
  draft: ApiRequestDefinition;
  inFlight: boolean;
  connected: boolean;
  activeSessionId?: string;
  scope: VariableScope;
  onChange(patch: ApiDraftPatch): void;
  onSend(): void;
  onConnect(): void;
  onCancel(sessionId: string): void;
  onDisconnect(sessionId: string): void;
  onJumpToVariable(name: string): void;
};

export function RequestLine({
  draft,
  inFlight,
  connected,
  activeSessionId,
  scope,
  onChange,
  onSend,
  onConnect,
  onCancel,
  onDisconnect,
  onJumpToVariable,
}: Props) {
  const isStream =
    draft.protocol === 'websocket' ||
    draft.protocol === 'sse' ||
    // A GraphQL subscription is a stream: Connect/Disconnect, never Send.
    (draft.protocol === 'graphql' && draft.protocolOptions.graphql?.transport === 'WS');
  // GraphQL and SSE choose their own verb; only plain HTTP exposes a method picker.
  const showMethod = draft.protocol === 'http';

  const methodValue: MethodOption = STANDARD_METHODS.includes(
    draft.method.toUpperCase() as (typeof STANDARD_METHODS)[number]
  )
    ? (draft.method.toUpperCase() as MethodOption)
    : 'CUSTOM';

  const methodOptions = useMemo(
    () => [
      ...STANDARD_METHODS.map((method) => ({ value: method, label: method })),
      { value: 'CUSTOM' as const, label: 'Custom…' },
    ],
    []
  );

  const urlEmpty = !draft.urlTemplate.trim();
  const scan = useMemo(
    () => scanTemplate(draft.urlTemplate, scope),
    [draft.urlTemplate, scope]
  );

  return (
    <div className="api-request-line">
      <div className="api-request-line__protocol">
        <Dropdown
          label="Protocol"
          value={draft.protocol}
          options={PROTOCOL_OPTIONS}
          onChange={(value) => onChange(protocolPatch(draft, value as ApiProtocol))}
        />
      </div>

      {showMethod ? (
        <div className="api-request-line__method">
          <Dropdown
            label="HTTP method"
            value={methodValue}
            options={methodOptions}
            onChange={(value) => {
              if (value === 'CUSTOM') {
                onChange({ method: draft.method || 'GET' });
                return;
              }
              onChange({ method: value });
            }}
          />
          {methodValue === 'CUSTOM' ? (
            <TextField
              aria-label="Custom HTTP method"
              className="api-request-line__custom-method mono"
              value={draft.method}
              onChange={(event) => onChange({ method: event.target.value.toUpperCase() })}
            />
          ) : null}
        </div>
      ) : null}

      <div className="api-request-line__url">
        <label className="api-field-label" htmlFor="api-request-url">
          URL
        </label>
        <VariableField
          id="api-request-url"
          value={draft.urlTemplate}
          scope={scope}
          placeholder={URL_PLACEHOLDER[draft.protocol]}
          onChange={(urlTemplate) => onChange({ urlTemplate })}
        />
        <UrlPreview scan={scan} onJumpToVariable={onJumpToVariable} />
      </div>

      <div className="api-request-line__actions">
        {isStream ? (
          connected && activeSessionId ? (
            <Button variant="secondary" onClick={() => onDisconnect(activeSessionId)}>
              Disconnect
            </Button>
          ) : (
            <Button variant="primary" onClick={onConnect} disabled={urlEmpty}>
              Connect
            </Button>
          )
        ) : inFlight && activeSessionId ? (
          <Button variant="secondary" onClick={() => onCancel(activeSessionId)}>
            Cancel
          </Button>
        ) : (
          <Button variant="primary" onClick={onSend} disabled={urlEmpty}>
            Send
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * What the request will actually send. An unresolved name is the quiet failure this pane exists to
 * prevent — main refuses the send unless "send unresolved literals" is on, and either way the user
 * should see it before pressing Send, not after.
 */
function UrlPreview({
  scan,
  onJumpToVariable,
}: {
  scan: TemplateScan;
  onJumpToVariable(name: string): void;
}) {
  if (scan.tokens.length === 0) return null;

  if (scan.cyclic.length > 0) {
    return (
      <p className="api-url-preview api-url-preview__missing" role="alert">
        <span>Variable cycle:</span>
        <span className="mono">{scan.cyclic.join(', ')}</span>
      </p>
    );
  }

  if (scan.missing.length > 0) {
    return (
      <p className="api-url-preview api-url-preview__missing" role="status">
        <span>{scan.missing.length === 1 ? 'Unresolved variable:' : 'Unresolved variables:'}</span>
        {scan.missing.map((name) => (
          <button
            key={name}
            type="button"
            className="api-url-preview__chip"
            title={`Define ${name} in the active environment`}
            onClick={() => onJumpToVariable(name)}
          >
            {name}
          </button>
        ))}
      </p>
    );
  }

  return (
    <p className="api-url-preview">
      <span className="api-url-preview__label">Sends</span>
      <span className="api-url-preview__value" title={scan.preview}>
        {scan.preview}
      </span>
    </p>
  );
}

/**
 * Switching protocol seeds the options that protocol needs and normalises the method, so a
 * request never sends a verb its protocol cannot use.
 */
function protocolPatch(draft: ApiRequestDefinition, protocol: ApiProtocol): ApiDraftPatch {
  const protocolOptions = { ...draft.protocolOptions };
  switch (protocol) {
    case 'graphql':
      protocolOptions.graphql ??= DEFAULT_GRAPHQL_OPTIONS;
      return { protocol, method: 'POST', protocolOptions };
    case 'websocket':
      protocolOptions.websocket ??= { subprotocols: [] };
      return { protocol, method: 'GET', protocolOptions };
    case 'sse':
      protocolOptions.sse ??= { reconnect: false };
      return { protocol, method: 'GET', protocolOptions };
    case 'http':
    default:
      return { protocol: 'http', protocolOptions };
  }
}
