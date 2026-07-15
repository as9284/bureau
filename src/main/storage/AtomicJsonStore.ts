import fs from 'node:fs/promises';
import path from 'node:path';

export type LoadSource = 'primary' | 'backup' | 'default';

export type StorageRecovery =
  { kind: 'backupRestored'; corruptPath: string } | { kind: 'safeDefaults'; corruptPath?: string };

export type LoadResult<T> = {
  value: T;
  source: LoadSource;
  recovery?: StorageRecovery;
};

export type AtomicJsonStore<T> = {
  load(): Promise<LoadResult<T>>;
  read(): T;
  update(mutator: (current: Readonly<T>) => T): Promise<T>;
};

export type AtomicJsonStoreOptions<T> = {
  filePath: string;
  schemaVersion: number;
  defaultValue: T;
  validate: (value: unknown) => T;
  onIncompatibleVersion?: (version: number) => Error;
};

type InternalState<T> = { status: 'empty' } | { status: 'loaded'; value: T; source: LoadSource };

export function createAtomicJsonStore<T>(options: AtomicJsonStoreOptions<T>): AtomicJsonStore<T> {
  const { filePath, schemaVersion, defaultValue, validate } = options;
  const directory = path.dirname(filePath);
  const backupPath = `${filePath}.bak`;
  const corruptDirectory = path.join(directory, 'corrupt');

  let state: InternalState<T> = { status: 'empty' };
  let writeQueue: Promise<T> = Promise.resolve(defaultValue);

  async function load(): Promise<LoadResult<T>> {
    const primaryResult = await readFileIfExists(filePath);
    if (primaryResult.ok) {
      const parsed = parseAndValidate(primaryResult.content);
      if ('incompatible' in parsed) {
        throw new Error(
          `Incompatible data schema version ${parsed.version}. This application only supports version ${schemaVersion}.`
        );
      }
      if (parsed.ok) {
        state = { status: 'loaded', value: parsed.value, source: 'primary' };
        return { value: parsed.value, source: 'primary' };
      }
    }

    const primaryCorrupt = primaryResult.ok ? primaryResult.content : undefined;
    const backupResult = await readFileIfExists(backupPath);
    if (backupResult.ok) {
      const parsed = parseAndValidate(backupResult.content);
      if ('incompatible' in parsed) {
        throw new Error(
          `Incompatible data schema version ${parsed.version}. This application only supports version ${schemaVersion}.`
        );
      }
      if (parsed.ok) {
        const corruptPath = await quarantineFile(filePath, primaryCorrupt);
        state = { status: 'loaded', value: parsed.value, source: 'backup' };
        return {
          value: parsed.value,
          source: 'backup',
          recovery: { kind: 'backupRestored', corruptPath },
        };
      }
    }

    const corruptPath = await quarantineFile(filePath, primaryCorrupt);
    state = { status: 'loaded', value: defaultValue, source: 'default' };
    return {
      value: defaultValue,
      source: 'default',
      recovery: { kind: 'safeDefaults', corruptPath },
    };
  }

  function read(): T {
    if (state.status === 'empty') {
      throw new Error('Store has not been loaded');
    }
    return state.value;
  }

  function update(mutator: (current: Readonly<T>) => T): Promise<T> {
    const queued = writeQueue.then(async (previous) => {
      const current = state.status === 'loaded' ? state.value : previous;
      const next = validate(mutator(current));
      await writeAtomically(next);
      state = { status: 'loaded', value: next, source: 'primary' };
      return next;
    });
    writeQueue = queued.catch(() => {
      // On failure, keep the prior resolved value in the queue so later writes can proceed.
      return previousQueueValue(writeQueue);
    });
    return queued;
  }

  async function previousQueueValue(queue: Promise<T>): Promise<T> {
    try {
      return await queue;
    } catch {
      return defaultValue;
    }
  }

  type ParseResult<T> =
    { ok: true; value: T } | { ok: false; error: Error } | { incompatible: true; version: number };

  function parseAndValidate(content: string): ParseResult<T> {
    try {
      const parsed = JSON.parse(content) as unknown;
      const versionCandidate =
        typeof parsed === 'object' && parsed !== null
          ? (parsed as Record<string, unknown>).schemaVersion
          : undefined;
      if (typeof versionCandidate === 'number' && versionCandidate > schemaVersion) {
        return { incompatible: true, version: versionCandidate };
      }
      return { ok: true, value: validate(parsed) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  async function writeAtomically(value: T): Promise<void> {
    const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
    const tempName = `.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
    const tempPath = path.join(directory, tempName);

    try {
      await fs.mkdir(directory, { recursive: true });
      const handle = await fs.open(tempPath, 'wx', 0o600);
      try {
        await handle.write(bytes, 0, bytes.length);
        await handle.sync();
      } finally {
        await handle.close();
      }

      const primaryValid = await isValidPrimary();
      if (primaryValid) {
        await safeCopy(filePath, backupPath);
      }

      await fs.rename(tempPath, filePath);

      try {
        const dirHandle = await fs.open(directory, 'r');
        try {
          await dirHandle.sync();
        } finally {
          await dirHandle.close();
        }
      } catch {
        // Directory sync is best-effort; ignore unsupported filesystems.
      }
    } catch (error) {
      try {
        await fs.unlink(tempPath);
      } catch {
        // Best-effort cleanup.
      }
      throw error;
    }
  }

  async function isValidPrimary(): Promise<boolean> {
    const result = await readFileIfExists(filePath);
    if (!result.ok) return false;
    const parsed = parseAndValidate(result.content);
    return 'ok' in parsed && parsed.ok;
  }

  async function safeCopy(source: string, destination: string): Promise<void> {
    const content = await fs.readFile(source);
    const tempDestination = `${destination}.tmp`;
    await fs.writeFile(tempDestination, content, { mode: 0o600 });
    await fs.rename(tempDestination, destination);
  }

  async function quarantineFile(originalPath: string, content?: string): Promise<string> {
    await fs.mkdir(corruptDirectory, { recursive: true });
    const baseName = path.basename(originalPath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const corruptPath = path.join(corruptDirectory, `${baseName}.${timestamp}.json`);
    if (content !== undefined) {
      await fs.writeFile(corruptPath, content, { mode: 0o600 });
    }
    return corruptPath;
  }

  type ReadResult = { ok: true; content: string } | { ok: false };

  async function readFileIfExists(targetPath: string): Promise<ReadResult> {
    try {
      const content = await fs.readFile(targetPath, 'utf8');
      return { ok: true, content };
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return { ok: false };
      }
      return { ok: false };
    }
  }

  return { load, read, update };
}
