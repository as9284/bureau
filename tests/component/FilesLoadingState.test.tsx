import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FilesLoadingState } from '@renderer/features/files/FilesLoadingState';

describe('FilesLoadingState', () => {
  it('shows a full-pane shimmer without a centered status card', () => {
    render(<FilesLoadingState />);

    const region = screen.getByRole('region', { name: 'Loading Files workspace' });
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(document.querySelector('.files-loading__shimmer')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(/Preparing Files workspace/i)).toBeNull();
  });
});
