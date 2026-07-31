import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '@renderer/components/Button';
import { Checkbox } from '@renderer/components/Checkbox';
import { Dropdown } from '@renderer/components/Dropdown';
import { TextField } from '@renderer/components/TextField';
import { TrashIcon } from '@renderer/components/icons';
import type {
  ApiCookie,
  ApiCookieJarSummary,
  ApiEnvironment,
  ApiSecretSummary,
  ApiVariableDefinition,
} from '@shared/contracts/apiWorkbench';
import { CookiesPane } from './CookiesPane';
import { SecretsPane } from './SecretsPane';

/** Shared frame so every non-request tab reads the same as a request tab. */
function AuxShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="api-aux">
      <header className="api-aux__header">
        <div>
          <h2 className="api-aux__title">{title}</h2>
          <p className="api-aux__description">{description}</p>
        </div>
        {actions ? <div className="api-aux__actions">{actions}</div> : null}
      </header>
      <div className="api-aux__body">{children}</div>
    </section>
  );
}

/**
 * The environment editor. It lives in the main area rather than the sidebar because a variable
 * table needs full width: name, value and the secret binding have to be readable side by side.
 */
export function EnvironmentEditor({
  environment,
  secrets,
  isActive,
  focusVariableName,
  onFocusHandled,
  onUpdate,
  onSetActive,
  onDelete,
}: {
  environment: ApiEnvironment;
  secrets: ApiSecretSummary[];
  isActive: boolean;
  /** Set when the composer sent the user here to fill in a specific variable. */
  focusVariableName?: string | null;
  onFocusHandled?(): void;
  onUpdate(patch: { name?: string; variables?: ApiVariableDefinition[] }): void;
  onSetActive(): void;
  onDelete(): void;
}) {
  const valueRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (!focusVariableName) return;
    const target = environment.variables.find(
      (variable) => variable.name.trim() === focusVariableName
    );
    // The variable may still be landing from the update that created it.
    if (!target) return;
    valueRefs.current[target.variableId]?.focus();
    onFocusHandled?.();
  }, [focusVariableName, environment.variables, onFocusHandled]);

  const patchVariable = (variableId: string, patch: Partial<ApiVariableDefinition>): void => {
    onUpdate({
      variables: environment.variables.map((item) =>
        item.variableId === variableId ? { ...item, ...patch } : item
      ),
    });
  };

  return (
    <AuxShell
      title={environment.name || 'Untitled environment'}
      description="Variables resolve as {{name}} in request URLs, headers, bodies and scripts."
      actions={
        <>
          <Button size="compact" variant={isActive ? 'secondary' : 'quiet'} aria-pressed={isActive} onClick={onSetActive}>
            {isActive ? 'Active environment' : 'Set active'}
          </Button>
          <Button size="compact" variant="ghost" onClick={onDelete}>
            Delete
          </Button>
        </>
      }
    >
      <div className="api-aux__field">
        <label className="api-field-label" htmlFor={`env-name-${environment.environmentId}`}>
          Environment name
        </label>
        <TextField
          id={`env-name-${environment.environmentId}`}
          value={environment.name}
          onChange={(event) => onUpdate({ name: event.target.value })}
        />
      </div>

      <div className="api-var-table" role="table" aria-label="Environment variables">
        <div className="api-var-table__head" role="row">
          <span role="columnheader">On</span>
          <span role="columnheader">Variable</span>
          <span role="columnheader">Value</span>
          <span role="columnheader">Secret</span>
          <span role="columnheader" className="bureau-visually-hidden">
            Remove
          </span>
        </div>
        {environment.variables.length === 0 ? (
          <div className="api-pane-empty">No variables yet.</div>
        ) : (
          environment.variables.map((variable) => (
            <div key={variable.variableId} className="api-var-table__row" role="row">
              <span role="cell">
                <Checkbox
                  checked={variable.enabled}
                  label={
                    <span className="bureau-visually-hidden">{`Enable ${variable.name || 'variable'}`}</span>
                  }
                  onChange={(enabled) => patchVariable(variable.variableId, { enabled })}
                />
              </span>
              <span role="cell">
                <TextField
                  className="mono"
                  aria-label="Variable name"
                  value={variable.name}
                  onChange={(event) => patchVariable(variable.variableId, { name: event.target.value })}
                />
              </span>
              <span role="cell">
                {variable.secret ? (
                  <Dropdown
                    label="Secret binding"
                    value={variable.secretId ?? ''}
                    placeholder="Choose a secret"
                    options={secrets.map((secret) => ({ value: secret.secretId, label: secret.label }))}
                    onChange={(secretId) => patchVariable(variable.variableId, { secretId })}
                  />
                ) : (
                  <TextField
                    ref={(element) => {
                      valueRefs.current[variable.variableId] = element;
                    }}
                    className="mono"
                    aria-label="Variable value"
                    value={variable.value ?? ''}
                    onChange={(event) => patchVariable(variable.variableId, { value: event.target.value })}
                  />
                )}
              </span>
              <span role="cell">
                <Checkbox
                  checked={variable.secret}
                  label={
                    <span className="bureau-visually-hidden">{`Store ${variable.name || 'variable'} as a secret`}</span>
                  }
                  onChange={(secret) =>
                    // Switching modes drops the other side's binding so a stale plaintext value can
                    // never be resolved after the variable is marked secret.
                    patchVariable(variable.variableId,
                      secret ? { secret, value: undefined } : { secret, secretId: undefined }
                    )
                  }
                />
              </span>
              <span role="cell">
                <Button
                  size="compact"
                  variant="ghost"
                  aria-label={`Remove ${variable.name || 'variable'}`}
                  onClick={() =>
                    onUpdate({
                      variables: environment.variables.filter(
                        (item) => item.variableId !== variable.variableId
                      ),
                    })
                  }
                >
                  <TrashIcon size={14} />
                </Button>
              </span>
            </div>
          ))
        )}
      </div>

      <div className="api-aux__footer">
        <Button
          size="compact"
          variant="secondary"
          onClick={() =>
            onUpdate({
              variables: [
                ...environment.variables,
                { variableId: crypto.randomUUID(), name: '', value: '', enabled: true, secret: false },
              ],
            })
          }
        >
          Add variable
        </Button>
      </div>
    </AuxShell>
  );
}

export function SecretsEditor({
  secrets,
  storageAvailable,
  onSave,
  onDelete,
}: {
  secrets: ApiSecretSummary[];
  storageAvailable: boolean;
  onSave(label: string, value: string, persist: boolean): void;
  onDelete(secretId: string): void;
}) {
  return (
    <AuxShell
      title="Secrets"
      description="Values are write-only: a secret crosses IPC once on save and is never shown again."
    >
      <SecretsPane
        secrets={secrets}
        storageAvailable={storageAvailable}
        onSave={onSave}
        onDelete={onDelete}
      />
    </AuxShell>
  );
}

export function CookiesEditor(props: {
  jars: ApiCookieJarSummary[];
  activeJarId: string;
  cookies: ApiCookie[];
  loading: boolean;
  onSelectJar(jarId: string): void;
  onDelete(cookie: ApiCookie): void;
  onClear(): void;
  onRefresh(): void;
  onEdit(cookie: ApiCookie | null): void;
}) {
  return (
    <AuxShell
      title="Cookies"
      description="Cookies this workspace has stored. They are redacted in exports and run reports."
    >
      <CookiesPane {...props} />
    </AuxShell>
  );
}
