import { TreeStructureIcon } from '@phosphor-icons/react/TreeStructure';
import type { FilesLoadingPhase } from '@renderer/store/appStore';

const PHASE_COPY: Record<Exclude<FilesLoadingPhase, 'idle'>, string> = {
  starting: 'Reading the project snapshot',
  watching: 'Preparing file change tracking',
  restoring: 'Restoring open files and drafts',
};

const PHASES: Exclude<FilesLoadingPhase, 'idle'>[] = ['starting', 'watching', 'restoring'];

export function FilesLoadingState({ phase }: { phase: FilesLoadingPhase }) {
  const activePhase = phase === 'idle' ? 'starting' : phase;
  const activeIndex = PHASES.indexOf(activePhase);

  return (
    <section className="files-loading" aria-label="Preparing Files workspace" aria-busy="true">
      <div className="files-loading__shimmer" aria-hidden="true">
        <div className="files-loading__shimmer-toolbar">
          <span className="files-loading__shimmer-block files-loading__shimmer-block--control" />
          <span className="files-loading__shimmer-block files-loading__shimmer-block--tab" />
          <span className="files-loading__shimmer-block files-loading__shimmer-block--tab files-loading__shimmer-block--tab-short" />
        </div>
        <div className="files-loading__shimmer-main">
          <div className="files-loading__shimmer-sidebar">
            <span className="files-loading__shimmer-block files-loading__shimmer-block--section" />
            <span className="files-loading__shimmer-block files-loading__shimmer-block--tree" />
            <span className="files-loading__shimmer-block files-loading__shimmer-block--tree files-loading__shimmer-block--tree-indent" />
            <span className="files-loading__shimmer-block files-loading__shimmer-block--tree" />
            <span className="files-loading__shimmer-block files-loading__shimmer-block--tree files-loading__shimmer-block--tree-indent" />
          </div>
          <div className="files-loading__shimmer-document">
            <span className="files-loading__shimmer-block files-loading__shimmer-block--heading" />
            <span className="files-loading__shimmer-block files-loading__shimmer-block--line" />
            <span className="files-loading__shimmer-block files-loading__shimmer-block--line files-loading__shimmer-block--line-medium" />
            <span className="files-loading__shimmer-block files-loading__shimmer-block--line files-loading__shimmer-block--line-short" />
          </div>
        </div>
      </div>
      <div className="files-loading__content" role="status" aria-live="polite">
        <TreeStructureIcon className="files-loading__icon" size={24} aria-hidden />
        <h2>Preparing Files workspace</h2>
        <p>{PHASE_COPY[activePhase]}</p>
        <ol className="files-loading__steps">
          {PHASES.map((item, index) => (
            <li key={item} className={index <= activeIndex ? 'is-complete' : undefined}>
              {PHASE_COPY[item]}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
