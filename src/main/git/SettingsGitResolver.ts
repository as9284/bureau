import type { GitExecutableResolver } from './GitExecutableResolver';
import type { SettingsStore } from '../settings/SettingsStore';

export function createSettingsGitResolver(
  baseResolver: GitExecutableResolver,
  settingsStore: SettingsStore
): GitExecutableResolver {
  return {
    resolve: () => baseResolver.resolve(settingsStore.get().git.executablePath),
  };
}
