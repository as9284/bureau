import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownReader } from '@renderer/features/files/MarkdownReader';
import { sanitizedSvgPreview } from '@renderer/features/files/markdown';
import type { BureauApiV1 } from '@shared/contracts/api';

describe('MarkdownReader', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'bureau', {
      configurable: true,
      value: {
        files: {
          resolveMarkdownAsset: vi.fn().mockResolvedValue({ ok: false, error: { code: 'FILE_NOT_FOUND' } }),
          fetchRemoteImage: vi.fn(),
        },
        github: { openUrl: vi.fn() },
      } as unknown as BureauApiV1,
    });
  });

  it('renders GFM and maths while leaving raw HTML disabled by default', () => {
    const { container } = render(
      <MarkdownReader
        projectId="11111111-1111-4111-8111-111111111111"
        relativePath="README.md"
        source={'# Guide\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n$E = mc^2$\n\n<script>alert(1)</script>'}
      />
    );
    expect(screen.getByRole('heading', { name: 'Guide' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(container.querySelector('.katex')).toBeInTheDocument();
    expect(container.querySelector('script')).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent('alert(1)');
  });

  it('sanitises raw HTML and blocks remote images when privacy settings require it', () => {
    const { container } = render(
      <MarkdownReader
        projectId="11111111-1111-4111-8111-111111111111"
        relativePath="docs/index.md"
        allowRawHtml
        remoteImages="block"
        source={'<img src="x" onerror="alert(1)">\n\n![remote](https://example.com/image.png)'}
      />
    );
    expect(container.querySelector('[onerror]')).not.toBeInTheDocument();
    expect(screen.getByLabelText('remote')).toHaveTextContent('Remote image blocked');
    expect(window.bureau.files.fetchRemoteImage).not.toHaveBeenCalled();
  });

  it('strips active content from SVG previews', () => {
    const safe = sanitizedSvgPreview(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><foreignObject>bad</foreignObject><animate attributeName="href" values="javascript:alert(3)" /><circle cx="2" cy="2" r="2" /></svg>'
    );
    expect(safe.toLowerCase()).not.toContain('script');
    expect(safe.toLowerCase()).not.toContain('foreignobject');
    expect(safe.toLowerCase()).not.toContain('animate');
    expect(safe.toLowerCase()).not.toContain('onload');
    expect(safe.toLowerCase()).not.toContain('javascript:');
    expect(safe).toContain('circle');
  });
});
