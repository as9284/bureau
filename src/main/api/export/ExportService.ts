import fs from 'node:fs/promises';
import type {
  ApiExportPlan,
  ApiExportScope,
  ApiInterchangeFormat,
} from '@shared/contracts/apiWorkbench';
import type { NativeDialogAdapter } from '../../system/dialogAdapter';
import type { ApiWorkspaceFileV1 } from '../ApiWorkspaceStore';
import { exportBureau } from './BureauExporter';
import { exportCurl } from './CurlExporter';
import { exportHar, type HarHistoryEntry } from './HarExporter';
import { exportOpenApi } from './OpenApiExporter';
import { exportPostman } from './PostmanExporter';
import { omission, safeFileStem, type ExportResult, type ExportSource } from './exportSupport';

export type ExportService = {
  /** Renders the export and reports what will be lost, without writing anything. */
  plan(input: {
    file: ApiWorkspaceFileV1;
    format: ApiInterchangeFormat;
    scope: ApiExportScope;
    history: () => Promise<HarHistoryEntry[]>;
  }): Promise<{ ok: true; plan: ApiExportPlan } | { ok: false; code: string; message: string }>;
  /** Re-renders and writes through a main-owned save dialog. */
  commit(input: {
    file: ApiWorkspaceFileV1;
    format: ApiInterchangeFormat;
    scope: ApiExportScope;
    history: () => Promise<HarHistoryEntry[]>;
  }): Promise<{ ok: true; written: boolean } | { ok: false; code: string; message: string }>;
  /**
   * Writes already-rendered text through the same main-owned save dialog. Used by the collection
   * runner's report export, which has nothing to plan: the report already exists and is redacted.
   */
  writeText(input: {
    title: string;
    suggestedFileName: string;
    extensions: string[];
    content: string;
  }): Promise<{ ok: true; written: boolean } | { ok: false; code: string; message: string }>;
};

export function createExportService(dialog: NativeDialogAdapter): ExportService {
  async function render(input: {
    file: ApiWorkspaceFileV1;
    format: ApiInterchangeFormat;
    scope: ApiExportScope;
    history: () => Promise<HarHistoryEntry[]>;
  }): Promise<{ ok: true; result: ExportResult; itemCount: number } | { ok: false; code: string; message: string }> {
    const { file, format, scope } = input;

    if (format === 'har') {
      if (scope.kind !== 'history') {
        return {
          ok: false,
          code: 'API_EXPORT_FAILED',
          message: 'HAR export applies to history entries, not collections.',
        };
      }
      const entries = await input.history();
      if (entries.length === 0) {
        return { ok: false, code: 'API_EXPORT_FAILED', message: 'No history entries were selected.' };
      }
      return {
        ok: true,
        itemCount: entries.length,
        result: exportHar(entries, file.summary.name, { redactSecrets: true }),
      };
    }

    if (scope.kind === 'history') {
      return {
        ok: false,
        code: 'API_EXPORT_FAILED',
        message: 'Only HAR can export history entries.',
      };
    }

    if (format === 'curl') {
      if (scope.kind !== 'request') {
        return {
          ok: false,
          code: 'API_EXPORT_FAILED',
          message: 'cURL export applies to a single request.',
        };
      }
      const request = file.requests.find((entry) => entry.requestId === scope.requestId);
      if (!request) {
        return { ok: false, code: 'API_REQUEST_NOT_FOUND', message: 'The request no longer exists.' };
      }
      return { ok: true, itemCount: 1, result: exportCurl(request), };
    }

    const rootId = scope.kind === 'collection' ? scope.collectionId : null;
    if (scope.kind === 'collection') {
      const node = file.collections.find((entry) => entry.collectionId === scope.collectionId);
      if (!node) {
        return { ok: false, code: 'API_REQUEST_NOT_FOUND', message: 'The folder no longer exists.' };
      }
    }
    if (scope.kind === 'request') {
      return {
        ok: false,
        code: 'API_EXPORT_FAILED',
        message: `Single-request export is available for cURL; use a folder or the workspace for ${format}.`,
      };
    }

    const source = buildSource(file, rootId);
    const result =
      format === 'postman'
        ? exportPostman(source, rootId)
        : format === 'openapi'
          ? exportOpenApi(source, rootId)
          : exportBureau(source, rootId);

    return { ok: true, itemCount: source.requests.size, result };
  }

  return {
    async plan(input) {
      const rendered = await render(input);
      if (!rendered.ok) return rendered;

      const omissions = [...rendered.result.omissions];
      if (input.format !== 'bureau') {
        omissions.push(
          omission(
            'lossy-format',
            'Only the native Bureau format round-trips every concept. Other formats export a compatible subset.'
          )
        );
      }

      return {
        ok: true,
        plan: {
          format: input.format,
          itemCount: rendered.itemCount,
          omissions,
          includesSecrets: false,
          privacySensitive: input.format === 'har',
          suggestedFileName: rendered.result.suggestedFileName,
          // A one-request cURL command is short enough to show and copy inline.
          inlinePreview: input.format === 'curl' ? rendered.result.content : undefined,
        },
      };
    },

    async commit(input) {
      const rendered = await render(input);
      if (!rendered.ok) return rendered;

      const chosen = await dialog.showSaveFileDialog({
        title: 'Export from the API workspace',
        defaultPath: rendered.result.suggestedFileName,
        filters: filtersFor(input.format),
      });
      if (!chosen) return { ok: true, written: false };

      try {
        await fs.writeFile(chosen, rendered.result.content, 'utf8');
      } catch {
        return { ok: false, code: 'API_EXPORT_FAILED', message: 'The file could not be written.' };
      }
      return { ok: true, written: true };
    },

    async writeText(input) {
      const chosen = await dialog.showSaveFileDialog({
        title: input.title,
        defaultPath: input.suggestedFileName,
        filters: [{ name: 'Report', extensions: input.extensions }],
      });
      // A cancelled dialog is a no-op, not a failure.
      if (!chosen) return { ok: true, written: false };
      try {
        await fs.writeFile(chosen, input.content, 'utf8');
      } catch {
        return { ok: false, code: 'API_EXPORT_FAILED', message: 'The file could not be written.' };
      }
      return { ok: true, written: true };
    },
  };
}

function buildSource(file: ApiWorkspaceFileV1, rootId: string | null): ExportSource {
  const requests = new Map(file.requests.map((request) => [request.requestId, request]));
  return {
    workspaceName: rootId
      ? (file.collections.find((node) => node.collectionId === rootId)?.name ?? file.summary.name)
      : file.summary.name,
    nodes: file.collections,
    requests,
    environments: file.environments,
  };
}

function filtersFor(format: ApiInterchangeFormat): Array<{ name: string; extensions: string[] }> {
  switch (format) {
    case 'curl':
      return [{ name: 'Shell script', extensions: ['sh'] }];
    case 'har':
      return [{ name: 'HAR', extensions: ['har', 'json'] }];
    default:
      return [{ name: 'JSON', extensions: ['json'] }];
  }
}

export { safeFileStem };
