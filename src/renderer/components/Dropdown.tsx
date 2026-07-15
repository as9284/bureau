import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CaretDown } from '@phosphor-icons/react/CaretDown';
import { Check } from '@phosphor-icons/react/Check';

export type DropdownOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

type DropdownProps<T extends string> = {
  value: T;
  options: readonly DropdownOption<T>[];
  onChange(value: T): void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

type MenuCoords = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  openUp: boolean;
};

export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  label,
  placeholder = 'Select an option',
  disabled = false,
  className,
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [coords, setCoords] = useState<MenuCoords | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    const place = (): void => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.max(rect.width, 150);
      const gap = 4;
      const spaceBelow = window.innerHeight - rect.bottom - gap;
      const spaceAbove = rect.top - gap;
      const openUp = spaceBelow < 120 && spaceAbove > spaceBelow;
      const maxHeight = Math.min(232, Math.max(80, openUp ? spaceAbove : spaceBelow));
      let left = rect.left;
      if (left + width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - width - 8);
      }
      setCoords({
        top: openUp ? rect.top - gap : rect.bottom + gap,
        left,
        width,
        maxHeight,
        openUp,
      });
    };
    place();
    window.addEventListener('resize', place);
    // Capture scroll from overflow ancestors (workspace-body, lists, etc.).
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onWindowChange = () => setOpen(false);
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('blur', onWindowChange);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('blur', onWindowChange);
    };
  }, [open]);

  const openMenu = () => {
    if (disabled) return;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : nextEnabled(options, -1, 1));
    setOpen(true);
  };

  const selectIndex = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
  };

  const menu =
    open && coords
      ? createPortal(
          <div
            ref={menuRef}
            className={['control-dropdown__menu', coords.openUp ? 'open-up' : ''].join(' ')}
            id={listboxId}
            role="listbox"
            aria-label={label}
            style={{
              top: coords.openUp ? undefined : coords.top,
              bottom: coords.openUp ? window.innerHeight - coords.top : undefined,
              left: coords.left,
              width: coords.width,
              maxHeight: coords.maxHeight,
            }}
          >
            {options.map((option, index) => (
              <button
                type="button"
                role="option"
                id={`${listboxId}-option-${index}`}
                aria-selected={option.value === value}
                disabled={option.disabled}
                className={['control-dropdown__option', index === activeIndex ? 'active' : '']
                  .filter(Boolean)
                  .join(' ')}
                key={option.value}
                onMouseEnter={() => {
                  if (!option.disabled) setActiveIndex(index);
                }}
                onClick={() => selectIndex(index)}
              >
                <span>{option.label}</span>
                {option.value === value && <Check size={13} weight="bold" aria-hidden />}
              </button>
            ))}
          </div>,
          document.body
        )
      : null;

  return (
    <div
      ref={rootRef}
      className={['control-dropdown', open ? 'open' : '', className].filter(Boolean).join(' ')}
    >
      <button
        ref={triggerRef}
        type="button"
        className="control-dropdown__trigger"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={
          open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
        }
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(event) => {
          if (!open) {
            if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
              event.preventDefault();
              openMenu();
            }
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const direction = event.key === 'ArrowDown' ? 1 : -1;
            setActiveIndex((current) => nextEnabled(options, current, direction));
          } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            setActiveIndex(
              nextEnabled(
                options,
                event.key === 'Home' ? -1 : options.length,
                event.key === 'Home' ? 1 : -1
              )
            );
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectIndex(activeIndex);
          } else if (event.key === 'Tab') {
            setOpen(false);
          }
        }}
      >
        <span className={selected ? '' : 'placeholder'}>{selected?.label ?? placeholder}</span>
        <CaretDown size={13} weight="bold" aria-hidden />
      </button>
      {menu}
    </div>
  );
}

function nextEnabled<T extends string>(
  options: readonly DropdownOption<T>[],
  from: number,
  direction: 1 | -1
): number {
  if (options.length === 0) return -1;
  let next = from;
  for (let count = 0; count < options.length; count += 1) {
    next = (next + direction + options.length) % options.length;
    if (!options[next]?.disabled) return next;
  }
  return -1;
}
