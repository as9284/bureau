import { useState, type ReactElement } from 'react';
import type { TagDetail } from '@shared/contracts/history';
import type { RepositorySnapshot } from '@shared/contracts/gitSnapshot';
import { useGitStore } from '@renderer/store/gitStore';
import { Button } from '@renderer/components/Button';
import { Checkbox } from '@renderer/components/Checkbox';
import { Dialog } from '@renderer/components/Dialog';
import { EmptyState } from '@renderer/components/EmptyState';
import { Skeleton } from '@renderer/components/Skeleton';
import { TextInput } from '@renderer/components/TextInput';
import { Badge } from '@renderer/components/Badge';
import './TagsPanel.css';

type Props = {
  projectId: string;
  snapshot?: RepositorySnapshot;
  readOnly: boolean;
};

function TagRow({
  tag,
  readOnly,
  busy,
  onDelete,
  onPush,
  onDeleteRemote,
}: {
  tag: TagDetail;
  readOnly: boolean;
  busy: boolean;
  onDelete: () => void;
  onPush: () => void;
  onDeleteRemote: () => void;
}): ReactElement {
  return (
    <li className="tags-panel__item">
      <div className="tags-panel__copy">
        <span className="tags-panel__name">
          {tag.name}
          <Badge type={tag.kind === 'annotated' ? 'accent' : 'neutral'}>
            {tag.kind === 'annotated' ? 'annotated' : 'lightweight'}
          </Badge>
        </span>
        <span className="tags-panel__meta">
          {tag.targetOid.slice(0, 7)}
          {tag.taggerName ? ` · ${tag.taggerName}` : ''}
          {tag.taggedAt ? ` · ${tag.taggedAt.slice(0, 10)}` : ''}
        </span>
        {tag.message ? (
          <span className="tags-panel__message" title={tag.message}>
            {tag.message}
          </span>
        ) : null}
      </div>
      {!readOnly ? (
        <div className="tags-panel__item-actions">
          <Button variant="ghost" disabled={busy} onClick={onPush}>
            Push
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onDelete}>
            Delete
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onDeleteRemote}>
            Delete remote
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export function TagsPanel({ projectId, snapshot, readOnly }: Props): ReactElement {
  const tags = useGitStore((s) => s.tags);
  const tagsLoading = useGitStore((s) => s.tagsLoading);
  const tagsHasMore = useGitStore((s) => s.tagsHasMore);
  const loadTags = useGitStore((s) => s.loadTags);
  const createTag = useGitStore((s) => s.createTag);
  const deleteTag = useGitStore((s) => s.deleteTag);
  const pushTag = useGitStore((s) => s.pushTag);
  const deleteRemoteTag = useGitStore((s) => s.deleteRemoteTag);
  const operation = useGitStore((s) => s.operationByRepo[projectId]);
  const confirmDeleteRemote = useGitStore((s) => s.settings?.confirmations.deleteRemoteTag ?? true);

  const [createOpen, setCreateOpen] = useState(false);
  const [tagName, setTagName] = useState('');
  const [tagAnnotated, setTagAnnotated] = useState(false);
  const [tagMessage, setTagMessage] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<TagDetail | null>(null);
  const [deleteRemoteTarget, setDeleteRemoteTarget] = useState<TagDetail | null>(null);

  const revision = snapshot?.revision;
  const headOid =
    snapshot?.branch.kind === 'named'
      ? snapshot.branch.headOid
      : snapshot?.branch.kind === 'detached'
        ? snapshot.branch.headOid
        : undefined;
  const busy = Boolean(operation);

  return (
    <section className="tags-panel" aria-label="Tags">
      <header className="tags-panel__header">
        <h2>Tags</h2>
        <div className="tags-panel__actions">
          {!readOnly && revision && headOid ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setCreateOpen(true)}
            >
              Create
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => loadTags(projectId)}>
            Refresh
          </Button>
        </div>
      </header>

      {tagsLoading && tags.length === 0 ? (
        <div className="tags-panel__loading">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} width="100%" height="40px" />
          ))}
        </div>
      ) : tags.length === 0 ? (
        <EmptyState title="No tags" description="Create a tag to mark a release or milestone." />
      ) : (
        <>
          <ul className="tags-panel__list">
            {tags.map((tag) => (
              <TagRow
                key={tag.name}
                tag={tag}
                readOnly={readOnly}
                busy={busy}
                onDelete={() => setDeleteTarget(tag)}
                onPush={() => revision && pushTag(projectId, revision, tag.name)}
                onDeleteRemote={() => {
                  if (confirmDeleteRemote) {
                    setDeleteRemoteTarget(tag);
                    return;
                  }
                  if (revision) deleteRemoteTag(projectId, revision, 'origin', tag.name);
                }}
              />
            ))}
          </ul>
          {tagsHasMore ? (
            <div className="tags-panel__more">
              <Button
                variant="secondary"
                loading={tagsLoading}
                onClick={() => loadTags(projectId, true)}
              >
                Load more
              </Button>
            </div>
          ) : null}
        </>
      )}

      <Dialog
        open={createOpen}
        title="Create tag"
        description="Tag the current HEAD commit."
        onClose={() => {
          setCreateOpen(false);
          setTagName('');
          setTagAnnotated(false);
          setTagMessage('');
        }}
        actions={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={
                !tagName.trim() || (tagAnnotated && !tagMessage.trim()) || !revision || !headOid
              }
              onClick={async () => {
                if (revision && headOid && tagName.trim()) {
                  await createTag(
                    projectId,
                    revision,
                    tagName.trim(),
                    headOid,
                    tagAnnotated ? tagMessage.trim() : undefined
                  );
                  setCreateOpen(false);
                  setTagName('');
                  setTagAnnotated(false);
                  setTagMessage('');
                  await loadTags(projectId);
                }
              }}
            >
              Create tag
            </Button>
          </>
        }
      >
        <TextInput
          label="Tag name"
          value={tagName}
          onChange={(e) => setTagName(e.target.value)}
          placeholder="v1.0.0"
        />
        <Checkbox checked={tagAnnotated} onCheckedChange={setTagAnnotated} label="Annotated tag" />
        {tagAnnotated ? (
          <TextInput
            label="Tag message"
            value={tagMessage}
            onChange={(e) => setTagMessage(e.target.value)}
            placeholder="Release notes or description"
          />
        ) : null}
      </Dialog>

      <Dialog
        open={Boolean(deleteTarget)}
        title="Delete tag?"
        description={`Local tag "${deleteTarget?.name}" will be removed.`}
        onClose={() => setDeleteTarget(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (deleteTarget && revision) {
                  deleteTag(projectId, revision, deleteTarget.name);
                  setDeleteTarget(null);
                }
              }}
            >
              Delete tag
            </Button>
          </>
        }
      />

      <Dialog
        open={Boolean(deleteRemoteTarget)}
        title="Delete remote tag?"
        description={`Tag "${deleteRemoteTarget?.name}" will be deleted from origin.`}
        onClose={() => setDeleteRemoteTarget(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDeleteRemoteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (deleteRemoteTarget && revision) {
                  deleteRemoteTag(projectId, revision, 'origin', deleteRemoteTarget.name);
                  setDeleteRemoteTarget(null);
                }
              }}
            >
              Delete remote tag
            </Button>
          </>
        }
      />
    </section>
  );
}
