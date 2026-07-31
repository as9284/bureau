import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { z } from 'zod';
import type {
  ApiAuth,
  ApiCollectionNode,
  ApiEntityId,
  ApiEnvironment,
  ApiOAuthProfile,
  ApiOAuthTokenStatus,
  ApiRequestDefinition,
  ApiProxyProfile,
  ApiTlsProfile,
  ApiVariableDefinition,
  ApiWorkspaceSnapshot,
  ApiWorkspaceSummary,
} from '@shared/contracts/apiWorkbench';
import type { AtomicJsonStore } from '../storage/AtomicJsonStore';
import { createAtomicJsonStore } from '../storage/AtomicJsonStore';
import { toBureauError } from '../ipc/errors';
import { workspaceFilePath, type ApiPersistence } from './ApiPersistence';

export type ApiWorkspaceFileV1 = {
  schemaVersion: 1;
  summary: ApiWorkspaceSummary;
  variables: ApiVariableDefinition[];
  auth: ApiAuth;
  collections: ApiCollectionNode[];
  requests: ApiRequestDefinition[];
  environments: ApiEnvironment[];
  /** Phase 2. Older files predate these, so readers must tolerate them being absent. */
  tlsProfiles?: ApiTlsProfile[];
  proxyProfiles?: ApiProxyProfile[];
  oauthProfiles?: ApiOAuthProfile[];
  updatedAt: string;
};

type IndexFileV1 = {
  schemaVersion: 1;
  workspaces: ApiWorkspaceSummary[];
};

const indexSchema = z.object({
  schemaVersion: z.literal(1),
  workspaces: z.array(z.record(z.unknown())).default([]),
});

function nowIso(): string {
  return new Date().toISOString();
}

