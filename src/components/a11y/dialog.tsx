/**
 * SHARED-A11Y-01: shared keyboard and screen-reader plumbing for the plugin's own popovers.
 *
 * Grafana's Modal, Drawer, Dropdown/Menu, Toggletip and Combobox already handle Escape and focus.
 * The custom Portal popovers (positioned next to a field, a pill, a chart bucket…) use this instead:
 * - announced as a dialog with Kibana's hint ("You are in a dialog. Press Escape…") as its description;
 * - Escape closes it, whether focus is inside it or still on the page;
 * - focus moves into it when it opens (unless something inside already took it) and returns to
 *   the opener when it closes, unless the user has already moved focus somewhere else.
 */
import React, { RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';

export const DIALOG_HINT = 'You are in a dialog. Press Escape, or click outside the dialog, to close.';

/** Visually hidden but read by screen readers. */
export const srOnly = css`
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
`;

export function DialogHint({ id }: { id: string }) {
  return (
    <span id={id} className={srOnly}>
      {DIALOG_HINT}
    </span>
  );
}

/** A polite live region: screen readers speak `message` whenever it changes. */
export function LiveRegion({ message, testId }: { message: string; testId?: string }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className={srOnly} data-testid={testId}>
      {message}
    </div>
  );
}

interface PopoverDialogOptions {
  onClose: () => void;
  /** Where focus goes after closing. Default: the element that had focus when the popover opened. */
  returnFocus?: () => HTMLElement | null | undefined;
  /** Move focus into the popover when it opens if nothing inside has it yet (default true). */
  autoFocus?: boolean;
  /** Also close on Escape pressed while focus is outside (default true; false for inline panels). */
  escapeFromPage?: boolean;
}

/**
 * Dialog behaviour for a popover rendered while mounted. Spread `dialogProps` on the popover's
 * root element (the one `ref` points to) and render `hint` inside it.
 */
export function usePopoverDialog(ref: RefObject<HTMLElement>, opts: PopoverDialogOptions) {
  const hintId = useId();
  const latest = useRef(opts);
  useLayoutEffect(() => {
    latest.current = opts;
  });
  // Captured during the first render, before any child effect can move focus into the popover.
  const [opener] = useState(() =>
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)
  );

  useEffect(() => {
    // Portalled content ignores autoFocus, and children may focus their own input in an effect or
    // a frame: only take focus if nothing inside has it by the next frame.
    const raf =
      latest.current.autoFocus === false
        ? 0
        : requestAnimationFrame(() => {
            const el = ref.current;
            if (el && !el.contains(document.activeElement)) {
              el.focus({ preventScroll: true });
            }
          });
    // Escape while focus is still on the page (opened by mouse); keys inside are handled by onKeyDown.
    const onDocKey = (e: KeyboardEvent) => {
      if (
        latest.current.escapeFromPage === false ||
        e.key !== 'Escape' ||
        e.defaultPrevented ||
        ref.current?.contains(e.target as Node)
      ) {
        return;
      }
      latest.current.onClose();
    };
    document.addEventListener('keydown', onDocKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onDocKey);
      // Focus was inside the removed popover (or on a backdrop): give it back. If the user clicked
      // a focusable element elsewhere, leave it there.
      const active = document.activeElement;
      if (!active || active === document.body) {
        const target = latest.current.returnFocus?.() ?? opener;
        if (target && target.isConnected) {
          target.focus({ preventScroll: true });
        }
      }
    };
    // Mount / unmount only: the latest options are read through `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    // A control inside (an open combobox list) may have used Escape already.
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      e.stopPropagation();
      latest.current.onClose();
    }
  };

  return {
    dialogProps: { role: 'dialog' as const, tabIndex: -1, 'aria-describedby': hintId, onKeyDown },
    hint: <DialogHint id={hintId} />,
  };
}

/**
 * Arrow-key movement between the `[role="menuitem"]` children of a menu: Up / Down wrap, Home /
 * End jump. Returns true when it handled the key.
 */
export function moveMenuFocus(menu: HTMLElement, key: string): boolean {
  const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'));
  if (items.length === 0) {
    return false;
  }
  const i = items.indexOf(document.activeElement as HTMLElement);
  let next: number;
  switch (key) {
    case 'ArrowDown':
      next = i < 0 ? 0 : (i + 1) % items.length;
      break;
    case 'ArrowUp':
      next = i < 0 ? items.length - 1 : (i - 1 + items.length) % items.length;
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = items.length - 1;
      break;
    default:
      return false;
  }
  items[next].focus();
  return true;
}
