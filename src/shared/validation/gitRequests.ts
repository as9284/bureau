import { z } from 'zod';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SNAPSHOT_REVISION_RE = /^[a-z0-9]{16,64}$/i;

const projectIdSchema = z.string().max(64).regex(UUID_RE, 'projectId must be a UUID');

const snapshotRevisionSchema = z
  .string()
  .min(16)
  .max(64)
  .regex(SNAPSHOT_REVISION_RE, 'snapshotRevision must be an opaque token');

const boundedPathSchema = z.string().max(4096);
const boundedMessageSchema = z.string().max(12000);
const refSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => !value.startsWith('-'), {
    message: 'ref must not start with a dash',
  });
const oidSchema = z.string().regex(/^[0-9a-f]{7,64}$/i, 'OID must be hexadecimal');

// Remote URLs reach `git clone`/`git remote add`. Two exploit classes must be blocked:
// a leading `-` (parsed as an option), and git's remote-helper transports (`ext::sh -c …`,
// `fd::…`) which execute arbitrary commands. Beyond that, require a recognizable remote form.
const SAFE_REMOTE_SCHEME_RE = /^(?:https?|ssh|git|ftps?|file):\/\//i;
const SCP_LIKE_RE = /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:.+/;
const LOCAL_PATH_RE = /^(?:[A-Za-z]:[\\/]|[\\/]|\.{1,2}[\\/])/;
const remoteUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine(
    (value) =>
      !value.startsWith('-') &&
      !value.includes('::') &&
      (SAFE_REMOTE_SCHEME_RE.test(value) ||
        SCP_LIKE_RE.test(value) ||
        LOCAL_PATH_RE.test(value)),
    'remote URL must be an http(s)/ssh/git/file URL, scp-style host:path, or local path'
  );
const stashIndexSchema = z.number().int().min(0).max(999);
const pageSchema = z.object({
  cursor: z.string().max(1024).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export const fileMutationRequestSchema = z.object({
  projectId: projectIdSchema,
  snapshotRevision: snapshotRevisionSchema,
  path: boundedPathSchema,
});

export const repoMutationRequestSchema = z.object({
  projectId: projectIdSchema,
  snapshotRevision: snapshotRevisionSchema,
});

export const branchSwitchRequestSchema = repoMutationRequestSchema.extend({
  branchName: z
    .string()
    .min(1)
    .max(255)
    .refine((value) => !value.startsWith('-'), {
      message: 'branchName must not start with a dash',
    }),
});

export const branchCreateRequestSchema = branchSwitchRequestSchema.extend({
  startPoint: refSchema.optional(),
});

export const branchDeleteRequestSchema = branchSwitchRequestSchema;

export const githubPublishRequestSchema = repoMutationRequestSchema
  .extend({
    branchName: refSchema,
    owner: z
      .string()
      .trim()
      .min(1)
      .max(39)
      .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/, 'owner is not valid')
      .optional(),
    repositoryName: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9._-]+$/, 'repositoryName contains unsupported characters'),
    visibility: z.enum(['public', 'private']),
    description: z.string().trim().max(350).optional(),
  })
  .strict();

export const githubOpenUrlRequestSchema = z
  .object({
    url: z
      .string()
      .url()
      .max(2048)
      .refine((value) => {
        try {
          const parsed = new URL(value);
          return parsed.protocol === 'https:' && parsed.hostname === 'github.com';
        } catch {
          return false;
        }
      }, 'URL must be an HTTPS github.com URL'),
  })
  .strict();

export const stashPushRequestSchema = repoMutationRequestSchema.extend({
  message: z.string().max(1000).optional(),
  includeUntracked: z.boolean().optional(),
});

export const stashIndexRequestSchema = repoMutationRequestSchema.extend({
  index: z.number().int().min(0).max(999),
});

export const diffRequestSchema = z
  .object({
    projectId: projectIdSchema,
    path: boundedPathSchema,
    area: z.enum(['staged', 'unstaged', 'commit']),
    commitOid: oidSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.area === 'commit' && !value.commitOid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'commitOid is required when area is commit',
        path: ['commitOid'],
      });
    }
  });

export const listCommitFilesRequestSchema = z.object({
  projectId: projectIdSchema,
  commitOid: oidSchema,
});

export const recentCommitsRequestSchema = z.object({
  projectId: projectIdSchema,
  limit: z.number().int().min(1).max(100).optional(),
});

export const commitRequestSchema = z.object({
  projectId: projectIdSchema,
  snapshotRevision: snapshotRevisionSchema,
  message: boundedMessageSchema,
  amend: z.boolean().optional(),
  signOff: z.boolean().optional(),
  signing: z.enum(['config', 'off']).optional(),
});

export const operationCancelRequestSchema = z.object({
  operationId: z.string().uuid(),
});

export const chooseDirectoryRequestSchema = z.object({
  title: z.string().max(200).optional(),
  buttonLabel: z.string().max(64).optional(),
});

export const addWorktreeRequestSchema = repoMutationRequestSchema.extend({
  path: z.string().min(1).max(4096),
  branch: z.string().min(1).max(255).optional(),
  newBranch: z.string().min(1).max(255).optional(),
});

