import { useMemo } from 'react';
import { useGitStore } from '@renderer/store/gitStore';
import type { ChangedFile } from '@shared/contracts/gitSnapshot';
import type { BranchDetail } from '@shared/contracts/branches';
import type { HistoryCommit } from '@shared/contracts/history';
import type { ContextMenuItemDef } from '@renderer/components/GitContextMenu';

type ChangedFileMenuParams = {
  projectId: string;
  file: ChangedFile;
  area: 'staged' | 'unstaged';
  revision?: string;
  readOnly: boolean;
  busy: boolean;
  onDiscard: () => void;
};

export function useChangedFileContextMenuItems({
  projectId,
  file,
  area,
  revision,
  readOnly,
  busy,
  onDiscard,
}: ChangedFileMenuParams): ContextMenuItemDef[] {
  const loadDiff = useGitStore((s) => s.loadDiff);
  const stageFile = useGitStore((s) => s.stageFile);
  const unstageFile = useGitStore((s) => s.unstageFile);
  const resolveConflict = useGitStore((s) => s.resolveConflict);

  return useMemo((): ContextMenuItemDef[] => {
    const items: ContextMenuItemDef[] = [
      {
        id: 'open-diff',
        label: 'Open diff',
        onClick: () => loadDiff(projectId, file.path, area),
      },
    ];

    if (!readOnly && revision) {
      if (file.unmerged) {
        items.push(
          {
            id: 'resolve-ours',
            label: 'Use ours',
            disabled: busy,
            separatorBefore: true,
            onClick: () => resolveConflict(projectId, revision, file.path, 'ours'),
          },
          {
            id: 'resolve-theirs',
            label: 'Use theirs',
            disabled: busy,
            onClick: () => resolveConflict(projectId, revision, file.path, 'theirs'),
          },
          {
            id: 'resolve-mark',
            label: 'Mark resolved',
            disabled: busy,
            onClick: () => resolveConflict(projectId, revision, file.path, 'markResolved'),
          }
        );
      }
      if (!file.staged) {
        items.push({
          id: 'stage',
          label: 'Stage',
          disabled: busy,
          onClick: () => stageFile(projectId, revision, file.path),
        });
      }
      if (file.staged) {
        items.push({
          id: 'unstage',
          label: 'Unstage',
          disabled: busy,
          onClick: () => unstageFile(projectId, revision, file.path),
        });
      }
      if (file.unstaged || file.untracked) {
        items.push({
          id: 'discard',
          label: 'Discard changes',
          destructive: true,
          separatorBefore: true,
          disabled: busy,
          onClick: onDiscard,
        });
      }
    }

    return items;
  }, [projectId, file, area, revision, readOnly, busy, onDiscard, loadDiff, stageFile, unstageFile, resolveConflict]);
}

type BranchMenuParams = {
  projectId: string;
  branch: BranchDetail;
  revision?: string;
  readOnly: boolean;
  busy: boolean;
  onCheckout: () => void;
  onDeleteLocal: () => void;
  onDeleteRemote: () => void;
  onRename: () => void;
  onSetUpstream: () => void;
  onUnsetUpstream: () => void;
  onPublish: () => void;
};

