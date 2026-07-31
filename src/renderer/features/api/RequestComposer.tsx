import { Button } from '@renderer/components/Button';
import type { ApiDraftPatch, ApiRequestDocument, ApiSessionState } from '@renderer/store/apiStore';
import type {
  ApiOAuthProfile,
  ApiOAuthTokenStatus,
  ApiProxyProfile,
  ApiScriptPhase,
  ApiSecretSummary,
  ApiTlsProfile,
  ApiValidateScriptResult,
} from '@shared/contracts/apiWorkbench';
import { RequestEditors } from './RequestEditors';
import { RequestLine } from './RequestLine';
import type { VariableScope } from './variablePreview';

type Props = {
  document: ApiRequestDocument;
  secrets: ApiSecretSummary[];
  tlsProfiles: ApiTlsProfile[];
  proxyProfiles: ApiProxyProfile[];
  oauthProfiles: ApiOAuthProfile[];
  oauthTokens: ApiOAuthTokenStatus[];
  session?: ApiSessionState;
  introspecting: boolean;
  introspectError: string | null;
  schemaTypeCount: number | null;
  scriptValidation: Record<string, ApiValidateScriptResult>;
  scriptsEnabledGlobally: boolean;
  onDraftChange(patch: ApiDraftPatch): void;
  onSave(): void;
  onSend(): void;
  onConnect(): void;
  onCancel(sessionId: string): void;
  onDisconnect(sessionId: string): void;
  onIntrospect(): void;
  onManageOAuth(profileId: string | null): void;
  onManageTls(profileId: string | null): void;
  onManageProxy(profileId: string | null): void;
  onValidateScript(phase: ApiScriptPhase, source: string): void;
  onReviewScripts(): void;
  scope: VariableScope;
  onJumpToVariable(name: string): void;
};

export function RequestComposer({
  document,
  secrets,
  tlsProfiles,
  proxyProfiles,
  oauthProfiles,
  oauthTokens,
  session,
  introspecting,
  introspectError,
  schemaTypeCount,
  scriptValidation,
  scriptsEnabledGlobally,
  onDraftChange,
  onSave,
  onSend,
  onConnect,
  onCancel,
  onDisconnect,
  onIntrospect,
  onManageOAuth,
  onManageTls,
  onManageProxy,
  onValidateScript,
  onReviewScripts,
  scope,
  onJumpToVariable,
}: Props) {
  const connected = session?.streamStatus === 'open';

  return (
    <div className="api-composer">
      <div className="api-composer__toolbar">
        <div className="api-composer__title">
          <label className="api-field-label" htmlFor="api-request-name">
            Request name
          </label>
          <input
            id="api-request-name"
            className="control-input api-composer__name"
            value={document.draft.name}
            onChange={(event) => onDraftChange({ name: event.target.value })}
          />
        </div>
        <div className="api-composer__actions">
          <Button
            size="compact"
            variant="secondary"
            disabled={!document.dirty || document.saving}
            loading={document.saving}
            title="Save request (Ctrl+S)"
            onClick={onSave}
          >
            Save
          </Button>
        </div>
      </div>

      <RequestLine
        draft={document.draft}
        inFlight={Boolean(session?.inFlight)}
        connected={connected}
        activeSessionId={session?.sessionId}
        scope={scope}
        onChange={onDraftChange}
        onSend={onSend}
        onConnect={onConnect}
        onCancel={onCancel}
        onDisconnect={onDisconnect}
        onJumpToVariable={onJumpToVariable}
      />

      {document.saveError ? (
        <div className="api-banner api-banner--danger" role="alert">
          <strong>Save failed</strong>
          <span>{document.saveError.message}</span>
        </div>
      ) : null}

      <RequestEditors
        draft={document.draft}
        secrets={secrets}
        tlsProfiles={tlsProfiles}
        oauthProfiles={oauthProfiles}
        oauthTokens={oauthTokens}
        introspecting={introspecting}
        introspectError={introspectError}
        schemaTypeCount={schemaTypeCount}
        onChange={onDraftChange}
        onIntrospect={onIntrospect}
        onManageOAuth={onManageOAuth}
        onManageTls={onManageTls}
        proxyProfiles={proxyProfiles}
        onManageProxy={onManageProxy}
        scriptValidation={scriptValidation}
        scriptsEnabledGlobally={scriptsEnabledGlobally}
        scope={scope}
        onValidateScript={onValidateScript}
        onReviewScripts={onReviewScripts}
      />
    </div>
  );
}
