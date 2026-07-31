import { useMemo, useRef, useState } from 'react';
import { Button } from '@renderer/components/Button';
import { Checkbox } from '@renderer/components/Checkbox';
import { Dropdown } from '@renderer/components/Dropdown';
import { IconButton } from '@renderer/components/IconButton';
import { TextArea } from '@renderer/components/TextArea';
import { TextField } from '@renderer/components/TextField';
import { GripIcon, TrashIcon } from '@renderer/components/icons';
import { newKeyValue, type ApiDraftPatch } from '@renderer/store/apiStore';
import type {
  ApiAuth,
  ApiBody,
  ApiKeyValue,
  ApiOAuthProfile,
  ApiOAuthTokenStatus,
  ApiRequestDefinition,
  ApiRequestSettings,
  ApiProxyProfile,
  ApiScriptPhase,
  ApiSecretSummary,
  ApiTlsProfile,
  ApiValidateScriptResult,
} from '@shared/contracts/apiWorkbench';
import { ApiCodeField } from './ApiCodeField';
import { bodyLanguageId } from './apiFormat';
import { GraphqlComposer } from './GraphqlComposer';
import { ScriptEditors } from './ScriptEditors';
import { VariableField } from './VariableField';
import type { VariableScope } from './variablePreview';

type EditorTab = 'params' | 'auth' | 'headers' | 'body' | 'query' | 'scripts' | 'settings';

type Props = {
  draft: ApiRequestDefinition;
  secrets: ApiSecretSummary[];
  tlsProfiles: ApiTlsProfile[];
  proxyProfiles: ApiProxyProfile[];
  oauthProfiles: ApiOAuthProfile[];
  oauthTokens: ApiOAuthTokenStatus[];
  introspecting: boolean;
  introspectError: string | null;
  schemaTypeCount: number | null;
  scriptValidation: Record<string, ApiValidateScriptResult>;
  scriptsEnabledGlobally: boolean;
  scope: VariableScope;
  onChange(patch: ApiDraftPatch): void;
  onIntrospect(): void;
  onManageOAuth(profileId: string | null): void;
  onManageTls(profileId: string | null): void;
  onManageProxy(profileId: string | null): void;
  onValidateScript(phase: ApiScriptPhase, source: string): void;
  onReviewScripts(): void;
};

