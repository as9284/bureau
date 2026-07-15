import { useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { WorkbenchShell } from '../layout/WorkbenchShell';
import { dismissBootSplash } from '../boot';

export function App() {
  const status = useAppStore((s) => s.status);
  const init = useAppStore((s) => s.init);
  const togglePalette = useAppStore((s) => s.togglePalette);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const immersiveMode = useAppStore((s) => s.settings?.appearance.immersiveMode ?? false);
  const pushToast = useAppStore((s) => s.pushToast);

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
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        const next = !immersiveMode;
        void updateSettings({ appearance: { immersiveMode: next } });
        pushToast('info', next ? 'Immersive mode on' : 'Immersive mode off');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePalette, updateSettings, immersiveMode, pushToast]);

  if (status === 'loading') {
    return null;
  }

  return <WorkbenchShell />;
}
