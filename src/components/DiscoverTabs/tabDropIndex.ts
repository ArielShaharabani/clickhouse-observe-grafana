/** Horizontal extent of a tab, in any one coordinate space (the same for every tab and the dragged centre). */
export interface TabSpan {
  left: number;
  right: number;
}

/**
 * Where a dragged tab lands: the number of OTHER tabs whose midpoint lies left of the dragged
 * tab's centre. It is the tab's index in the final order, so it is 0 anywhere left of the first
 * midpoint and `spans.length - 1` anywhere right of the last one, and dropping past either end
 * of the strip needs no special case. `spans` are the tabs in their original, unshifted layout.
 */
export function tabDropIndex(dragIndex: number, draggedCenter: number, spans: TabSpan[]): number {
  if (dragIndex < 0 || dragIndex >= spans.length || !Number.isFinite(draggedCenter)) {
    return Math.max(0, Math.min(spans.length - 1, dragIndex));
  }
  let target = 0;
  spans.forEach((s, i) => {
    if (i !== dragIndex && (s.left + s.right) / 2 < draggedCenter) {
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
