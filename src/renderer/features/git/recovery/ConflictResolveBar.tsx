import { useState, type ReactElement } from 'react';
import type { ConflictStage } from '@shared/contracts/recovery';
import { useGitStore } from '@renderer/store/gitStore';
import { Button } from '@renderer/components/Button';
import { Dialog } from '@renderer/components/Dialog';
import { TextArea } from '@renderer/components/TextArea';
import './ConflictResolveBar.css';

type Props = {
  projectId: string;
  path: string;
  revision: string;
  readOnly: boolean;
  busy: boolean;
};

export function ConflictResolveBar({
  projectId,
  path,
  revision,
  readOnly,
  busy,
}: Props): ReactElement {
  const resolveConflict = useGitStore((s) => s.resolveConflict);
  const loadConflictVersion = useGitStore((s) => s.loadConflictVersion);
  const conflictPreview = useGitStore((s) => s.conflictPreview);
  const clearConflictPreview = useGitStore((s) => s.clearConflictPreview);
  const confirmOverwrite = useGitStore((s) => s.settings?.confirmations.conflictOverwrite ?? true);

  const [previewStage, setPreviewStage] = useState<ConflictStage | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [pendingResolution, setPendingResolution] = useState<
    'ours' | 'theirs' | 'markResolved' | null
  >(null);

  const openPreview = async (stage: 'ours' | 'theirs') => {
    setPreviewStage(stage);
    setPreviewOpen(true);
    setPreviewLoading(true);
    await loadConflictVersion(projectId, path, stage);
    setPreviewLoading(false);
  };

  const closePreview = () => {
    setPreviewOpen(false);
    setPreviewStage(null);
    clearConflictPreview();
  };

  const requestResolve = (resolution: 'ours' | 'theirs' | 'markResolved') => {
    if (confirmOverwrite) {
      setPendingResolution(resolution);
      return;
    }
    void resolveConflict(projectId, revision, path, resolution);
  };

  const confirmResolve = () => {
    if (!pendingResolution) return;
    const resolution = pendingResolution;
    setPendingResolution(null);
    void resolveConflict(projectId, revision, path, resolution);
  };

  const previewLabel = previewStage === 'ours' ? 'Ours' : previewStage === 'theirs' ? 'Theirs' : '';
  const pendingLabel =
    pendingResolution === 'ours'
      ? 'Use ours'
      : pendingResolution === 'theirs'
        ? 'Use theirs'
        : 'Mark resolved';

  return (
    <div className="conflict-resolve-bar" role="toolbar" aria-label="Conflict resolution">
      <span className="conflict-resolve-bar__path mono" title={path}>
        {path}
      </span>
      <div className="conflict-resolve-bar__actions">
        <Button variant="ghost" disabled={busy} onClick={() => void openPreview('ours')}>
          Preview ours
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void openPreview('theirs')}>
          Preview theirs
        </Button>
        {!readOnly ? (
          <>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => requestResolve('ours')}
            >
              Use ours
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => requestResolve('theirs')}
            >
              Use theirs
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => requestResolve('markResolved')}
            >
              Mark resolved
            </Button>
          </>
        ) : null}
      </div>

      <Dialog
        open={previewOpen}
        title={`${previewLabel} version`}
        description={path}
        onClose={closePreview}
        actions={
          <Button variant="secondary" onClick={closePreview}>
            Close
          </Button>
        }
      >
        {previewLoading ? (
          <p className="conflict-resolve-bar__preview-status">Loading…</p>
        ) : conflictPreview?.binary ? (
          <p className="conflict-resolve-bar__preview-status">Binary file — preview unavailable.</p>
        ) : (
          <TextArea
            label={`${previewLabel} content`}
            value={conflictPreview?.content ?? ''}
            readOnly
            rows={16}
            className="conflict-resolve-bar__preview"
          />
        )}
      </Dialog>

      <Dialog
        open={pendingResolution !== null}
        title="Overwrite conflict resolution?"
        description={`Apply “${pendingLabel}” for ${path}? This replaces the working-tree resolution for this file.`}
        onClose={() => setPendingResolution(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setPendingResolution(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirmResolve}>
              {pendingLabel}
            </Button>
          </>
        }
      />
    </div>
  );
}
