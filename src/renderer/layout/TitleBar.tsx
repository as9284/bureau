import logoUrl from '../../../assets/icons/icon-64.png';
import { CloseIcon, MinusIcon, SquareIcon } from '../components/icons';
import { requestImmersiveNavigationReveal } from '../lib/immersiveNavigation';
import { useAppStore } from '../store/appStore';

export function TitleBar() {
  const openPalette = useAppStore((s) => s.openPalette);
  const immersiveMode = useAppStore((s) => s.settings?.appearance.immersiveMode ?? false);
  const bureau = window.bureau;
  const brand = (
    <>
      <img className="title-brand__mark" src={logoUrl} alt="" width={18} height={18} />
      <span className="title-brand__name">Bureau</span>
    </>
  );

  return (
    <header className="title-bar">
      {immersiveMode ? (
        <button
          className="title-brand title-brand--navigation"
          type="button"
          aria-label="Show navigation"
          title="Show navigation"
          onClick={requestImmersiveNavigationReveal}
        >
          {brand}
        </button>
      ) : (
        <div className="title-brand">{brand}</div>
      )}

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
