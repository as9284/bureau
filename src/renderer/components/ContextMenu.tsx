import { useEffect } from 'react';
import { useAppStore } from '@renderer/store/appStore';

/** Store-driven context menu used by the Bureau shell (not the git workbench trigger). */
export function ContextMenu() {
  const menu = useAppStore((s) => s.contextMenu);
  const closeContextMenu = useAppStore((s) => s.closeContextMenu);

  useEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeContextMenu();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('.context-menu')) return;
      closeContextMenu();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, [menu, closeContextMenu]);

  if (!menu) return null;

  const pad = 8;
  const approxWidth = 220;
  const approxHeight = Math.min(360, 8 + menu.items.length * 34);
  const left = Math.max(pad, Math.min(menu.x, window.innerWidth - approxWidth - pad));
  const top = Math.max(pad, Math.min(menu.y, window.innerHeight - approxHeight - pad));

  return (
    <div
      className="context-menu"
      role="menu"
      style={{ left, top }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {menu.items.map((item, index) => {
        if (item.type === 'separator') {
          return <div key={`sep-${index}`} className="context-menu__separator" role="separator" />;
        }
        return (
          <button
            key={`${item.label}-${index}`}
            type="button"
            role="menuitem"
            className={['context-menu__item', item.danger ? 'danger' : ''].filter(Boolean).join(' ')}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              item.onSelect();
              closeContextMenu();
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
