import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAppStore } from '@renderer/store/appStore';
import { UpdateNotifier } from '@renderer/components/UpdateNotifier';

afterEach(() => {
  cleanup();
  useAppStore.setState({ updateState: null });
  Reflect.deleteProperty(window, 'bureau');
});

describe('UpdateNotifier', () => {
  it('renders nothing until an update is downloading or ready', () => {
    useAppStore.setState({ updateState: { kind: 'idle', currentVersion: '1.0.0' } });
    const { container } = render(<UpdateNotifier />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows live download progress without a dismiss control', () => {
    useAppStore.setState({ updateState: { kind: 'downloading', currentVersion: '1.0.0', percent: 42 } });
    render(<UpdateNotifier />);
    expect(screen.getByText('Downloading update')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByText('42%')).toBeInTheDocument();
    // Non-dismissible: no close/dismiss button.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers a restart once the update is downloaded', async () => {
    const installUpdate = vi.fn().mockResolvedValue(true);
    Object.defineProperty(window, 'bureau', {
      configurable: true,
      value: { app: { installUpdate } },
    });
    useAppStore.setState({
      updateState: { kind: 'downloaded', currentVersion: '1.0.0', availableVersion: '1.0.1' },
    });
    render(<UpdateNotifier />);
    expect(screen.getByText('Update ready to install')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Restart' }));
    expect(installUpdate).toHaveBeenCalledOnce();
  });
});