export function RequestEditors({
  draft,
  secrets,
  tlsProfiles,
  proxyProfiles,
  oauthProfiles,
  oauthTokens,
  introspecting,
  introspectError,
  schemaTypeCount,
  scriptValidation,
  scriptsEnabledGlobally,
  scope,
  onChange,
  onIntrospect,
  onManageOAuth,
  onManageTls,
  onManageProxy,
  onValidateScript,
  onReviewScripts,
}: Props) {
  const isGraphql = draft.protocol === 'graphql';
  // A WebSocket or SSE request has no request body; GraphQL replaces Body with Query.
  const isStream = draft.protocol === 'websocket' || draft.protocol === 'sse';

  /**
   * Tab badges. Six identical tabs hide what a request actually carries, so each one reports its
   * own content: a count where rows are countable, a dot where the tab is simply "set".
   */
  const tabs = useMemo<Array<{ id: EditorTab; label: string; badge?: string; dot?: boolean }>>(() => {
    const enabled = (rows: ApiKeyValue[]): number => rows.filter((row) => row.enabled).length;
    const scriptCount = [draft.scripts?.preRequest, draft.scripts?.postResponse].filter((source) =>
      source?.trim()
    ).length;
    const settingsTouched = Boolean(
      draft.settings.timeoutMs !== undefined ||
        draft.settings.maxRedirects !== undefined ||
        draft.settings.sendUnresolvedLiterals ||
        draft.settings.followRedirects === false ||
        draft.protocolOptions.tlsProfileId ||
        draft.protocolOptions.proxyProfileId
    );

    const list: Array<{ id: EditorTab; label: string; badge?: string; dot?: boolean }> = [
      { id: 'params', label: 'Params', badge: enabled(draft.query) ? String(enabled(draft.query)) : undefined },
      { id: 'auth', label: 'Auth', dot: draft.auth.kind !== 'none' && draft.auth.kind !== 'inherit' },
      { id: 'headers', label: 'Headers', badge: enabled(draft.headers) ? String(enabled(draft.headers)) : undefined },
    ];
    if (isGraphql) {
      list.push({
        id: 'query',
        label: 'Query',
        dot: Boolean(draft.protocolOptions.graphql?.query.trim()),
      });
    } else if (!isStream) {
      list.push({ id: 'body', label: 'Body', dot: draft.body.kind !== 'none' });
    }
    list.push({
      id: 'scripts',
      label: 'Scripts',
      badge: scriptCount ? String(scriptCount) : undefined,
    });
    list.push({ id: 'settings', label: 'Settings', dot: settingsTouched });
    return list;
  }, [
    draft.auth.kind,
    draft.body.kind,
    draft.headers,
    draft.protocolOptions.graphql?.query,
    draft.protocolOptions.proxyProfileId,
    draft.protocolOptions.tlsProfileId,
    draft.query,
    draft.scripts?.postResponse,
    draft.scripts?.preRequest,
    draft.settings.followRedirects,
    draft.settings.maxRedirects,
    draft.settings.sendUnresolvedLiterals,
    draft.settings.timeoutMs,
    isGraphql,
    isStream,
  ]);

  const [tab, setTab] = useState<EditorTab>('params');
  // The protocol may remove the current tab (e.g. HTTP → SSE drops Body).
  const activeTab = tabs.some((item) => item.id === tab) ? tab : 'params';

  return (
    <div className="api-editors">
      <div className="api-editors__tabs" role="tablist" aria-label="Request editor sections">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className={activeTab === item.id ? 'is-active' : ''}
            aria-selected={activeTab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {/* The badge stays in the accessible name — a count nobody can hear is half a signal. */}
            {item.badge ? <span className="api-editors__tab-badge mono">{item.badge}</span> : null}
            {item.dot ? (
              <>
                <span className="api-editors__tab-dot" aria-hidden="true" />
                <span className="bureau-visually-hidden">set</span>
              </>
            ) : null}
          </button>
        ))}
      </div>
      <div className="api-editors__panel" role="tabpanel">
        {activeTab === 'params' ? (
          <KeyValueEditor
            label="Query parameters"
            rows={draft.query}
            scope={scope}
            onChange={(query) => onChange({ query })}
          />
        ) : null}
        {activeTab === 'headers' ? (
          <KeyValueEditor
            label="Request headers"
            rows={draft.headers}
            scope={scope}
            onChange={(headers) => onChange({ headers })}
          />
        ) : null}
        {activeTab === 'auth' ? (
          <AuthEditor
            auth={draft.auth}
            secrets={secrets}
            oauthProfiles={oauthProfiles}
            oauthTokens={oauthTokens}
            onChange={(auth) => onChange({ auth })}
            onManageOAuth={onManageOAuth}
          />
        ) : null}
        {activeTab === 'body' ? (
          <BodyEditor body={draft.body} scope={scope} onChange={(body) => onChange({ body })} />
        ) : null}
        {activeTab === 'query' ? (
          <GraphqlComposer
            draft={draft}
            introspecting={introspecting}
            introspectError={introspectError}
            schemaTypeCount={schemaTypeCount}
            onIntrospect={onIntrospect}
            onChange={(graphql) =>
              onChange({ protocolOptions: { ...draft.protocolOptions, graphql } })
            }
          />
        ) : null}
        {activeTab === 'scripts' ? (
          <ScriptEditors
            draft={draft}
            validation={scriptValidation}
            scriptsEnabledGlobally={scriptsEnabledGlobally}
            onChange={onChange}
            onValidate={onValidateScript}
            onReviewScripts={onReviewScripts}
          />
        ) : null}
        {activeTab === 'settings' ? (
          <SettingsEditor
            settings={draft.settings}
            tlsProfileId={draft.protocolOptions.tlsProfileId}
            tlsProfiles={tlsProfiles}
            proxyProfileId={draft.protocolOptions.proxyProfileId}
            proxyProfiles={proxyProfiles}
            onProxyProfileChange={(proxyProfileId) =>
              onChange({ protocolOptions: { ...draft.protocolOptions, proxyProfileId } })
            }
            onManageProxy={onManageProxy}
            onChange={(settings) => onChange({ settings })}
            onTlsProfileChange={(tlsProfileId) =>
              onChange({ protocolOptions: { ...draft.protocolOptions, tlsProfileId } })
            }
            onManageTls={onManageTls}
          />
        ) : null}
      </div>
    </div>
  );
}

