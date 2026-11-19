/**
 * SHARED-A11Y-01: keyboard mode for Visualize's drag and drop (field → workspace / dimension group),
 * with spoken instructions, as in Kibana Lens. A field's drag handle lifts it with Space or Enter,
 * the arrow keys move between the drop targets that accept it, Space or Enter drops it there and
 * Escape cancels. Every step is announced through a polite live region (`message`).
 */
import React, { useState } from 'react';

export interface DropTarget {
  id: string;
  label: string;
  drop: () => void;
}

export const DND_INSTRUCTIONS =
  'Press Space or Enter to start dragging. While dragging, use the arrow keys to choose a drop target, ' +
  'Space or Enter to drop, and Escape to cancel.';

export function liftMessage(label: string, target: DropTarget | undefined, count: number): string {
  if (!target) {
    return `${label} cannot be dropped anywhere right now.`;
  }
  return (
    `Lifted ${label}. ${count} drop ${count === 1 ? 'target' : 'targets'}. ` +
    `Over ${target.label}. Use the arrow keys to choose a target, Space or Enter to drop, Escape to cancel.`
  );
}

export const overMessage = (label: string, target: DropTarget) =>
  `${label} over ${target.label}. Press Space or Enter to drop.`;
export const dropMessage = (label: string, target: DropTarget) => `Dropped ${label} on ${target.label}.`;
export const cancelMessage = (label: string) => `Cancelled dragging ${label}.`;

/** The next target index for an arrow key (wrapping), or null for any other key. */
export function stepTarget(index: number, count: number, key: string): number | null {
  if (count === 0) {
    return null;
  }
  if (key === 'ArrowDown' || key === 'ArrowRight') {
    return (index + 1) % count;
  }
  if (key === 'ArrowUp' || key === 'ArrowLeft') {
    return (index - 1 + count) % count;
  }
  return null;
}

/**
 * Keyboard drag state for items of type T. `targetsFor` is called on every key so the targets
 * always match the current chart.
 */
export function useKeyboardDrag<T>(
  targetsFor: (item: T) => DropTarget[],
  labelOf: (item: T) => string,
  keyOf: (item: T) => string
) {
  const [drag, setDrag] = useState<{ item: T; index: number } | null>(null);
  const [message, setMessage] = useState('');

  const onKeyDown = (item: T) => (e: React.KeyboardEvent) => {
    const label = labelOf(item);
    const targets = targetsFor(item);
    const lifted = drag !== null && keyOf(drag.item) === keyOf(item);
    if (!lifted) {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        setDrag(targets.length ? { item, index: 0 } : null);
        setMessage(liftMessage(label, targets[0], targets.length));
      }
      return;
    }
    const index = Math.min(drag.index, targets.length - 1);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setDrag(null);
      setMessage(cancelMessage(label));
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      setDrag(null);
      const target = targets[index];
      if (target) {
        target.drop();
        setMessage(dropMessage(label, target));
      }
      return;
    }
    const next = stepTarget(index, targets.length, e.key);
    if (next !== null) {
      e.preventDefault();
      setDrag({ item, index: next });
      setMessage(overMessage(label, targets[next]));
    }
  };

  const onBlur = (item: T) => () => {
    if (drag && keyOf(drag.item) === keyOf(item)) {
      setDrag(null);
      setMessage(cancelMessage(labelOf(item)));
    }
  };

  const activeTargetId = drag ? targetsFor(drag.item)[drag.index]?.id : undefined;
  const isLifted = (item: T) => drag !== null && keyOf(drag.item) === keyOf(item);

  return { onKeyDown, onBlur, activeTargetId, isLifted, message };
}
