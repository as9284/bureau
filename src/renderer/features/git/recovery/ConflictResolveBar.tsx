import { useState, type ReactElement } from 'react';
import type { ConflictStage } from '@shared/contracts/recovery';
import type { BureauError } from '@shared/contracts/errors';
import { useGitStore } from '@renderer/store/gitStore';
import { Button } from '@renderer/components/Button';
import { Dialog } from '@renderer/components/Dialog';
import { TextArea } from '@renderer/components/TextArea';
import { PanelError } from '@renderer/features/git/PanelState';
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

  const [previewStage, setPreviewStage] = useState<ConflictStage | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  /**
   * A failed load used to leave `conflictPreview` undefined, and the dialog fell
   * through to `value={conflictPreview?.content ?? ''}` — presenting an empty
   * textarea as though the file's "ours"/"theirs" side were genuinely blank. That
   * is the most dangerous shape this bug could take: the next click resolves the
   * conflict. The error is now held explicitly so the two cannot be confused.
   */
  const [previewError, setPreviewError] = useState<BureauError | null>(null);

  const openPreview = async (stage: 'ours' | 'theirs') => {
    setPreviewStage(stage);
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError(null);
    const result = await loadConflictVersion(projectId, path, stage);
    setPreviewError(result.ok ? null : result.error);
    setPreviewLoading(false);
  };

  const closePreview = () => {
    setPreviewOpen(false);
    setPreviewStage(null);
    setPreviewError(null);
    clearConflictPreview();
  };

  // No local confirmation here: resolveConflict gates itself in the store, so
  // this button and the file context menu share one prompt.
  const requestResolve = (resolution: 'ours' | 'theirs' | 'markResolved') => {
    void resolveConflict(projectId, revision, path, resolution);
  };

  const previewLabel = previewStage === 'ours' ? 'Ours' : previewStage === 'theirs' ? 'Theirs' : '';

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
        ) : previewError ? (
          <PanelError
            title={`Could not load the ${previewLabel.toLowerCase()} version`}
            message={previewError.message}
            onRetry={() => {
              if (previewStage === 'ours' || previewStage === 'theirs') {
                void openPreview(previewStage);
              }
            }}
          />
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

    </div>
  );
}
