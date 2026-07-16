import type { EnvResolver } from '../processes/ProcessSupervisor';
import type { ProjectConfigStore } from '../projects/ProjectConfigStore';
import type { SettingsStore } from '../settings/SettingsStore';
import { mergeEnv, sanitizeEnv } from './pathMerge';
import { resolveToolchainPathEntries } from './RuntimeDetector';

export function createToolchainEnvResolver(deps: {
  settingsStore: SettingsStore;
  configStore: ProjectConfigStore;
}): EnvResolver {
  return async ({ projectId, projectRoot, definition, overrides }) => {
    const base = sanitizeEnv();
    const settings = deps.settingsStore.get();
    const config = deps.configStore.get(projectId);
    const pathEntries = await resolveToolchainPathEntries(
      projectRoot,
      config,
      definition,
      settings.toolchains ?? {}
    );
    return mergeEnv(base, pathEntries, overrides);
  };
}
