import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type ReactNode,
} from 'react';
import { IMMERSIVE_NAVIGATION_REVEAL_EVENT } from '../lib/immersiveNavigation';

type ImmersiveNavigationHostProps = {
  sidebarWidth: number;
  edgeRevealDisabled?: boolean;
  children: ReactNode;
};

const HIDE_DELAY_MS = 350;
const REVEAL_DWELL_MS = 150;
const REARM_DISTANCE_PX = 24;

/**
 * Navigation host for immersive mode. The rail and sidebar share one overlay and
 * one edge target, so transitions between the two cannot race independent hover
 * handlers or leave timers.
 */
export function ImmersiveNavigationHost({
  sidebarWidth,
  edgeRevealDisabled = false,
  children,
}: ImmersiveNavigationHostProps) {
  const navigationRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  const revealTimerRef = useRef<number | null>(null);
  const pointerWithinRef = useRef(false);
  const revealArmedRef = useRef(true);
  const revealedRef = useRef(false);
  const [revealed, setRevealed] = useState(false);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const clearRevealTimer = useCallback(() => {
    if (revealTimerRef.current !== null) {
      window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
  }, []);

  const setNavigationRevealed = useCallback((nextRevealed: boolean) => {
    revealedRef.current = nextRevealed;
    if (!nextRevealed) revealArmedRef.current = false;
    setRevealed(nextRevealed);
  }, []);

  const reveal = useCallback(() => {
    clearHideTimer();
    clearRevealTimer();
    setNavigationRevealed(true);
  }, [clearHideTimer, clearRevealTimer, setNavigationRevealed]);

  const scheduleReveal = useCallback(() => {
    clearHideTimer();
    clearRevealTimer();
    if (revealedRef.current || !revealArmedRef.current) return;

    revealTimerRef.current = window.setTimeout(() => {
      if (pointerWithinRef.current && revealArmedRef.current) setNavigationRevealed(true);
      revealTimerRef.current = null;
    }, REVEAL_DWELL_MS);
  }, [clearHideTimer, clearRevealTimer, setNavigationRevealed]);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    if (pointerWithinRef.current || !revealedRef.current) return;

    hideTimerRef.current = window.setTimeout(() => {
      if (!pointerWithinRef.current) setNavigationRevealed(false);
      hideTimerRef.current = null;
    }, HIDE_DELAY_MS);
  }, [clearHideTimer, setNavigationRevealed]);

  useEffect(
    () => () => {
      clearHideTimer();
      clearRevealTimer();
    },
    [clearHideTimer, clearRevealTimer]
  );

  useEffect(() => {
    if (!edgeRevealDisabled) return;

    pointerWithinRef.current = false;
    clearHideTimer();
    clearRevealTimer();
    if (revealedRef.current) setNavigationRevealed(false);
  }, [clearHideTimer, clearRevealTimer, edgeRevealDisabled, setNavigationRevealed]);

  useEffect(() => {
    window.addEventListener(IMMERSIVE_NAVIGATION_REVEAL_EVENT, reveal);
    return () => window.removeEventListener(IMMERSIVE_NAVIGATION_REVEAL_EVENT, reveal);
  }, [reveal]);

  useEffect(() => {
    const workspace = navigationRef.current?.parentElement;
    if (!workspace) return;

    const rearm = (event: PointerEvent) => {
      if (revealedRef.current || revealArmedRef.current) return;
      const distanceIntoWorkspace = event.clientX - workspace.getBoundingClientRect().left;
      if (distanceIntoWorkspace >= REARM_DISTANCE_PX) revealArmedRef.current = true;
    };

    workspace.addEventListener('pointermove', rearm);
    return () => workspace.removeEventListener('pointermove', rearm);
  }, []);

  const onEdgePointerEnter = (): void => {
    if (edgeRevealDisabled) return;
    pointerWithinRef.current = true;
    scheduleReveal();
  };

  const onEdgePointerLeave = (): void => {
    if (edgeRevealDisabled) return;
    pointerWithinRef.current = false;
    clearRevealTimer();
    scheduleHide();
  };

  const onNavigationPointerEnter = (): void => {
    pointerWithinRef.current = true;
    reveal();
  };

  const onNavigationPointerLeave = (): void => {
    pointerWithinRef.current = false;
    scheduleHide();
  };

  const onFocusCapture = (): void => {
    reveal();
  };

  const onBlurCapture = (event: ReactFocusEvent<HTMLDivElement>): void => {
    if (!navigationRef.current?.contains(event.relatedTarget)) scheduleHide();
  };

  const navigationStyle = {
    '--immersive-sidebar-width': `${sidebarWidth}px`,
  } as CSSProperties;

  return (
    <div
      ref={navigationRef}
      className="workspace-immersive-slot"
      onFocusCapture={onFocusCapture}
      onBlurCapture={onBlurCapture}
    >
      <button
        type="button"
        className="immersive-navigation-reveal"
        aria-label="Show navigation"
        disabled={edgeRevealDisabled}
        onClick={reveal}
        onPointerEnter={onEdgePointerEnter}
        onPointerLeave={onEdgePointerLeave}
      />
      <div
        className={['immersive-navigation', revealed ? 'is-revealed' : ''].filter(Boolean).join(' ')}
        style={navigationStyle}
        aria-hidden={!revealed}
        inert={!revealed}
        onPointerEnter={onNavigationPointerEnter}
        onPointerLeave={onNavigationPointerLeave}
      >
        {children}
      </div>
    </div>
  );
}
