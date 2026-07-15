import { useId, type ReactElement, type ReactNode } from 'react';
import './Checkbox.css';

type CheckboxProps = {
  checked: boolean;
  /** StarGit API */
  onCheckedChange?: (checked: boolean) => void;
  /** Bureau API (e.g. Android panel) */
  onChange?: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  tone?: 'danger';
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
  tone,
  disabled = false,
  className,
}: CheckboxProps): ReactElement {
  const labelId = useId();
  const descriptionId = useId();

  function toggle(): void {
    const next = !checked;
    onCheckedChange?.(next);
    onChange?.(next);
  }

  return (
    <div
      className={[
        'checkbox-row',
        description ? 'checkbox-row--described' : undefined,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={description ? descriptionId : undefined}
        disabled={disabled}
        className={[
          'sg-checkbox',
          description ? 'sg-checkbox--described' : undefined,
          tone ? `sg-checkbox--${tone}` : undefined,
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={toggle}
      >
        <span className="sg-checkbox__box" aria-hidden="true">
          {checked ? (
            <svg viewBox="0 0 16 16" className="sg-checkbox__check">
              <path d="M3.5 8.2 6.6 11.3 12.8 4.7" />
            </svg>
          ) : null}
        </span>
        <span className="sg-checkbox__copy">
          <span id={labelId} className="sg-checkbox__label">
            {label}
          </span>
          {description ? (
            <span id={descriptionId} className="sg-checkbox__description">
              {description}
            </span>
          ) : null}
        </span>
      </button>
    </div>
  );
}
