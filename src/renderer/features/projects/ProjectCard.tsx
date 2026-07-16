import { useRef, type DragEvent, type MouseEvent, type PointerEvent } from 'react';
import type { TrackedProject } from '@shared/contracts/projects';
import { IconButton } from '../../components/IconButton';
import { StackBadge } from '../../components/StackBadge';
import { GripIcon, PinIcon, TrashIcon } from '../../components/icons';
import { formatRelativeTime } from '../../lib/format';

// Max tilt in degrees; small enough to read as depth, not novelty.
const TILT_MAX_DEG = 5;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export type ProjectCardProps = {
  project: TrackedProject;
  running: number;
  gitBadge: { className: string; label: string } | null;
  refreshing: boolean;
  onOpen(): void;
  onRemove(): void;
  onTogglePin(): void;
  onContextMenu(event: MouseEvent): void;
  /** Present only when the card sits in the reorderable pinned group. */
  dragHandleProps?: { draggable: true; onDragStart(e: DragEvent): void; onDragEnd(): void };
  dropProps?: { onDragOver(e: DragEvent): void; onDrop(e: DragEvent): void };
  dragging?: boolean;
};

export function ProjectCard({
  project,
  running,
  gitBadge,
  refreshing,
  onOpen,
  onRemove,
  onTogglePin,
  onContextMenu,
  dragHandleProps,
  dropProps,
  dragging = false,
}: ProjectCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  function handlePointerMove(event: PointerEvent) {
    const el = cardRef.current;
    if (!el || dragging || prefersReducedMotion()) return;
    const rect = el.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    el.style.setProperty('--card-ry', `${(px - 0.5) * 2 * TILT_MAX_DEG}deg`);
    el.style.setProperty('--card-rx', `${-(py - 0.5) * 2 * TILT_MAX_DEG}deg`);
    el.style.setProperty('--glare-x', `${px * 100}%`);
    el.style.setProperty('--glare-y', `${py * 100}%`);
  }

  function resetTilt() {
    const el = cardRef.current;
    if (!el) return;
    el.style.setProperty('--card-rx', '0deg');
    el.style.setProperty('--card-ry', '0deg');
  }

  return (
    <div
      ref={cardRef}
      className={[
        'project-card',
        project.missing ? 'missing' : '',
        project.pinned ? 'pinned' : '',
        dragging ? 'dragging' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="button"
      tabIndex={0}
      aria-label={project.name}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetTilt}
      onContextMenu={onContextMenu}
      {...dropProps}
    >
      <span className="project-card__glare" aria-hidden />
      <div className="project-card__top">
        <div className="project-card__title">
          {dragHandleProps ? (
            <span
              className="project-card__grip"
              aria-hidden
              title="Drag to reorder"
              onClick={(e) => e.stopPropagation()}
              {...dragHandleProps}
            >
              <GripIcon size={14} />
            </span>
          ) : null}
          <span className="project-card__name">{project.name}</span>
        </div>
        <div className="project-card__actions">
          <IconButton
            label={project.pinned ? 'Unpin project' : 'Pin project'}
            className={['project-card__pin', project.pinned ? 'active' : ''].join(' ')}
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin();
            }}
          >
            <PinIcon size={14} filled={project.pinned} />
          </IconButton>
          <IconButton
            label="Remove project"
            className="project-card__remove"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <TrashIcon size={14} />
          </IconButton>
        </div>
      </div>
      <div className="project-card__path mono">{project.path}</div>
      <div className="project-card__badges">
        {project.stack.map((s) => (
          <StackBadge key={s} stack={s} />
        ))}
        {project.missing && <span className="stack-badge danger">Missing</span>}
        {gitBadge ? (
          <span className={gitBadge.className}>{gitBadge.label}</span>
        ) : refreshing ? (
          <span className="stack-badge">Refreshing…</span>
        ) : null}
      </div>
      <div className="project-card__foot mono">
        <span>{running > 0 ? `${running} running` : 'idle'}</span>
        <span>{formatRelativeTime(project.lastOpenedAt)}</span>
      </div>
    </div>
  );
}
