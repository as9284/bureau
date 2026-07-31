import { useEffect, useState } from 'react';
import { Button } from '@renderer/components/Button';
import { Checkbox } from '@renderer/components/Checkbox';
import type {
  ApiRequestDefinition,
  ApiScriptPhase,
  ApiValidateScriptResult,
} from '@shared/contracts/apiWorkbench';
import type { ApiDraftPatch } from '@renderer/store/apiStore';
import { ApiCodeField } from './ApiCodeField';

type Props = {
  draft: ApiRequestDefinition;
  /** Keyed `${requestId}:${phase}`; only this request's entries are read. */
  validation: Record<string, ApiValidateScriptResult>;
  scriptsEnabledGlobally: boolean;
  onChange(patch: ApiDraftPatch): void;
  onValidate(phase: ApiScriptPhase, source: string): void;
  onReviewScripts(): void;
};

const PHASES: Array<{ id: ApiScriptPhase; label: string; hint: string }> = [
  {
    id: 'pre-request',
    label: 'Pre-request',
    hint: 'Runs before the request is built. Set variables here; the request itself is read-only.',
  },
  {
    id: 'post-response',
    label: 'Tests',
    hint: 'Runs after the response arrives. Use bureau.test() to assert; a failed test fails the request.',
  },
];

/**
 * The pre-request and post-response script editors.
 *
 * Two things about this surface are deliberate. First, the enable toggle is refused for imported
 * source: enabling untrusted script text is a per-collection decision made in the approval dialog,
 * not a checkbox next to the code. Second, `enabled` is the only field main will not accept from an
 * unsaved draft, so the toggle says it needs a save.
 */
export function ScriptEditors({
  draft,
  validation,
  scriptsEnabledGlobally,
  onChange,
  onValidate,
  onReviewScripts,
}: Props) {
  const scripts = draft.scripts;
  const imported = scripts.origin === 'imported';
  const hasSource = Boolean(scripts.preRequest?.trim() || scripts.postResponse?.trim());

  return (
    <div className="api-scripts">
      {!scriptsEnabledGlobally ? (
        <div className="api-scripts__notice" role="alert">
          Scripts are turned off for this installation. Turn them on in Settings → API to run them.
        </div>
      ) : null}

      {imported ? (
        <div className="api-scripts__notice api-scripts__notice--untrusted" role="alert">
          <div>
            <strong>Imported script.</strong> Imported source is never run until it is reviewed and
            enabled for its collection.
          </div>
          <Button size="compact" variant="secondary" onClick={onReviewScripts}>
            Review scripts…
          </Button>
        </div>
      ) : null}

      <div className="api-scripts__toggle">
        <Checkbox
          label="Run these scripts"
          checked={scripts.enabled === true}
          disabled={imported || !hasSource}
          onChange={(enabled) =>
            onChange({ scripts: { ...scripts, enabled, origin: scripts.origin ?? 'authored' } })
          }
        />
        <span className="api-scripts__toggle-hint">
          {imported
            ? 'Enable this from the review dialog.'
            : 'Saved with the request — a send uses the last saved setting.'}
        </span>
      </div>

      {PHASES.map((phase) => (
        <PhaseEditor
          key={phase.id}
          phase={phase}
          value={(phase.id === 'pre-request' ? scripts.preRequest : scripts.postResponse) ?? ''}
          result={validation[`${draft.requestId}:${phase.id}`]}
          onChange={(source) =>
            onChange({
              scripts: {
                ...scripts,
                [phase.id === 'pre-request' ? 'preRequest' : 'postResponse']: source,
                origin: scripts.origin ?? 'authored',
              },
            })
          }
          onValidate={(source) => onValidate(phase.id, source)}
        />
      ))}

      <details className="api-scripts__reference">
        <summary>Available API</summary>
        <pre className="api-scripts__reference-body">{`bureau.request            method, url, headers, body, header(name)
bureau.response           status, ok, headers, body, json(), header(name)
bureau.variables.get(name)
bureau.variables.set(name, value)
bureau.variables.unset(name)
bureau.environment.name
bureau.test(name, fn)
bureau.expect(value)      toBe, toEqual, toContain, toMatch, toHaveLength,
                          toHaveProperty, toBeTruthy/Falsy/Null/Defined,
                          toBeGreaterThan(OrEqual), toBeLessThan(OrEqual), .not
console.log / warn / error

No network, filesystem, timers, or module loading. Scripts are
synchronous and run in an isolated runtime with a time and memory limit.`}</pre>
      </details>
    </div>
  );
}

function PhaseEditor({
  phase,
  value,
  result,
  onChange,
  onValidate,
}: {
  phase: (typeof PHASES)[number];
  value: string;
  result: ApiValidateScriptResult | undefined;
  onChange(source: string): void;
  onValidate(source: string): void;
}) {
  const [local, setLocal] = useState(value);

  // A draft reset (switching documents, discarding) must be reflected in the textarea.
  useEffect(() => {
    setLocal(value);
  }, [value]);

  // Validation is a round-trip to the sandbox, so it waits for a pause in typing.
  useEffect(() => {
    if (local === '') return;
    const timer = window.setTimeout(() => onValidate(local), 400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onValidate is stable per phase
  }, [local]);

  return (
    <section className="api-scripts__phase">
      <header className="api-scripts__phase-header">
        <h3 className="api-scripts__phase-title">{phase.label}</h3>
        <p className="api-scripts__phase-hint">{phase.hint}</p>
      </header>
      <ApiCodeField
        label={`${phase.label} script`}
        languageId="javascript"
        value={local}
        error={
          result && !result.ok
            ? result.line === undefined
              ? result.message
              : `Line ${result.line}: ${result.message}`
            : undefined
        }
        onChange={(next) => {
          setLocal(next);
          onChange(next);
        }}
      />
    </section>
  );
}
