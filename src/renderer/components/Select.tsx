import type { ReactElement, ReactNode } from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
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
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? options[0],
    [options, value]
  );

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const selectOption = (nextValue: T) => {
    onChange(nextValue);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={`sg-select sg-select--${size} ${className ?? ''}`.trim()}>
      <button
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
      {open ? (
        <div id={listboxId} className="sg-select__popover" role="listbox" aria-label={label}>
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
        </div>
      ) : null}
    </div>
  );
}
