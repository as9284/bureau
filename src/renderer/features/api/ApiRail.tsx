import type { ApiSidebarMode } from '@renderer/store/apiStore';
import { API_RAIL_SECTIONS } from './apiSections';

/**
 * The API workspace's section rail. One section is shown at a time, so the collection tree gets the
 * whole sidebar column instead of competing with four other panes for height.
 */
export function ApiRail({
  mode,
  counts,
  onSelect,
}: {
  mode: ApiSidebarMode;
  counts: Record<ApiSidebarMode, number | null>;
  onSelect(mode: ApiSidebarMode): void;
}) {
  return (
    <nav className="api-rail" aria-label="API sections">
      {API_RAIL_SECTIONS.map((section) => {
        const count = counts[section.id];
        const active = mode === section.id;
        return (
          <button
            key={section.id}
            type="button"
            className={`api-rail__button${active ? ' is-active' : ''}`}
            aria-current={active ? 'true' : undefined}
            aria-controls="api-sidebar-panel"
            title={`${section.label} — ${section.hint}`}
            onClick={() => onSelect(section.id)}
          >
            <span className="api-rail__icon" aria-hidden="true">
              {section.icon}
            </span>
            {/* Icon-only by design; the name stays in the accessible name and the tooltip. */}
            <span className="bureau-visually-hidden">{section.label}</span>
            {count != null && count > 0 ? (
              <>
                <span className="api-rail__count mono" aria-hidden="true">
                  {count > 99 ? '99+' : count}
                </span>
                <span className="bureau-visually-hidden">{`${count} items`}</span>
              </>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
