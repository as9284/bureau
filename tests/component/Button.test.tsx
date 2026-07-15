import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '@renderer/components/Button';

afterEach(cleanup);

describe('Button', () => {
  it('renders with the primary variant class', () => {
    render(<Button variant="primary">Add</Button>);
    const button = screen.getByRole('button', { name: 'Add' });
    expect(button).toHaveClass('button', 'primary');
  });

  it('fires onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Run</Button>);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Run' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
