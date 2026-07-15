import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkFrontmatter from 'remark-frontmatter';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import type { Components } from 'react-markdown';
import { Button } from '@renderer/components/Button';
import { useAppStore } from '@renderer/store/appStore';
import { sanitizedSvgPreview } from './markdown';

function resolveProjectPath(documentPath: string, target: string): string | null {
  const clean = target.split(/[?#]/, 1)[0];
  if (!clean) return documentPath;
  let decoded: string;
  try { decoded = decodeURIComponent(clean); } catch { return null; }
  const source = decoded.startsWith('/') ? [] : documentPath.split('/').slice(0, -1);
  for (const part of decoded.replace(/^\/+/, '').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!source.length) return null; source.pop(); }
    else source.push(part);
  }
  return source.join('/');
}

function mermaidThemeVariables(): Record<string, string> {
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  return {
    darkMode: document.documentElement.dataset.theme !== 'light' ? 'true' : 'false',
    background: token('--color-surface-canvas', '#181818'),
    primaryColor: token('--color-surface-raised', '#222222'),
    primaryTextColor: token('--color-text-primary', '#ededed'),
    primaryBorderColor: token('--color-border-default', '#363636'),
    secondaryColor: token('--color-surface-sunken', '#141414'),
    tertiaryColor: token('--color-surface-hover', '#252525'),
    lineColor: token('--color-border-strong', '#454545'),
    textColor: token('--color-text-primary', '#ededed'),
    mainBkg: token('--color-surface-raised', '#222222'),
    nodeBorder: token('--color-border-default', '#363636'),
    clusterBkg: token('--color-surface-sunken', '#141414'),
    titleColor: token('--color-text-primary', '#ededed'),
    edgeLabelBackground: token('--color-surface-overlay', '#282828'),
    fontFamily: token('--font-family-ui', 'sans-serif'),
  };
}

