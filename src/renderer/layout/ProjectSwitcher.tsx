import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronDownIcon, GearIcon, PlusIcon, SearchIcon, StackIcon } from '../components/icons';
import { TextField } from '../components/TextField';
import { useAppStore } from '../store/appStore';
import { groupProjects } from '../lib/projectOrder';
import type { TrackedProject } from '@shared/contracts/projects';

function monogram(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

type MenuCoords = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

export function ProjectSwitcher() {
  const projects = useAppStore((s) => s.projects);
  const projectQuery = useAppStore((s) => s.projectQuery);
  const setProjectQuery = useAppStore((s) => s.setProjectQuery);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const view = useAppStore((s) => s.view);
  const processesByProject = useAppStore((s) => s.processesByProject);
  const loadProcesses = useAppStore((s) => s.loadProcesses);
  const selectProject = useAppStore((s) => s.selectProject);
  const setSection = useAppStore((s) => s.setSection);
  const openAddDialog = useAppStore((s) => s.openAddDialog);

  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<MenuCoords | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selected = projects.find((p) => p.projectId === selectedProjectId) ?? null;
  const onHub = view === 'hub' || !selected;
  const triggerLabel = onHub ? 'Projects' : selected.name;

  const warmedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const project of projects) {
      if (warmedRef.current.has(project.projectId)) continue;
      if (processesByProject[project.projectId]) continue;
      warmedRef.current.add(project.projectId);
      void loadProcesses(project.projectId);
    }
  }, [projects, processesByProject, loadProcesses]);

  const grouped = useMemo(() => groupProjects(projects, projectQuery), [projects, projectQuery]);
  const flatProjects = useMemo(
    () => [...grouped.pinned, ...grouped.recent],
    [grouped.pinned, grouped.recent]
  );

  const isRunning = (projectId: string): boolean =>
    (processesByProject[projectId]?.runtimes ?? []).some(
      (r) => r.status === 'running' || r.status === 'starting'
    );

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    const place = (): void => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.max(280, Math.min(360, rect.width + 120));
      const gap = 6;
      const maxHeight = Math.min(420, Math.max(160, window.innerHeight - rect.bottom - gap - 12));
      let left = rect.left;
      if (left + width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - width - 8);
      }
      setCoords({ top: rect.bottom + gap, left, width, maxHeight });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [projectQuery, open]);

  const closeAnd = (fn: () => void): void => {
    setOpen(false);
    setProjectQuery('');
    fn();
  };

  const footerActions = [
    { id: 'hub', label: 'Open hub', run: () => closeAnd(() => setSection('projects')) },
    { id: 'add', label: 'Add project…', run: () => closeAnd(() => void openAddDialog()) },
    { id: 'settings', label: 'Settings', run: () => closeAnd(() => setSection('settings')) },
  ] as const;

  const selectableCount = flatProjects.length + footerActions.length;

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen(true);
    }
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % Math.max(1, selectableCount));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + selectableCount) % Math.max(1, selectableCount));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (activeIndex < flatProjects.length) {
        const project = flatProjects[activeIndex];
        if (project) closeAnd(() => void selectProject(project.projectId));
      } else {
        const action = footerActions[activeIndex - flatProjects.length];
        action?.run();
      }
    }
  };

  const renderProjectRow = (project: TrackedProject, index: number) => {
    const active = selectedProjectId === project.projectId && view === 'project';
    const running = isRunning(project.projectId);
    const focused = open && activeIndex === index;
    return (
      <button
        key={project.projectId}
        type="button"
        role="option"
        id={`${listId}-opt-${index}`}
        aria-selected={active}
        className={[
          'project-switcher__item',
          active ? 'active' : '',
          focused ? 'is-active' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => closeAnd(() => void selectProject(project.projectId))}
      >
        <span
          className={['project-switcher__avatar', running ? 'is-running' : ''].filter(Boolean).join(' ')}
          aria-hidden
        >
          {monogram(project.name)}
        </span>
        <span className="project-switcher__label">{project.name}</span>
        {project.missing ? (
          <span
            className="state-dot warning"
            role="img"
            aria-label="Project unavailable"
            title="Unavailable"
          />
        ) : running ? (
          <span className="state-dot success" role="img" aria-label="Running" title="Running" />
        ) : null}
      </button>
    );
  };

  const menu =
    open && coords
      ? createPortal(
          <div
            ref={menuRef}
            className="project-switcher__menu"
            role="listbox"
            id={listId}
            aria-label="Projects"
            style={{
              top: coords.top,
              left: coords.left,
              width: coords.width,
              maxHeight: coords.maxHeight,
            }}
            onKeyDown={onMenuKeyDown}
          >
            {projects.length > 0 ? (
              <div className="project-switcher__search">
                <SearchIcon size={13} />
                <TextField
                  ref={searchRef}
                  type="search"
                  placeholder="Filter projects…"
                  aria-label="Filter projects"
                  value={projectQuery}
                  onChange={(e) => setProjectQuery(e.target.value)}
                />
              </div>
            ) : null}

            <div className="project-switcher__body">
              {projects.length === 0 ? (
                <p className="project-switcher__empty">No projects yet.</p>
              ) : flatProjects.length === 0 ? (
                <p className="project-switcher__empty">No matches.</p>
              ) : (
                <>
                  {grouped.pinned.length > 0 ? (
                    <div className="project-switcher__group" role="group" aria-label="Pinned">
                      <div className="project-switcher__group-label">Pinned</div>
                      {grouped.pinned.map((p, i) => renderProjectRow(p, i))}
                    </div>
                  ) : null}
                  {grouped.recent.length > 0 ? (
                    <div className="project-switcher__group" role="group" aria-label="Recent">
                      <div className="project-switcher__group-label">Recent</div>
                      {grouped.recent.map((p, i) =>
                        renderProjectRow(p, grouped.pinned.length + i)
                      )}
                    </div>
                  ) : null}
                </>
              )}
            </div>

            <div className="project-switcher__footer">
              {footerActions.map((action, i) => {
                const index = flatProjects.length + i;
                const focused = open && activeIndex === index;
                return (
                  <button
                    key={action.id}
                    type="button"
                    className={['project-switcher__footer-item', focused ? 'is-active' : '']
                      .filter(Boolean)
                      .join(' ')}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={action.run}
                  >
                    {action.id === 'hub' ? <StackIcon size={14} /> : null}
                    {action.id === 'add' ? <PlusIcon size={14} /> : null}
                    {action.id === 'settings' ? <GearIcon size={14} /> : null}
                    <span>{action.label}</span>
                  </button>
                );
              })}
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div className="project-switcher">
      <button
        ref={triggerRef}
        type="button"
        className={['project-switcher__trigger', open ? 'open' : ''].filter(Boolean).join(' ')}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={onHub ? 'Projects' : `Current project: ${selected?.name ?? 'Projects'}`}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
      >
        {onHub ? (
          <StackIcon size={14} />
        ) : (
          <span
            className={[
              'project-switcher__avatar',
              'project-switcher__avatar--sm',
              selected && isRunning(selected.projectId) ? 'is-running' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-hidden
          >
            {monogram(selected?.name ?? 'P')}
          </span>
        )}
        <span className="project-switcher__trigger-label">{triggerLabel}</span>
        <ChevronDownIcon size={12} />
      </button>
      {menu}
    </div>
  );
}
