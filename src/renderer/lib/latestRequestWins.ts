// Monotonic generation guard: drop out-of-order async responses when the user
// switches subjects faster than requests resolve. One instance per async stream.
export function createLatestRequestWins() {
  let generation = 0;

  return {
    nextGeneration(): number {
      generation += 1;
      return generation;
    },
    isCurrent(value: number): boolean {
      return value === generation;
    },
    cancelAll(): void {
      generation += 1;
    },
  };
}
