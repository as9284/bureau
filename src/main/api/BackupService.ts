import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type {
  ApiInterchangeNote,
  ApiRestorePlan,
  ApiRestoreReport,
} from '@shared/contracts/apiWorkbench';
import type { NativeDialogAdapter } from '../system/dialogAdapter';
import type { ApiWorkspaceFileV1 } from './ApiWorkspaceStore';

/**
 * Workspace backup and restore.
 *
 * A backup is every workspace document in one file. It is *not* a secret backup: secret material
 * stays in the OS vault, and a restore onto another machine reconnects to nothing until the secrets
 * are re-entered. That is the same rule as the native export (§14.6) and it is deliberate — a
 * portable file that decrypts a vault is a worse failure mode than a re-typed token.
 *
 * Restore is two-step for the same reason import is: it is the most destructive operation in the
 * app, so the plan names every workspace and every conflict before anything is written.
 */

export const BACKUP_FORMAT = 'bureau-api-backup';
const BACKUP_VERSION = 1;

/** Generous, but a backup that will not fit in memory is a corruption report, not a restore. */
const MAX_BACKUP_BYTES = 200 * 1024 * 1024;
const PLAN_TTL_MS = 30 * 60_000;

const backupFileSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.number().int().positive(),
  createdAt: z.string().max(64).optional(),
  secretPolicy: z.literal('omitted').optional(),
  // Workspace documents are re-validated by the store on write; here we only need enough shape to
  // build an honest plan.
  workspaces: z
    .array(
      z.object({
        summary: z.object({ workspaceId: z.string(), name: z.string() }).passthrough(),
        requests: z.array(z.unknown()).default([]),
        environments: z.array(z.unknown()).default([]),
      }).passthrough()
    )
    .max(500),
});

export type BackupService = {
  backup(files: ApiWorkspaceFileV1[]): Promise<
    { ok: true; written: boolean } | { ok: false; code: string; message: string }
  >;
  plan(
    existingIds: string[]
  ): Promise<
    { ok: true; plan: ApiRestorePlan | null } | { ok: false; code: string; message: string }
  >;
  take(restoreId: string): { files: ApiWorkspaceFileV1[]; plan: ApiRestorePlan } | undefined;
  discard(restoreId: string): void;
  dispose(): void;
};

export function createBackupService(dialog: NativeDialogAdapter): BackupService {
  const pending = new Map<
    string,
    { files: ApiWorkspaceFileV1[]; plan: ApiRestorePlan; createdAt: number }
  >();

  function prune(): void {
    const now = Date.now();
    for (const [id, entry] of pending) {
      if (now - entry.createdAt > PLAN_TTL_MS) pending.delete(id);
    }
  }

  return {
    async backup(files) {
      const stamp = new Date().toISOString();
      const document = {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        createdAt: stamp,
        // Stated in the file itself, so a restore on another machine is not a surprise.
        secretPolicy: 'omitted' as const,
        workspaces: files,
      };

      const chosen = await dialog.showSaveFileDialog({
        title: 'Back up API workspaces',
        defaultPath: `bureau-api-backup-${stamp.slice(0, 10)}.json`,
        filters: [{ name: 'Bureau API backup', extensions: ['json'] }],
      });
      // A cancelled dialog is a no-op, not a failure.
      if (!chosen) return { ok: true, written: false };

      try {
        await fs.writeFile(chosen, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
      } catch {
        return { ok: false, code: 'API_EXPORT_FAILED', message: 'The backup could not be written.' };
      }
      return { ok: true, written: true };
    },

    async plan(existingIds) {
      prune();
      const chosen = await dialog.showOpenFileDialog({
        title: 'Restore API workspaces',
        filters: [{ name: 'Bureau API backup', extensions: ['json'] }],
      });
      if (!chosen) return { ok: true, plan: null };

      let stat: Awaited<ReturnType<typeof fs.stat>>;
      try {
        stat = await fs.stat(chosen);
      } catch {
        return { ok: false, code: 'API_IMPORT_INVALID', message: 'The backup could not be read.' };
      }
      // Checked before reading, so an oversized file is never loaded into memory.
      if (stat.size > MAX_BACKUP_BYTES) {
        return {
          ok: false,
          code: 'API_IMPORT_LIMIT_EXCEEDED',
          message: `The backup is over the ${Math.round(MAX_BACKUP_BYTES / 1024 / 1024)} MiB limit.`,
        };
      }

      let raw: unknown;
      try {
        raw = JSON.parse(await fs.readFile(chosen, 'utf8'));
      } catch {
        return { ok: false, code: 'API_IMPORT_INVALID', message: 'The backup is not valid JSON.' };
      }

      const parsed = backupFileSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          ok: false,
          code: 'API_IMPORT_INVALID',
          message: 'That file is not a Bureau API backup.',
        };
      }
      if (parsed.data.version > BACKUP_VERSION) {
        return {
          ok: false,
          code: 'API_IMPORT_INVALID',
          message: 'The backup was written by a newer Bureau. Update first.',
        };
      }

      const warnings: ApiInterchangeNote[] = [];
      const existing = new Set(existingIds);
      const seen = new Set<string>();
      const workspaces: ApiRestorePlan['workspaces'] = [];
      const files: ApiWorkspaceFileV1[] = [];

      for (const entry of parsed.data.workspaces) {
        const file = entry as unknown as ApiWorkspaceFileV1;
        const workspaceId = file.summary.workspaceId;
        if (seen.has(workspaceId)) {
          warnings.push({
            code: 'duplicate-workspace',
            message: `\`${file.summary.name}\` appears twice in the backup; the later copy was skipped.`,
          });
          continue;
        }
        seen.add(workspaceId);
        files.push(file);
        workspaces.push({
          workspaceId,
          name: file.summary.name,
          requestCount: file.requests?.length ?? 0,
          environmentCount: file.environments?.length ?? 0,
          conflict: existing.has(workspaceId),
        });
      }

      if (workspaces.length === 0) {
        return { ok: false, code: 'API_IMPORT_INVALID', message: 'The backup has no workspaces.' };
      }
      warnings.push({
        code: 'secrets-omitted',
        message:
          'Secret values are not in a backup. Restored requests keep their secret references but need the values re-entered.',
      });

      const plan: ApiRestorePlan = {
        restoreId: randomUUID(),
        // File name only — never the path.
        sourceLabel: path.basename(chosen),
        createdAt: parsed.data.createdAt,
        workspaces,
        warnings,
      };
      pending.set(plan.restoreId, { files, plan, createdAt: Date.now() });
      return { ok: true, plan };
    },

    take(restoreId) {
      prune();
      const entry = pending.get(restoreId);
      if (!entry) return undefined;
      // One commit per plan: a stale plan must not be replayable against a changed workspace set.
      pending.delete(restoreId);
      return { files: entry.files, plan: entry.plan };
    },

    discard(restoreId) {
      pending.delete(restoreId);
    },

    dispose() {
      pending.clear();
    },
  };
}

export function emptyRestoreReport(): ApiRestoreReport {
  return { restored: 0, replaced: 0, skipped: 0, warnings: [] };
}
