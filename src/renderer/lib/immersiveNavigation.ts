export const IMMERSIVE_NAVIGATION_REVEAL_EVENT = 'bureau:immersive-navigation:reveal';

export function requestImmersiveNavigationReveal(): void {
  window.dispatchEvent(new Event(IMMERSIVE_NAVIGATION_REVEAL_EVENT));
}
