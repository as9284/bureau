import { useAppStore } from '../store/appStore';

/**
 * Title-bar entry point for the global API workspace, sitting beside the project switcher.
 *
 * API data is global rather than per-project, so this is a peer of the switcher — not a project
 * tab. Settings is still not a primary destination: it remembers and restores whichever of
 * Projects or API was active.
 */
export function ApiNavButton() {
  const view = useAppStore((s) => s.view);
  const primaryWorkspace = useAppStore((s) => s.primaryWorkspace);
  const setPrimaryWorkspace = useAppStore((s) => s.setPrimaryWorkspace);

  // While Settings is open, keep highlighting the destination it will return to.
  const active = view === 'api' || (view === 'settings' && primaryWorkspace === 'api');

  return (
    <button
      type="button"
      className={['title-nav-item', active ? 'active' : ''].filter(Boolean).join(' ')}
      aria-current={active ? 'page' : undefined}
      title="API workspace"
      onClick={() => setPrimaryWorkspace(active ? 'projects' : 'api')}
    >
      API
    </button>
  );
}
