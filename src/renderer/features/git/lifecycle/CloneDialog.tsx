import { useEffect, useState, type ReactElement } from 'react';
import { useGitStore } from '@renderer/store/gitStore';
import { Button } from '@renderer/components/Button';
import { Checkbox } from '@renderer/components/Checkbox';
import { Dialog } from '@renderer/components/Dialog';
import { TextInput } from '@renderer/components/TextInput';
import { PanelError } from '@renderer/features/git/PanelState';
import './LifecycleDialog.css';

function folderNameFromUrl(url: string): string {
  const trimmed = url.trim().replace(/\/$/, '');
  if (!trimmed) return '';
  const withoutGit = trimmed.replace(/\.git$/i, '');
  const parts = withoutGit.split(/[/:]/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

export function CloneDialog(): ReactElement {
  const open = useGitStore((s) => s.cloneDialogOpen);
  const setOpen = useGitStore((s) => s.setCloneDialogOpen);
  const cloneRepository = useGitStore((s) => s.cloneRepository);
  const cloneBusy = useGitStore((s) => s.cloneBusy);
  const cloneError = useGitStore((s) => s.cloneError);

  const [url, setUrl] = useState('');
  const [parentDirectory, setParentDirectory] = useState('');
  const [folderName, setFolderName] = useState('');
  const [folderTouched, setFolderTouched] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [depth, setDepth] = useState('');
  const [branch, setBranch] = useState('');

  useEffect(() => {
    if (!open) {
      setUrl('');
      setParentDirectory('');
      setFolderName('');
      setFolderTouched(false);
      setShowAdvanced(false);
      setDepth('');
      setBranch('');
    }
  }, [open]);

  useEffect(() => {
    if (!folderTouched && url.trim()) {
      setFolderName(folderNameFromUrl(url));
    }
  }, [url, folderTouched]);

  const browseParent = async () => {
    const result = await window.bureau.system.chooseDirectory({
      title: 'Choose parent directory',
      buttonLabel: 'Select',
    });
    if (!result.cancelled && result.path) {
      setParentDirectory(result.path);
    }
  };

  const canSubmit =
    url.trim().length > 0 &&
    parentDirectory.trim().length > 0 &&
    folderName.trim().length > 0 &&
    !cloneBusy;

  return (
    <Dialog
      open={open}
      title="Clone repository"
      description="Clone a remote repository into a folder on this machine."
      onClose={() => {
        // Closing mid-clone would strand the operation with no way back to its result.
        if (!cloneBusy) setOpen(false);
      }}
      actions={
        <>
          <Button variant="secondary" disabled={cloneBusy} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={cloneBusy}
            disabled={!canSubmit}
            onClick={() =>
              cloneRepository({
                url: url.trim(),
                parentDirectory: parentDirectory.trim(),
                folderName: folderName.trim(),
                ...(depth.trim() ? { depth: Number(depth) } : {}),
                ...(branch.trim() ? { branch: branch.trim() } : {}),
              })
            }
          >
            Clone
          </Button>
        </>
      }
    >
      <div className="lifecycle-dialog__fields">
        {/* No onRetry: the dialog stays open with the values intact, so Clone below is
            the retry — and a bad URL needs correcting first, not re-sending. */}
        {cloneError ? <PanelError title="Clone failed" message={cloneError.message} /> : null}
        {cloneBusy ? (
          <p className="lifecycle-dialog__status" role="status">
            Cloning repository — this can take a while for a large repository.
          </p>
        ) : null}
        <TextInput
          label="Repository URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/org/repo.git"
        />
        <div className="lifecycle-dialog__path-row">
          <TextInput
            label="Parent directory"
            value={parentDirectory}
            onChange={(e) => setParentDirectory(e.target.value)}
            placeholder="C:\Projects"
          />
          <Button variant="secondary" onClick={() => browseParent()}>
            Browse…
          </Button>
        </div>
        <TextInput
          label="Folder name"
          value={folderName}
          onChange={(e) => {
            setFolderTouched(true);
            setFolderName(e.target.value);
          }}
          placeholder="repo"
        />
        <Checkbox
          checked={showAdvanced}
          onCheckedChange={setShowAdvanced}
          label="Show advanced options"
        />
        {showAdvanced ? (
          <>
            <TextInput
              label="Clone depth"
              value={depth}
              onChange={(e) => setDepth(e.target.value)}
              placeholder="Optional shallow clone depth"
            />
            <TextInput
              label="Branch"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="Optional branch name"
            />
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
