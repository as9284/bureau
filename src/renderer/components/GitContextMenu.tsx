import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  cloneElement,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { MenuItem, MenuDivider } from './Menu';
import { positionMenuAtPoint } from './menuPosition';
import './Menu.css';

export type ContextMenuItemDef = {
  id: string;
  label: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  separatorBefore?: boolean;
  checked?: boolean;
};

type ContextMenuApi = {
  openAt: (x: number, y: number, items: ContextMenuItemDef[]) => void;
  close: () => void;
};

const ContextMenuContext = createContext<ContextMenuApi | null>(null);

type OpenState = {
  x: number;
  y: number;
  items: ContextMenuItemDef[];
};

export function ContextMenuProvider({ children }: { children: ReactNode }): ReactElement {
  const [open, setOpen] = useState<OpenState | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(null);
    setCoords(null);
  }, []);

  const openAt = useCallback((x: number, y: number, items: ContextMenuItemDef[]) => {
    if (items.length === 0) return;
    setOpen({ x, y, items });
  }, []);

  useLayoutEffect(() => {
    if (!open || !panelRef.current) {
      setCoords(null);
      return;
    }
    setCoords(positionMenuAtPoint(open.x, open.y, panelRef.current));
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onPointer = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onReflow = () => {
      if (!open || !panelRef.current) return;
      setCoords(positionMenuAtPoint(open.x, open.y, panelRef.current));
    };

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
  }, [open, close]);

  const panelStyle: CSSProperties = coords
    ? { top: coords.top, left: coords.left }
    : { top: open?.y ?? -9999, left: open?.x ?? -9999, visibility: 'hidden' };

  return (
    <ContextMenuContext.Provider value={{ openAt, close }}>
      {children}
      {open
        ? createPortal(
            <div
              ref={panelRef}
              className="sg-menu__panel"
              role="menu"
              style={panelStyle}
              onContextMenu={(e) => e.preventDefault()}
            >
              {open.items.map((item) => (
                <span key={item.id}>
                  {item.separatorBefore ? <MenuDivider /> : null}
                  <MenuItem
                    label={item.label}
                    destructive={item.destructive}
                    disabled={item.disabled}
                    disabledReason={item.disabledReason}
                    checked={item.checked}
                    onClick={() => {
                      item.onClick();
                      close();
                    }}
                  />
                </span>
              ))}
            </div>,
            document.body
          )
        : null}
    </ContextMenuContext.Provider>
  );
}

export function useContextMenu(): ContextMenuApi {
  const ctx = useContext(ContextMenuContext);
  if (!ctx) {
    throw new Error('useContextMenu must be used within ContextMenuProvider');
  }
  return ctx;
}

type ContextMenuTriggerProps = {
  menu: ContextMenuItemDef[];
  children: ReactElement;
  disabled?: boolean;
};

export function ContextMenuTrigger({
  menu,
  children,
  disabled = false,
}: ContextMenuTriggerProps): ReactElement {
  const { openAt } = useContextMenu();

  const child = children as ReactElement<{ onContextMenu?: (e: React.MouseEvent) => void }>;

  return cloneElement(child, {
    onContextMenu: (e: React.MouseEvent) => {
      child.props.onContextMenu?.(e);
      if (e.defaultPrevented || disabled || menu.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      openAt(e.clientX, e.clientY, menu);
    },
  });
}

export function openContextMenuFromEvent(
  e: React.MouseEvent,
  openAt: ContextMenuApi['openAt'],
  items: ContextMenuItemDef[]
): void {
  if (items.length === 0) return;
  e.preventDefault();
  e.stopPropagation();
  openAt(e.clientX, e.clientY, items);
}
