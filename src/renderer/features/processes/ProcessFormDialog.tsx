import { useMemo, useState } from 'react';
import type { ProcessDefinition, ProcessRunMode } from '@shared/contracts/projects';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { Dropdown } from '../../components/Dropdown';
import { Checkbox } from '../../components/Checkbox';

type ProcessFormDialogProps = {
  title: string;
  initial?: ProcessDefinition;
  nestedRoots?: string[];
  onCancel(): void;
  onSave(definition: ProcessDefinition): void;
};

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'process'
  );
}

function envToText(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

function textToEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1);
    if (key) out[key] = value;
  }
  return out;
}

export function ProcessFormDialog({
  title,
  initial,
  nestedRoots = [],
  onCancel,
  onSave,
}: ProcessFormDialogProps) {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [command, setCommand] = useState(initial?.command ?? 'npm');
  const [argsText, setArgsText] = useState(initial?.args.join(' ') ?? 'run dev');
  const [cwd, setCwd] = useState(initial?.cwd ?? '.');
  const [runMode, setRunMode] = useState<ProcessRunMode>(initial?.runMode ?? 'log');
  const [autoRestart, setAutoRestart] = useState(initial?.autoRestart ?? false);
  const [runOnOpen, setRunOnOpen] = useState(initial?.runOnOpen ?? false);
  const [urlPattern, setUrlPattern] = useState(initial?.urlPattern ?? '');
  const [envText, setEnvText] = useState(envToText(initial?.env ?? {}));

  const cwdOptions = useMemo(
    () => [
      { value: '.', label: 'Project root (.)' },
      ...nestedRoots.map((root) => ({ value: root, label: root })),
    ],
    [nestedRoots]
  );

  const submit = (): void => {
    const trimmedLabel = label.trim();
    const trimmedCommand = command.trim();
    if (!trimmedLabel || !trimmedCommand) return;
    const args = argsText.trim().split(/\s+/).filter(Boolean);
    onSave({
      id: initial?.id ?? slugify(trimmedLabel),
      label: trimmedLabel,
      command: trimmedCommand,
      args,
      cwd: cwd || '.',
      env: textToEnv(envText),
      runMode,
      autoRestart,
      runOnOpen,
      urlPattern: urlPattern.trim() || undefined,
      // Preserve the per-process runtime pin (not exposed in this form) across edits.
      toolchain: initial?.toolchain,
    });
  };

  return (
    <div className="overlay-root" onMouseDown={onCancel}>
      <div
        className="dialog process-form-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>{title}</h2>
        <div className="process-form">
          <label className="process-form__field">
            <span>Label</span>
            <TextField value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label className="process-form__field">
            <span>Command</span>
            <TextField mono value={command} onChange={(e) => setCommand(e.target.value)} />
          </label>
          <label className="process-form__field">
            <span>Arguments</span>
            <TextField mono value={argsText} onChange={(e) => setArgsText(e.target.value)} />
          </label>
          <Dropdown label="Working directory" value={cwd} options={cwdOptions} onChange={setCwd} />
          <Dropdown
            label="Run mode"
            value={runMode}
            options={[
              { value: 'log', label: 'Log console' },
              { value: 'terminal', label: 'Interactive terminal' },
            ]}
            onChange={(value) => setRunMode(value as ProcessRunMode)}
          />
          <label className="process-form__field">
            <span>URL pattern (optional)</span>
            <TextField mono value={urlPattern} onChange={(e) => setUrlPattern(e.target.value)} />
          </label>
          <label className="process-form__field">
            <span>Environment (KEY=value per line)</span>
            <textarea
              className="text-field mono process-form__env"
              rows={4}
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              placeholder="PORT=3000"
            />
          </label>
          <Checkbox
            checked={autoRestart}
            onChange={setAutoRestart}
            label="Auto-restart on crash"
          />
          <Checkbox
            checked={runOnOpen}
            onChange={setRunOnOpen}
            label="Run when project opens"
          />
        </div>
        <div className="dialog__actions">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!label.trim() || !command.trim()}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
