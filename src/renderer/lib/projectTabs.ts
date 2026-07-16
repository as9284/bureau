import { PROJECT_TAB_IDS, type ProjectTabId } from '@shared/contracts/settings';

/** Display labels for the per-project workspace tabs. */
export const PROJECT_TAB_LABELS: Record<ProjectTabId, string> = {
  overview: 'Overview',
  files: 'Files',
  processes: 'Processes',
  preview: 'Preview',
  android: 'Android',
  toolchains: 'Toolchains',
  ports: 'Ports',
  git: 'Git',
};

/**
 * Resolve the effective tab order from a saved preference: keep the saved order
 * for ids that still exist (dropping any that were removed and de-duplicating),
 * then append any canonical tabs the preference doesn't mention (new tabs land in
 * their default position). Pure, so the workspace and the settings editor agree.
 */
export function orderProjectTabs(saved: readonly ProjectTabId[] | undefined): ProjectTabId[] {
  const known = new Set<ProjectTabId>(PROJECT_TAB_IDS);
  const seen = new Set<ProjectTabId>();
  const ordered: ProjectTabId[] = [];
  for (const id of saved ?? []) {
    if (known.has(id) && !seen.has(id)) {
      ordered.push(id);
      seen.add(id);
    }
  }
  for (const id of PROJECT_TAB_IDS) {
    if (!seen.has(id)) ordered.push(id);
  }
  return ordered;
}
