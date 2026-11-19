import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { splitHighlights } from '../sql/kql/highlight';
import { copyToClipboard, valueActions } from '../actions/registry';
import { ActionIconButton } from '../actions/ActionIconButton';
import { CellExpandPopover } from './CellExpandPopover';
import { ColumnHeaderMenu, ColumnMenuItem } from './ColumnHeaderMenu';
import { MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from '../data/columns';
import { DEFAULT_GRID_DISPLAY, GridDisplay } from './GridDisplayOptions';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2, DateTime, dateTimeFormat, toUtc } from '@grafana/data';
import { Icon, IconButton, LoadingPlaceholder, EmptyState, useStyles2 } from '@grafana/ui';
import { FilterPill, LogRow, SelectedColumn } from '../types';
import { FIELD_DRAG_MIME, SEVERITY_COLORS } from '../constants';

interface LogsTableProps {
  rows: LogRow[];
  loading: boolean;
  columns: SelectedColumn[];
  sort?: { col: string; dir: 'asc' | 'desc' };
  onRowClick: (row: LogRow) => void;
  /** Header menu sort: `dir` is the chosen direction (Sort ascending / descending). */
  onSort?: (col: string, dir?: 'asc' | 'desc') => void;
  /** Header resize handle (PARITY-GRID): the new width in px, or undefined to reset it. Omit to
   *  hide the handles. */
  onResizeColumn?: (id: string, width: number | undefined) => void;
  onRemoveColumn?: (col: SelectedColumn) => void;
  onMoveColumn?: (id: string, direction: 'left' | 'right') => void;
  /** Drag-and-drop reorder: fired on drop with the dragged column's id and the id of the column
   *  it was dropped on. Omit to disable dragging (columns fall back to the move-left/right
   *  buttons only). */
  onMoveColumnTo?: (id: string, targetId: string) => void;
  selectedRow?: LogRow | null;
  /** Rows currently checked for comparison (by index within `rows`). Omit the pair to hide the
   *  checkbox column entirely. */
  compareSelection?: Set<number>;
  onToggleCompare?: (index: number) => void;
  /** Enables the per-cell hover toolbar (filter for/out, copy), floating just above whichever
   *  cell is under the cursor. Omit to hide it (e.g. read-only contexts). */
  onAddFilter?: (f: FilterPill) => void;
  /** False for a converted time field (PLAN #16d): the Time cell shows the converted time, which
   *  can't be compared with the raw epoch / text column, so it gets no filter actions. */
  timeFilterable?: boolean;
  /** Fired with a field id when a FieldSidebar row is dropped onto the table — adds it as a
   *  column. `targetId` is the column the drop landed on/near (header or body cell), so the new
   *  column can be inserted at that position instead of always appending at the end — omitted
   *  when the drop lands outside any column (e.g. the empty-state area), which appends. Omit the
   *  prop entirely to disable accepting field drops. */
  onDropField?: (fieldId: string, targetId?: string) => void;
  /** Matcher for a column's matched query/filter terms (DISC-SEARCH-02); null = none. */
  highlighterFor?: (col: SelectedColumn) => RegExp | null;
  /** Density and body-cell lines (DISC-TABLE-01 display options). */
  display?: GridDisplay;
  /** PgUp / PgDn from the keyboard: move one page back (-1) or forward (+1). Returns whether the
   *  page changes (false on the first/last page or while a page is loading). */
  onPageStep?: (delta: 1 | -1) => boolean;
  /** Surrounding documents (DISC-DOC-02): the anchor row, highlighted pale yellow. */
  anchorRow?: LogRow | null;
}

type CellPos = { ri: number; ci: number };

/** Horizontal cell padding (both sides) — a set column width is the cell's outer width. */
const CELL_PAD_X = 24;
/** Arrow-key step of a focused resize handle. */
const RESIZE_KEY_STEP = 16;

/** Width a column renders at: the user's, else the built-in one for time / level columns. */
function columnWidth(col: SelectedColumn): number | undefined {
  return col.width ?? (col.type === 'time' ? 190 : col.type === 'level' ? 80 : undefined);
}

const clampWidth = (w: number) => Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, w)));

/** Shared with LogDetailDrawer's header summary so the row and detail view agree on color. */
export function severityColor(severity: unknown): string {
  const s = String(severity || '').toLowerCase();
  return SEVERITY_COLORS[s] ?? SEVERITY_COLORS['unknown'];
}

const TS_FORMAT = { format: 'YYYY-MM-DD HH:mm:ss.SSS', timeZone: 'browser' } as const;

/** Shared with LogDetailDrawer's header summary. */
export function formatTimestamp(ts: unknown): string {
  if (ts === null || ts === undefined) {
    return '';
  }
  if (typeof ts === 'object' && ts !== null && 'valueOf' in ts) {
    return dateTimeFormat((ts as DateTime).valueOf(), TS_FORMAT);
  }
  if (typeof ts === 'number') {
    return dateTimeFormat(ts, TS_FORMAT);
  }
  // Raw string from ClickHouse (e.g. "2026-06-29 06:00:00") — parse as UTC, display local.
  const ms = toUtc(String(ts)).valueOf();
  if (!isNaN(ms)) {
    return dateTimeFormat(ms, TS_FORMAT);
  }
  return String(ts);
}

