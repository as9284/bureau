import { Button } from '@renderer/components/Button';
import { Dialog } from '@renderer/components/Dialog';

const SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: 'Ctrl+P', action: 'Open a request by name, method or URL' },
  { keys: 'Ctrl+F', action: 'Filter the current sidebar list' },
  { keys: 'Ctrl+Enter', action: 'Send the request — or connect and disconnect a stream' },
  { keys: 'Ctrl+S', action: 'Save the open request' },
  { keys: 'Ctrl+W', action: 'Close the open tab' },
  { keys: 'Ctrl+Tab', action: 'Cycle open tabs (add Shift to go back)' },
  { keys: 'Ctrl+K', action: 'Bureau command palette' },
  { keys: 'Esc', action: 'Leave response focus mode' },
];

/** Shortcuts a user cannot discover by looking at the UI, in one place they can find. */
export function ApiShortcutsDialog({ onClose }: { onClose(): void }) {
  return (
    <Dialog
      open
      title="Keyboard shortcuts"
      description="Available while the API workspace has focus."
      onClose={onClose}
      actions={
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <dl className="api-shortcuts">
        {SHORTCUTS.map((shortcut) => (
          <div key={shortcut.keys} className="api-shortcuts__row">
            <dt className="api-shortcuts__keys mono">{shortcut.keys}</dt>
            <dd className="api-shortcuts__action">{shortcut.action}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
