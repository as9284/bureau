import { useEffect } from 'react';
import { useAppStore } from '@renderer/store/appStore';
import { ensureGitProject, useGitStore } from '@renderer/store/gitStore';
import { GitWorkbench } from '@renderer/features/git/workbench/GitWorkbench';
import { Button } from '@renderer/components/Button';
import { EmptyState } from '@renderer/components/EmptyState';

type Props = { projectId: string };

/** Bridges Bureau's selected project into the StarGit-ported git workbench store. */
export function GitTab({ projectId }: Props) {
  const project = useAppStore((s) => s.projects.find((p) => p.projectId === projectId));
  const settings = useAppStore((s) => s.settings);
  const refreshRepo = useGitStore((s) => s.refreshRepo);
  const repo = useGitStore((s) => s.repos[projectId]);
  const setCloneDialogOpen = useGitStore((s) => s.setCloneDialogOpen);
  const setInitDialogOpen = useGitStore((s) => s.setInitDialogOpen);

  useEffect(() => {
    if (!project) return;
    ensureGitProject({
      projectId: project.projectId,
      path: project.path,
      name: project.name,
    });
    if (settings) {
      useGitStore.setState({ settings });
    }
    void refreshRepo(projectId);
  }, [project, projectId, refreshRepo, settings]);

  if (!project) return null;

  const snap = repo?.snapshot;
  const refreshing = repo?.refreshing && !snap;

  if (refreshing) {
    return (
      <div className="empty-state">
        <p>Refreshing Git status…</p>
      </div>
    );
  }

  const notRepo =
    snap?.availability === 'unavailable' ||
    repo?.error?.code === 'NOT_A_WORKTREE' ||
    (!snap && Boolean(repo?.error));

  if (notRepo) {
    const description =
      repo?.error?.code === 'NOT_A_WORKTREE' || snap?.availability === 'unavailable'
        ? 'This folder is not a Git repository yet.'
        : (repo?.error?.message ?? 'This folder is not a Git repository yet.');
    return (
      <EmptyState
        title="No Git repository"
        description={description}
        actions={
          <>
            <Button variant="primary" onClick={() => setInitDialogOpen(true)}>
              Init repository
            </Button>
            <Button variant="secondary" onClick={() => setCloneDialogOpen(true)}>
              Clone repository
            </Button>
          </>
        }
      />
    );
  }

  return <GitWorkbench projectId={projectId} />;
}
