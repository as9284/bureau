import type { ContextMenuItem } from '@renderer/store/appStore';
import { copyText } from '@renderer/lib/contextMenu';
import type {
  ApiCollectionNode,
  ApiCookie,
  ApiEntityId,
  ApiEnvironment,
  ApiHistorySummary,
  ApiResponsePreview,
  ApiSecretSummary,
  ApiStreamEntry,
} from '@shared/contracts/apiWorkbench';

/** Copy a request as cURL via the export planner without opening the export dialog. */
export async function copyRequestAsCurl(
  workspaceId: ApiEntityId,
  requestId: ApiEntityId
): Promise<boolean> {
  const result = await window.bureau.api.planExport({
    workspaceId,
    format: 'curl',
    scope: { kind: 'request', requestId },
  });
  if (!result.ok || !result.plan.inlinePreview) return false;
  copyText(result.plan.inlinePreview);
  return true;
}

type CollectionMenuActions = {
  open(): void;
  createFolder(): void;
  createRequest(): void;
  rename(): void;
  duplicate(): void;
  copyAsCurl(): void;
  copyId(): void;
  remove(): void;
};

/** Context menu for a collections-tree row (folder or request). */
export function buildCollectionMenuItems(
  node: ApiCollectionNode & { depth?: number },
  actions: CollectionMenuActions
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];

  if (node.kind === 'request') {
    items.push(
      { type: 'item', label: 'Open', onSelect: actions.open },
      { type: 'separator' },
      { type: 'item', label: 'Copy as cURL', onSelect: actions.copyAsCurl },
      { type: 'item', label: 'Copy request ID', onSelect: actions.copyId }
    );
  } else {
    items.push(
      { type: 'item', label: 'New folder', onSelect: actions.createFolder },
      { type: 'item', label: 'New request', onSelect: actions.createRequest },
      { type: 'separator' },
      { type: 'item', label: 'Copy folder ID', onSelect: actions.copyId }
    );
  }

  items.push(
    { type: 'separator' },
    { type: 'item', label: 'Rename…', onSelect: actions.rename },
    { type: 'item', label: 'Duplicate', onSelect: actions.duplicate },
    { type: 'separator' },
    {
      type: 'item',
      label: node.kind === 'folder' ? 'Delete folder' : 'Delete request',
      danger: true,
      onSelect: actions.remove,
    }
  );

  return items;
}

/** Empty-space menu for the collections tree. */
export function buildCollectionBackgroundMenuItems(actions: {
  createFolder(): void;
  createRequest(): void;
}): ContextMenuItem[] {
  return [
    { type: 'item', label: 'New folder', onSelect: actions.createFolder },
    { type: 'item', label: 'New request', onSelect: actions.createRequest },
  ];
}

type DocumentTabMenuActions = {
  close(): void;
  closeOthers(): void;
  closeAll(): void;
  save(): void;
  discard(): void;
  copyAsCurl(): void;
  remove(): void;
};

/** Context menu for an open request document tab. */
export function buildDocumentTabMenuItems(
  options: { dirty: boolean; canCloseOthers: boolean; canSave: boolean },
  actions: DocumentTabMenuActions
): ContextMenuItem[] {
  return [
    { type: 'item', label: 'Close', onSelect: actions.close },
    {
      type: 'item',
      label: 'Close Others',
      onSelect: actions.closeOthers,
      disabled: !options.canCloseOthers,
    },
    { type: 'item', label: 'Close All', onSelect: actions.closeAll },
    { type: 'separator' },
    {
      type: 'item',
      label: 'Save',
      onSelect: actions.save,
      disabled: !options.canSave,
    },
    {
      type: 'item',
      label: 'Discard changes',
      onSelect: actions.discard,
      disabled: !options.dirty,
    },
    { type: 'separator' },
    { type: 'item', label: 'Copy as cURL', onSelect: actions.copyAsCurl },
    { type: 'separator' },
    { type: 'item', label: 'Delete request', danger: true, onSelect: actions.remove },
  ];
}

type HistoryMenuActions = {
  open(): void;
  copyUrl(): void;
  copyAsCurl(): void;
  refresh(): void;
};

