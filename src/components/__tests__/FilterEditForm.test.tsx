import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { FilterEditForm, isFilterComplete, operatorsFor, validateRange, OPERATORS } from '../AddFilter/FilterEditForm';
import { FieldsContext } from '../FieldsContext';
import { FilterPill } from '../../types';
import { FieldModel } from '../../sql/fieldModel';
import * as filtersModule from '../../sql/filters';

jest.mock('../../sql/filters', () => {
  const actual = jest.requireActual('../../sql/filters');
  return { ...actual, nextId: jest.fn(actual.nextId) };
});

// Grafana's Combobox measures text on a canvas, which jsdom does not implement.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => ({ measureText: () => ({ width: 10 }), font: '' })) as any;
});

const field = (name: string, type: FieldModel['type']): FieldModel => ({
  id: `col:${name}`,
  name,
  displayName: name,
  sqlExpr: name,
  type,
  source: 'column',
});

function renderForm(initial?: FilterPill) {
  const onSubmit = jest.fn();
  const onCancel = jest.fn();
  const fields = [field('SeverityNumber', 'number'), field('ServiceName', 'string')];
  const ctx: any = { fields, loading: false, error: null, refresh: jest.fn() };
  render(
    <FieldsContext.Provider value={ctx}>
      <FilterEditForm initial={initial} loadValues={async () => []} onSubmit={onSubmit} onCancel={onCancel} />
    </FieldsContext.Provider>
  );
  return { onSubmit, onCancel };
}

describe('DISC-FILTER-02 operator lists', () => {
  const values = (type: FieldModel['type'], source: FieldModel['source'] = 'column') =>
    operatorsFor({ type, source }).map((o) => o.value);
  const RANGES = ['gte', 'lt', 'between', 'not_between'];
  it('numbers and times get ranges but no substring match', () => {
    for (const t of ['number', 'time'] as const) {
      expect(values(t)).toEqual(expect.arrayContaining(RANGES));
      expect(values(t)).not.toContain('contains');
    }
  });
  it('strings get substring match but no ranges', () => {
    expect(values('string')).toEqual(expect.arrayContaining(['contains', 'not_contains', 'exists']));
    expect(values('string')).not.toContain('between');
  });
  it('a whole Map / JSON / Tuple / Array column gets no range operators', () => {
    for (const t of ['map', 'json', 'tuple', 'array'] as const) {
      for (const r of RANGES) {
        expect(values(t)).not.toContain(r);
      }
    }
  });
  it('a Map key (string-valued) gets ranges', () => {
    expect(values('string', 'map')).toEqual(expect.arrayContaining(RANGES));
  });
  it('covers the spec operator set', () => {
    expect(OPERATORS.map((o) => o.label)).toEqual(
      expect.arrayContaining([
        'is',
        'is not',
        'is one of',
        'is not one of',
        'greater or equal',
        'less than',
        'is between',
        'is not between',
        'exists',
      ])
    );
  });
});

describe('isFilterComplete', () => {
  const none: [string, string] = ['', ''];
  it('needs a field and an operator', () => {
    expect(isFilterComplete(null, '=', 'a', [], none)).toBe(false);
    expect(isFilterComplete('f', null, 'a', [], none)).toBe(false);
  });
  it('exists needs no value', () => expect(isFilterComplete('f', 'exists', '', [], none)).toBe(true));
  it('one_of needs a value', () => {
    expect(isFilterComplete('f', 'one_of', '', [], none)).toBe(false);
    expect(isFilterComplete('f', 'not_one_of', '', ['a'], none)).toBe(true);
  });
  it('between needs both bounds; gte needs a value', () => {
    expect(isFilterComplete('f', 'between', '', [], ['1', ''])).toBe(false);
    expect(isFilterComplete('f', 'between', '', [], ['1', '2'])).toBe(true);
    expect(isFilterComplete('f', 'gte', ' ', [], none)).toBe(false);
    expect(isFilterComplete('f', 'lt', '3', [], none)).toBe(true);
  });
});

