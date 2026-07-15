import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { processDefinitionSchema } from '@shared/validation/requests';
import { STACK_TAGS } from '@shared/contracts/projects';
import type { BureauProjectConfig, ProcessDefinition } from '@shared/contracts/projects';

const CONFIG_DIR = '.bureau';
const CONFIG_FILE = 'config.json';

const configToolchainsSchema = z
  .object({
    node: z.object({ version: z.string().max(64), manager: z.enum(['fnm', 'volta', 'nvm', 'system']).optional() }).optional(),
    python: z
      .object({
        version: z.string().max(64),
        manager: z.enum(['pyenv', 'venv', 'system']).optional(),
        venv: z.string().max(256).optional(),
      })
      .optional(),
    flutter: z
      .object({
        version: z.string().max(64),
        manager: z.enum(['fvm', 'flutter']).optional(),
      })
      .optional(),
  })
  .strict();

const configSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string().min(1).max(256),
    stack: z.array(z.enum(STACK_TAGS)).max(20),
    packageManager: z.enum(['npm', 'pnpm', 'yarn', 'bun']).optional(),
    processes: z.array(processDefinitionSchema).max(100),
    toolchains: configToolchainsSchema.optional(),
  })
  .strict();

export type ReadConfigResult = {
  config: BureauProjectConfig;
  present: boolean;
  warning?: string;
};

function configPath(projectRoot: string): string {
  return path.join(projectRoot, CONFIG_DIR, CONFIG_FILE);
}

function fallbackConfig(projectRoot: string): BureauProjectConfig {
  return {
    schemaVersion: 1,
    name: path.basename(projectRoot) || 'Project',
    stack: [],
    processes: [],
  };
}

/** Reads a project's committable config, recovering gracefully from corrupt/incompatible files. */
export async function readProjectConfig(projectRoot: string): Promise<ReadConfigResult> {
  let raw: string;
  try {
    raw = await fs.readFile(configPath(projectRoot), 'utf8');
  } catch {
    return { config: fallbackConfig(projectRoot), present: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      config: fallbackConfig(projectRoot),
      present: true,
      warning: 'The project .bureau/config.json is corrupt and was ignored.',
    };
  }

  const version =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>).schemaVersion
      : undefined;
  if (typeof version === 'number' && version > 1) {
    return {
      config: fallbackConfig(projectRoot),
      present: true,
      warning:
        'This project config was written by a newer version of Bureau; it is read-only here.',
    };
  }

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    return {
      config: fallbackConfig(projectRoot),
      present: true,
      warning: 'The project .bureau/config.json has an unexpected shape and was ignored.',
    };
  }

  return { config: result.data, present: true };
}

/** Atomically writes a project's config (temp file → rename). */
export async function writeProjectConfig(
  projectRoot: string,
  config: BureauProjectConfig
): Promise<void> {
  const dir = path.join(projectRoot, CONFIG_DIR);
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, CONFIG_FILE);
  const bytes = Buffer.from(JSON.stringify(configSchema.parse(config), null, 2) + '\n', 'utf8');
  const temp = path.join(dir, `.tmp-${process.pid}-${Date.now()}.json`);
  const handle = await fs.open(temp, 'wx', 0o600);
  try {
    await handle.write(bytes, 0, bytes.length);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temp, target);
}

export async function upsertProcessDefinition(
  projectRoot: string,
  definition: ProcessDefinition
): Promise<BureauProjectConfig> {
  const { config } = await readProjectConfig(projectRoot);
  const processes = config.processes.filter((p) => p.id !== definition.id);
  processes.push(definition);
  const next: BureauProjectConfig = { ...config, processes };
  await writeProjectConfig(projectRoot, next);
  return next;
}

export async function removeProcessDefinition(
  projectRoot: string,
  processId: string
): Promise<BureauProjectConfig> {
  const { config } = await readProjectConfig(projectRoot);
  const next: BureauProjectConfig = {
    ...config,
    processes: config.processes.filter((p) => p.id !== processId),
  };
  await writeProjectConfig(projectRoot, next);
  return next;
}
