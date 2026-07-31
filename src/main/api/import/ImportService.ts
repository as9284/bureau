import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  ApiCollectionNode,
  ApiImportPreview,
  ApiImportConflictStrategy,
  ApiImportReport,
  ApiInterchangeFormat,
  ApiRequestDefinition,
} from '@shared/contracts/apiWorkbench';
import type { ApiSettings } from '@shared/contracts/settings';
import type { NativeDialogAdapter } from '../../system/dialogAdapter';
import type { ApiWorkspaceFileV1 } from '../ApiWorkspaceStore';
import { importBureau } from './BureauImporter';
import { importCurl } from './CurlImporter';
import { importHar } from './HarImporter';
import { importOpenApi } from './OpenApiImporter';
import { importPostman } from './PostmanImporter';
import {
  DEFAULT_IMPORT_DEPTH,
  ImportError,
  assertWithinBytes,
  detectFormat,
  summarizeEnvironments,
  type ImportDraft,
  type ImportLimits,
} from './importSupport';

/** How long an un-committed preview is retained before it is discarded. */
const PREVIEW_TTL_MS = 30 * 60_000;
const MAX_PENDING_PREVIEWS = 8;

type PendingPreview = {
  previewId: string;
  workspaceId: string;
  draft: ImportDraft;
  createdAt: number;
};

export type ImportService = {
  inspect(input: {
    workspaceId: string;
    format: ApiInterchangeFormat | 'auto';
    text?: string;
    fromFile?: boolean;
    settings: ApiSettings;
    existingNames: (parentId: string | null) => string[];
    existingEnvironmentNames: () => string[];
  }): Promise<
    { ok: true; preview: ApiImportPreview } | { ok: false; code: string; message: string }
  >;
  /** Applies a preview to a workspace file. Pure: the caller performs the single atomic write. */
  commit(input: {
    previewId: string;
    workspaceId: string;
    parentId: string | null;
    conflictStrategy: ApiImportConflictStrategy;
    file: ApiWorkspaceFileV1;
  }):
    | { ok: true; file: ApiWorkspaceFileV1; report: ApiImportReport }
    | { ok: false; code: string; message: string };
  discard(previewId: string): void;
  dispose(): void;
};

