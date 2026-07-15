import type { ReactElement, ReactNode } from 'react';
import './EmptyState.css';

type Props = {
  title: string;
  description?: string;
  actions?: ReactNode;
  icon?: ReactNode;
};

export function EmptyState({ title, description, actions, icon }: Props): ReactElement {
  return (
    <div className="sg-empty-state">
      {icon ? <div className="sg-empty-state__icon">{icon}</div> : null}
      <p className="sg-empty-state__title">{title}</p>
      {description ? <p className="sg-empty-state__description">{description}</p> : null}
      {actions ? <div className="sg-empty-state__actions">{actions}</div> : null}
    </div>
  );
}
