import type { EnvResolver } from '../processes/ProcessSupervisor';
import type { ProjectCatalogue } from '../projects/ProjectCatalogue';
import { readProjectConfig } from '../projects/BureauConfigStore';
import type { SettingsStore } from '../settings/SettingsStore';
import { mergeEnv, sanitizeEnv } from './pathMerge';
import { resolveToolchainPathEntries } from './RuntimeDetector';

export function createToolchainEnvResolver(deps: {
  catalogue: ProjectCatalogue;
  settingsStore: SettingsStore;
}): EnvResolver {
  return async ({ projectRoot, definition, overrides }) => {
    const base = sanitizeEnv();
    const settings = deps.settingsStore.get();
    const { config } = await readProjectConfig(projectRoot);
    const pathEntries = await resolveToolchainPathEntries(
      projectRoot,
      config,
      definition,
      settings.toolchains ?? {}
    );
    return mergeEnv(base, pathEntries, overrides);
  };
}
