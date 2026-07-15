import type { ReactElement, ReactNode } from 'react';
import './Banner.css';

type BannerVariant = 'information' | 'warning' | 'error' | 'recovery';

interface BannerProps {
  variant?: BannerVariant;
  icon: ReactNode;
  heading: ReactNode;
  supporting?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}

export function Banner({
  variant = 'information',
  icon,
  heading,
  supporting,
  actions,
  children,
}: BannerProps): ReactElement {
  const toneClass =
    variant === 'information'
      ? 'info'
      : variant === 'warning'
        ? 'warning'
        : variant === 'error'
          ? 'error'
          : 'recovery';
  return (
    <div className={`sg-banner sg-banner--${toneClass}`} role="alert">
      <span className="sg-banner__icon" aria-hidden="true">
        {icon}
      </span>
      <div className="sg-banner__content">
        <h2 className="sg-banner__heading">{heading}</h2>
        {supporting ? <p className="sg-banner__supporting">{supporting}</p> : null}
        {children}
        {actions ? <div className="sg-banner__actions">{actions}</div> : null}
      </div>
    </div>
  );
}
