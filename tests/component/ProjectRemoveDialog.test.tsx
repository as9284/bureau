import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectRemoveDialog } from '@renderer/components/ProjectRemoveDialog';
import { useAppStore, type FilesProjectState } from '@renderer/store/appStore';

afterEach(() => {
  cleanup();
  useAppStore.setState({ pendingProjectRemoval: null, projects: [], filesByProject: {} });
});

describe('ProjectRemoveDialog', () => {
  it('requires save, discard, or cancel when removing a project with dirty files', () => {
    useAppStore.setState({
      pendingProjectRemoval: 'p1',
      projects: [{ projectId: 'p1', name: 'Fixture' } as never],
      filesByProject: {
        p1: {
          buffers: {
            'README.md': { kind: 'text', dirty: true },
            'src/index.ts': { kind: 'text', dirty: true },
          },
        } as unknown as FilesProjectState,
      },
    });

    render(<ProjectRemoveDialog />);
    expect(screen.getByRole('dialog', { name: 'Unsaved project files' })).toBeInTheDocument();
    expect(screen.getByText(/2 unsaved files/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save All and Remove' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard and Remove' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });
});
