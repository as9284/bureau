export type MenuCoords = { top: number; left: number };

const VIEWPORT_MARGIN = 8;

export function clampMenuToViewport(left: number, top: number, panel: HTMLElement): MenuCoords {
  const { width, height } = panel.getBoundingClientRect();

  let nextLeft = left;
  let nextTop = top;

  if (nextLeft + width > window.innerWidth - VIEWPORT_MARGIN) {
    nextLeft = window.innerWidth - width - VIEWPORT_MARGIN;
  }
  if (nextTop + height > window.innerHeight - VIEWPORT_MARGIN) {
    nextTop = window.innerHeight - height - VIEWPORT_MARGIN;
  }
  if (nextLeft < VIEWPORT_MARGIN) {
    nextLeft = VIEWPORT_MARGIN;
  }
  if (nextTop < VIEWPORT_MARGIN) {
    nextTop = VIEWPORT_MARGIN;
  }

  return { top: nextTop, left: nextLeft };
}

export function positionMenuAtTrigger(
  trigger: HTMLElement,
  panel: HTMLElement,
  align: 'start' | 'end'
): MenuCoords {
  const gap = 4;
  const triggerRect = trigger.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();

  const left = align === 'end' ? triggerRect.right - panelRect.width : triggerRect.left;
  let top = triggerRect.bottom + gap;

  if (top + panelRect.height > window.innerHeight - VIEWPORT_MARGIN) {
    const above = triggerRect.top - panelRect.height - gap;
    if (above >= VIEWPORT_MARGIN) {
      top = above;
    }
  }

  return clampMenuToViewport(left, top, panel);
}

export function positionMenuAtPoint(x: number, y: number, panel: HTMLElement): MenuCoords {
  return clampMenuToViewport(x, y, panel);
}