describe('validateRange', () => {
  const num = { type: 'number' as const, source: 'column' as const };
  const time = { type: 'time' as const, source: 'column' as const };
  const key = { type: 'string' as const, source: 'map' as const };
  const none: [string, string] = ['', ''];
  it('numeric fields and Map keys need numbers', () => {
    expect(validateRange(num, 'gte', '1s', none)).toMatch(/not a number/);
    expect(validateRange(num, 'between', '', ['1', '5s'])).toMatch(/not a number/);
    expect(validateRange(key, 'lt', '2026-01-01', none)).toMatch(/not a number/);
    expect(validateRange(num, 'gte', '13', none)).toBeNull();
    expect(validateRange(num, 'gte', '-1.5e3', none)).toBeNull();
  });
  it('time fields need dates', () => {
    expect(validateRange(time, 'gte', '13', none)).toMatch(/not a date/);
    expect(validateRange(time, 'gte', '2026-01-05', none)).toBeNull();
    expect(validateRange(time, 'between', '', ['2026-01-05 09:00:00', '2026-01-05 11:00:00'])).toBeNull();
    expect(validateRange(time, 'gte', '2026-13-45', none)).toMatch(/not a date/);
  });
  it('between rejects From greater than To; equal bounds are fine', () => {
    expect(validateRange(num, 'between', '', ['10', '2'])).toBe('From must not be greater than To');
    expect(validateRange(num, 'not_between', '', ['10', '2'])).toBe('From must not be greater than To');
    expect(validateRange(num, 'between', '', ['9', '10'])).toBeNull(); // numeric, not lexical
    expect(validateRange(num, 'between', '', ['5', '5'])).toBeNull();
    expect(validateRange(time, 'between', '', ['2026-01-06', '2026-01-05'])).toBe('From must not be greater than To');
  });
  it('is silent for non-range operators and unfilled bounds', () => {
    expect(validateRange(num, '=', 'abc', none)).toBeNull();
    expect(validateRange(num, 'between', '', ['1', ''])).toBeNull();
  });
});

describe('FilterEditForm', () => {
  it('blank form: value disabled until an operator is picked, Add disabled', () => {
    renderForm();
    expect(screen.getByPlaceholderText('Please select operator first...')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add filter' })).toBeDisabled();
    expect(screen.queryByTestId('filter-preview')).toBeNull();
  });

  it('editing a pill prefills it, shows a preview and keeps id/disabled/pinned on update', () => {
    const { onSubmit } = renderForm({
      id: 'p1',
      field: 'SeverityNumber',
      op: 'between',
      value: '',
      values: ['9', '13'],
      disabled: true,
      pinned: true,
      label: 'mid',
    });
    expect(screen.getByTestId('filter-preview').textContent).toContain('SeverityNumber is between 9 and 13');
    fireEvent.click(screen.getByRole('button', { name: 'Update filter' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1', op: 'between', values: ['9', '13'], disabled: true, pinned: true, label: 'mid' })
    );
  });

  it('hostile values stay plain data on the pill', () => {
    const { onSubmit } = renderForm({ id: 'p2', field: 'ServiceName', op: '=', value: "') OR 1=1 --" });
    fireEvent.click(screen.getByRole('button', { name: 'Update filter' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ value: "') OR 1=1 --" }));
  });

  it('an invalid range disables Update and explains why', () => {
    renderForm({ id: 'p3', field: 'SeverityNumber', op: 'between', value: '', values: ['10', '2'] });
    expect(screen.getByTestId('filter-error').textContent).toBe('From must not be greater than To');
    expect(screen.getByRole('button', { name: 'Update filter' })).toBeDisabled();
    expect(screen.queryByTestId('filter-preview')).toBeNull();
  });

  it('building the preview does not consume pill ids', () => {
    const ids = filtersModule.nextId as jest.Mock;
    ids.mockClear();
    renderForm({ id: 'p4', field: 'ServiceName', op: '=', value: 'x' });
    expect(screen.getByTestId('filter-preview')).toBeInTheDocument();
    expect(ids).not.toHaveBeenCalled();
  });

  it('Cancel calls onCancel', () => {
    const { onCancel } = renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
