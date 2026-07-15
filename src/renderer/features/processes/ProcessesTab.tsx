import { useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { ProcessRow } from './ProcessRow';
import { ProcessFormDialog } from './ProcessFormDialog';
import { Button } from '../../components/Button';
import type { ProcessDefinition } from '@shared/contracts/projects';

export function ProcessesTab({ projectId }: { projectId: string }) {
  const definitions = useAppStore((s) => s.processesByProject[projectId]?.definitions);
  const project = useAppStore((s) => s.projects.find((p) => p.projectId === projectId));
  const stopAllProcesses = useAppStore((s) => s.stopAllProcesses);
  const saveProcessDefinition = useAppStore((s) => s.saveProcessDefinition);
  const [form, setForm] = useState<'add' | ProcessDefinition | null>(null);

  if (!definitions) {
    return <div className="tab-loading">Loading…</div>;
  }

  return (
    <div className="processes-tab">
      <div className="processes-tab__header">
        <span className="processes-tab__title">Processes</span>
        <div className="processes-tab__actions">
          <Button variant="ghost" onClick={() => setForm('add')}>
            Add process
          </Button>
          <Button variant="ghost" onClick={() => void stopAllProcesses(projectId)}>
            Stop all
          </Button>
        </div>
      </div>
      {definitions.length === 0 ? (
        <div className="empty-state">
          <h1>No processes</h1>
          <p>
            Bureau didn’t find runnable commands for this project. Add one manually, or re-detect
            from package.json and similar manifests.
          </p>
          <Button variant="primary" onClick={() => setForm('add')}>
            Add process
          </Button>
        </div>
      ) : (
        <div className="process-list">
          {definitions.map((definition) => (
            <ProcessRow
              key={definition.id}
              projectId={projectId}
              definition={definition}
              onEdit={() => setForm(definition)}
            />
          ))}
        </div>
      )}

      {form && (
        <ProcessFormDialog
          title={form === 'add' ? 'Add process' : 'Edit process'}
          initial={form === 'add' ? undefined : form}
          nestedRoots={project?.nestedRoots ?? []}
          onCancel={() => setForm(null)}
          onSave={(definition) => {
            void saveProcessDefinition(projectId, definition).then(() => setForm(null));
          }}
        />
      )}
    </div>
  );
}
