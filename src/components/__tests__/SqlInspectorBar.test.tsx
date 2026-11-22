/**
 * "Inspect SQL" shows the builder SQL with the time macros expanded, but "Copy" keeps the macro
 * form (the text "Edit as SQL" starts from, re-runnable for any range); "Copy as shown" copies the
 * expanded text.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { dateTime } from '@grafana/data';
import { SqlInspectorBar } from '../SqlInspectorBar';
import { DEFAULT_LOGS_QUERY_STATE } from '../../types';

jest.mock('../../diag/DiagContext', () => ({ useDiagnostics: () => ({ roots: [] }) }));
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

  it('"Copy" keeps the macro form', () => {
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: /^Copy$/ }));
    expect(mockCopied).toHaveBeenCalledWith(SQL);
  });

  it('"Copy as shown" copies the expanded SQL', () => {
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: /Copy as shown/ }));
    expect(mockCopied).toHaveBeenCalledWith(expanded);
  });
});