/** Text form of a raw cell value usable as a filter/comparison value — a JSON field's value comes
 *  back as a parsed object/array (e.g. a nested leaf or array leaf), not a primitive; stringify it
 *  the same way the cell itself renders it, instead of `String(raw)` which would produce the
 *  useless "[object Object]". */
function cellTextValue(raw: unknown): string {
  return raw !== null && typeof raw === 'object' ? JSON.stringify(raw) : String(raw ?? '');
}

/** Text with matched query/filter terms wrapped in <mark> (DISC-SEARCH-02). Matching runs on the
 *  stored text; `display` only changes how each run is shown (e.g. upper-cased levels). */
function highlighted(
  text: string,
  matcher: RegExp | null | undefined,
  markClass: string,
  display: (s: string) => string = (s) => s
): React.ReactNode {
  if (!matcher) {
    return display(text);
  }
  return splitHighlights(text, matcher).map((run, i) =>
    run.match ? (
      <mark key={i} className={markClass} data-testid="match-highlight">
        {display(run.text)}
      </mark>
    ) : (
      display(run.text)
    )
  );
}

const upper = (s: string) => s.toUpperCase();

function renderCell(col: SelectedColumn, row: LogRow, matcher: RegExp | null | undefined, markClass: string): React.ReactNode {
  const raw = row[col.key];
  if (col.type === 'time') {
    return String(formatTimestamp(raw));
  }
  if (col.type === 'level') {
    const s = String(raw || '');
    return <span style={{ color: severityColor(s) }}>{s ? highlighted(s, matcher, markClass, upper) : '—'}</span>;
  }
  if (raw === null || raw === undefined) {
    return '—';
  }
  return highlighted(cellTextValue(raw), matcher, markClass);
}

