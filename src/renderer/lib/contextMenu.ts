import type { ContextMenuItem } from '../store/appStore';

function runCommand(el: HTMLElement, command: 'cut' | 'copy' | 'selectAll'): void {
  el.focus();
  document.execCommand(command);
}

function paste(el: HTMLElement): void {
  el.focus();
  navigator.clipboard
    .readText()
    .then((text) => document.execCommand('insertText', false, text))
    .catch(() => undefined);
}

/** Cut/Copy/Paste/Select-all items for an editable field. */
export function buildEditMenuItems(el: HTMLElement): ContextMenuItem[] {
  const field = el as HTMLInputElement;
  const readOnly = Boolean(field.readOnly) || Boolean(field.disabled);
  return [
    { type: 'item', label: 'Cut', onSelect: () => runCommand(el, 'cut'), disabled: readOnly },
    { type: 'item', label: 'Copy', onSelect: () => runCommand(el, 'copy') },
    { type: 'item', label: 'Paste', onSelect: () => paste(el), disabled: readOnly },
    { type: 'separator' },
    { type: 'item', label: 'Select all', onSelect: () => runCommand(el, 'selectAll') },
  ];
}

/** Copies text to the clipboard (used by right-click "Copy command"). */
export function copyText(text: string): void {
  void navigator.clipboard.writeText(text).catch(() => undefined);
}
