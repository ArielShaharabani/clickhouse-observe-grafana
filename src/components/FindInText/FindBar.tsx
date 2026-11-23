/**
 * Ctrl+F inside one block of text (the document panel's JSON, a cell's expanded value), as the code
 * viewer in Kibana: next / previous, match count, match case, whole word, regular expression.
 *
 * Matches are found in the rendered text and painted with the CSS Custom Highlight API, so the
 * content needs no changes. `[data-find-line]` elements are searched one by one (a match never spans
 * two lines of the tree); content without them is searched as one text. Where the API is missing,
 * the current match is shown as the text selection.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { IconButton, Input, useStyles2 } from '@grafana/ui';
import { findRegExp, FindOptions, matchOffsets, MAX_MATCHES } from './findMatches';

interface HighlightApi {
  registry: { set: (name: string, h: unknown) => void; delete: (name: string) => void };
  create: (ranges: Range[]) => unknown;
}

function highlightApi(): HighlightApi | undefined {
  const w = window as unknown as { CSS?: { highlights?: HighlightApi['registry'] }; Highlight?: new (...r: Range[]) => unknown };
  const { Highlight } = w;
  const registry = w.CSS?.highlights;
  if (!Highlight || !registry) {
    return undefined;
  }
  return {
    registry,
    create: (ranges) => {
      const h = new Highlight();
      ranges.forEach((r) => (h as { add: (r: Range) => void }).add(r));
      return h;
    },
  };
}

const ALL = 'observe-find';
const CURRENT = 'observe-find-current';

/** Ranges of every match in `root`. */
export function findRanges(root: HTMLElement, re: RegExp): Range[] {
  const lines = root.querySelectorAll<HTMLElement>('[data-find-line]');
  const blocks = lines.length > 0 ? Array.from(lines) : [root];
  const out: Range[] = [];
  for (const block of blocks) {
    const nodes: Array<{ node: Text; start: number }> = [];
    let text = '';
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      nodes.push({ node, start: text.length });
      text += node.data;
    }
    let i = 0;
    for (const [from, to] of matchOffsets(text, re, MAX_MATCHES - out.length)) {
      while (nodes[i].start + nodes[i].node.length <= from) {
        i++;
      }
      let j = i;
      while (nodes[j].start + nodes[j].node.length < to) {
        j++;
      }
      const r = document.createRange();
      r.setStart(nodes[i].node, from - nodes[i].start);
      r.setEnd(nodes[j].node, to - nodes[j].start);
      out.push(r);
    }
    if (out.length >= MAX_MATCHES) {
      break;
    }
  }
  return out;
}

/** Scrolls every scrolling ancestor just enough to show the range. */
function reveal(range: Range) {
  if (!range.getBoundingClientRect) {
    return;
  }
  for (let el = range.startContainer.parentElement; el && el !== document.body; el = el.parentElement) {
    if (el.scrollHeight <= el.clientHeight || !/auto|scroll/.test(getComputedStyle(el).overflowY)) {
      continue;
    }
    const r = range.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    if (r.top < box.top || r.bottom > box.bottom) {
      el.scrollTop += r.top - box.top - el.clientHeight / 2;
    }
  }
}

export interface Find {
  open: boolean;
  show: () => void;
  close: () => void;
  /** Bumped when the bar is asked for again while open (focus and select its text). */
  focusTick: number;
  /** Text to start with (the selection inside the content). */
  seed: string;
}

/**
 * Open state of a find bar. Ctrl / Cmd+F opens it while focus is inside the `scope` ancestor of
 * `rootRef` (the panel or dialog it belongs to); anywhere else the browser's own find opens.
 */
export function useFind(rootRef: React.RefObject<HTMLElement | null>, scope: string, onShow?: () => void): Find {
  const [state, setState] = useState({ open: false, focusTick: 0, seed: '' });
  const onShowRef = useRef(onShow);
  useEffect(() => {
    onShowRef.current = onShow;
  });
  const show = useCallback(() => {
    const sel = window.getSelection();
    const inside = sel && sel.anchorNode && rootRef.current?.contains(sel.anchorNode);
    const text = inside ? sel.toString() : '';
    onShowRef.current?.();
    setState((s) => ({ open: true, focusTick: s.focusTick + 1, seed: text.includes('\n') ? '' : text.slice(0, 200) }));
  }, [rootRef]);
  const close = useCallback(() => {
    setState((s) => ({ ...s, open: false }));
    rootRef.current?.closest<HTMLElement>(scope)?.focus({ preventScroll: true });
  }, [rootRef, scope]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'f') {
        return;
      }
      const el = rootRef.current?.closest(scope);
      if (el && e.target instanceof Node && el.contains(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        show();
      }
    };
    // Capture: the dialog and the grid stop their key events on the way up.
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [rootRef, scope, show]);
  return { ...state, show, close };
}

interface Props {
  rootRef: React.RefObject<HTMLElement | null>;
  find: Find;
  /** Changes when the content does. */
  contentKey: unknown;
}

