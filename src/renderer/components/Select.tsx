import type { ReactElement, ReactNode } from 'react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './Select.css';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

interface SelectProps<T extends string> {
  label: string;
  value: T;
  options: Array<SelectOption<T>>;
  onChange: (value: T) => void;
  id?: string;
  className?: string;
  disabled?: boolean;
  leadingIcon?: ReactNode;
  size?: 'standard' | 'compact';
}

type PopoverCoords = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  openUp: boolean;
};

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  id,
  className,
  disabled = false,
  leadingIcon,
  size = 'standard',
}: SelectProps<T>): ReactElement {
  const generatedId = useId();
  const selectId = id ?? `sg-select-${generatedId}`;
  const listboxId = `${selectId}-listbox`;
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<PopoverCoords | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? options[0],
    [options, value]
  );

  // Position the portalled popover against the trigger (fixed coords), matching
  // Dropdown so the menu is never clipped by a dialog's overflow or hidden
  // behind a modal scrim.
  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    const place = (): void => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.max(rect.width, 180);
      const gap = 4;
      const spaceBelow = window.innerHeight - rect.bottom - gap;
      const spaceAbove = rect.top - gap;
      const openUp = spaceBelow < 140 && spaceAbove > spaceBelow;
      const maxHeight = Math.min(260, Math.max(96, openUp ? spaceAbove : spaceBelow));
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
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleWindowChange = () => setOpen(false);
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('blur', handleWindowChange);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('blur', handleWindowChange);
    };
  }, [open]);

  const selectOption = (nextValue: T) => {
    onChange(nextValue);
    setOpen(false);
  };

  const popover =
    open && coords
      ? createPortal(
          <div
            ref={popoverRef}
            id={listboxId}
            className={['sg-select__popover', coords.openUp ? 'open-up' : ''].filter(Boolean).join(' ')}
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
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className="sg-select__option"
                onClick={() => selectOption(option.value)}
              >
                <span className="sg-select__option-label">{option.label}</span>
                {option.description ? (
                  <span className="sg-select__option-description">{option.description}</span>
                ) : null}
              </button>
            ))}
          </div>,
          document.body
        )
      : null;

  return (
    <div ref={rootRef} className={`sg-select sg-select--${size} ${className ?? ''}`.trim()}>
      <button
        ref={triggerRef}
        id={selectId}
        type="button"
        className="sg-select__trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen(true);
          }
          if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
      >
        {leadingIcon ? <span className="sg-select__leading">{leadingIcon}</span> : null}
        <span className="sg-select__value">{selected?.label ?? ''}</span>
        <span className="sg-select__chevron" aria-hidden="true" />
      </button>
      {popover}
    </div>
  );
}
