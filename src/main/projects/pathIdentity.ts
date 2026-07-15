import { realpath } from 'node:fs/promises';
import path from 'node:path';

/** Case-normalized on Windows (case-insensitive FS), case-preserving elsewhere. */
export function normalizePathForComparison(input: string): string {
  const normalized = path.normalize(input);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function pathsEqual(a: string, b: string): boolean {
  return normalizePathForComparison(a) === normalizePathForComparison(b);
}

/** Resolves a canonical (symlink-free) absolute path; falls back to normalize on failure. */
export async function canonicalizePath(input: string): Promise<string> {
  try {
    return await realpath(input);
  } catch {
    return path.resolve(input);
  }
}