function defaultRequest(workspaceId: ApiEntityId, requestId: ApiEntityId, name: string): ApiRequestDefinition {
  const stamp = nowIso();
  return {
    requestId,
    workspaceId,
    name,
    protocol: 'http',
    urlTemplate: '',
    method: 'GET',
    query: [],
    headers: [],
    auth: { kind: 'inherit' },
    body: { kind: 'none' },
    protocolOptions: {},
    scripts: {},
    settings: {},
    variables: [],
    revision: 1,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/**
 * Strips plaintext from secret variables while keeping the vault handle, so a renderer
 * round-trip (edit an environment, save it back) cannot destroy the secret binding.
 */
function redactVariables(variables: ApiVariableDefinition[]): ApiVariableDefinition[] {
  return variables.map((variable) => {
    if (!variable.secret) return variable;
    return {
      variableId: variable.variableId,
      name: variable.name,
      enabled: variable.enabled,
      secret: true,
      secretId: variable.secretId,
      hasSecretValue: Boolean(variable.secretId) || Boolean(variable.hasSecretValue),
    };
  });
}

/**
 * Incoming variables never carry plaintext for a secret. Anything the renderer sends in
 * `value` for a secret variable is discarded rather than persisted.
 */
export function sanitizeIncomingVariables(
  variables: ApiVariableDefinition[]
): ApiVariableDefinition[] {
  return variables.map((variable) => {
    if (!variable.secret) return { ...variable, secretId: undefined, hasSecretValue: undefined };
    return {
      variableId: variable.variableId,
      name: variable.name,
      enabled: variable.enabled,
      secret: true,
      secretId: variable.secretId,
      hasSecretValue: Boolean(variable.secretId),
    };
  });
}

function redactRequest(request: ApiRequestDefinition): ApiRequestDefinition {
  return {
    ...request,
    variables: redactVariables(request.variables),
  };
}

function toSnapshot(
  file: ApiWorkspaceFileV1,
  linked: { name?: string; stale?: boolean; oauthTokens?: ApiOAuthTokenStatus[] }
): ApiWorkspaceSnapshot {
  return {
    summary: file.summary,
    variables: redactVariables(file.variables),
    auth: file.auth,
    collections: file.collections.map((node) => ({
      ...node,
      variables: redactVariables(node.variables),
    })),
    requests: file.requests.map(redactRequest),
    environments: file.environments.map((env) => ({
      ...env,
      variables: redactVariables(env.variables),
    })),
    tlsProfiles: file.tlsProfiles ?? [],
    proxyProfiles: file.proxyProfiles ?? [],
    oauthProfiles: file.oauthProfiles ?? [],
    oauthTokens: linked.oauthTokens ?? [],
    linkedProjectName: linked.name,
    linkedProjectStale: linked.stale,
  };
}

export type ApiWorkspaceStore = {
  listSummaries(): ApiWorkspaceSummary[];
  getFile(workspaceId: string): Promise<ApiWorkspaceFileV1 | null>;
  getSnapshot(
    workspaceId: string,
    linked: { name?: string; stale?: boolean; oauthTokens?: ApiOAuthTokenStatus[] }
  ): Promise<ApiWorkspaceSnapshot | null>;
  restoreWorkspace(file: ApiWorkspaceFileV1): Promise<ApiWorkspaceSummary>;
  createWorkspace(input: {
    name: string;
    linkedProjectId?: string;
  }): Promise<ApiWorkspaceFileV1>;
  updateWorkspace(input: {
    workspaceId: string;
    expectedRevision: number;
    name?: string;
    linkedProjectId?: string | null;
    activeEnvironmentId?: string | null;
    variables?: ApiVariableDefinition[];
    auth?: ApiAuth;
  }): Promise<
    | { ok: true; file: ApiWorkspaceFileV1 }
    | { ok: false; error: ReturnType<typeof toBureauError> }
  >;
  deleteWorkspace(input: {
    workspaceId: string;
    expectedRevision: number;
  }): Promise<{ ok: true } | { ok: false; error: ReturnType<typeof toBureauError> }>;
  mutateWorkspace(
    workspaceId: string,
    expectedRevision: number | null,
    mutator: (file: ApiWorkspaceFileV1) => ApiWorkspaceFileV1 | { error: ReturnType<typeof toBureauError> }
  ): Promise<
    | { ok: true; file: ApiWorkspaceFileV1 }
    | { ok: false; error: ReturnType<typeof toBureauError> }
  >;
  unlinkProject(projectId: string): Promise<void>;
  createDefaultRequestNode(input: {
    workspaceId: string;
    parentId: string | null;
    name: string;
  }): Promise<
    | { ok: true; file: ApiWorkspaceFileV1; collectionId: string; requestId: string }
    | { ok: false; error: ReturnType<typeof toBureauError> }
  >;
};

export function createApiWorkspaceStore(persistence: ApiPersistence): ApiWorkspaceStore {
  const indexStore = persistence.indexStore as AtomicJsonStore<IndexFileV1>;
  const fileStores = new Map<string, AtomicJsonStore<ApiWorkspaceFileV1>>();

  function readIndex(): IndexFileV1 {
    const raw = indexStore.read();
    const parsed = indexSchema.safeParse(raw);
    if (!parsed.success) return { schemaVersion: 1, workspaces: [] };
    const workspaces = (parsed.data.workspaces as unknown as ApiWorkspaceSummary[]).filter(
      (entry) => typeof entry?.workspaceId === 'string' && typeof entry?.name === 'string'
    );
    return { schemaVersion: 1, workspaces };
  }

  async function writeIndex(workspaces: ApiWorkspaceSummary[]): Promise<void> {
    await indexStore.update(() => ({ schemaVersion: 1, workspaces }));
  }

  function getOrCreateFileStore(workspaceId: string): AtomicJsonStore<ApiWorkspaceFileV1> {
    const existing = fileStores.get(workspaceId);
    if (existing) return existing;
    const store = createAtomicJsonStore<ApiWorkspaceFileV1>({
      filePath: workspaceFilePath(persistence.workspacesDir, workspaceId),
      schemaVersion: 1,
      defaultValue: {
        schemaVersion: 1,
        summary: {
          workspaceId,
          name: 'Workspace',
          createdAt: nowIso(),
          updatedAt: nowIso(),
          revision: 1,
        },
        variables: [],
        auth: { kind: 'none' },
        collections: [],
        requests: [],
        environments: [],
        updatedAt: nowIso(),
      },
      validate: (value) => value as ApiWorkspaceFileV1,
    });
    fileStores.set(workspaceId, store);
    return store;
  }

  async function loadFile(workspaceId: string): Promise<ApiWorkspaceFileV1 | null> {
    // The index is the authority on which workspaces exist. Without this check an unknown id
    // would resolve to the store's *default* value — whose summary carries the requested id —
    // and every caller would see a phantom empty workspace instead of "not found".
    if (!readIndex().workspaces.some((entry) => entry.workspaceId === workspaceId)) return null;

    const store = getOrCreateFileStore(workspaceId);
    try {
      await store.load();
      const file = store.read();
      if (file.summary.workspaceId !== workspaceId) return null;
      return file;
    } catch {
      return null;
    }
  }

  function listSummaries(): ApiWorkspaceSummary[] {
    return [...readIndex().workspaces].sort((a, b) => a.name.localeCompare(b.name));
  }

  async function getFile(workspaceId: string): Promise<ApiWorkspaceFileV1 | null> {
    return loadFile(workspaceId);
  }

  async function getSnapshot(
    workspaceId: string,
    linked: { name?: string; stale?: boolean; oauthTokens?: ApiOAuthTokenStatus[] }
  ): Promise<ApiWorkspaceSnapshot | null> {
    const file = await loadFile(workspaceId);
    if (!file) return null;
    return toSnapshot(file, linked);
  }

  async function createWorkspace(input: {
    name: string;
    linkedProjectId?: string;
  }): Promise<ApiWorkspaceFileV1> {
    const workspaceId = randomUUID();
    const stamp = nowIso();
    const summary: ApiWorkspaceSummary = {
      workspaceId,
      name: input.name.trim() || 'Workspace',
      linkedProjectId: input.linkedProjectId,
      createdAt: stamp,
      updatedAt: stamp,
      revision: 1,
    };
    const requestId = randomUUID();
    const collectionId = randomUUID();
    const request = defaultRequest(workspaceId, requestId, 'New request');
    request.collectionId = collectionId;
    const file: ApiWorkspaceFileV1 = {
      schemaVersion: 1,
      summary,
      variables: [],
      auth: { kind: 'none' },
      collections: [
        {
          collectionId,
          workspaceId,
          parentId: null,
          kind: 'request',
          name: 'New request',
          order: 0,
          requestId,
          variables: [],
          revision: 1,
        },
      ],
      requests: [request],
      environments: [],
      updatedAt: stamp,
    };
    const store = getOrCreateFileStore(workspaceId);
    await store.load();
    await store.update(() => file);
    const index = readIndex();
    await writeIndex([...index.workspaces, summary]);
    return file;
  }

  /**
   * Writes a whole workspace document, creating or overwriting it. Used only by restore, which is
   * the one operation that legitimately supplies a complete file rather than a patch — so it is a
   * separate entry point rather than a mode of `mutateWorkspace`.
   */
  async function restoreWorkspace(file: ApiWorkspaceFileV1): Promise<ApiWorkspaceSummary> {
    const workspaceId = file.summary.workspaceId;
    const stamp = nowIso();
    const summary: ApiWorkspaceSummary = { ...file.summary, updatedAt: stamp };
    const restored: ApiWorkspaceFileV1 = { ...file, schemaVersion: 1, summary, updatedAt: stamp };
    const store = getOrCreateFileStore(workspaceId);
    await store.load();
    await store.update(() => restored);
    const index = readIndex();
    const others = index.workspaces.filter((entry) => entry.workspaceId !== workspaceId);
    await writeIndex([...others, summary]);
    return summary;
  }

  async function mutateWorkspace(
    workspaceId: string,
    expectedRevision: number | null,
    mutator: (
      file: ApiWorkspaceFileV1
    ) => ApiWorkspaceFileV1 | { error: ReturnType<typeof toBureauError> }
  ): Promise<
    | { ok: true; file: ApiWorkspaceFileV1 }
    | { ok: false; error: ReturnType<typeof toBureauError> }
  > {
    const current = await loadFile(workspaceId);
    if (!current) {
      return {
        ok: false,
        error: toBureauError({
          code: 'API_WORKSPACE_NOT_FOUND',
          message: 'API workspace not found.',
          operation: 'api.mutateWorkspace',
          subjectId: workspaceId,
          retryable: false,
        }),
      };
    }
    if (expectedRevision !== null && current.summary.revision !== expectedRevision) {
      return {
        ok: false,
        error: toBureauError({
          code: 'STALE_STATE',
          message: 'The workspace was modified elsewhere. Reload and try again.',
          operation: 'api.mutateWorkspace',
          subjectId: workspaceId,
          retryable: true,
          details: `expected ${expectedRevision}, found ${current.summary.revision}`,
        }),
      };
    }
    const nextOrError = mutator(current);
    if ('error' in nextOrError) return { ok: false, error: nextOrError.error };
    const stamp = nowIso();
    const next: ApiWorkspaceFileV1 = {
      ...nextOrError,
      summary: {
        ...nextOrError.summary,
        revision: current.summary.revision + 1,
        updatedAt: stamp,
      },
      updatedAt: stamp,
    };
    const store = getOrCreateFileStore(workspaceId);
    await store.update(() => next);
    const index = readIndex();
    await writeIndex(
      index.workspaces.map((entry) => (entry.workspaceId === workspaceId ? next.summary : entry))
    );
    return { ok: true, file: next };
  }

  async function updateWorkspace(input: {
    workspaceId: string;
    expectedRevision: number;
    name?: string;
    linkedProjectId?: string | null;
    activeEnvironmentId?: string | null;
    defaultProxyProfileId?: string | null;
    activeCookieJarId?: string | null;
    variables?: ApiVariableDefinition[];
    auth?: ApiAuth;
  }) {
    return mutateWorkspace(input.workspaceId, input.expectedRevision, (file) => {
      const summary = { ...file.summary };
      if (input.name !== undefined) summary.name = input.name.trim() || summary.name;
      if (input.linkedProjectId !== undefined) {
        if (input.linkedProjectId === null) delete summary.linkedProjectId;
        else summary.linkedProjectId = input.linkedProjectId;
      }
      if (input.activeEnvironmentId !== undefined) {
        if (input.activeEnvironmentId === null) delete summary.activeEnvironmentId;
        else summary.activeEnvironmentId = input.activeEnvironmentId;
      }
      if (input.defaultProxyProfileId !== undefined) {
        if (input.defaultProxyProfileId === null) delete summary.defaultProxyProfileId;
        else summary.defaultProxyProfileId = input.defaultProxyProfileId;
      }
      if (input.activeCookieJarId !== undefined) {
        if (!input.activeCookieJarId) delete summary.activeCookieJarId;
        else summary.activeCookieJarId = input.activeCookieJarId;
      }
      return {
        ...file,
        summary,
        variables: input.variables ? sanitizeIncomingVariables(input.variables) : file.variables,
        auth: input.auth ?? file.auth,
      };
    });
  }

  async function deleteWorkspace(input: {
    workspaceId: string;
    expectedRevision: number;
  }): Promise<{ ok: true } | { ok: false; error: ReturnType<typeof toBureauError> }> {
    const current = await loadFile(input.workspaceId);
    if (!current) {
      return {
        ok: false,
        error: toBureauError({
          code: 'API_WORKSPACE_NOT_FOUND',
          message: 'API workspace not found.',
          operation: 'api.deleteWorkspace',
          subjectId: input.workspaceId,
          retryable: false,
        }),
      };
    }
    if (current.summary.revision !== input.expectedRevision) {
      return {
        ok: false,
        error: toBureauError({
          code: 'STALE_STATE',
          message: 'The workspace was modified elsewhere. Reload and try again.',
          operation: 'api.deleteWorkspace',
          subjectId: input.workspaceId,
          retryable: true,
        }),
      };
    }
    const index = readIndex();
    await writeIndex(index.workspaces.filter((entry) => entry.workspaceId !== input.workspaceId));
    fileStores.delete(input.workspaceId);
    try {
      await fs.rm(workspaceFilePath(persistence.workspacesDir, input.workspaceId), { force: true });
    } catch {
      // ignore
    }
    return { ok: true };
  }

  async function unlinkProject(projectId: string): Promise<void> {
    const index = readIndex();
    for (const summary of index.workspaces) {
      if (summary.linkedProjectId !== projectId) continue;
      await mutateWorkspace(summary.workspaceId, null, (file) => {
        const nextSummary = { ...file.summary };
        delete nextSummary.linkedProjectId;
        return { ...file, summary: nextSummary };
      });
    }
  }

  async function createDefaultRequestNode(input: {
    workspaceId: string;
    parentId: string | null;
    name: string;
  }) {
    const requestId = randomUUID();
    const collectionId = randomUUID();
    const result = await mutateWorkspace(input.workspaceId, null, (file) => {
      const siblings = file.collections.filter((node) => node.parentId === input.parentId);
      const order = siblings.reduce((max, node) => Math.max(max, node.order), -1) + 1;
      const request = defaultRequest(input.workspaceId, requestId, input.name);
      request.collectionId = collectionId;
      const node: ApiCollectionNode = {
        collectionId,
        workspaceId: input.workspaceId,
        parentId: input.parentId,
        kind: 'request',
        name: input.name,
        order,
        requestId,
        variables: [],
        revision: 1,
      };
      return {
        ...file,
        collections: [...file.collections, node],
        requests: [...file.requests, request],
      };
    });
    if (!result.ok) return result;
    return { ok: true as const, file: result.file, collectionId, requestId };
  }

  return {
    listSummaries,
    getFile,
    getSnapshot,
    createWorkspace,
    restoreWorkspace,
    updateWorkspace,
    deleteWorkspace,
    mutateWorkspace,
    unlinkProject,
    createDefaultRequestNode,
  };
}
