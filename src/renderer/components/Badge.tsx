import type { ReactElement, ReactNode } from 'react';
import './Badge.css';

type BadgeType = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

interface BadgeProps {
  type?: BadgeType;
  children: ReactNode;
}

export function Badge({ type = 'neutral', children }: BadgeProps): ReactElement {
  return <span className={`sg-badge sg-badge--${type}`}>{children}</span>;
}
