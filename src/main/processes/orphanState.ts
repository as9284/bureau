import { createAtomicJsonStore, type AtomicJsonStore } from '../storage/AtomicJsonStore';
import { z } from 'zod';

const orphanRecordSchema = z.object({
  projectId: z.string(),
  processId: z.string(),
  projectRoot: z.string().optional().default(''),
  label: z.string(),
  pid: z.number().int().positive(),
  command: z.string(),
  cwd: z.string(),
  detectedUrl: z.string().optional(),
  recordedAt: z.string(),
});

const orphanFileSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.string(),
  records: z.array(orphanRecordSchema).max(200),
});

export type OrphanRecord = z.infer<typeof orphanRecordSchema>;
export type OrphanFile = z.infer<typeof orphanFileSchema>;

export type OrphanStore = {
  list(): OrphanRecord[];
  replace(records: OrphanRecord[]): Promise<void>;
  clear(): Promise<void>;
};

export function createOrphanStore(filePath: string): AtomicJsonStore<OrphanFile> {
  return createAtomicJsonStore<OrphanFile>({
    filePath,
    schemaVersion: 1,
    defaultValue: {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      records: [],
    },
    validate: (value) => orphanFileSchema.parse(value),
  });
}

export function createOrphanStoreApi(store: AtomicJsonStore<OrphanFile>): OrphanStore {
  return {
    list() {
      return store.read().records;
    },
    async replace(records) {
      await store.update(() => ({
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        records,
      }));
    },
    async clear() {
      await store.update(() => ({
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        records: [],
      }));
    },
  };
}

/** True when a PID appears alive (signal 0 / Windows OpenProcess equivalent via kill). */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
