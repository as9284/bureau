import { createConcurrencyLimiter } from './ConcurrencyLimiter';

const MAX_READ_CONCURRENCY = 4;

export type OperationCoordinator = {
  runRead<T>(fn: () => Promise<T>): Promise<T>;
  runProjectRead<T>(projectId: string, fn: () => Promise<T>): Promise<T>;
  runMutation<T>(projectId: string, fn: () => Promise<T>): Promise<T>;
};

export function createOperationCoordinator(): OperationCoordinator {
  const readLimiter = createConcurrencyLimiter(MAX_READ_CONCURRENCY);
  const mutationLocks = new Map<string, Promise<unknown>>();

  async function runRead<T>(fn: () => Promise<T>): Promise<T> {
    return readLimiter.run(fn);
  }

  async function runProjectRead<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    return readLimiter.run(() => runForRepo(projectId, fn));
  }

  async function runMutation<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    return runForRepo(projectId, fn);
  }

  async function runForRepo<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    const previous = mutationLocks.get(projectId) ?? Promise.resolve();
    const next = previous.then(async () => fn());
    mutationLocks.set(
      projectId,
      next.catch(() => undefined)
    );
    return next;
  }

  return { runRead, runProjectRead, runMutation };
}
