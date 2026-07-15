import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Checkbox } from '@renderer/components/Checkbox';
import { Dropdown } from '@renderer/components/Dropdown';
import { Select } from '@renderer/components/Select';
import { TextField } from '@renderer/components/TextField';

afterEach(cleanup);

describe('shared form controls', () => {
  it('selects a dropdown option with pointer input', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Dropdown
        label="Runtime"
        value="node"
        options={[
          { value: 'node', label: 'Node' },
          { value: 'flutter', label: 'Flutter' },
        ]}
        onChange={onChange}
      />
    );
    await user.click(screen.getByRole('combobox', { name: 'Runtime' }));
    expect(screen.getByRole('listbox', { name: 'Runtime' })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'Flutter' }));
    expect(onChange).toHaveBeenCalledWith('flutter');
  });

  it('supports dropdown keyboard navigation', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Dropdown
        label="Priority"
        value="V"
        options={[
          { value: 'V', label: 'Verbose' },
          { value: 'E', label: 'Error' },
        ]}
        onChange={onChange}
      />
    );
    const trigger = screen.getByRole('combobox', { name: 'Priority' });
    trigger.focus();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('E');
  });

  it('portals the Select popover to document.body so it is never clipped inside a modal', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Select
        label="Target branch"
        value="main"
        options={[
          { value: 'main', label: 'main' },
          { value: 'release', label: 'release' },
        ]}
        onChange={onChange}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Target branch' }));
    const listbox = screen.getByRole('listbox', { name: 'Target branch' });
    // Portalled directly under <body>, not nested inside the trigger's root
    // (which would let a dialog's overflow/scrim clip or hide it).
    expect(listbox.parentElement).toBe(document.body);
    await user.click(screen.getByRole('option', { name: 'release' }));
    expect(onChange).toHaveBeenCalledWith('release');
  });

  it('keeps checkbox and text input semantics', async () => {
    const user = userEvent.setup();
    const onChecked = vi.fn();
    render(
      <>
        <Checkbox
          checked={false}
          onChange={onChecked}
          label="Cold boot"
          description="Ignore the saved snapshot."
        />
        <TextField aria-label="Package" mono value="com.example.app" readOnly />
      </>
    );
    const checkbox = screen.getByRole('checkbox', { name: 'Cold boot' });
    expect(checkbox).toHaveAccessibleDescription('Ignore the saved snapshot.');
    await user.click(screen.getByText('Ignore the saved snapshot.'));
    expect(onChecked).toHaveBeenCalledWith(true);
    expect(screen.getByRole('textbox', { name: 'Package' })).toHaveValue('com.example.app');
  });
});
