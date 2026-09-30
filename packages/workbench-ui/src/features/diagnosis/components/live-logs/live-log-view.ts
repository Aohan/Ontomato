interface ScrollViewport {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

export function isLogViewAtBottom(viewport: ScrollViewport | null): boolean {
  return (
    viewport === null || viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 2
  );
}

export function appendRecentLogs<T>(
  current: T[],
  batch: T[],
  maxLines: number,
  trimTo: number
): T[] {
  const next = current.concat(batch);
  return next.length > maxLines ? next.slice(-trimTo) : next;
}
