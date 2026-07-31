import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextArea } from '@renderer/components/TextArea';

afterEach(cleanup);

describe('TextArea', () => {
  it('renders a labelled textarea with a custom resize handle', () => {
    render(<TextArea label="Notes" defaultValue="hello" />);
    const input = screen.getByRole('textbox', { name: 'Notes' });
    expect(input).toHaveClass('sg-text-area__input');
    expect(screen.getByRole('separator', { name: 'Resize “Notes” height' })).toBeInTheDocument();
  });

  it('merges caller class names onto the textarea', () => {
    render(<TextArea label="Body" className="mono" />);
    expect(screen.getByRole('textbox', { name: 'Body' })).toHaveClass('sg-text-area__input', 'mono');
  });

  it('can disable the custom resize handle', () => {
    render(<TextArea label="Preview" resizable={false} readOnly />);
    expect(screen.queryByRole('separator', { name: 'Resize “Preview” height' })).not.toBeInTheDocument();
  });

  it('resizes with arrow keys on the handle', async () => {
    const user = userEvent.setup();
    render(<TextArea label="Script" rows={4} minHeight={88} maxHeight={240} />);
    const handle = screen.getByRole('separator', { name: 'Resize “Script” height' });
    handle.focus();
    await user.keyboard('{Home}');
    expect(handle).toHaveAttribute('aria-valuenow', '88');
    await user.keyboard('{ArrowDown}');
    expect(handle).toHaveAttribute('aria-valuenow', '100');
    await user.keyboard('{End}');
    expect(handle).toHaveAttribute('aria-valuenow', '240');
  });
});
