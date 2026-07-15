import { z } from 'zod';

const projectId = z.string().uuid();
const relativePath = z
  .string()
  .max(4096)
  .refine((value) => !value.includes('\0'), 'Path contains a NUL character')
  .refine((value) => !/^[\\/]/.test(value), 'Path must be project-relative')
  .refine((value) => !/^[A-Za-z]:/.test(value), 'Path must be project-relative')
  .refine(
    (value) => !value.replace(/\\/g, '/').split('/').some((part) => part === '..'),
    'Path traversal is not permitted'
  );

const WORKSPACE_PATH_MAP_LIMIT = 200;
const fileModeByPath = z
  .record(relativePath, z.enum(['edit', 'preview', 'split']))
  .refine((value) => Object.keys(value).length <= WORKSPACE_PATH_MAP_LIMIT, `modeByPath may contain at most ${WORKSPACE_PATH_MAP_LIMIT} entries`);
const cursorByPath = z
  .record(
    relativePath,
    z.object({
      line: z.number().int().positive(),
      column: z.number().int().positive(),
      scrollTop: z.number().nonnegative(),
    })
  )
  .refine((value) => Object.keys(value).length <= WORKSPACE_PATH_MAP_LIMIT, `cursorByPath may contain at most ${WORKSPACE_PATH_MAP_LIMIT} entries`);

const nonRootPath = relativePath.refine((value) => value.length > 0, 'The project root is protected');
const name = z.string().min(1).max(255).refine((value) => !/[\\/\0]/.test(value));
export const fileRevisionSchema = z.object({
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().nonnegative(),
  modifiedAtMs: z.number().nonnegative(),
});
const workspaceStateSchema = z.object({
  projectId,
  openPaths: z.array(relativePath).max(100),
  activePath: relativePath.nullable(),
  expandedPaths: z.array(relativePath).max(2000),
  recentPaths: z.array(relativePath).max(200),
  pinnedPaths: z.array(relativePath).max(100),
  modeByPath: fileModeByPath,
  cursorByPath,
  explorerWidth: z.number().min(180).max(640),
  updatedAt: z.string().datetime(),
});
const draftSchema = z.object({
  projectId,
  relativePath: nonRootPath,
  content: z.string().max(5 * 1024 * 1024),
  baseRevision: fileRevisionSchema.nullable(),
  encoding: z.enum(['utf-8', 'utf-8-bom']),
  lineEnding: z.enum(['lf', 'crlf', 'cr', 'none']),
  updatedAt: z.string().datetime(),
});

export const listDirectoryRequestSchema = z.object({
  projectId,
  relativePath,
  showIgnored: z.boolean().optional(),
});
export const filePathRequestSchema = z.object({ projectId, relativePath: nonRootPath });
export const saveTextRequestSchema = filePathRequestSchema.extend({
  content: z.string().max(5 * 1024 * 1024),
  expectedRevision: fileRevisionSchema.nullable(),
  encoding: z.enum(['utf-8', 'utf-8-bom']),
  lineEnding: z.enum(['lf', 'crlf', 'cr', 'none']),
  force: z.boolean().optional(),
});
export const createEntryRequestSchema = z.object({
  projectId,
  relativePath: nonRootPath,
  kind: z.enum(['file', 'directory']),
});
export const renameEntryRequestSchema = filePathRequestSchema.extend({ newName: name });
export const moveEntryRequestSchema = filePathRequestSchema.extend({ destinationPath: nonRootPath });
export const duplicateEntryRequestSchema = moveEntryRequestSchema;
export const quickOpenRequestSchema = z.object({
  projectId,
  query: z.string().max(256),
  showIgnored: z.boolean().optional(),
});
export const startSearchRequestSchema = z.object({
  projectId,
  searchId: z.string().uuid(),
  query: z.string().min(1).max(512),
  caseSensitive: z.boolean(),
  wholeWord: z.boolean(),
  showIgnored: z.boolean().optional(),
});
export const cancelSearchRequestSchema = z.object({ projectId, searchId: z.string().uuid() });
export const watchProjectRequestSchema = z.object({ projectId });
export const remoteImageRequestSchema = z.object({ url: z.string().url().max(4096) });
export const exportHtmlRequestSchema = filePathRequestSchema.extend({
  html: z.string().max(10 * 1024 * 1024),
  suggestedName: name,
});
export const printDocumentRequestSchema = z.object({ html: z.string().max(10 * 1024 * 1024) });
export const workspaceStateRequestSchema = z.object({ projectId });
export const saveWorkspaceStateRequestSchema = z.object({ state: workspaceStateSchema });
export const putDraftRequestSchema = z.object({ draft: draftSchema });
