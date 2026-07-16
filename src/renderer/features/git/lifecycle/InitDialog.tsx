import { useEffect, useState, type ReactElement } from 'react';
import { useGitStore } from '@renderer/store/gitStore';
import { Button } from '@renderer/components/Button';
import { Checkbox } from '@renderer/components/Checkbox';
import { Dialog } from '@renderer/components/Dialog';
import { TextInput } from '@renderer/components/TextInput';
import { PanelError } from '@renderer/features/git/PanelState';
import './LifecycleDialog.css';

export function InitDialog(): ReactElement {
  const open = useGitStore((s) => s.initDialogOpen);
  const setOpen = useGitStore((s) => s.setInitDialogOpen);
  const initRepository = useGitStore((s) => s.initRepository);
  const initBusy = useGitStore((s) => s.initBusy);
  const initError = useGitStore((s) => s.initError);

  const [directory, setDirectory] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [createReadme, setCreateReadme] = useState(false);
  const [createGitignore, setCreateGitignore] = useState(false);

  useEffect(() => {
    if (!open) {
      setDirectory('');
      setDefaultBranch('main');
      setCreateReadme(false);
      setCreateGitignore(false);
    }
  }, [open]);

  const browseDirectory = async () => {
    const result = await window.bureau.system.chooseDirectory({
      title: 'Choose directory to initialize',
      buttonLabel: 'Select',
    });
    if (!result.cancelled && result.path) {
      setDirectory(result.path);
    }
  };

  const canSubmit = directory.trim().length > 0 && !initBusy;

  return (
    <Dialog
      open={open}
      title="Initialize repository"
      description="Create a Git repository in an existing folder or a new one. Existing files are preserved."
      onClose={() => {
        if (!initBusy) setOpen(false);
      }}
      actions={
        <>
          <Button variant="secondary" disabled={initBusy} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={initBusy}
            disabled={!canSubmit}
            onClick={() =>
              initRepository({
                directory: directory.trim(),
                defaultBranch: defaultBranch.trim() || 'main',
                createReadme,
                createGitignore,
              })
            }
          >
            Initialize
          </Button>
        </>
      }
    >
      <div className="lifecycle-dialog__fields">
        {/* As in CloneDialog: the form stays put, so Initialize is the retry. */}
        {initError ? <PanelError title="Could not initialize" message={initError.message} /> : null}
        {initBusy ? (
          <p className="lifecycle-dialog__status" role="status">
            Initializing repository…
          </p>
        ) : null}
        <div className="lifecycle-dialog__path-row">
          <TextInput
            label="Directory path"
            value={directory}
            onChange={(e) => setDirectory(e.target.value)}
            placeholder="C:\Projects\my-app"
          />
          <Button variant="secondary" onClick={() => browseDirectory()}>
            Browse…
          </Button>
        </div>
        <TextInput
          label="Default branch"
          value={defaultBranch}
          onChange={(e) => setDefaultBranch(e.target.value)}
          placeholder="main"
        />
        <Checkbox
          checked={createReadme}
          onCheckedChange={setCreateReadme}
          label="Create README.md"
        />
        <Checkbox
          checked={createGitignore}
          onCheckedChange={setCreateGitignore}
          label="Create .gitignore"
        />
      </div>
    </Dialog>
  );
}
