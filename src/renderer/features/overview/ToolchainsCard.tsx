import { useAppStore } from '../../store/appStore';
import { Button } from '../../components/Button';
import { Dropdown } from '../../components/Dropdown';
import type { RuntimeRow, SwitchableRuntimeKind } from '@shared/contracts/toolchains';

function versionSatisfiesUi(constraint: string, actual: string): boolean {
  const raw = constraint.trim();
  if (!raw || raw === '*') return true;
  const strip = (v: string) =>
    v
      .replace(/^v/, '')
      .replace(/^>=\s*/, '')
      .replace(/^>\s*/, '')
      .replace(/^~\s*/, '')
      .replace(/^\^\s*/, '')
      .replace(/^=\s*/, '');
  const actualParts = strip(actual)
    .split('.')
    .map((n) => Number(n) || 0);
  if (/^>=\s*/.test(raw)) {
    const min = strip(raw)
      .split('.')
      .map((n) => Number(n) || 0);
    for (let i = 0; i < 3; i += 1) {
      const a = actualParts[i] ?? 0;
      const b = min[i] ?? 0;
      if (a !== b) return a > b;
    }
    return true;
  }
  if (/^\^\s*/.test(raw)) {
    const base = strip(raw)
      .split('.')
      .map((n) => Number(n) || 0);
    return (actualParts[0] ?? 0) === (base[0] ?? 0);
  }
  const e = strip(raw);
  const a = strip(actual);
  return a === e || a.startsWith(`${e}.`) || e.startsWith(`${a}.`);
}

function rowTone(row: RuntimeRow): 'ok' | 'warn' | 'missing' {
  if (row.missing) return 'missing';
  if (row.mismatch) return 'warn';
  return 'ok';
}

function statusLabel(row: RuntimeRow): string {
  if (row.missing) return 'Missing';
  if (row.mismatch) return 'Mismatch';
  if (row.activeVersion) return row.activeVersion;
  return 'Unset';
}

/** Prefer switchable / expected / problem rows; fall back to a short detect-only list. */
function rowsForOverview(rows: RuntimeRow[]): RuntimeRow[] {
  const primary = rows.filter(
    (row) => row.switchable || row.expectedVersion || row.mismatch || row.missing
  );
  if (primary.length > 0) return primary;
  return rows.slice(0, 4);
}

export function ToolchainsCard({ projectId }: { projectId: string }) {
  const toolchains = useAppStore((s) => s.toolchainsByProject[projectId]);
  const loadToolchains = useAppStore((s) => s.loadToolchains);
  const setActiveToolchain = useAppStore((s) => s.setActiveToolchain);

  const rows = toolchains ? rowsForOverview(toolchains.rows) : [];
  const issues = toolchains?.rows.filter((row) => row.mismatch || row.missing).length ?? 0;

  return (
    <section className="overview-card overview-card--toolchains">
      <div className="overview-card__head">
        <h2 className="overview-card__title">Toolchains</h2>
        {toolchains ? (
          <span className="overview-count">
            {issues > 0 ? `${issues} need attention` : `${toolchains.rows.length} detected`}
          </span>
        ) : (
          <span className="overview-count">Loading…</span>
        )}
      </div>

      {!toolchains ? (
        <p className="overview-card__empty">Scanning project runtimes…</p>
      ) : rows.length === 0 ? (
        <p className="overview-card__empty">No recognized language runtimes for this project.</p>
      ) : (
        <div className="toolchain-list overview-toolchain-list">
          {rows.map((row) => {
            const tone = rowTone(row);
            return (
              <div key={row.kind} className="toolchain-row">
                <span className={`toolchain-row__dot ${tone}`} aria-hidden />
                <div className="toolchain-row__identity">
                  <span className="toolchain-row__label">{row.label}</span>
                  {row.manager && (
                    <span className="toolchain-row__manager mono">{row.manager}</span>
                  )}
                </div>
                <div className="toolchain-row__meta">
                  {row.expectedVersion && (
                    <span className="mono">Expected {row.expectedVersion}</span>
                  )}
                  <span className={tone === 'ok' ? undefined : 'toolchain-row__status'}>
                    {statusLabel(row)}
                  </span>
                </div>
                {row.switchable ? (
                  <Dropdown
                    className="toolchain-row__select"
                    label={`${row.label} version`}
                    value={row.activeVersion ?? row.installedVersions[0] ?? 'unset'}
                    placeholder="Select version"
                    disabled={row.installedVersions.length === 0}
                    options={
                      row.installedVersions.length === 0
                        ? [{ value: 'unset', label: 'No versions detected' }]
                        : row.installedVersions.map((version) => ({
                            value: version,
                            label:
                              row.expectedVersion &&
                              versionSatisfiesUi(row.expectedVersion, version)
                                ? `${version} · matches`
                                : version,
                          }))
                    }
                    onChange={(version) => {
                      if (version === 'unset') return;
                      void setActiveToolchain(
                        projectId,
                        row.kind as SwitchableRuntimeKind,
                        version
                      );
                    }}
                  />
                ) : (
                  <span className="toolchain-row__version mono">
                    {row.activeVersion ?? 'Not installed'}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="overview-card__foot">
        <Button variant="ghost" onClick={() => void loadToolchains(projectId)}>
          Refresh
        </Button>
      </div>
    </section>
  );
}
