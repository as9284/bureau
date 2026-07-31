import logoUrl from '../../../assets/icons/icon-64.png';
import { CloseIcon, MinusIcon, SquareIcon } from '../components/icons';
import { useAppStore } from '../store/appStore';
import { ApiNavButton } from './ApiNavButton';
import { ProjectSwitcher } from './ProjectSwitcher';

export function TitleBar() {
  const openPalette = useAppStore((s) => s.openPalette);
  const backToHub = useAppStore((s) => s.backToHub);
  const bureau = window.bureau;

  return (
    <header className="title-bar">
      <div className="title-bar__leading">
        <button
          type="button"
          className="title-brand"
          aria-label="Go to Projects hub"
          title="Projects hub"
          onClick={() => backToHub()}
        >
          <img className="title-brand__mark" src={logoUrl} alt="" width={18} height={18} />
          <span className="title-brand__name">Bureau</span>
        </button>
        <ProjectSwitcher />
        <ApiNavButton />
      </div>

      <button className="command-bar" type="button" onClick={openPalette}>
        <span className="command-bar__label">Search or run a command…</span>
        <span className="command-bar__hint">Ctrl K</span>
      </button>

      <div className="window-controls">
        <button aria-label="Minimize" onClick={() => bureau.app.minimizeWindow()}>
          <MinusIcon size={14} />
        </button>
        <button aria-label="Maximize" onClick={() => bureau.app.toggleMaximizeWindow()}>
          <SquareIcon size={12} />
        </button>
        <button className="close" aria-label="Close" onClick={() => bureau.app.closeWindow()}>
          <CloseIcon size={14} />
        </button>
      </div>
    </header>
  );
}
