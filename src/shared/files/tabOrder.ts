export type TabDropPlace = 'before' | 'after';

/** Move `sourcePath` so it sits immediately before or after `targetPath`. */
export function moveTabRelative(
  tabs: string[],
  sourcePath: string,
  targetPath: string,
  place: TabDropPlace
): string[] {
  if (sourcePath === targetPath) return tabs;
  const from = tabs.indexOf(sourcePath);
  const to = tabs.indexOf(targetPath);
  if (from < 0 || to < 0) return tabs;

  const next = tabs.slice();
  next.splice(from, 1);
  let insertAt = next.indexOf(targetPath);
  if (insertAt < 0) return tabs;
  if (place === 'after') insertAt += 1;
  next.splice(insertAt, 0, sourcePath);
  return next;
}

export function tabDropPlaceFromPoint(clientX: number, rect: { left: number; width: number }): TabDropPlace {
  return clientX < rect.left + rect.width / 2 ? 'before' : 'after';
}
