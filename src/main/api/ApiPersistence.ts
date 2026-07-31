import fs from 'node:fs/promises';
import path from 'node:path';
import { createAtomicJsonStore, type AtomicJsonStore } from '../storage/AtomicJsonStore';

export type ApiPersistencePaths = {
  root: string;
  indexPath: string;
  secretsPath: string;
  cookiesPath: string;
  oauthTokensPath: string;
  workspacesDir: string;
  historyDir: string;
  historyIndexPath: string;
  historyEntriesDir: string;
  historyBodiesDir: string;
};

export type ApiPersistence = ApiPersistencePaths & {
  indexStore: AtomicJsonStore<unknown>;
  secretsStore: AtomicJsonStore<unknown>;
  cookiesStore: AtomicJsonStore<unknown>;
  /** OAuth tokens live apart from user secrets so clearing one never clears the other. */
  oauthTokensStore: AtomicJsonStore<unknown>;
  historyIndexStore: AtomicJsonStore<unknown>;
};

export async function createApiPersistence(dataPath: string): Promise<ApiPersistence> {
  const root = path.join(dataPath, 'api');
  const workspacesDir = path.join(root, 'workspaces');
  const historyDir = path.join(root, 'history');
  const historyEntriesDir = path.join(historyDir, 'entries');
  const historyBodiesDir = path.join(historyDir, 'bodies');

  await fs.mkdir(workspacesDir, { recursive: true });
  await fs.mkdir(historyEntriesDir, { recursive: true });
  await fs.mkdir(historyBodiesDir, { recursive: true });

  const indexPath = path.join(root, 'index.v1.json');
  const secretsPath = path.join(root, 'secrets.v1.json');
  const cookiesPath = path.join(root, 'cookies.v1.json');
  const oauthTokensPath = path.join(root, 'oauth-tokens.v1.json');
  const historyIndexPath = path.join(historyDir, 'index.v1.json');

  const indexStore = createAtomicJsonStore({
    filePath: indexPath,
    schemaVersion: 1,
    defaultValue: { schemaVersion: 1, workspaces: [] },
    validate: (value) => value,
  });
  const secretsStore = createAtomicJsonStore({
    filePath: secretsPath,
    schemaVersion: 1,
    defaultValue: { schemaVersion: 1, secrets: [], updatedAt: new Date().toISOString() },
    validate: (value) => value,
  });
  const cookiesStore = createAtomicJsonStore({
    filePath: cookiesPath,
    schemaVersion: 1,
    defaultValue: { schemaVersion: 1, jars: [], updatedAt: new Date().toISOString() },
    validate: (value) => value,
  });
  const oauthTokensStore = createAtomicJsonStore({
    filePath: oauthTokensPath,
    schemaVersion: 1,
    defaultValue: { schemaVersion: 1, tokens: [], updatedAt: new Date().toISOString() },
    validate: (value) => value,
  });
  const historyIndexStore = createAtomicJsonStore({
    filePath: historyIndexPath,
    schemaVersion: 1,
    defaultValue: { schemaVersion: 1, entries: [], bodyBytesUsed: 0 },
    validate: (value) => value,
  });

  await indexStore.load();
  await secretsStore.load();
  await cookiesStore.load();
  await oauthTokensStore.load();
  await historyIndexStore.load();

  return {
    root,
    indexPath,
    secretsPath,
    cookiesPath,
    oauthTokensPath,
    workspacesDir,
    historyDir,
    historyIndexPath,
    historyEntriesDir,
    historyBodiesDir,
    indexStore,
    secretsStore,
    cookiesStore,
    oauthTokensStore,
    historyIndexStore,
  };
}

export function workspaceFilePath(workspacesDir: string, workspaceId: string): string {
  return path.join(workspacesDir, `${workspaceId}.v1.json`);
}
