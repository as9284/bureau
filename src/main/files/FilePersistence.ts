import { z } from 'zod';
import type { FileDraft, FileWorkspaceState } from '@shared/contracts/files';
import { createAtomicJsonStore, type AtomicJsonStore } from '../storage/AtomicJsonStore';

type WorkspaceFile = {
  schemaVersion: 1;
  workspaces: Record<string, FileWorkspaceState>;
};
type DraftFile = { schemaVersion: 1; drafts: FileDraft[] };

const revisionSchema = z.object({
  hash: z.string(),
  size: z.number().nonnegative(),
  modifiedAtMs: z.number().nonnegative(),
});
const WORKSPACE_PATH_MAP_LIMIT = 200;
const relativePathKey = z
  .string()
  .max(4096)
  .refine((value) => !value.includes('\0'), 'Path contains a NUL character')
  .refine((value) => !/^[\\/]/.test(value), 'Path must be project-relative')
  .refine((value) => !/^[A-Za-z]:/.test(value), 'Path must be project-relative')
  .refine(
    (value) => !value.replace(/\\/g, '/').split('/').some((part) => part === '..'),
    'Path traversal is not permitted'
  );
const workspaceSchema = z.object({
  projectId: z.string(),
  openPaths: z.array(z.string()),
  activePath: z.string().nullable(),
  expandedPaths: z.array(z.string()),
  recentPaths: z.array(z.string()),
  pinnedPaths: z.array(z.string()),
  modeByPath: z
    .record(relativePathKey, z.enum(['edit', 'preview', 'split']))
    .refine((value) => Object.keys(value).length <= WORKSPACE_PATH_MAP_LIMIT),
  cursorByPath: z
    .record(
      relativePathKey,
      z.object({ line: z.number().int().positive(), column: z.number().int().positive(), scrollTop: z.number() })
    )
    .refine((value) => Object.keys(value).length <= WORKSPACE_PATH_MAP_LIMIT),
  explorerWidth: z.number().min(180).max(640),
  updatedAt: z.string(),
});
const draftSchema = z.object({
  projectId: z.string(),
  relativePath: z.string(),
  content: z.string().max(5 * 1024 * 1024),
  baseRevision: revisionSchema.nullable(),
  encoding: z.enum(['utf-8', 'utf-8-bom']),
  lineEnding: z.enum(['lf', 'crlf', 'cr', 'none']),
  updatedAt: z.string(),
});

export type FilesPersistence = {
  workspaceStore: AtomicJsonStore<WorkspaceFile>;
  draftStore: AtomicJsonStore<DraftFile>;
};

export async function createFilesPersistence(dataPath: string): Promise<FilesPersistence> {
  const workspaceStore = createAtomicJsonStore<WorkspaceFile>({
    filePath: `${dataPath}/files-workspaces.v1.json`,
    schemaVersion: 1,
    defaultValue: { schemaVersion: 1, workspaces: {} },
    validate(value) {
      return z
        .object({ schemaVersion: z.literal(1), workspaces: z.record(workspaceSchema) })
        .parse(value) as WorkspaceFile;
    },
  });
  const draftStore = createAtomicJsonStore<DraftFile>({
    filePath: `${dataPath}/files-drafts.v1.json`,
    schemaVersion: 1,
    defaultValue: { schemaVersion: 1, drafts: [] },
    validate(value) {
      return z
        .object({ schemaVersion: z.literal(1), drafts: z.array(draftSchema) })
        .parse(value) as DraftFile;
    },
  });
  await Promise.all([workspaceStore.load(), draftStore.load()]);
  const expiry = Date.now() - 30 * 24 * 60 * 60 * 1000;
  await draftStore.update((current) => ({
    ...current,
    drafts: current.drafts.filter((draft) => Date.parse(draft.updatedAt) >= expiry),
  }));
  return { workspaceStore, draftStore };
}