export function FindBar({ rootRef, find, contentKey }: Props) {
  const styles = useStyles2(getStyles);
  const [query, setQuery] = useState(find.seed);
  const [options, setOptions] = useState<FindOptions>({ matchCase: false, wholeWord: false, regex: false });
  const [ranges, setRanges] = useState<Range[]>([]);
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const re = findRegExp(query, options);
  const invalid = re === undefined;

  const { focusTick, seed } = find;
  useEffect(() => {
    if (seed) {
      // Asked for again with a selection: search for that.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery(seed);
    }
    const raf = requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
    return () => cancelAnimationFrame(raf);
  }, [focusTick, seed]);

  // Layout effect: a key pressed right after typing must step through the new matches.
  useLayoutEffect(() => {
    const r = findRegExp(query, options);
    const found = r && rootRef.current ? findRanges(rootRef.current, r) : [];
    // The matches are read from the rendered content.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRanges(found);
    setAt(0);
  }, [query, options, contentKey, rootRef]);

  useEffect(() => {
    const api = highlightApi();
    const current = ranges[at];
    if (current) {
      reveal(current);
    }
    if (!api) {
      if (current) {
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(current);
      }
      return;
    }
    api.registry.set(ALL, api.create(ranges));
    api.registry.set(CURRENT, api.create(current ? [current] : []));
    return () => {
      api.registry.delete(ALL);
      api.registry.delete(CURRENT);
    };
  }, [ranges, at]);

  const step = (d: 1 | -1) => {
    if (ranges.length > 0) {
      setAt((i) => (i + d + ranges.length) % ranges.length);
    }
  };
  const toggle = (key: keyof FindOptions, label: string, text: string) => (
    <button
      type="button"
      className={cx(styles.option, options[key] && styles.optionOn)}
      aria-pressed={options[key]}
      aria-label={label}
      title={label}
      onClick={() => setOptions((o) => ({ ...o, [key]: !o[key] }))}
    >
      {text}
    </button>
  );
  const count = !query
    ? ''
    : invalid
      ? 'Not a valid expression'
      : ranges.length === 0
        ? 'No results'
        : `${at + 1} of ${ranges.length}${ranges.length >= MAX_MATCHES ? '+' : ''}`;

  return (
    <div
      className={styles.bar}
      role="search"
      aria-label="Find in text"
      onKeyDown={(e) => {
        // Escape closes the bar only, not the panel or dialog around it; other keys stay here too.
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          find.close();
        } else if (e.key === 'F3' || (e.key === 'Enter' && e.target === input.current)) {
          e.preventDefault();
          e.stopPropagation();
          step(e.shiftKey ? -1 : 1);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.stopPropagation();
        }
      }}
    >
      <Input
        ref={input}
        value={query}
        placeholder="Find"
        aria-label="Find"
        maxLength={500}
        invalid={invalid}
        onChange={(e) => setQuery(e.currentTarget.value)}
        className={styles.input}
      />
      {toggle('matchCase', 'Match case', 'Aa')}
      {toggle('wholeWord', 'Match whole word', 'ab')}
      {toggle('regex', 'Use regular expression', '.*')}
      <span className={styles.count} role="status">
        {count}
      </span>
      <IconButton name="arrow-up" size="sm" tooltip="Previous match" disabled={ranges.length === 0} onClick={() => step(-1)} />
      <IconButton name="arrow-down" size="sm" tooltip="Next match" disabled={ranges.length === 0} onClick={() => step(1)} />
      <IconButton name="times" size="sm" tooltip="Close find" onClick={find.close} />
    </div>
  );
}

/** Colours of the matches: on an ancestor of the searched content. */
export const getFindHighlightStyle = (theme: GrafanaTheme2) => css`
  & *::highlight(${ALL}),
  &::highlight(${ALL}) {
    background-color: ${theme.isDark ? 'rgba(234, 184, 57, 0.35)' : 'rgba(234, 184, 57, 0.45)'};
  }
  & *::highlight(${CURRENT}),
  &::highlight(${CURRENT}) {
    background-color: ${theme.visualization.getColorByName('orange')};
    color: black;
  }
`;

const getStyles = (theme: GrafanaTheme2) => ({
  bar: css`
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: ${theme.spacing(0.5)};
    padding: ${theme.spacing(0.5)};
    background: ${theme.colors.background.secondary};
    border: 1px solid ${theme.colors.border.medium};
    border-radius: ${theme.shape.radius.default};
  `,
  input: css`
    flex: 1 1 120px;
    width: auto;
    min-width: 100px;
  `,
  option: css`
    padding: 0 ${theme.spacing(0.5)};
    height: 24px;
    min-width: 24px;
    font-family: ${theme.typography.fontFamilyMonospace};
    font-size: ${theme.typography.bodySmall.fontSize};
    color: ${theme.colors.text.secondary};
    background: transparent;
    border: 1px solid transparent;
    border-radius: ${theme.shape.radius.default};
    &:hover {
      background: ${theme.colors.action.hover};
    }
  `,
  optionOn: css`
    color: ${theme.colors.primary.text};
    background: ${theme.colors.primary.transparent};
    border-color: ${theme.colors.primary.border};
  `,
  count: css`
    min-width: 72px;
    font-size: ${theme.typography.bodySmall.fontSize};
    color: ${theme.colors.text.secondary};
    white-space: nowrap;
  `,
});
