import type { ReactElement, ReactNode } from 'react';
import './Checkbox.css';

type CheckboxProps = {
  checked: boolean;
  /** StarGit API */
  onCheckedChange?: (checked: boolean) => void;
  /** Bureau API (e.g. Android panel) */
  onChange?: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  tone?: string;
  disabled?: boolean;
  className?: string;
};

/** Supports both Bureau (onChange) and StarGit (onCheckedChange) call sites. */
export function Checkbox({
  checked,
  onCheckedChange,
  onChange,
  label,
  description,
  disabled = false,
  className,
}: CheckboxProps): ReactElement {
  function toggle(): void {
    const next = !checked;
    onCheckedChange?.(next);
    onChange?.(next);
  }

  return (
    <div className={['checkbox-row', className].filter(Boolean).join(' ')}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        disabled={disabled}
        className="sg-checkbox"
        onClick={toggle}
      >
        <span className="sg-checkbox__box" aria-hidden="true">
          {checked ? (
            <svg viewBox="0 0 16 16" className="sg-checkbox__check">
              <path d="M3.5 8.2 6.6 11.3 12.8 4.7" />
            </svg>
          ) : null}
        </span>
        <span className="sg-checkbox__label">{label}</span>
      </button>
      {description ? <span className="checkbox-row__desc">{description}</span> : null}
    </div>
  );
}