function MermaidBlock({ source }: { source: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [themeEpoch, setThemeEpoch] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setThemeEpoch((value) => value + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let active = true;
    setSvg(null);
    setError(false);
    void import('mermaid').then(async ({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        fontFamily: 'var(--font-family-ui)',
        themeVariables: mermaidThemeVariables(),
      });
      try {
        const result = await mermaid.render(`bureau-mermaid-${crypto.randomUUID()}`, source);
        if (active) setSvg(sanitizedSvgPreview(result.svg));
      } catch { if (active) setError(true); }
    });
    return () => { active = false; };
  }, [source, themeEpoch]);
  if (error) return <div className="files-reader__diagram-error" role="alert">Mermaid could not render this diagram.</div>;
  if (!svg) return <div className="files-reader__diagram-loading" role="status" aria-live="polite">Rendering diagram</div>;
  return <div className="files-reader__diagram" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function MarkdownImage({ projectId, documentPath, src, alt, remoteImages }: { projectId: string; documentPath: string; src?: string; alt?: string; remoteImages: 'ask' | 'block' }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const remote = Boolean(src && /^https?:\/\//i.test(src));
  useEffect(() => {
    if (!src || remote) return;
    const relativePath = resolveProjectPath(documentPath, src);
    if (!relativePath) { setError(true); return; }
    let active = true;
    let objectUrl: string | null = null;
    void window.bureau.files.resolveMarkdownAsset({ projectId, relativePath }).then((result) => {
      if (!active) return;
      if (!result.ok) { setError(true); return; }
      objectUrl = URL.createObjectURL(new Blob([result.document.bytes.slice()], { type: result.document.mimeType }));
      setUrl(objectUrl);
    });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [documentPath, projectId, remote, src]);

  const loadRemote = async () => {
    if (!src) return;
    const result = await window.bureau.files.fetchRemoteImage({ url: src });
    if (!result.ok) { setError(true); return; }
    setUrl(URL.createObjectURL(new Blob([result.bytes.slice()], { type: result.mimeType })));
  };
  useEffect(() => () => {
    if (remote && url?.startsWith('blob:')) URL.revokeObjectURL(url);
  }, [remote, url]);
  if (error) return <span className="files-reader__image-error" role="img" aria-label={alt ?? 'Image unavailable'}>Image unavailable</span>;
  if (url) return <img src={url} alt={alt ?? ''} loading="lazy" onClick={(event) => event.currentTarget.classList.toggle('is-zoomed')} />;
  if (remote && remoteImages === 'block') return <span className="files-reader__image-error" role="img" aria-label={alt ?? 'Remote image blocked'}>Remote image blocked</span>;
  if (remote) return <Button size="compact" variant="secondary" onClick={() => void loadRemote()}>Load remote image</Button>;
  return <span className="files-reader__image-loading" role="status" aria-live="polite">Loading image</span>;
}

type MarkdownReaderProps = {
  projectId: string;
  relativePath: string;
  source: string;
  allowRawHtml?: boolean;
  remoteImages?: 'ask' | 'block';
  onRenderedHtml?(html: string): void;
  onProgress?(progress: number): void;
};

export function MarkdownReader({ projectId, relativePath, source, allowRawHtml = false, remoteImages = 'ask', onRenderedHtml, onProgress }: MarkdownReaderProps) {
  const rootRef = useRef<HTMLElement>(null);
  const openProjectFile = useAppStore((state) => state.openProjectFile);
  const sanitizeSchema = {
    ...defaultSchema,
    attributes: { ...defaultSchema.attributes, div: [...(defaultSchema.attributes?.div ?? []), ['className', /^files-|^mermaid/]], span: [...(defaultSchema.attributes?.span ?? []), ['className', /^katex/]], code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-/, 'math-inline', 'math-display']] },
    clobberPrefix: 'bureau-doc-',
  };
  const rehypePlugins = allowRawHtml
    ? [rehypeRaw, [rehypeSanitize, sanitizeSchema], [rehypeKatex, { trust: false, strict: 'ignore' }], rehypeSlug]
    : [[rehypeSanitize, sanitizeSchema], [rehypeKatex, { trust: false, strict: 'ignore' }], rehypeSlug];

  // Only re-serialize the rendered document when its inputs change — not on
  // every render. Without deps this fired after every render (including the
  // setRenderedHtml it triggers), serializing the whole subtree's outerHTML in
  // a self-perpetuating loop.
  useEffect(() => {
    if (rootRef.current) onRenderedHtml?.(rootRef.current.outerHTML);
  }, [source, allowRawHtml, remoteImages, onRenderedHtml]);
  useEffect(() => {
    const scroller = rootRef.current?.parentElement;
    if (!scroller || !onProgress) return;
    const update = () => {
      const maximum = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
      onProgress(Math.round((scroller.scrollTop / maximum) * 100));
    };
    update();
    scroller.addEventListener('scroll', update, { passive: true });
    return () => scroller.removeEventListener('scroll', update);
  }, [onProgress, source]);

  const components = useMemo<Components>(() => ({
    code({ className, children, ...props }) {
      if (className === 'language-mermaid') return <MermaidBlock source={String(children).replace(/\n$/, '')} />;
      return <code className={className} {...props}>{children}</code>;
    },
    img({ src, alt }) { return <MarkdownImage projectId={projectId} documentPath={relativePath} src={typeof src === 'string' ? src : undefined} alt={alt} remoteImages={remoteImages} />; },
    a({ href, children, ...props }) {
      const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (!href) return;
        event.preventDefault();
        if (/^https?:\/\//i.test(href)) { void window.bureau.github.openUrl({ url: href }); return; }
        if (href.startsWith('#')) { rootRef.current?.querySelector<HTMLElement>(href)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
        const resolved = resolveProjectPath(relativePath, href);
        if (resolved) void openProjectFile(projectId, resolved);
      };
      return <a href={href} {...props} onClick={onClick}>{children}</a>;
    },
  }), [openProjectFile, projectId, relativePath, remoteImages]);

  return (
    <article ref={rootRef} className="files-reader" data-document-path={relativePath}>
      <nav className="files-reader__breadcrumbs" aria-label="Document path">
        {relativePath.split('/').map((part, index, parts) => <span key={`${part}:${index}`}>{part}{index < parts.length - 1 ? <span aria-hidden>/</span> : null}</span>)}
      </nav>
      <ReactMarkdown remarkPlugins={[remarkFrontmatter, remarkGfm, remarkMath]} rehypePlugins={rehypePlugins as never} components={components} skipHtml={!allowRawHtml}>
        {source}
      </ReactMarkdown>
    </article>
  );
}