export function useBranchContextMenuItems({
  projectId,
  branch,
  revision,
  readOnly,
  busy,
  onCheckout,
  onDeleteLocal,
  onDeleteRemote,
  onRename,
  onSetUpstream,
  onUnsetUpstream,
  onPublish,
}: BranchMenuParams): ContextMenuItemDef[] {
  const switchBranch = useGitStore((s) => s.switchBranch);

  return useMemo((): ContextMenuItemDef[] => {
    const items: ContextMenuItemDef[] = [
      {
        id: 'copy',
        label: 'Copy branch name',
        onClick: () => navigator.clipboard.writeText(branch.shortName),
      },
    ];

    if (!readOnly && revision) {
      if (branch.kind === 'local') {
        if (!branch.current) {
          items.push({
            id: 'checkout',
            label: 'Checkout',
            disabled: busy,
            separatorBefore: true,
            onClick: () => switchBranch(projectId, revision, branch.shortName),
          });
        }
        if (!branch.published) {
          items.push({
            id: 'publish',
            label: 'Publish branch',
            disabled: busy,
            separatorBefore: true,
            onClick: onPublish,
          });
        }
        items.push({
          id: 'rename',
          label: 'Rename branch',
          disabled: busy,
          separatorBefore: !items.some((i) => i.id === 'checkout' || i.id === 'publish'),
          onClick: onRename,
        });
        if (branch.upstreamRef) {
          items.push({
            id: 'unset-upstream',
            label: 'Unset upstream',
            disabled: busy,
            onClick: onUnsetUpstream,
          });
        } else {
          items.push({
            id: 'set-upstream',
            label: 'Set upstream',
            disabled: busy,
            onClick: onSetUpstream,
          });
        }
        if (!branch.current) {
          items.push({
            id: 'delete',
            label: 'Delete branch',
            destructive: true,
            separatorBefore: true,
            disabled: busy,
            onClick: onDeleteLocal,
          });
        }
      }

      if (branch.kind === 'remote') {
        items.push({
          id: 'checkout-tracking',
          label: 'Checkout as local branch',
          disabled: busy,
          separatorBefore: true,
          onClick: onCheckout,
        });
        items.push({
          id: 'delete-remote',
          label: 'Delete remote branch',
          destructive: true,
          disabled: busy,
          onClick: onDeleteRemote,
        });
      }
    }

    return items;
  }, [
    projectId,
    branch,
    revision,
    readOnly,
    busy,
    onCheckout,
    onDeleteLocal,
    onDeleteRemote,
    onRename,
    onSetUpstream,
    onUnsetUpstream,
    onPublish,
    switchBranch,
  ]);
}

type StashMenuParams = {
  projectId: string;
  index: number;
  revision?: string;
  readOnly: boolean;
  busy: boolean;
  onApply: () => void;
  onPop: () => void;
  onDrop: () => void;
  onCreateBranch: () => void;
};

export function useStashContextMenuItems({
  revision,
  readOnly,
  busy,
  onApply,
  onPop,
  onDrop,
  onCreateBranch,
}: StashMenuParams): ContextMenuItemDef[] {
  return useMemo((): ContextMenuItemDef[] => {
    if (readOnly || !revision) return [];

    return [
      {
        id: 'apply',
        label: 'Apply stash',
        disabled: busy,
        onClick: onApply,
      },
      {
        id: 'pop',
        label: 'Pop stash',
        disabled: busy,
        onClick: onPop,
      },
      {
        id: 'branch',
        label: 'Create branch from stash',
        disabled: busy,
        onClick: onCreateBranch,
      },
      {
        id: 'drop',
        label: 'Drop stash',
        destructive: true,
        separatorBefore: true,
        disabled: busy,
        onClick: onDrop,
      },
    ];
  }, [revision, readOnly, busy, onApply, onPop, onDrop, onCreateBranch]);
}

type StashFileMenuParams = {
  readOnly: boolean;
  revision?: string;
  busy: boolean;
  onRestore: () => void;
};

export function useStashFileContextMenuItems({
  readOnly,
  revision,
  busy,
  onRestore,
}: StashFileMenuParams): ContextMenuItemDef[] {
  return useMemo((): ContextMenuItemDef[] => {
    if (readOnly || !revision) return [];
    return [
      {
        id: 'restore-file',
        label: 'Restore file',
        disabled: busy,
        onClick: onRestore,
      },
    ];
  }, [revision, readOnly, busy, onRestore]);
}

type CommitMenuParams = {
  projectId: string;
  commit: HistoryCommit;
  revision?: string;
  readOnly: boolean;
  busy: boolean;
  compareBaseOid?: string;
  onCreateBranch: () => void;
  onCreateTag: () => void;
  onSetCompareBase: () => void;
  onCompareWithBase: () => void;
};