export function LogsTable({
  rows,
  loading,
  columns,
  sort,
  onRowClick,
  onSort,
  onResizeColumn,
  onRemoveColumn,
  onMoveColumn,
  onMoveColumnTo,
  selectedRow,
  compareSelection,
  onToggleCompare,
  onAddFilter,
  timeFilterable = true,
  onDropField,
  highlighterFor,
  display = DEFAULT_GRID_DISPLAY,
  onPageStep,
  anchorRow,
}: LogsTableProps) {
  const wrap = display.bodyLines === 'auto';
  const bodyLines = display.bodyLines === 'auto' ? 0 : display.bodyLines;
  const showCompare = compareSelection !== undefined && onToggleCompare !== undefined;
  const styles = useStyles2(getStyles);
  // One compiled matcher per column, not per cell per render (the grid re-renders on hover).
  const matchers = useMemo(
    () => new Map(columns.map((c) => [c.id, highlighterFor ? highlighterFor(c) : null])),
    [columns, highlighterFor]
  );
  // Roving keyboard focus on one cell (row index within this page, column index), independent of
  // `selectedRow` (which opens the detail panel). Arrows / Home / End / PgUp / PgDn move it;
  // Enter opens the Expand popover for it (DISC-TABLE-01 keyboard model).
  const [rawFocus, setFocusCell] = useState<CellPos>({ ri: -1, ci: 0 });
  // SHARED-A11Y-01: focus stays on the grid; aria-activedescendant names the cursor cell.
  const cellIdPrefix = useId();
  const cellId = (ri: number, ci: number) => `${cellIdPrefix}-cell-${ri}-${ci}`;
  // Clamped to the current page, so rendering and key handling always agree after a re-query.
  const focusCell: CellPos =
    rawFocus.ri < 0 || rows.length === 0
      ? { ri: -1, ci: 0 }
      : { ri: Math.min(rawFocus.ri, rows.length - 1), ci: Math.max(0, Math.min(rawFocus.ci, columns.length - 1)) };
  const focusIndex = focusCell.ri;
  const [gridFocused, setGridFocused] = useState(false);
  // The focused cell shows its action bar only while the keyboard drives the grid; a mouse click
  // switches back to hover-only.
  const [keyboardNav, setKeyboardNav] = useState(false);
  // Expand popover target. Keyed by this page's `rows` array as well as the row, so it disappears
  // when the page changes and doesn't come back when returning (pages are fresh arrays).
  const [expanded, setExpanded] = useState<{ rows: LogRow[]; row: LogRow; colId: string } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // When the detail panel closes (Escape, its close button) focus would fall to <body>: give it
  // back to the row's "Open detail" button, like Kibana returns focus to the row.
  const prevSelectedRef = useRef<LogRow | null | undefined>(selectedRow);
  useEffect(() => {
    const prev = prevSelectedRef.current;
    prevSelectedRef.current = selectedRow;
    if (!prev || selectedRow) {
      return;
    }
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) {
      return;
    }
    const i = rows.indexOf(prev);
    const btn = i >= 0 ? wrapperRef.current?.querySelector<HTMLElement>(`[data-expand-row="${i}"]`) : null;
    (btn ?? wrapperRef.current)?.focus({ preventScroll: true });
  }, [selectedRow, rows]);
  // Header menu (sort / move / remove / copy name) and live column resizing.
  const [menu, setMenu] = useState<{ colId: string; rect: DOMRect } | null>(null);
  const [liveWidth, setLiveWidth] = useState<{ id: string; width: number } | null>(null);
  const resizeRef = useRef<{ id: string; startX: number; startW: number; width: number } | null>(null);
  useEffect(() => {
    if (!gridFocused || focusCell.ri < 0) {
      return;
    }
    const el = wrapperRef.current?.querySelector(`[data-cell="${focusCell.ri}:${focusCell.ci}"]`);
    (el as HTMLElement | null)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [focusCell.ri, focusCell.ci, gridFocused]);
  // Which single cell's hover toolbar (filter for/out, copy, open detail) is currently mounted.
  // Previously every data cell in every row always mounted its toolbar (just opacity:0, revealed
  // by CSS :hover) — with a few hundred user-added columns that's tens of thousands of always-in-
  // the-DOM IconButtons. Only the actually-hovered cell now mounts its toolbar at all.
  const [hoveredCell, setHoveredCell] = useState<{ ri: number; ci: string } | null>(null);
  // Column drag-and-drop reorder (native HTML5 DnD — no extra dependency). draggedId tracks
  // which column is being lifted (dimmed at its origin); dragOverId tracks the current drop
  // target (highlighted) so the user always sees where a drop would land.
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // Dropping a field from FieldSidebar anywhere onto the table adds it as a column — works even
  // with zero rows loaded, since it's a column-selection action, not a per-row one.
  const [isFieldDragOver, setIsFieldDragOver] = useState(false);
  // Which column (header or body cell) a field drag is currently hovering — the new column is
  // inserted at that position on drop, rather than always appended at the end.
  const [fieldDropTargetId, setFieldDropTargetId] = useState<string | null>(null);
  const acceptsFieldDrag = Boolean(onDropField);
  // Hoisted out of the row-render loop below — this used to run `columns.find(...)` once per
  // row on every render, pure wasted work since `columns` doesn't change per-row.
  const levelCol = useMemo(() => columns.find((c) => c.type === 'level'), [columns]);
  const onTableDragOver = (e: React.DragEvent) => {
    if (!acceptsFieldDrag || !e.dataTransfer.types.includes(FIELD_DRAG_MIME)) {
      return;
    }
    e.preventDefault();
    setIsFieldDragOver(true);
  };
  const onTableDrop = (e: React.DragEvent) => {
    if (!acceptsFieldDrag) {
      return;
    }
    const fieldId = e.dataTransfer.getData(FIELD_DRAG_MIME);
    setIsFieldDragOver(false);
    if (fieldId) {
      e.preventDefault();
      onDropField!(fieldId);
    }
  };
  // Column-position-aware handlers, wired onto each th/td below. Stop propagation so the drop
  // isn't also handled by onTableDrop above (which would append a second time at the end).
  const onColumnFieldDragOver = (e: React.DragEvent, colId: string) => {
    if (!acceptsFieldDrag || !e.dataTransfer.types.includes(FIELD_DRAG_MIME)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (fieldDropTargetId !== colId) {
      setFieldDropTargetId(colId);
    }
  };
  const onColumnFieldDrop = (e: React.DragEvent, colId: string) => {
    if (!acceptsFieldDrag || !e.dataTransfer.types.includes(FIELD_DRAG_MIME)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const fieldId = e.dataTransfer.getData(FIELD_DRAG_MIME);
    setIsFieldDragOver(false);
    setFieldDropTargetId(null);
    if (fieldId) {
      onDropField!(fieldId, colId);
    }
  };

  if (loading) {
    return (
      <div
        className={cx(styles.empty, isFieldDragOver && styles.emptyDragOver)}
        onDragOver={onTableDragOver}
        onDragLeave={() => setIsFieldDragOver(false)}
        onDrop={onTableDrop}
      >
        <LoadingPlaceholder text="Running query…" />
      </div>
    );
  }
  if (!loading && rows.length === 0) {
    return (
      <div
        className={cx(styles.empty, isFieldDragOver && styles.emptyDragOver)}
        onDragOver={onTableDragOver}
        onDragLeave={() => setIsFieldDragOver(false)}
        onDrop={onTableDrop}
      >
        <EmptyState
          variant="not-found"
          hideImage
          message="No logs found for the selected time range and filters."
        />
      </div>
    );
  }

  const closeExpand = (refocusGrid = true) => {
    setExpanded(null);
    if (refocusGrid) {
      wrapperRef.current?.focus();
    }
  };

  const onTableKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Only keys aimed at the grid itself: inputs/buttons inside cells keep their own keys.
    if (e.target !== e.currentTarget) {
      return;
    }
    const lastRow = rows.length - 1;
    const lastCol = columns.length - 1;
    const started = focusCell.ri >= 0;
    const cur: CellPos = started ? focusCell : { ri: 0, ci: 0 };
    const ctrl = e.ctrlKey || e.metaKey;
    let next: CellPos | null = null;
    switch (e.key) {
      case 'ArrowDown':
        next = started ? { ...cur, ri: Math.min(lastRow, cur.ri + 1) } : cur;
        break;
      case 'ArrowUp':
        next = { ...cur, ri: Math.max(0, cur.ri - 1) };
        break;
      case 'ArrowRight':
        next = started ? { ...cur, ci: Math.min(lastCol, cur.ci + 1) } : cur;
        break;
      case 'ArrowLeft':
        next = { ...cur, ci: Math.max(0, cur.ci - 1) };
        break;
      case 'Home':
        next = ctrl ? { ri: 0, ci: 0 } : { ...cur, ci: 0 };
        break;
      case 'End':
        next = ctrl ? { ri: lastRow, ci: lastCol } : { ...cur, ci: lastCol };
        break;
      case 'PageDown':
      case 'PageUp':
        // Only take the key when the page really changes; otherwise leave native scrolling alone.
        if (!onPageStep?.(e.key === 'PageDown' ? 1 : -1)) {
          return;
        }
        next = { ri: 0, ci: cur.ci };
        break;
      case 'Enter':
        if (started && columns[cur.ci]) {
          e.preventDefault();
          if (e.shiftKey) {
            // Shift+Enter: the row's detail panel (Enter alone expands the cell, per the spec).
            onRowClick(rows[cur.ri]);
          } else {
            setExpanded({ rows, row: rows[cur.ri], colId: columns[cur.ci].id });
          }
        }
        return;
      case 'Escape':
        if (expanded) {
          e.preventDefault();
          closeExpand();
        }
        return;
      default:
        return;
    }
    e.preventDefault();
    setKeyboardNav(true);
    setFocusCell(next);
  };
  // Effective width of a column: live while dragging its handle, else set / built-in.
  const widthOf = (col: SelectedColumn) => (liveWidth?.id === col.id ? liveWidth.width : columnWidth(col));
  const widthStyle = (col: SelectedColumn): React.CSSProperties | undefined => {
    const w = widthOf(col);
    if (w === undefined) {
      return undefined;
    }
    // Built-in widths (time / level) stay a hint; a user width is exact.
    const exact = col.width !== undefined || liveWidth?.id === col.id;
    return exact ? { width: w, minWidth: w, maxWidth: w } : { width: w };
  };
  // Cell content of a resized column is capped too (table cells treat width only as a hint).
  const contentWidthStyle = (col: SelectedColumn): React.CSSProperties | undefined => {
    if (col.width === undefined && liveWidth?.id !== col.id) {
      return undefined;
    }
    const w = Math.max(0, (widthOf(col) ?? 0) - CELL_PAD_X);
    return { maxWidth: w, width: col.type === 'text' ? w : undefined, overflow: 'hidden', textOverflow: 'ellipsis' };
  };
  const startResize = (e: React.PointerEvent<HTMLDivElement>, id: string) => {
    if (e.button > 0) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const th = e.currentTarget.parentElement;
    const startW = th ? th.getBoundingClientRect().width : 150;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    resizeRef.current = { id, startX: e.clientX, startW, width: clampWidth(startW) };
    setLiveWidth({ id, width: clampWidth(startW) });
  };
  const moveResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = resizeRef.current;
    if (!r) {
      return;
    }
    r.width = clampWidth(r.startW + e.clientX - r.startX);
    setLiveWidth({ id: r.id, width: r.width });
  };
  const endResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = resizeRef.current;
    if (!r) {
      return;
    }
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    resizeRef.current = null;
    setLiveWidth(null);
    onResizeColumn?.(r.id, r.width);
  };
  const hasMenu = Boolean(onSort || onMoveColumn || onRemoveColumn);
  const menuCol = menu ? columns.find((c) => c.id === menu.colId) : undefined;
  const menuItems = (col: SelectedColumn): ColumnMenuItem[] => {
    const idx = columns.findIndex((c) => c.id === col.id);
    const sorted = sort?.col === col.key ? sort.dir : undefined;
    const items: ColumnMenuItem[] = [];
    if (onSort) {
      items.push(
        { id: 'asc', label: 'Sort ascending', icon: 'arrow-up', active: sorted === 'asc', run: () => onSort(col.key, 'asc') },
        { id: 'desc', label: 'Sort descending', icon: 'arrow-down', active: sorted === 'desc', run: () => onSort(col.key, 'desc') }
      );
    }
    if (onMoveColumn && idx > 0) {
      items.push({ id: 'left', label: 'Move left', icon: 'arrow-left', run: () => onMoveColumn(col.id, 'left') });
    }
    if (onMoveColumn && idx < columns.length - 1) {
      items.push({ id: 'right', label: 'Move right', icon: 'arrow-right', run: () => onMoveColumn(col.id, 'right') });
    }
    if (onResizeColumn && col.width !== undefined) {
      items.push({ id: 'width', label: 'Reset width', icon: 'arrows-h', run: () => onResizeColumn(col.id, undefined) });
    }
    items.push({ id: 'copy', label: 'Copy name', icon: 'copy', run: () => void copyToClipboard(col.sqlExpr) });
    if (rows.length > 0) {
      items.push({
        id: 'copy-values',
        label: 'Copy column',
        icon: 'copy',
        run: () => void copyToClipboard(rows.map((r) => cellTextValue(r[col.key])).join('
')),
      });
    }
    if (onRemoveColumn && !col.isCore) {
      items.push({ id: 'remove', label: 'Remove column', icon: 'times', run: () => onRemoveColumn(col) });
    }
    return items;
  };

  // The cell whose action bar is showing: the hovered one, else the keyboard-focused one.
  const activeCell =
    hoveredCell ?? (gridFocused && keyboardNav && focusCell.ri >= 0 && columns[focusCell.ci] ? { ri: focusCell.ri, ci: columns[focusCell.ci].id } : null);

  return (
    <div
      className={cx(styles.tableWrapper, isFieldDragOver && styles.tableWrapperDragOver)}
      ref={wrapperRef}
      role="grid"
      aria-label="Log results"
      aria-activedescendant={
        gridFocused && focusCell.ri >= 0 && focusCell.ri < rows.length && columns[focusCell.ci]
          ? cellId(focusCell.ri, focusCell.ci)
          : undefined
      }
      tabIndex={0}
      onKeyDown={onTableKeyDown}
      onFocus={() => setGridFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setGridFocused(false);
        }
      }}
      onDragOver={onTableDragOver}
      onDragLeave={() => {
        setIsFieldDragOver(false);
        setFieldDropTargetId(null);
      }}
      onDrop={onTableDrop}
    >
      <table className={cx(styles.table, styles.density[display.density])}>
        <thead>
          <tr>
            {showCompare && <th className={cx(styles.th, styles.compareTh)} aria-hidden="true" />}
            <th className={cx(styles.th, styles.expandTh)} aria-hidden="true" />
            {columns.map((col) => {
              const isSorted = sort?.col === col.key;
              const draggable = Boolean(onMoveColumnTo);
              return (
                <th
                  key={col.id}
                  aria-sort={isSorted ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={cx(
                    styles.th,
                    styles.dataTh,
                    draggable && styles.thDraggable,
                    draggedId === col.id && styles.thDragging,
                    dragOverId === col.id && dragOverId !== draggedId && styles.thDragOver,
                    fieldDropTargetId === col.id && styles.fieldDropTarget
                  )}
                  style={widthStyle(col)}
                  draggable={draggable}
                  onDragStart={(e) => {
                    if (resizeRef.current) {
                      e.preventDefault();
                      return;
                    }
                    setDraggedId(col.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => {
                    setDraggedId(null);
                    setDragOverId(null);
                  }}
                  onDragOver={(e) => {
                    if (acceptsFieldDrag && e.dataTransfer.types.includes(FIELD_DRAG_MIME)) {
                      onColumnFieldDragOver(e, col.id);
                      return;
                    }
                    if (!draggable) {
                      return;
                    }
                    e.preventDefault();
                    if (dragOverId !== col.id) {
                      setDragOverId(col.id);
                    }
                  }}
                  onDrop={(e) => {
                    if (acceptsFieldDrag && e.dataTransfer.types.includes(FIELD_DRAG_MIME)) {
                      onColumnFieldDrop(e, col.id);
                      return;
                    }
                    e.preventDefault();
                    if (draggedId && draggedId !== col.id) {
                      onMoveColumnTo!(draggedId, col.id);
                    }
                    setDraggedId(null);
                    setDragOverId(null);
                  }}
                >
                  <div className={styles.thInner}>
                    {draggable && (
                      <Icon name="draggabledots" size="sm" className={styles.dragHandle} title="Drag to reorder" />
                    )}
                    {hasMenu ? (
                      // Kibana-style header: the name opens the column menu (sort, move, remove,
                      // copy name); a button, so it works from the keyboard (SHARED-A11Y-01).
                      <button
                        type="button"
                        className={cx(styles.sortable, styles.sortBtn)}
                        title={`Column actions: ${col.displayName}`}
                        aria-haspopup="menu"
                        aria-expanded={menu?.colId === col.id}
                        data-col-menu={col.id}
                        onClick={(e) => setMenu({ colId: col.id, rect: e.currentTarget.getBoundingClientRect() })}
                      >
                        <span className={styles.thName}>{col.displayName}</span>
                        {isSorted && (
                          <Icon name={sort!.dir === 'asc' ? 'arrow-up' : 'arrow-down'} size="xs" />
                        )}
                        <Icon name="angle-down" size="xs" className={styles.menuCaret} />
                      </button>
                    ) : (
                      <span className={styles.sortable}>
                        <span className={styles.thName}>{col.displayName}</span>
                        {isSorted && (
                          <Icon name={sort!.dir === 'asc' ? 'arrow-up' : 'arrow-down'} size="xs" />
                        )}
                      </span>
                    )}
                  </div>
                  {onResizeColumn && (
                    <div
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize column ${col.displayName}`}
                      aria-valuenow={columnWidth(col)}
                      aria-valuemin={MIN_COLUMN_WIDTH}
                      aria-valuemax={MAX_COLUMN_WIDTH}
                      tabIndex={0}
                      title="Drag to resize, double-click to reset"
                      className={cx(styles.resizeHandle, liveWidth?.id === col.id && styles.resizeHandleActive)}
                      draggable={false}
                      onMouseDown={(e) => {
                        // Keeps the header's native drag (reorder) from starting.
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onPointerDown={(e) => startResize(e, col.id)}
                      onPointerMove={moveResize}
                      onPointerUp={endResize}
                      onPointerCancel={endResize}
                      onDoubleClick={() => onResizeColumn(col.id, undefined)}
                      onKeyDown={(e) => {
                        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') {
                          return;
                        }
                        e.preventDefault();
                        e.stopPropagation();
                        const th = e.currentTarget.parentElement;
                        const cur = th ? th.getBoundingClientRect().width : (columnWidth(col) ?? 150);
                        onResizeColumn(col.id, clampWidth(cur + (e.key === 'ArrowRight' ? RESIZE_KEY_STEP : -RESIZE_KEY_STEP)));
                      }}
                    />
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const isSelected = selectedRow === row;
            const isFocused = focusIndex === i;
            const stripeColor = levelCol ? severityColor(row[levelCol.key]) : 'transparent';
            return (
              <React.Fragment key={i}>
                <tr
                  className={cx(
                    styles.tr,
                    row === anchorRow && styles.trAnchor,
                    isSelected && styles.trSelected,
                    isFocused && styles.trFocused
                  )}
                  data-anchor={row === anchorRow ? 'true' : undefined}
                  style={{ borderLeftColor: stripeColor }}
                  onMouseDown={() => {
                    setKeyboardNav(false);
                    setFocusCell((c) => ({ ri: i, ci: c.ci }));
                  }}
                  aria-selected={isSelected}
                >
                  {showCompare && (
                    <td className={cx(styles.td, styles.compareTd)}>
                      <input
                        type="checkbox"
                        checked={compareSelection!.has(i)}
                        onChange={() => onToggleCompare!(i)}
                        aria-label="Select for comparison"
                      />
                    </td>
                  )}
                  <td className={cx(styles.td, styles.expandTd)}>
                    <button
                      className={styles.expandBtn}
                      data-expand-row={i}
                      title={isSelected ? 'Close detail' : 'Open detail'}
                      aria-pressed={isSelected}
                      onClick={() => {
                        setFocusCell((c) => ({ ri: i, ci: c.ci }));
                        onRowClick(row);
                      }}
                    >
                      <Icon
                        name={isSelected ? 'compress-arrows' : 'expand-arrows'}
                        size="xs"
                        className={cx('expand-icon', styles.expandIcon, isSelected && styles.expandIconActive)}
                      />
                    </button>
                  </td>
                  {columns.map((col, ci) => {
                    const rawValue = row[col.key];
                    const isFocusedCell = gridFocused && isFocused && focusCell.ci === ci;
                    const isExpanded = expanded?.rows === rows && expanded.row === row && expanded.colId === col.id;
                    // A raw Map/JSON *container* column (added as its own column, e.g. the whole
                    // `ResourceAttributes` blob — sqlExpr is just the bare column name, no accessor)
                    // has no sensible equality filter — comparing a Map/JSON value to a stringified
                    // blob never matches. A flattened *leaf* (sqlExpr like `Col['key']` or
                    // `Col.path`) is a real scalar value and should stay filterable — its value
                    // comes back as a parsed object/array sometimes (nested/array leaf), not
                    // excluded outright; filtered using the same stringified form the cell already
                    // renders (cellTextValue), same as the drawer does.
                    const isRawContainer =
                      (col.type === 'map' || col.type === 'json') &&
                      !col.sqlExpr.includes('[') &&
                      !col.sqlExpr.includes('.');
                    const filterable =
                      onAddFilter && rawValue !== null && rawValue !== undefined && !isRawContainer &&
                      (timeFilterable || col.type !== 'time');
                    return (
                      <td
                        key={col.id}
                        id={cellId(i, ci)}
                        data-cell={`${i}:${ci}`}
                        aria-selected={isFocusedCell || undefined}
                        style={widthStyle(col)}
                        className={cx(
                          styles.td,
                          styles.dataTd,
                          col.type === 'text' && widthOf(col) === undefined && styles.bodyCell,
                          isFocusedCell && styles.focusedCell,
                          fieldDropTargetId === col.id && styles.fieldDropTarget
                        )}
                        onDragOver={(e) => onColumnFieldDragOver(e, col.id)}
                        onDrop={(e) => onColumnFieldDrop(e, col.id)}
                        onMouseDown={() => setFocusCell({ ri: i, ci })}
                        onMouseEnter={() => setHoveredCell({ ri: i, ci: col.id })}
                        onMouseLeave={() =>
                          setHoveredCell((prev) => (prev && prev.ri === i && prev.ci === col.id ? null : prev))
                        }
                      >
                        <span
                          className={cx(
                            col.type === 'time'
                              ? styles.timestamp
                              : col.type === 'level'
                              ? styles.severity
                              : col.type === 'text'
                              ? styles.body
                              : styles.cell,
                            col.type === 'text' && wrap && styles.wrapped
                          )}
                          style={{
                            ...(col.type === 'text' && !wrap
                              ? { WebkitLineClamp: bodyLines, minHeight: `${bodyLines * 1.5}em` }
                              : undefined),
                            ...contentWidthStyle(col),
                          }}
                        >
                          {renderCell(col, row, matchers.get(col.id), styles.matchHighlight)}
                        </span>
                        {isExpanded && (
                          <CellExpandPopover
                            ctx={{ field: col.sqlExpr, value: cellTextValue(rawValue), filterable: !!filterable }}
                            raw={rawValue}
                            host={{ addFilter: onAddFilter, copyText: copyToClipboard }}
                            onClose={closeExpand}
                          />
                        )}
                        {!isExpanded && activeCell?.ri === i && activeCell.ci === col.id && (
                          <div
                            className={cx(styles.cellToolbar, i === 0 && styles.cellToolbarBelow)}
                            style={{ opacity: 1, pointerEvents: 'auto' }}
                          >
                              {valueActions(
                                // Empty values and raw Map/JSON container cells offer copy only.
                                { field: col.sqlExpr, value: cellTextValue(rawValue), filterable: !!filterable },
                                {
                                  addFilter: onAddFilter,
                                  copyText: copyToClipboard,
                                  expand: () => setExpanded({ rows, row, colId: col.id }),
                                }
                              ).map((a) => (
                                <ActionIconButton key={a.id} action={a} />
                              ))}
                              <IconButton
                                name="table"
                                size="sm"
                                tooltip="Open detail"
                                aria-label="Open log detail"
                                onClick={() => {
                                  setFocusCell((c) => ({ ri: i, ci: c.ci }));
                                  onRowClick(row);
                                }}
                              />
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      {menu && menuCol && (
        <ColumnHeaderMenu
          columnName={menuCol.displayName}
          anchorRect={menu.rect}
          items={menuItems(menuCol)}
          onClose={() => setMenu(null)}
          returnFocus={() =>
            Array.from(wrapperRef.current?.querySelectorAll<HTMLElement>('[data-col-menu]') ?? []).find(
              (el) => el.dataset.colMenu === menuCol.id
            ) ?? null
          }
        />
      )}
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  matchHighlight: css({
    background: theme.colors.warning.transparent,
    color: 'inherit',
    padding: 0,
    borderRadius: theme.shape.radius.default,
    boxShadow: `0 0 0 1px ${theme.colors.warning.border}`,
  }),
  tableWrapper: css`
    overflow-x: auto;
    overflow-y: auto;
    flex: 1;
    border: 1px solid ${theme.colors.border.weak};
    border-radius: ${theme.shape.radius.default};
    background: ${theme.colors.background.primary};
    outline: none;
    &:focus-visible {
      box-shadow: inset 0 0 0 2px ${theme.colors.primary.border};
    }
  `,
  /** Dashed accent while a field from the sidebar is dragged over the table, so it's obvious
   *  dropping here will add the field as a column. */
  tableWrapperDragOver: css`
    box-shadow: inset 0 0 0 2px ${theme.colors.primary.border};
  `,
  emptyDragOver: css`
    box-shadow: inset 0 0 0 2px ${theme.colors.primary.border};
    background: ${theme.colors.primary.transparent};
  `,
  /** Which column a field drag is hovering — shows the new column would land right before this
   *  one, distinct from tableWrapperDragOver's whole-table cue. */
  fieldDropTarget: css`
    box-shadow: inset 2px 0 0 0 ${theme.colors.primary.main};
    background: ${theme.colors.primary.transparent};
  `,
  table: css`
    width: 100%;
    // 'separate' (not 'collapse') — position:sticky on a <th> inside a collapsed-border table is
    // a well-documented cross-browser fragility: table layout's box generation doesn't reliably
    // reserve the sticky header's height in the normal flow with border-collapse:collapse, so a
    // reflow (e.g. adding a column pushes the table past the container's width, toggling
    // horizontal scroll) could make the header render stacked on top of row 1 instead of above
    // it. border-spacing:0 keeps the visual result identical to collapsed borders since every
    // cell already draws its own border-bottom (th below, tr below) rather than relying on
    // adjacent cells' borders merging.
    border-collapse: separate;
    border-spacing: 0;
    font-size: 14px;
  `,
  th: css`
    padding: ${theme.spacing(0.75)} ${theme.spacing(1)};
    text-align: left;
    font-weight: ${theme.typography.fontWeightMedium};
    font-size: ${theme.typography.body.fontSize};
    font-family: ${theme.typography.fontFamily};
    color: ${theme.colors.text.secondary};
    border-bottom: 1px solid ${theme.colors.border.medium};
    background: ${theme.colors.background.secondary};
    background-clip: padding-box;
    white-space: nowrap;
    position: sticky;
    top: 0;
    // Above row content (rows have no explicit z-index / are auto-stacked) and above dataTd's
    // hover box-shadow, but below cellToolbar's z-index:5 and FieldSidebar's Portal popovers —
    // just needs to reliably win against the table body, not the whole page's stacking order.
    z-index: 3;
  `,
  /** Hover feedback only for real data-column headers — the leading checkbox/expand-chevron
   *  header cells aren't interactive and shouldn't visually react on hover. */
  dataTh: css`
    &:hover {
      background: ${theme.colors.action.hover};
    }
  `,
  thDraggable: css`
    cursor: grab;
  `,
  thDragging: css`
    opacity: 0.4;
  `,
  thDragOver: css`
    box-shadow: inset 2px 0 0 0 ${theme.colors.primary.main};
    background: ${theme.colors.action.hover};
  `,
  dragHandle: css`
    flex-shrink: 0;
    color: ${theme.colors.text.disabled};
    cursor: grab;
  `,
  expandTh: css`
    width: 24px;
    padding-left: ${theme.spacing(1)};
    padding-right: 0;
  `,
  expandTd: css`
    width: 24px;
    padding-left: ${theme.spacing(1)};
    padding-right: 0;
  `,
  compareTh: css`
    width: 28px;
    padding-left: ${theme.spacing(1)};
    padding-right: 0;
  `,
  compareTd: css`
    width: 28px;
    padding-left: ${theme.spacing(1)};
    padding-right: 0;
  `,
  expandIcon: css`
    color: ${theme.colors.text.disabled};
  `,
  expandIconActive: css`
    color: ${theme.colors.primary.text};
  `,
  expandBtn: css`
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 2px;
    display: flex;
    align-items: center;
    border-radius: 2px;
    &:hover { background: ${theme.colors.action.hover}; }
    &:hover .expand-icon { color: ${theme.colors.text.primary}; }
  `,
  thInner: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(0.5)};
  `,
  sortable: css`
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 2px;
    &:hover { color: ${theme.colors.text.primary}; }
  `,
  thName: css`
    overflow: hidden;
    text-overflow: ellipsis;
  `,
  menuCaret: css`
    color: ${theme.colors.text.disabled};
    opacity: 0;
    th:hover &,
    th:focus-within & { opacity: 1; }
  `,
  resizeHandle: css`
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 7px;
    cursor: col-resize;
    touch-action: none;
    outline: none;
    &::after {
      content: '';
      position: absolute;
      top: 25%;
      bottom: 25%;
      right: 2px;
      width: 2px;
      border-radius: 1px;
      background: ${theme.colors.border.medium};
      opacity: 0;
    }
    th:hover &::after,
    &:focus-visible::after { opacity: 1; }
    &:hover::after,
    &:focus-visible::after { background: ${theme.colors.primary.main}; }
  `,
  resizeHandleActive: css`
    &::after {
      opacity: 1;
      background: ${theme.colors.primary.main};
    }
  `,
  sortBtn: css`
    background: transparent;
    border: none;
    padding: 0;
    min-width: 0;
    color: inherit;
    font: inherit;
    text-align: left;
  `,
  tr: css`
    border-bottom: 1px solid ${theme.colors.border.weak};
    border-left: 2px solid transparent;
    background: ${theme.colors.background.primary};
    transition: background-color 150ms ease;
    &:nth-of-type(even) { background: ${theme.colors.background.secondary}; }
    &:hover { background: ${theme.colors.action.hover}; }
    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  trSelected: css`
    background: ${theme.colors.action.selected} !important;
  `,
  /** The anchor of the surrounding-documents page: its own colour on every row (even rows' zebra
   *  and hover included) plus an accent bar, like Kibana's highlighted anchor. */
  trAnchor: css`
    background: ${theme.isDark ? 'rgba(255, 214, 0, 0.18)' : 'rgba(255, 230, 128, 0.55)'} !important;
    & > td:first-of-type {
      box-shadow: inset 3px 0 0 0 ${theme.colors.warning.main};
    }
  `,
  trFocused: css`
    box-shadow: inset 0 0 0 1px ${theme.colors.primary.border};
  `,
  td: css`
    padding: ${theme.spacing(1.25)} ${theme.spacing(1.5)};
    vertical-align: top;
    font-family: ${theme.typography.fontFamilyMonospace};
    line-height: 1.5;
  `,
  /** DISC-TABLE-01 density: cell padding per Compact / Normal / Expanded. */
  density: {
    compact: css`
      & > tbody > tr > td {
        padding-top: ${theme.spacing(0.25)};
        padding-bottom: ${theme.spacing(0.25)};
      }
    `,
    normal: css``,
    expanded: css`
      & > tbody > tr > td {
        padding-top: ${theme.spacing(2)};
        padding-bottom: ${theme.spacing(2)};
      }
    `,
  },
  /** Keyboard-focused cell (roving focus). */
  focusedCell: css`
    box-shadow: inset 0 0 0 2px ${theme.colors.primary.main} !important;
  `,
  dataTd: css`
    position: relative;
    &:hover {
      box-shadow: inset 0 0 0 1px ${theme.colors.primary.border};
    }
  `,
  cellToolbar: css`
    position: absolute;
    top: -14px;
    left: ${theme.spacing(0.5)};
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 1px;
    padding: 1px ${theme.spacing(0.25)};
    background: ${theme.colors.background.primary};
    border: 1px solid ${theme.colors.border.medium};
    border-radius: ${theme.shape.radius.default};
    box-shadow: ${theme.shadows.z1};
    opacity: 0;
    pointer-events: none;
    transition: opacity 100ms ease;
    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  /** The message column takes the leftover width but never less than a readable minimum: with
   *  many columns the grid scrolls sideways instead of squeezing it to a word per line. */
  bodyCell: css`
    max-width: 0;
    width: 100%;
    & > span {
      min-width: 18em;
    }
  `,
  /** First row: below the cell, so it never covers the sticky column header. */
  cellToolbarBelow: css`
    top: auto;
    bottom: -14px;
  `,
  timestamp: css`
    color: ${theme.colors.text.primary};
    white-space: nowrap;
    font-size: 14px;
    display: block;
    font-variant-numeric: tabular-nums;
  `,
  severity: css`
    font-weight: ${theme.typography.fontWeightMedium};
    font-size: 14px;
    white-space: nowrap;
    display: block;
  `,
  body: css`
    /* Default (Wrap lines off): always exactly 2 lines tall, even for short values — uniform row
       height across the table beats reclaiming space on short rows. line-height is fixed here
       (not inherited) so min-height's 2x multiple lines up exactly with the clamp. */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-word;
    color: ${theme.colors.text.primary};
    line-height: 1.5;
    min-height: 3em;
  `,
  /** "Wrap lines" toggle: full unlimited wrap, overriding body's default 2-line clamp. */
  wrapped: css`
    display: block;
    -webkit-line-clamp: unset;
    white-space: pre-wrap;
    word-break: break-word;
  `,
  cell: css`
    color: ${theme.colors.text.primary};
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 200px;
    display: block;
  `,
  empty: css`
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: ${theme.spacing(4)};
    text-align: center;
    color: ${theme.colors.text.secondary};
  `,
});