export const worktreePathRequestSchema = repoMutationRequestSchema.extend({
  path: z.string().min(1).max(4096),
});

export const removeWorktreeRequestSchema = worktreePathRequestSchema;

export const lockWorktreeRequestSchema = worktreePathRequestSchema.extend({
  reason: z.string().max(500).optional(),
});

export const hunkMutationRequestSchema = z.object({
  projectId: projectIdSchema,
  snapshotRevision: snapshotRevisionSchema,
  path: boundedPathSchema,
  area: z.enum(['staged', 'unstaged']),
  patch: z.string().max(512_000),
  action: z.enum(['stage', 'unstage', 'discard']),
});

export const historyRequestSchema = pageSchema
  .extend({
    projectId: projectIdSchema,
    filters: z
      .object({
        text: z.string().max(500).optional(),
        author: z.string().max(255).optional(),
        path: boundedPathSchema.optional(),
        since: z.string().max(64).optional(),
        until: z.string().max(64).optional(),
        ref: refSchema.optional(),
        oid: oidSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const tagsRequestSchema = pageSchema.extend({ projectId: projectIdSchema }).strict();
export const stashFilesRequestSchema = z
  .object({ projectId: projectIdSchema, index: stashIndexSchema })
  .strict();
export const stashDiffRequestSchema = stashFilesRequestSchema
  .extend({ path: boundedPathSchema })
  .strict();
export const conflictVersionRequestSchema = z
  .object({
    projectId: projectIdSchema,
    path: boundedPathSchema,
    stage: z.enum(['base', 'ours', 'theirs', 'working']),
  })
  .strict();
export const conflictResolveRequestSchema = fileMutationRequestSchema
  .extend({
    resolution: z.enum(['ours', 'theirs', 'markResolved']),
  })
  .strict();
export const branchPublishRequestSchema = repoMutationRequestSchema
  .extend({
    branchName: refSchema.optional(),
    remoteName: refSchema.optional(),
    remoteUrl: remoteUrlSchema.optional(),
  })
  .strict();
export const branchSetUpstreamRequestSchema = repoMutationRequestSchema
  .extend({ upstreamRef: refSchema.nullable() })
  .strict();
export const branchRenameRequestSchema = repoMutationRequestSchema
  .extend({ newName: refSchema })
  .strict();
export const branchCheckoutTrackingRequestSchema = repoMutationRequestSchema
  .extend({ remoteRef: refSchema, localName: refSchema.optional() })
  .strict();
export const branchDeleteRemoteRequestSchema = repoMutationRequestSchema
  .extend({ remoteName: refSchema, branchName: refSchema })
  .strict();
export const commitOidMutationRequestSchema = repoMutationRequestSchema
  .extend({ commitOid: oidSchema })
  .strict();
export const branchFromCommitRequestSchema = commitOidMutationRequestSchema
  .extend({ branchName: refSchema })
  .strict();
export const createTagRequestSchema = repoMutationRequestSchema
  .extend({
    name: refSchema,
    targetOid: oidSchema,
    message: z.string().max(12000).optional(),
    annotated: z.boolean().optional(),
  })
  .strict();
export const tagMutationRequestSchema = repoMutationRequestSchema
  .extend({ name: refSchema })
  .strict();
export const remoteTagMutationRequestSchema = tagMutationRequestSchema
  .extend({ remoteName: refSchema })
  .strict();
export const stashMutationRequestSchema = repoMutationRequestSchema
  .extend({ index: stashIndexSchema })
  .strict();
export const stashBranchRequestSchema = stashMutationRequestSchema
  .extend({ branchName: refSchema })
  .strict();
export const stashRestoreFilesRequestSchema = stashMutationRequestSchema
  .extend({ paths: z.array(boundedPathSchema).min(1).max(500) })
  .strict();
export const submoduleActionRequestSchema = fileMutationRequestSchema.strict();
export const blameRequestSchema = z
  .object({
    projectId: projectIdSchema,
    path: boundedPathSchema,
    commitOid: oidSchema,
    offset: z.number().int().min(0).max(10_000_000).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
export const compareCommitsRequestSchema = z
  .object({ projectId: projectIdSchema, baseOid: oidSchema, targetOid: oidSchema })
  .strict();
export const cloneRequestSchema = z
  .object({
    url: remoteUrlSchema,
    parentDirectory: z.string().min(1).max(4096),
    folderName: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine(
        (value) => value !== '.' && value !== '..' && !/[\\/\0]/.test(value),
        'folderName must be one directory name'
      ),
    depth: z.number().int().min(1).max(1_000_000).optional(),
    branch: refSchema.optional(),
  })
  .strict();
export const initRepositoryRequestSchema = z
  .object({
    directory: z.string().min(1).max(4096),
    defaultBranch: refSchema.optional(),
    createReadme: z.boolean().optional(),
    createGitignore: z.boolean().optional(),
    gitignoreTemplate: z.string().max(100_000).optional(),
  })
  .strict();