export function useCommitContextMenuItems({
  projectId,
  commit,
  revision,
  readOnly,
  busy,
  compareBaseOid,
  onCreateBranch,
  onCreateTag,
  onSetCompareBase,
  onCompareWithBase,
}: CommitMenuParams): ContextMenuItemDef[] {
  const cherryPick = useGitStore((s) => s.cherryPick);
  const revertCommit = useGitStore((s) => s.revertCommit);

  return useMemo((): ContextMenuItemDef[] => {
    const items: ContextMenuItemDef[] = [
      {
        id: 'copy-subject',
        label: 'Copy subject',
        onClick: () => navigator.clipboard.writeText(commit.subject),
      },
      {
        id: 'copy-full',
        label: 'Copy commit hash',
        onClick: () => navigator.clipboard.writeText(commit.oid),
      },
      {
        id: 'copy-short',
        label: 'Copy abbreviated hash',
        onClick: () => navigator.clipboard.writeText(commit.abbreviatedOid),
      },
      {
        id: 'set-compare-base',
        label: 'Set as compare base',
        onClick: onSetCompareBase,
      },
      ...(compareBaseOid && compareBaseOid !== commit.oid
        ? [
            {
              id: 'compare-with-base',
              label: 'Compare with selected…',
              disabled: busy,
              onClick: onCompareWithBase,
            },
          ]
        : []),
    ];

    if (!readOnly && revision) {
      items.push(
        {
          id: 'cherry-pick',
          label: 'Cherry-pick',
          disabled: busy,
          separatorBefore: true,
          onClick: () => cherryPick(projectId, revision, commit.oid),
        },
        {
          id: 'revert',
          label: 'Revert commit',
          disabled: busy,
          onClick: () => revertCommit(projectId, revision, commit.oid),
        },
        {
          id: 'create-branch',
          label: 'Create branch…',
          disabled: busy,
          onClick: onCreateBranch,
        },
        {
          id: 'create-tag',
          label: 'Create tag…',
          disabled: busy,
          onClick: onCreateTag,
        }
      );
    }

    return items;
  }, [
    projectId,
    commit,
    revision,
    readOnly,
    busy,
    onCreateBranch,
    onCreateTag,
    onSetCompareBase,
    onCompareWithBase,
    compareBaseOid,
    cherryPick,
    revertCommit,
  ]);
}

export function useDiffContextMenuItems(path?: string): ContextMenuItemDef[] {
  return useMemo((): ContextMenuItemDef[] => {
    if (!path) return [];
    return [
      {
        id: 'copy-path',
        label: 'Copy path',
        onClick: () => navigator.clipboard.writeText(path),
      },
    ];
  }, [path]);
}

export function useActiveRepositoryContextMenuItems(projectId: string): ContextMenuItemDef[] {
  const refreshRepo = useGitStore((s) => s.refreshRepo);
  const openInEditor = useGitStore((s) => s.openInEditor);
  const openInTerminal = useGitStore((s) => s.openInTerminal);
  const openInFileExplorer = useGitStore((s) => s.openInFileExplorer);
  const fetch = useGitStore((s) => s.fetch);
  const pull = useGitStore((s) => s.pull);
  const push = useGitStore((s) => s.push);
  const snapshot = useGitStore((s) => s.repos[projectId]?.snapshot);
  const operation = useGitStore((s) => s.operationByRepo[projectId]);
  const readOnly = Boolean(snapshot?.blockedOperation);
  const busy = Boolean(operation);
  const revision = snapshot?.revision;
  const canSync = !readOnly && snapshot?.upstream.kind === 'tracking' && revision;

  return useMemo((): ContextMenuItemDef[] => {
    const items: ContextMenuItemDef[] = [
      {
        id: 'refresh',
        label: 'Refresh repository',
        disabled: busy,
        onClick: () => refreshRepo(projectId),
      },
      { id: 'editor', label: 'Open in editor', onClick: () => openInEditor(projectId) },
      { id: 'terminal', label: 'Open in terminal', onClick: () => openInTerminal(projectId) },
      {
        id: 'explorer',
        label: 'Reveal in file explorer',
        onClick: () => openInFileExplorer(projectId),
      },
    ];

    if (revision) {
      items.push({
        id: 'fetch',
        label: 'Fetch',
        disabled: busy,
        separatorBefore: true,
        onClick: () => fetch(projectId, revision),
      });
      if (canSync) {
        items.push(
          {
            id: 'pull',
            label: 'Pull',
            disabled: busy,
            onClick: () => pull(projectId, revision),
          },
          {
            id: 'push',
            label: 'Push',
            disabled: busy,
            onClick: () => push(projectId, revision),
          }
        );
      }
    }

    return items;
  }, [
    projectId,
    revision,
    canSync,
    busy,
    refreshRepo,
    openInEditor,
    openInTerminal,
    openInFileExplorer,
    fetch,
    pull,
    push,
  ]);
}
