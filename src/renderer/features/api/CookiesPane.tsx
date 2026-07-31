import type { MouseEvent as ReactMouseEvent } from 'react';
import { Button } from '@renderer/components/Button';
import { Dropdown } from '@renderer/components/Dropdown';
import { copyText } from '@renderer/lib/contextMenu';
import { useAppStore } from '@renderer/store/appStore';
import type { ApiCookie, ApiCookieJarSummary } from '@shared/contracts/apiWorkbench';
import { buildCookieMenuItems } from './apiContextMenu';

type Props = {
  jars: ApiCookieJarSummary[];
  activeJarId: string;
  cookies: ApiCookie[];
  loading: boolean;
  onSelectJar(jarId: string): void;
  onDelete(cookie: ApiCookie): void;
  onClear(): void;
  onRefresh(): void;
  onEdit(cookie: ApiCookie | null): void;
};

/**
 * The cookie inspector.
 *
 * Values are shown, because a cookie inspector that hides them cannot be used to debug a session —
 * but they are sensitive everywhere else, so they are redacted in HAR exports and never written to
 * a run report. Deletion is per-cookie; clearing the whole jar is a confirmed action because it
 * signs the workspace out of everything at once.
 */
export function CookiesPane({
  jars,
  activeJarId,
  cookies,
  loading,
  onSelectJar,
  onDelete,
  onClear,
  onRefresh,
  onEdit,
}: Props) {
  const openContextMenu = useAppStore((s) => s.openContextMenu);

  const openCookieMenu = (event: ReactMouseEvent, cookie: ApiCookie): void => {
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    event.stopPropagation();
    openContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: buildCookieMenuItems(cookie, {
        edit: () => onEdit(cookie),
        copyName: () => copyText(cookie.name),
        copyValue: () => copyText(cookie.value),
        remove: () => onDelete(cookie),
      }),
    });
  };

  return (
    <div className="api-cookies">
      <div className="api-cookies__header">
        <Dropdown
          label="Jar"
          value={activeJarId}
          options={
            jars.length > 0
              ? jars.map((jar) => ({
                  value: jar.jarId,
                  label: `${jar.name} (${jar.cookieCount})`,
                }))
              : [{ value: '', label: 'Default (0)' }]
          }
          onChange={onSelectJar}
        />
        <div className="api-cookies__actions">
          <Button size="compact" variant="quiet" onClick={onRefresh}>
            Refresh
          </Button>
          <Button size="compact" variant="quiet" onClick={() => onEdit(null)}>
            Add cookie
          </Button>
          <Button
            size="compact"
            variant="danger"
            disabled={cookies.length === 0}
            onClick={onClear}
          >
            Clear jar
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="tab-loading">Reading cookies…</div>
      ) : cookies.length === 0 ? (
        <div className="empty-state">
          <p className="sg-empty-state__title">No cookies yet</p>
          <p className="sg-empty-state__description">
            Responses that set cookies in this workspace will appear here.
          </p>
        </div>
      ) : (
        <ul className="api-cookies__list">
          {cookies.map((cookie) => (
            <li
              key={`${cookie.name}:${cookie.domain}:${cookie.path}`}
              className="api-cookies__row"
              onContextMenu={(event) => openCookieMenu(event, cookie)}
            >
              <div className="api-cookies__row-heading">
                <div className="api-cookies__row-main">
                  <span className="api-cookies__name mono">{cookie.name}</span>
                  <span className="api-cookies__value mono">{cookie.value}</span>
                </div>
                <div className="api-cookies__row-actions">
                  <Button size="compact" variant="quiet" onClick={() => onEdit(cookie)}>
                    Edit
                  </Button>
                  <Button size="compact" variant="quiet" onClick={() => onDelete(cookie)}>
                    Delete
                  </Button>
                </div>
              </div>
              <div className="api-cookies__row-meta mono">
                <span>
                  {cookie.hostOnly ? '' : '.'}
                  {cookie.domain}
                  {cookie.path}
                </span>
                <span>SameSite={cookie.sameSite}</span>
                {cookie.secure ? <span>Secure</span> : null}
                {cookie.httpOnly ? <span>HttpOnly</span> : null}
                <span>{cookie.expiresAt ? cookie.expiresAt.slice(0, 19).replace('T', ' ') : 'session'}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
