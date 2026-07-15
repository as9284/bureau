import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FilesLoadingState } from '@renderer/features/files/FilesLoadingState';

describe('FilesLoadingState', () => {
  it('communicates the active initialization phase without rendering the Files workbench', () => {
    render(<FilesLoadingState phase="restoring" />);

    expect(screen.getByRole('region', { name: 'Preparing Files workspace' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Restoring open files and drafts');
    expect(screen.getByText('Reading the project snapshot')).toHaveClass('is-complete');
    expect(document.querySelector('.files-loading__shimmer')).toHaveAttribute('aria-hidden', 'true');
  });
});
