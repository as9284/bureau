import { useAppStore } from '../store/appStore';
import { Button } from './Button';
import { Dialog } from './Dialog';

export function ProjectRemoveDialog() {
  const projectId = useAppStore((state) => state.pendingProjectRemoval);
  const project = useAppStore((state) => state.projects.find((entry) => entry.projectId === projectId));
  const files = useAppStore((state) => projectId ? state.filesByProject[projectId] : undefined);
  const saveAllFiles = useAppStore((state) => state.saveAllFiles);
  const closeFile = useAppStore((state) => state.closeFile);
  const removeProject = useAppStore((state) => state.removeProject);
  const cancelProjectRemoval = useAppStore((state) => state.cancelProjectRemoval);

  const dirtyPaths = Object.entries(files?.buffers ?? {})
    .filter(([, buffer]) => buffer.kind === 'text' && buffer.dirty)
    .map(([relativePath]) => relativePath);

  const saveAndRemove = async (): Promise<void> => {
    if (!projectId || !(await saveAllFiles(projectId))) return;
    await removeProject(projectId, true);
  };

  const discardAndRemove = async (): Promise<void> => {
    if (!projectId) return;
    for (const relativePath of dirtyPaths) closeFile(projectId, relativePath, true);
    await removeProject(projectId, true);
  };

  return (
    <Dialog
      open={Boolean(projectId)}
      title="Unsaved project files"
      description={`${project?.name ?? 'This project'} has ${dirtyPaths.length} unsaved ${dirtyPaths.length === 1 ? 'file' : 'files'}. Save or explicitly discard them before removing the project from Bureau.`}
      onClose={cancelProjectRemoval}
      actions={
        <>
          <Button variant="ghost" onClick={cancelProjectRemoval}>Cancel</Button>
          <Button variant="danger" onClick={() => void discardAndRemove()}>Discard and Remove</Button>
          <Button variant="primary" onClick={() => void saveAndRemove()}>Save All and Remove</Button>
        </>
      }
    />
  );
}
