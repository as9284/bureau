import { useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { WorkbenchShell } from '../layout/WorkbenchShell';
import { dismissBootSplash } from '../boot';

export function App() {
  const status = useAppStore((s) => s.status);
  const init = useAppStore((s) => s.init);
  const togglePalette = useAppStore((s) => s.togglePalette);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (status !== 'loading') {
      dismissBootSplash();
    }
  }, [status]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        togglePalette();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePalette]);

  if (status === 'loading') {
    return null;
  }

  return <WorkbenchShell />;
}
