/** "Inspect SQL" shows and copies the SQL as it was executed; before any query, with the time filled in. */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { dateTime } from '@grafana/data';
import { SqlInspectorBar } from '../SqlInspectorBar';
import { DEFAULT_LOGS_QUERY_STATE } from '../../types';

let mockRoots: unknown[] = [];
jest.mock('../../diag/DiagContext', () => ({ useDiagnostics: () => ({ roots: mockRoots }) }));
jest.mock('../SavedSearches/SavedSearchMenu', () => ({ SavedSearchMenu: () => null }));
jest.mock('../SessionActions/SessionActions', () => ({ SessionActions: () => null }));
// jsdom has no secure-context clipboard; record what each copy button would copy instead.
const mockCopied = jest.fn();
jest.mock('@grafana/ui', () => {
  const actual = jest.requireActual('@grafana/ui');
  return {
    ...actual,
    ClipboardButton: ({ getText, children }: { getText: () => string; children: React.ReactNode }) => (
      <button onClick={() => mockCopied(getText())}>{children}</button>
    ),
  };
});

const SQL = 'SELECT * FROM t WHERE ts >= $__fromTime AND ts <= $__toTime';
const from = dateTime('2026-01-01T00:00:00Z');
const to = dateTime('2026-01-01T01:00:00Z');

function renderBar() {
  return render(
    <SqlInspectorBar
      queryState={{ ...DEFAULT_LOGS_QUERY_STATE, useRawSql: false }}
      timeRange={{ from, to, raw: { from: 'now-1h', to: 'now' } }}
      onLoadSaved={jest.fn()}
      canAddToDashboard={false}
      onOpenAddToDashboard={jest.fn()}
      onToggleRawSql={jest.fn()}
      showSqlInspect={true}
      onToggleShowSqlInspect={jest.fn()}
      rawSqlDraft=""
      onRawSqlDraftChange={jest.fn()}
      onRunRawSql={jest.fn()}
      builderSql={SQL}
      onOpenDiagnostics={jest.fn()}
    />
  );
}

describe('SqlInspectorBar inspect / copy', () => {
  beforeEach(() => mockCopied.mockClear());

  const expanded = `SELECT * FROM t WHERE ts >= toDateTime(${from.unix()}) AND ts <= toDateTime(${to.unix()})`;

  it('displays the SQL with the time macros expanded', () => {
    renderBar();
    expect(screen.getByText(expanded)).toBeInTheDocument();
  });

  it('copies exactly what it shows', () => {
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: /^Copy$/ }));
    expect(mockCopied).toHaveBeenCalledWith(expanded);
  });

  it('shows every executed step of the latest search, what was loaded after it, and the histogram', () => {
    const span = (id: string, kind: string, startMs: number, group?: string) => ({
      id, kind, startMs, endMs: startMs + 5, status: 'ok', children: [],
      attrs: { sql: 'macro', executedSql: `SELECT '${id}'`, rowCount: 1, group },
    });
    mockRoots = [
      span('old', 'logs', 1, 'a'),
      span('vol', 'volume', 2),
      span('s1', 'logs', 3, 'b'),
      span('s2', 'logs', 4, 'b'),
      span('more', 'loadMore', 9, 'c'),
      span('side', 'mapKeys', 10),
    ];
    renderBar();
    mockRoots = [];
    const shown = screen.getAllByRole('group', { name: /^Executed SQL/ }).map((g) => g.querySelector('pre')?.textContent);
    expect(shown).toEqual(["SELECT 's1'", "SELECT 's2'", "SELECT 'more'", "SELECT 'vol'"]);
    expect(screen.getByText(/Documents, step 2 of 2 \(1 row, 5 ms\)/)).toBeInTheDocument();
  });
});
