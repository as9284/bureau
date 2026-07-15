import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { positionMenuAtTrigger, type MenuCoords } from './menuPosition';
import './Menu.css';

type MenuProps = {
  open: boolean;
  onClose: () => void;
  trigger: ReactElement;
  children: ReactNode;
  align?: 'start' | 'end';
};

export function Menu({ open, onClose, trigger, children, align = 'end' }: MenuProps): ReactElement {
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<MenuCoords | null>(null);

  const updatePosition = useCallback(() => {
    const triggerEl = triggerRef.current;
    const panelEl = panelRef.current;
    if (!triggerEl || !panelEl) return;
    setCoords(positionMenuAtTrigger(triggerEl, panelEl, align));
  }, [align]);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    updatePosition();
  }, [open, children, align, updatePosition]);

  useEffect(() => {
    if (!open) return;

    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onReflow = () => updatePosition();

    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);

    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open, onClose, updatePosition]);

  const panelStyle: CSSProperties | undefined = coords
    ? { top: coords.top, left: coords.left }
    : { top: -9999, left: -9999, visibility: 'hidden' as const };

  return (
    <>
      <div className="sg-menu" ref={triggerRef}>
        {trigger}
      </div>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              className="sg-menu__panel"
              role="menu"
              style={panelStyle}
              onClick={(e) => {
                const target = e.target as HTMLElement;
                if (target.closest('[role="menuitem"], [role="menuitemcheckbox"]')) {
                  onClose();
                }
              }}
            >
              {children}
            </div>,
            document.body
          )
        : null}
    </>
  );
}

type MenuItemProps = {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
  shortcut?: string;
  destructive?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  /** When set, renders as a checkable menu item. */
  checked?: boolean;
};

export function MenuItem({
  label,
  onClick,
  icon,
  shortcut,
  destructive = false,
  disabled = false,
  disabledReason,
  checked,
}: MenuItemProps): ReactElement {
  const checkable = checked !== undefined;
  const classes = [
    'sg-menu__item',
    destructive ? 'sg-menu__item--destructive' : '',
    checkable ? 'sg-menu__item--checkable' : '',
    checked ? 'sg-menu__item--checked' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      role={checkable ? 'menuitemcheckbox' : 'menuitem'}
      aria-checked={checkable ? checked : undefined}
      className={classes}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      onClick={() => {
        if (!disabled) onClick();
      }}
    >
      {checkable ? (
        <span className="sg-menu__item-check" aria-hidden="true">
          {checked ? '✓' : ''}
        </span>
      ) : icon ? (
        <span className="sg-menu__item-icon">{icon}</span>
      ) : null}
      <span className="sg-menu__item-label">{label}</span>
      {shortcut ? <kbd className="sg-menu__item-shortcut">{shortcut}</kbd> : null}
    </button>
  );
}

export function MenuDivider(): ReactElement {
  return <div className="sg-menu__divider" role="separator" />;
}
