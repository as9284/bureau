import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { SpinnerIcon } from './icons';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children?: ReactNode;
  loading?: boolean;
  leadingIcon?: ReactNode;
  size?: 'standard' | 'compact';
};

/** Bureau button with StarGit-compatible loading / leadingIcon / quiet alias. */
export function Button({
  variant = 'secondary',
  className,
  children,
  loading = false,
  leadingIcon,
  size: _size,
  disabled,
  ...rest
}: ButtonProps) {
  const tone = variant === 'quiet' ? 'ghost' : variant;
  return (
    <button
      className={['button', tone, className].filter(Boolean).join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span className="button__icon" aria-hidden="true">
          <SpinnerIcon />
        </span>
      ) : leadingIcon ? (
        <span className="button__icon" aria-hidden="true">
          {leadingIcon}
        </span>
      ) : null}
      {children}
    </button>
  );
}
