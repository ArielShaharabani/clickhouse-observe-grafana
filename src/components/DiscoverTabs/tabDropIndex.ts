/** Horizontal extent of a tab, in any one coordinate space (the same for every tab and the dragged centre). */
export interface TabSpan {
  left: number;
  right: number;
}

/**
 * Where a tab dragged `dx` px lands: a neighbour gives way as soon as the dragged tab's leading
 * edge passes its midpoint (about half a tab of travel, as in browsers). Dropping past either end
 * needs no special case. `spans` are the tabs in their original, unshifted layout.
 */
export function tabDropIndex(dragIndex: number, dx: number, spans: TabSpan[]): number {
  if (dragIndex < 0 || dragIndex >= spans.length || !Number.isFinite(dx)) {
    return Math.max(0, Math.min(spans.length - 1, dragIndex));
  }
  const own = spans[dragIndex];
  let target = 0;
  spans.forEach((s, i) => {
    const edge = i < dragIndex ? own.left + dx : own.right + dx;
    if (i !== dragIndex && (s.left + s.right) / 2 < edge) {
      target++;
    }
  });
  return target;
}

/** How far a tab at `index` slides sideways while `dragIndex` is hovering over `target` (0 = stays). */
export function tabShift(index: number, dragIndex: number, target: number, slot: number): number {
  if (index === dragIndex) {
    return 0;
  }
  if (dragIndex < target && index > dragIndex && index <= target) {
    return -slot;
  }
  if (dragIndex > target && index >= target && index < dragIndex) {
    return slot;
  }
  return 0;
}
