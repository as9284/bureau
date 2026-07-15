import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('orphanState schema', () => {
  it('accepts records without projectRoot (legacy)', () => {
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
    const parsed = orphanRecordSchema.parse({
      projectId: 'p1',
      processId: 'web',
      label: 'Web',
      pid: 1234,
      command: 'node server.js',
      cwd: 'C:/proj',
      recordedAt: new Date().toISOString(),
    });
    expect(parsed.projectRoot).toBe('');
  });
});
