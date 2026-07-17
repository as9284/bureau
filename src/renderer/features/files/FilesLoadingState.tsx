/**
 * Full-pane shimmer while the Files workspace boots — layout-shaped like the
 * real sidebar + document, no centered status card (same idea as AndroidSkeleton).
 */
export function FilesLoadingState() {
  return (
    <section className="files-loading" aria-label="Loading Files workspace" aria-busy="true">
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
    </section>
  );
}
