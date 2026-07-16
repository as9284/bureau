import type { ReactElement } from 'react';
import { Banner } from '@renderer/components/Banner';
import { Button } from '@renderer/components/Button';
import { WarningIcon } from '@renderer/components/icons';
import './PanelState.css';

/**
 * The one non-fatal error surface for the Git workbench: what failed, in git's own
 * words, plus a Retry that re-fires the load. Every list panel uses this instead of
 * hand-rolling its own — sibling panels diverging on their error language was itself
 * an audit finding, and before this nothing in the feature offered a retry at all.
 *
 * It is a thin arrangement of the `Banner` primitive (which owns `role="alert"` and
 * the danger tone) so it reads as a quieter sibling of RecoveryBanner rather than a
 * second, unrelated error language.
 *
 * An error is never an Empty state: `EmptyState` asserts "there is nothing here",
 * which is the opposite of what a failed load knows.
 */
type Props = {
  /** What failed, in the user's terms — e.g. "Could not load branches". */
  title: string;
  /** The underlying `BureauError.message`. */
  message: string;
  /** Re-fire the failed load. Omitted only where no retry is meaningful. */
  onRetry?: () => void;
  /** Clear the error without retrying. */
  onDismiss?: () => void;
};

export function PanelError({ title, message, onRetry, onDismiss }: Props): ReactElement {
  return (
    // The wrapper owns the spacing from whatever follows, so no caller repeats it.
    <div className="git-panel-error">
      <Banner
        variant="error"
        icon={<WarningIcon />}
        heading={title}
        // Git's own message is machine text, so it is mono — see PanelState.css.
        supporting={<span className="git-panel-error__message">{message}</span>}
        actions={
          onRetry || onDismiss ? (
            <>
              {onRetry ? (
                <Button variant="secondary" onClick={onRetry}>
                  Retry
                </Button>
              ) : null}
              {onDismiss ? (
                <Button variant="ghost" onClick={onDismiss}>
                  Dismiss
                </Button>
              ) : null}
            </>
          ) : null
        }
      />
    </div>
  );
}

