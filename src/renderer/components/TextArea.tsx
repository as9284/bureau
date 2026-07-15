import type { ReactElement, TextareaHTMLAttributes } from 'react';
import './TextArea.css';

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  helper?: React.ReactNode;
  error?: React.ReactNode;
}

export function TextArea({ label, helper, error, id, ...props }: TextAreaProps): ReactElement {
  const inputId = id ?? `sg-textarea-${label.replace(/\s+/g, '-').toLowerCase()}`;
  const errorId = error ? `${inputId}-error` : undefined;
  const helperId = helper ? `${inputId}-helper` : undefined;
  return (
    <div className="sg-text-area">
      <label htmlFor={inputId} className="sg-text-area__label">
        {label}
      </label>
      <textarea
        id={inputId}
        className="sg-text-area__input"
        aria-invalid={Boolean(error)}
        aria-describedby={[errorId, helperId].filter(Boolean).join(' ') || undefined}
        {...props}
      />
      {error ? (
        <p id={errorId} className="sg-text-area__error">
          {error}
        </p>
      ) : null}
      {helper ? (
        <p id={helperId} className="sg-text-area__helper">
          {helper}
        </p>
      ) : null}
    </div>
  );
}
