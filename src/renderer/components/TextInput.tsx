import { forwardRef, type InputHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import './TextInput.css';

type TextInputSize = 'standard' | 'compact';

interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string;
  /** Keep the label as an accessible name only — for toolbars and inline search. */
  hideLabel?: boolean;
  leadingIcon?: ReactNode;
  size?: TextInputSize;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { label, hideLabel = false, leadingIcon, className, id, size = 'standard', ...props },
  ref
): ReactElement {
  const inputId = id ?? `sg-input-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className={`sg-text-input sg-text-input--${size} ${className ?? ''}`.trim()}>
      {hideLabel ? null : (
        <label htmlFor={inputId} className="sg-text-input__label">
          {label}
        </label>
      )}
      <div className="sg-text-input__field">
        {leadingIcon ? (
          <span className="sg-text-input__icon" aria-hidden="true">
            {leadingIcon}
          </span>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          className={`sg-text-input__control ${leadingIcon ? 'sg-text-input__control--with-icon' : ''}`}
          aria-label={hideLabel ? label : undefined}
          {...props}
        />
      </div>
    </div>
  );
});