export function createImportService(dialog: NativeDialogAdapter): ImportService {
  const previews = new Map<string, PendingPreview>();

  function prune(): void {
    const cutoff = Date.now() - PREVIEW_TTL_MS;
    for (const [id, preview] of previews) {
      if (preview.createdAt < cutoff) previews.delete(id);
    }
    // Bound the map regardless of age so a user who never commits cannot grow it forever.
    while (previews.size > MAX_PENDING_PREVIEWS) {
      const oldest = [...previews.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
      if (!oldest) break;
      previews.delete(oldest[0]);
    }
  }

  async function readSource(
    fromFile: boolean | undefined,
    text: string | undefined,
    limits: ImportLimits
  ): Promise<{ ok: true; content: string; label: string } | { ok: false; code: string; message: string }> {
    if (fromFile) {
      // The path comes from a main-owned picker; the renderer never supplies one.
      const chosen = await dialog.showOpenFileDialog({
        title: 'Import into the API workspace',
        filters: [
          { name: 'API interchange', extensions: ['json', 'yaml', 'yml', 'har', 'txt', 'sh'] },
          { name: 'All files', extensions: ['*'] },
        ],
      });
      if (!chosen) return { ok: false, code: 'API_CANCELLED', message: 'The import was cancelled.' };

      let stat: Awaited<ReturnType<typeof fs.stat>>;
      try {
        stat = await fs.stat(chosen);
      } catch {
        return { ok: false, code: 'API_IMPORT_INVALID', message: 'The file could not be read.' };
      }
      // Size is checked before reading so an oversized file is never loaded into memory.
      if (stat.size > limits.maxBytes) {
        return {
          ok: false,
          code: 'API_IMPORT_LIMIT_EXCEEDED',
          message: `The file is ${Math.round(stat.size / 1024 / 1024)} MiB, over the ${Math.round(
            limits.maxBytes / 1024 / 1024
          )} MiB import limit.`,
        };
      }
      try {
        const content = await fs.readFile(chosen, 'utf8');
        return { ok: true, content, label: path.basename(chosen) };
      } catch {
        return { ok: false, code: 'API_IMPORT_INVALID', message: 'The file could not be read as text.' };
      }
    }

    if (!text?.trim()) {
      return { ok: false, code: 'API_IMPORT_INVALID', message: 'There is nothing to import.' };
    }
    return { ok: true, content: text, label: 'Pasted text' };
  }

  return {
    async inspect(input) {
      prune();
      const limits: ImportLimits = {
        maxBytes: input.settings.importFileBytes,
        maxNodes: input.settings.importNodeCap,
        maxDepth: DEFAULT_IMPORT_DEPTH,
      };

      const source = await readSource(input.fromFile, input.text, limits);
      if (!source.ok) return source;

      let draft: ImportDraft;
      try {
        assertWithinBytes(source.content, limits);
        const format = input.format === 'auto' ? detectFormat(source.content) : input.format;
        if (!format) {
          return {
            ok: false,
            code: 'API_IMPORT_INVALID',
            message:
              'The format could not be detected. Choose cURL, Postman, OpenAPI, HAR, or Bureau explicitly.',
          };
        }
        draft = runImporter(format, source.content, limits, source.label);
      } catch (error) {
        if (error instanceof ImportError) return { ok: false, code: error.code, message: error.message };
        return {
          ok: false,
          code: 'API_IMPORT_INVALID',
          message: error instanceof Error ? error.message : 'The import could not be parsed.',
        };
      }

      // Nothing is executed or fetched during preview — only parsed and counted.
      const previewId = randomUUID();
      previews.set(previewId, {
        previewId,
        workspaceId: input.workspaceId,
        draft,
        createdAt: Date.now(),
      });

      const taken = new Set(input.existingNames(null));
      const environmentNames = new Set(input.existingEnvironmentNames());
      const environments = summarizeEnvironments(draft).map((environment) => ({
        ...environment,
        conflict: environmentNames.has(environment.name),
      }));

      const nodes = draft.nodes.map((node) => ({
        ...node,
        // Only root-level nodes can collide before a destination is chosen.
        conflict: node.parentTempId === null && taken.has(node.name),
      }));

      const scripts = draft.nodes.filter((node) => node.hasScripts).length;
      const secrets = draft.environments.reduce(
        (total, environment) => total + environment.variables.filter((variable) => variable.secret).length,
        0
      );

      return {
        ok: true,
        preview: {
          previewId,
          format: draft.format,
          sourceLabel: draft.sourceLabel,
          nodes,
          environments,
          warnings: draft.warnings,
          counts: {
            folders: draft.nodes.filter((node) => node.kind === 'folder').length,
            requests: draft.nodes.filter((node) => node.kind === 'request').length,
            environments: draft.environments.length,
            scripts,
            secrets,
          },
          truncated: draft.truncated,
        },
      };
    },

    commit(input) {
      const pending = previews.get(input.previewId);
      if (!pending) {
        return {
          ok: false,
          code: 'API_IMPORT_INVALID',
          message: 'The import preview expired. Inspect the source again.',
        };
      }
      if (pending.workspaceId !== input.workspaceId) {
        return {
          ok: false,
          code: 'API_IMPORT_INVALID',
          message: 'The preview belongs to a different workspace.',
        };
      }

      const result = applyDraft(pending.draft, input.file, input.parentId, input.conflictStrategy);
      previews.delete(input.previewId);
      return { ok: true, ...result };
    },

    discard(previewId) {
      previews.delete(previewId);
    },

    dispose() {
      previews.clear();
    },
  };
}

function runImporter(
  format: ApiInterchangeFormat,
  content: string,
  limits: ImportLimits,
  label: string
): ImportDraft {
  switch (format) {
    case 'curl':
      return importCurl(content, limits, label);
    case 'postman':
      return importPostman(content, limits, label);
    case 'openapi':
      return importOpenApi(content, limits, label);
    case 'har':
      return importHar(content, limits, label);
    case 'bureau':
      return importBureau(content, limits, label);
  }
}

/**
 * Turns a draft into a new workspace file.
 *
 * Builds the whole next state before returning, so the caller writes it once. A failure part-way
 * through leaves `file` untouched — there is no partial-write path to roll back.
 */
function applyDraft(
  draft: ImportDraft,
  file: ApiWorkspaceFileV1,
  parentId: string | null,
  strategy: ApiImportConflictStrategy
): { file: ApiWorkspaceFileV1; report: ApiImportReport } {
  const report: ApiImportReport = {
    createdFolders: 0,
    createdRequests: 0,
    createdEnvironments: 0,
    renamed: 0,
    replaced: 0,
    skipped: 0,
    scriptsImportedDisabled: 0,
    warnings: [...draft.warnings],
  };

  const collections = [...file.collections];
  const requests = [...file.requests];
  const environments = [...file.environments];
  const stamp = new Date().toISOString();

  const orderFor = (parent: string | null): number =>
    collections.filter((node) => node.parentId === parent).reduce((max, node) => Math.max(max, node.order), -1) + 1;

  /** Names already used under a parent, so rename/replace/skip can be decided per destination. */
  const siblingsOf = (parent: string | null): ApiCollectionNode[] =>
    collections.filter((node) => node.parentId === parent);

  const idMap = new Map<string, string>();
  const skipped = new Set<string>();

  for (const node of draft.nodes) {
    const parent =
      node.parentTempId === null ? parentId : (idMap.get(node.parentTempId) ?? null);

    // A node whose parent was skipped is skipped too, rather than being re-homed.
    if (node.parentTempId !== null && skipped.has(node.parentTempId)) {
      skipped.add(node.tempId);
      report.skipped += 1;
      continue;
    }

    const existing = siblingsOf(parent).find((sibling) => sibling.name === node.name);
    let name = node.name;

    if (existing) {
      if (strategy === 'skip') {
        skipped.add(node.tempId);
        report.skipped += 1;
        continue;
      }
      if (strategy === 'replace') {
        // Remove the existing subtree so the imported one takes its place cleanly.
        const doomed = subtreeIds(collections, existing.collectionId);
        for (const id of doomed) {
          const index = collections.findIndex((entry) => entry.collectionId === id);
          if (index >= 0) {
            const [removed] = collections.splice(index, 1);
            if (removed.requestId) {
              const requestIndex = requests.findIndex((r) => r.requestId === removed.requestId);
              if (requestIndex >= 0) requests.splice(requestIndex, 1);
            }
          }
        }
        report.replaced += 1;
      } else {
        name = uniqueName(node.name, siblingsOf(parent).map((sibling) => sibling.name));
        report.renamed += 1;
      }
    }

    const collectionId = randomUUID();
    idMap.set(node.tempId, collectionId);

    if (node.kind === 'folder') {
      collections.push({
        collectionId,
        workspaceId: file.summary.workspaceId,
        parentId: parent,
        kind: 'folder',
        name,
        order: orderFor(parent),
        variables: [],
        revision: 1,
      });
      report.createdFolders += 1;
      continue;
    }

    const drafted = draft.requests.get(node.tempId);
    if (!drafted) continue;

    const requestId = randomUUID();
    const definition: ApiRequestDefinition = {
      ...drafted,
      name,
      requestId,
      collectionId,
      workspaceId: file.summary.workspaceId,
      // Scripts arrive disabled and marked untrusted: the source is kept, but nothing runs until
      // the user reviews it in the approval dialog. `enabled` is forced here rather than trusted
      // from the importer, so no future importer can opt out of it.
      scripts:
        drafted.scripts.preRequest ?? drafted.scripts.postResponse
          ? { ...drafted.scripts, enabled: false, origin: 'imported' as const }
          : drafted.scripts,
      revision: 1,
      createdAt: stamp,
      updatedAt: stamp,
    };
    if (definition.scripts.preRequest ?? definition.scripts.postResponse) {
      report.scriptsImportedDisabled += 1;
    }

    requests.push(definition);
    collections.push({
      collectionId,
      workspaceId: file.summary.workspaceId,
      parentId: parent,
      kind: 'request',
      name,
      order: orderFor(parent),
      requestId,
      variables: [],
      revision: 1,
    });
    report.createdRequests += 1;
  }

  for (const environment of draft.environments) {
    const conflict = environments.some((existing) => existing.name === environment.name);
    if (conflict && strategy === 'skip') {
      report.skipped += 1;
      continue;
    }
    const name = conflict && strategy === 'rename'
      ? uniqueName(environment.name, environments.map((existing) => existing.name))
      : environment.name;
    if (conflict && strategy === 'replace') {
      const index = environments.findIndex((existing) => existing.name === environment.name);
      if (index >= 0) environments.splice(index, 1);
    }

    environments.push({
      environmentId: randomUUID(),
      workspaceId: file.summary.workspaceId,
      name,
      variables: environment.variables.map((variable) => ({
        variableId: randomUUID(),
        name: variable.name,
        enabled: variable.enabled,
        secret: variable.secret,
        // A secret imported without a value has no vault handle until the user creates one.
        value: variable.secret ? undefined : variable.value,
        hasSecretValue: false,
      })),
      revision: 1,
      createdAt: stamp,
      updatedAt: stamp,
    });
    report.createdEnvironments += 1;
  }

  return {
    file: { ...file, collections, requests, environments },
    report,
  };
}

function subtreeIds(collections: ApiCollectionNode[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of collections) {
      if (node.parentId && ids.has(node.parentId) && !ids.has(node.collectionId)) {
        ids.add(node.collectionId);
        grew = true;
      }
    }
  }
  return ids;
}

/** `Name` → `Name (2)`, `Name (3)`, … avoiding anything already taken. */
export function uniqueName(base: string, taken: string[]): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base} (${suffix})`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base} (${randomUUID().slice(0, 8)})`;
}
