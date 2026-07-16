/** ~256 KiB of scrollback per session. Raw pty bytes, not lines. */
const DEFAULT_MAX_CHARS = 256 * 1024;

/** How far past the cut point we will look for a newline to trim at. */
const NEWLINE_SEARCH_WINDOW = 4096;

export type TerminalOutputBuffer = {
  /** Appends a chunk and returns its sequence number. */
  push(data: string): number;
  snapshot(): { data: string; seq: number; truncated: boolean };
  clear(): void;
};

/**
 * Replay buffer for one shell session, so unmounting the xterm view (leaving the tab,
 * switching project) does not lose what is on screen.
 *
 * Unlike the log-mode LogRingBuffer this stores raw pty output rather than lines: it has to
 * replay verbatim, escape sequences included, or the restored screen would lose its colours
 * and cursor state. Trimming therefore prefers to cut at a newline — slicing at an arbitrary
 * offset can leave a half-finished escape sequence at the head of the buffer, which xterm
 * would render as garbage on replay.
 */
export function createTerminalOutputBuffer(maxChars = DEFAULT_MAX_CHARS): TerminalOutputBuffer {
  let data = '';
  let seq = 0;
  let truncated = false;

  function push(chunk: string): number {
    data += chunk;
    if (data.length > maxChars) {
      const cut = data.length - maxChars;
      const newline = data.indexOf('\n', cut);
      const at = newline !== -1 && newline - cut <= NEWLINE_SEARCH_WINDOW ? newline + 1 : cut;
      data = data.slice(at);
      truncated = true;
    }
    return ++seq;
  }

  function snapshot(): { data: string; seq: number; truncated: boolean } {
    return { data, seq, truncated };
  }

  function clear(): void {
    data = '';
    truncated = false;
  }

  return { push, snapshot, clear };
}
