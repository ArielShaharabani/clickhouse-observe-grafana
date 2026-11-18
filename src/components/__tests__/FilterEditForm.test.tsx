import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { FilterEditForm, isFilterComplete, operatorsFor, OPERATORS } from '../AddFilter/FilterEditForm';
import { FieldsContext } from '../FieldsContext';
import { FilterPill } from '../../types';
import { FieldModel } from '../../sql/fieldModel';

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
  const values = (t: Parameters<typeof operatorsFor>[0]) => operatorsFor(t).map((o) => o.value);
  it('numbers and times get ranges but no substring match', () => {
    for (const t of ['number', 'time'] as const) {
      expect(values(t)).toEqual(expect.arrayContaining(['gte', 'lt', 'between', 'not_between']));
      expect(values(t)).not.toContain('contains');
    }
  });
  it('strings get substring match but no ranges', () => {
    expect(values('string')).toEqual(expect.arrayContaining(['contains', 'not_contains', 'exists']));
    expect(values('string')).not.toContain('between');
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

  it('Cancel calls onCancel', () => {
    const { onCancel } = renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
