export function createConcurrencyLimiter(maxConcurrency: number) {
  let running = 0;
  const queue: Array<() => void> = [];

  async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (running >= maxConcurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    running += 1;
    try {
      return await fn();
    } finally {
      running -= 1;
      const next = queue.shift();
      if (next) next();
    }
  }

  return { run };
}
