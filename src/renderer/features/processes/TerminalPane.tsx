import { useMemo } from 'react';
import { XtermSurface, type XtermTransport } from '../../components/XtermSurface';

/**
 * Terminal view for a process running in terminal mode. The pty belongs to a stored
 * ProcessDefinition, so it is addressed by processId; free shells live in the Terminal
 * tab instead. Both render through XtermSurface.
 */
export function TerminalPane({
  projectId,
  processId,
  active,
}: {
  projectId: string;
  processId: string;
  active: boolean;
}) {
  const transport = useMemo<XtermTransport>(
    () => ({
      onInput: (data) => {
        void window.bureau.processes.writePty({ projectId, processId, data });
      },
      subscribe: (write) =>
        window.bureau.processes.onPty((event) => {
          // The pty channel is global; every subscriber sees every process's output.
          if (event.projectId !== projectId || event.processId !== processId) return;
          write(event.data);
        }),
      onResize: (cols, rows) => {
        void window.bureau.processes.resizePty({ projectId, processId, cols, rows });
      },
    }),
    [projectId, processId]
  );

  return <XtermSurface transport={transport} active={active} />;
}