/** Context menu for a history row. */
export function buildHistoryMenuItems(
  entry: ApiHistorySummary,
  actions: HistoryMenuActions
): ContextMenuItem[] {
  return [
    {
      type: 'item',
      label: 'Open request',
      onSelect: actions.open,
      disabled: !entry.requestId,
    },
    { type: 'separator' },
    { type: 'item', label: 'Copy URL', onSelect: actions.copyUrl },
    {
      type: 'item',
      label: 'Copy as cURL',
      onSelect: actions.copyAsCurl,
      disabled: !entry.requestId,
    },
    { type: 'separator' },
    { type: 'item', label: 'Refresh history', onSelect: actions.refresh },
  ];
}

type EnvironmentMenuActions = {
  setActive(): void;
  duplicate(): void;
  remove(): void;
};

/** Context menu for an environment card. */
export function buildEnvironmentMenuItems(
  environment: ApiEnvironment,
  options: { isActive: boolean },
  actions: EnvironmentMenuActions
): ContextMenuItem[] {
  return [
    {
      type: 'item',
      label: options.isActive ? 'Active environment' : 'Set as active',
      onSelect: actions.setActive,
      disabled: options.isActive,
    },
    { type: 'item', label: 'Duplicate', onSelect: actions.duplicate },
    { type: 'separator' },
    {
      type: 'item',
      label: `Delete “${environment.name}”`,
      danger: true,
      onSelect: actions.remove,
    },
  ];
}

/** Context menu for a secret row (values are never revealed). */
export function buildSecretMenuItems(
  secret: ApiSecretSummary,
  actions: { copyLabel(): void; remove(): void }
): ContextMenuItem[] {
  return [
    { type: 'item', label: 'Copy label', onSelect: actions.copyLabel },
    { type: 'separator' },
    {
      type: 'item',
      label: `Delete “${secret.label}”`,
      danger: true,
      onSelect: actions.remove,
    },
  ];
}

/** Context menu for a cookie row. */
export function buildCookieMenuItems(
  cookie: ApiCookie,
  actions: {
    edit(): void;
    copyName(): void;
    copyValue(): void;
    remove(): void;
  }
): ContextMenuItem[] {
  return [
    { type: 'item', label: 'Edit…', onSelect: actions.edit },
    { type: 'separator' },
    { type: 'item', label: 'Copy name', onSelect: actions.copyName },
    { type: 'item', label: 'Copy value', onSelect: actions.copyValue },
    { type: 'separator' },
    {
      type: 'item',
      label: `Delete “${cookie.name}”`,
      danger: true,
      onSelect: actions.remove,
    },
  ];
}

/** Context menu for the response inspector surface. */
export function buildResponseMenuItems(
  response: ApiResponsePreview,
  actions: {
    copyStatus(): void;
    copyBody(): void;
    copyHeaders(): void;
  }
): ContextMenuItem[] {
  const hasBody = Boolean(response.bodyText);
  return [
    { type: 'item', label: 'Copy status line', onSelect: actions.copyStatus },
    {
      type: 'item',
      label: 'Copy body',
      onSelect: actions.copyBody,
      disabled: !hasBody,
    },
    {
      type: 'item',
      label: 'Copy headers',
      onSelect: actions.copyHeaders,
      disabled: response.headers.length === 0,
    },
  ];
}

/** Context menu for a stream transcript row. */
export function buildStreamEntryMenuItems(
  entry: ApiStreamEntry,
  actions: { copyPayload(): void; copyLine(): void }
): ContextMenuItem[] {
  const hasText = Boolean(entry.text ?? entry.reason);
  return [
    {
      type: 'item',
      label: 'Copy payload',
      onSelect: actions.copyPayload,
      disabled: !hasText,
    },
    {
      type: 'item',
      label: 'Copy line',
      onSelect: actions.copyLine,
      disabled: !hasText,
    },
  ];
}

export function formatResponseHeaders(response: ApiResponsePreview): string {
  return response.headers.map((header) => `${header.name}: ${header.value}`).join('\n');
}

export function formatStreamLine(entry: ApiStreamEntry): string {
  const time = entry.at.slice(11, 23);
  const label =
    entry.kind === 'sse-event'
      ? (entry.eventName ?? 'message')
      : entry.kind === 'close'
        ? `close ${entry.code ?? ''}`
        : entry.kind;
  const payload = entry.text ?? entry.reason ?? '';
  return `${time} ${label} ${payload}`.trim();
}

/** Ask for a new name; returns null when cancelled or unchanged/blank. */
export function promptRename(currentName: string, title: string): string | null {
  const next = window.prompt(title, currentName);
  if (next === null) return null;
  const trimmed = next.trim();
  if (!trimmed || trimmed === currentName) return null;
  return trimmed;
}
