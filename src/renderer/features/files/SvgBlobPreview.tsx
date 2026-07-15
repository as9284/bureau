import { useEffect, useState } from 'react';

/** Renders local SVG via a blob URL in an <img>, which never executes scripts or SMIL. */
export function SvgBlobPreview({ markup, title = 'SVG preview' }: { markup: string; title?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const objectUrl = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [markup]);
  if (!url) return <div className="files-svg-preview" role="status" aria-live="polite">Loading SVG</div>;
  return (
    <div className="files-svg-preview">
      <img src={url} alt={title} />
    </div>
  );
}