/** `name: value` per line; a leading `#` marks the row disabled, matching what bulk edit writes. */
function rowsToText(rows: ApiKeyValue[]): string {
  return rows.map((row) => `${row.enabled ? '' : '# '}${row.name}: ${row.value}`).join('\n');
}

function textToRows(text: string, previous: ApiKeyValue[]): ApiKeyValue[] {
  const byName = new Map(previous.map((row) => [row.name, row]));
  const rows: ApiKeyValue[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const disabled = line.startsWith('#');
    const body = disabled ? line.slice(1).trim() : line;
    const separator = body.indexOf(':');
    const name = (separator === -1 ? body : body.slice(0, separator)).trim();
    const value = separator === -1 ? '' : body.slice(separator + 1).trim();
    if (!name) continue;
    // Reuse the existing row id so React keys — and any focus — survive a round trip.
    rows.push({ ...(byName.get(name) ?? newKeyValue()), name, value, enabled: !disabled });
  }
  return rows;
}

function KeyValueEditor({
  label,
  rows,
  scope,
  onChange,
}: {
  label: string;
  rows: ApiKeyValue[];
  scope: VariableScope;
  onChange(rows: ApiKeyValue[]): void;
}) {
  const [bulk, setBulk] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const nameRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const updateRow = (id: string, patch: Partial<ApiKeyValue>): void => {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const addRow = (): void => {
    const row = newKeyValue();
    onChange([...rows, row]);
    // Land the caret in the new row rather than making the user click it.
    requestAnimationFrame(() => nameRefs.current[row.id]?.focus());
  };

  const move = (from: number, to: number): void => {
    if (to < 0 || to >= rows.length || from === to) return;
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  const enabledCount = rows.filter((row) => row.enabled).length;

  return (
    <div className="api-kv-editor">
      <div className="api-kv-editor__header">
        <span className="api-field-label">
          {label}
          {rows.length > 0 ? (
            <span className="api-kv-editor__count mono">
              {enabledCount}/{rows.length}
            </span>
          ) : null}
        </span>
        <div className="api-kv-editor__header-actions">
          <Button
            size="compact"
            variant="quiet"
            aria-pressed={bulk !== null}
            onClick={() => setBulk((current) => (current === null ? rowsToText(rows) : null))}
          >
            {bulk === null ? 'Bulk edit' : 'Done'}
          </Button>
          {bulk === null ? (
            <Button size="compact" variant="secondary" onClick={addRow}>
              Add row
            </Button>
          ) : null}
        </div>
      </div>

      {bulk !== null ? (
        <div className="api-kv-editor__bulk">
          <p className="api-field-hint">
            One <span className="mono">name: value</span> per line. Prefix a line with{' '}
            <span className="mono">#</span> to disable that row.
          </p>
          <TextArea
            label={`${label} as text`}
            className="mono"
            value={bulk}
            onChange={(event) => {
              setBulk(event.target.value);
              onChange(textToRows(event.target.value, rows));
            }}
          />
        </div>
      ) : rows.length === 0 ? (
        <div className="api-pane-empty">
          <p>No rows yet.</p>
          <Button size="compact" variant="secondary" onClick={addRow}>
            Add row
          </Button>
        </div>
      ) : (
        <div className="api-kv-editor__rows">
          {rows.map((row, index) => (
            <div
              key={row.id}
              className={`api-kv-editor__row${row.enabled ? '' : ' is-disabled'}${dragId === row.id ? ' is-dragging' : ''}`}
              draggable
              onDragStart={() => setDragId(row.id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (!dragId) return;
                move(rows.findIndex((item) => item.id === dragId), index);
                setDragId(null);
              }}
            >
              <button
                type="button"
                className="api-kv-editor__grip"
                aria-label={`Reorder ${row.name || 'row'}; use arrow keys`}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                  event.preventDefault();
                  move(index, index + (event.key === 'ArrowDown' ? 1 : -1));
                }}
              >
                <GripIcon size={14} />
              </button>
              <Checkbox
                checked={row.enabled}
                label={<span className="bureau-visually-hidden">{`Enable ${row.name || 'row'}`}</span>}
                onChange={(enabled) => updateRow(row.id, { enabled })}
              />
              <TextField
                ref={(element) => {
                  nameRefs.current[row.id] = element;
                }}
                aria-label="Name"
                placeholder="Name"
                className="mono"
                value={row.name}
                onChange={(event) => updateRow(row.id, { name: event.target.value })}
              />
              <VariableField
                ariaLabel="Value"
                placeholder="Value"
                value={row.value}
                scope={scope}
                onChange={(value) => updateRow(row.id, { value })}
                onKeyDown={(event) => {
                  // Enter on the last row continues the list instead of doing nothing.
                  if (event.key !== 'Enter' || index !== rows.length - 1) return;
                  event.preventDefault();
                  addRow();
                }}
              />
              <IconButton
                label={`Remove ${row.name || 'row'}`}
                onClick={() => onChange(rows.filter((item) => item.id !== row.id))}
              >
                <TrashIcon size={14} />
              </IconButton>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AuthEditor({
  auth,
  secrets,
  oauthProfiles,
  oauthTokens,
  onChange,
  onManageOAuth,
}: {
  auth: ApiAuth;
  secrets: ApiSecretSummary[];
  oauthProfiles: ApiOAuthProfile[];
  oauthTokens: ApiOAuthTokenStatus[];
  onChange(auth: ApiAuth): void;
  onManageOAuth(profileId: string | null): void;
}) {
  const kind = auth.kind === 'inherit' ? 'none' : auth.kind;
  const secretOptions = useMemo(
    () => [
      { value: '', label: 'No secret' },
      ...secrets.map((secret) => ({ value: secret.secretId, label: secret.label })),
    ],
    [secrets]
  );

  const selectedToken =
    auth.kind === 'oauth2'
      ? oauthTokens.find((token) => token.profileId === auth.profileId)
      : undefined;

  return (
    <div className="api-auth-editor">
      <Dropdown
        label="Auth type"
        value={kind}
        options={[
          { value: 'none', label: 'No auth' },
          { value: 'basic', label: 'Basic' },
          { value: 'bearer', label: 'Bearer token' },
          { value: 'api-key', label: 'API key' },
          { value: 'oauth2', label: 'OAuth 2' },
        ]}
        onChange={(value) => {
          if (value === 'none') onChange({ kind: 'none' });
          if (value === 'basic') onChange({ kind: 'basic', usernameTemplate: '' });
          if (value === 'bearer') onChange({ kind: 'bearer' });
          if (value === 'api-key') {
            onChange({ kind: 'api-key', placement: 'header', nameTemplate: '' });
          }
          if (value === 'oauth2') {
            onChange({ kind: 'oauth2', profileId: oauthProfiles[0]?.profileId ?? '' });
          }
        }}
      />
      {auth.kind === 'oauth2' ? (
        <>
          <Dropdown
            label="OAuth profile"
            value={auth.profileId}
            placeholder={oauthProfiles.length === 0 ? 'No profiles yet' : undefined}
            options={oauthProfiles.map((profile) => ({
              value: profile.profileId,
              label: profile.name,
            }))}
            onChange={(profileId) => onChange({ kind: 'oauth2', profileId })}
          />
          <p className="api-field-hint">
            {selectedToken?.hasAccessToken
              ? `Access token stored${selectedToken.expiresAt ? ` · expires ${selectedToken.expiresAt.slice(0, 19).replace('T', ' ')}` : ''}.`
              : 'No access token yet — authorize the profile before sending.'}
          </p>
          <div className="api-auth-editor__actions">
            <Button
              size="compact"
              variant="secondary"
              onClick={() => onManageOAuth(auth.profileId || null)}
            >
              {auth.profileId ? 'Manage profile' : 'New profile'}
            </Button>
            {oauthProfiles.length > 0 ? (
              <Button size="compact" variant="ghost" onClick={() => onManageOAuth(null)}>
                New profile
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
      {auth.kind === 'basic' ? (
        <>
          <div className="api-auth-editor__field">
            <label className="api-field-label" htmlFor="api-auth-username">
              Username
            </label>
            <TextField
              id="api-auth-username"
              className="mono"
              value={auth.usernameTemplate}
              onChange={(event) => onChange({ ...auth, usernameTemplate: event.target.value })}
            />
          </div>
          <Dropdown
            label="Password secret"
            value={auth.passwordSecretId ?? ''}
            options={secretOptions}
            onChange={(value) =>
              onChange({ ...auth, passwordSecretId: value || undefined })
            }
          />
        </>
      ) : null}
      {auth.kind === 'bearer' ? (
        <Dropdown
          label="Token secret"
          value={auth.tokenSecretId ?? ''}
          options={secretOptions}
          onChange={(value) => onChange({ ...auth, tokenSecretId: value || undefined })}
        />
      ) : null}
      {auth.kind === 'api-key' ? (
        <>
          <Dropdown
            label="Placement"
            value={auth.placement}
            options={[
              { value: 'header', label: 'Header' },
              { value: 'query', label: 'Query' },
            ]}
            onChange={(placement) => onChange({ ...auth, placement })}
          />
          <div className="api-auth-editor__field">
            <label className="api-field-label" htmlFor="api-auth-key-name">
              Key name
            </label>
            <TextField
              id="api-auth-key-name"
              className="mono"
              value={auth.nameTemplate}
              onChange={(event) => onChange({ ...auth, nameTemplate: event.target.value })}
            />
          </div>
          <Dropdown
            label="Value secret"
            value={auth.valueSecretId ?? ''}
            options={secretOptions}
            onChange={(value) => onChange({ ...auth, valueSecretId: value || undefined })}
          />
        </>
      ) : null}
    </div>
  );
}

const TEXT_BODY_KINDS = ['json', 'text', 'xml', 'html'] as const;
type TextBodyKind = (typeof TEXT_BODY_KINDS)[number];

const BODY_LABELS: Record<string, string> = {
  none: 'No body',
  json: 'JSON',
  text: 'Text',
  xml: 'XML',
  html: 'HTML',
  'form-urlencoded': 'Form URL encoded',
  multipart: 'Multipart form data',
};

function isTextBody(body: ApiBody): body is Extract<ApiBody, { kind: TextBodyKind }> {
  return (TEXT_BODY_KINDS as readonly string[]).includes(body.kind);
}

function BodyEditor({
  body,
  scope,
  onChange,
}: {
  body: ApiBody;
  scope: VariableScope;
  onChange(body: ApiBody): void;
}) {
  // Text carried across a type switch so changing JSON → XML does not silently discard it.
  const carriedText = isTextBody(body) ? body.text : '';

  return (
    <div className="api-body-editor">
      <Dropdown
        label="Body type"
        value={body.kind}
        options={Object.entries(BODY_LABELS).map(([value, label]) => ({ value, label }))}
        onChange={(value) => {
          switch (value) {
            case 'none':
              onChange({ kind: 'none' });
              break;
            case 'json':
              onChange({ kind: 'json', text: carriedText || '{}' });
              break;
            case 'text':
              onChange({ kind: 'text', text: carriedText });
              break;
            case 'xml':
              onChange({ kind: 'xml', text: carriedText });
              break;
            case 'html':
              onChange({ kind: 'html', text: carriedText });
              break;
            case 'form-urlencoded':
              onChange({
                kind: 'form-urlencoded',
                fields: body.kind === 'multipart' ? body.fields : [],
              });
              break;
            case 'multipart':
              onChange({
                kind: 'multipart',
                fields: body.kind === 'form-urlencoded' ? body.fields : [],
              });
              break;
          }
        }}
      />
      {isTextBody(body) ? (
        <ApiCodeField
          label={`${BODY_LABELS[body.kind]} body`}
          languageId={bodyLanguageId(body.kind)}
          value={body.text}
          onChange={(text) => onChange({ ...body, text })}
        />
      ) : null}
      {body.kind === 'form-urlencoded' || body.kind === 'multipart' ? (
        <KeyValueEditor
          label={BODY_LABELS[body.kind]}
          rows={body.fields}
          scope={scope}
          onChange={(fields) => onChange({ ...body, fields })}
        />
      ) : null}
    </div>
  );
}

function SettingsEditor({
  settings,
  tlsProfileId,
  tlsProfiles,
  proxyProfileId,
  proxyProfiles,
  onChange,
  onTlsProfileChange,
  onManageTls,
  onProxyProfileChange,
  onManageProxy,
}: {
  settings: ApiRequestSettings;
  tlsProfileId?: string;
  tlsProfiles: ApiTlsProfile[];
  proxyProfileId?: string;
  proxyProfiles: ApiProxyProfile[];
  onChange(settings: ApiRequestSettings): void;
  onTlsProfileChange(profileId: string | undefined): void;
  onManageTls(profileId: string | null): void;
  onProxyProfileChange(profileId: string | undefined): void;
  onManageProxy(profileId: string | null): void;
}) {
  const selected = tlsProfiles.find((profile) => profile.profileId === tlsProfileId);
  const weakened = (selected?.allowInvalidCertificateHosts.length ?? 0) > 0 && selected?.enabled;

  return (
    <div className="api-settings-editor">
      <div className="api-settings-editor__field">
        <label className="api-field-label" htmlFor="api-settings-timeout">
          Timeout (ms)
        </label>
        <TextField
          id="api-settings-timeout"
          className="mono"
          inputMode="numeric"
          value={settings.timeoutMs?.toString() ?? ''}
          placeholder="Default"
          onChange={(event) => {
            const raw = event.target.value.trim();
            onChange({
              ...settings,
              timeoutMs: raw ? Number.parseInt(raw, 10) : undefined,
            });
          }}
        />
      </div>
      <Checkbox
        checked={settings.followRedirects ?? true}
        label="Follow redirects"
        onChange={(followRedirects) => onChange({ ...settings, followRedirects })}
      />
      <Checkbox
        checked={settings.sendUnresolvedLiterals ?? false}
        label="Send unresolved variables literally"
        onChange={(sendUnresolvedLiterals) => onChange({ ...settings, sendUnresolvedLiterals })}
      />

      <Dropdown
        label="Proxy profile"
        value={proxyProfileId ?? ''}
        options={[
          { value: '', label: 'Workspace default' },
          ...proxyProfiles.map((profile) => ({
            value: profile.profileId,
            label: profile.enabled ? profile.name : `${profile.name} (disabled)`,
          })),
        ]}
        onChange={(value) => onProxyProfileChange(value || undefined)}
      />
      <Button size="compact" variant="quiet" onClick={() => onManageProxy(proxyProfileId ?? null)}>
        {proxyProfileId ? 'Edit proxy profile…' : 'New proxy profile…'}
      </Button>

      <Dropdown
        label="TLS profile"
        value={tlsProfileId ?? ''}
        options={[
          { value: '', label: 'Strict verification (default)' },
          ...tlsProfiles.map((profile) => ({
            value: profile.profileId,
            label: profile.enabled ? profile.name : `${profile.name} (disabled)`,
          })),
        ]}
        onChange={(value) => onTlsProfileChange(value || undefined)}
      />
      {weakened ? (
        <div className="api-banner api-banner--danger" role="alert">
          <strong>Certificate verification is disabled</strong>
          <span>
            This request accepts invalid certificates for{' '}
            <span className="mono">{selected!.allowInvalidCertificateHosts.join(', ')}</span>.
          </span>
        </div>
      ) : null}
      <div className="api-settings-editor__actions">
        <Button size="compact" variant="secondary" onClick={() => onManageTls(tlsProfileId ?? null)}>
          {tlsProfileId ? 'Manage TLS profile' : 'New TLS profile'}
        </Button>
      </div>
    </div>
  );
}
