import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { DimensionEditor } from '../DimensionEditor';
import { formulaSuggestions } from '../FormulaEditor';
import { LensField, MetricDim, RECORDS_FIELD } from '../state';

const fields: LensField[] = [
  RECORDS_FIELD,
  { id: 'sn', sqlExpr: 'SeverityNumber', label: 'SeverityNumber', type: 'number' },
  { id: 'st', sqlExpr: 'SeverityText', label: 'SeverityText', type: 'string' },
  { id: 'hs', sqlExpr: "LogAttributes['http-status']", label: 'LogAttributes.http-status', type: 'string' },
];

const median: MetricDim = {
  kind: 'metric',
  id: 'm1',
  op: 'median',
  field: 'SeverityNumber',
  fieldLabel: 'SeverityNumber',
  numeric: true,
};

function Harness({ initial, onChange }: { initial: MetricDim; onChange: (d: MetricDim) => void }) {
  const [dim, setDim] = useState(initial);
  return (
    <DimensionEditor
      dim={dim}
      group="Vertical axis"
      fields={fields}
      onChange={(d) => {
        setDim(d as MetricDim);
        onChange(d as MetricDim);
      }}
      onRemove={() => {}}
      onClose={() => {}}
    />
  );
}

const formulaBox = () => screen.getByRole('textbox', { name: 'Formula' }) as HTMLTextAreaElement;

describe('Formula editor (LENS-DIM-03)', () => {
  beforeAll(() => {
    // jsdom has no canvas; the Combobox measures text with it.
    HTMLCanvasElement.prototype.getContext = (() => ({ measureText: () => ({ width: 10 }), font: '' })) as never;
  });

  it('switching to Formula converts the quick function', () => {
    const onChange = jest.fn();
    render(<Harness initial={median} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Formula', { selector: 'input' }));
    expect(onChange).toHaveBeenLastCalledWith({
      kind: 'metric',
      id: 'm1',
      op: 'formula',
      formula: 'median(SeverityNumber)',
      formulaFields: { SeverityNumber: { expr: 'SeverityNumber', numeric: true } },
      name: undefined,
    });
    expect(formulaBox().value).toBe('median(SeverityNumber)');
  });

  it('a valid formula is applied on blur, keeping only the fields it uses', () => {
    const onChange = jest.fn();
    render(<Harness initial={{ kind: 'metric', id: 'm0', op: 'formula', formula: 'count()', formulaFields: {} }} onChange={onChange} />);
    fireEvent.change(formulaBox(), { target: { value: "count(kql='SeverityText : ERROR') / count()" } });
    fireEvent.blur(formulaBox());
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ op: 'formula', formula: "count(kql='SeverityText : ERROR') / count()", formulaFields: {} })
    );
  });

  it('an invalid formula shows the error badge and is not applied', () => {
    const onChange = jest.fn();
    render(<Harness initial={{ kind: 'metric', id: 'm0', op: 'formula', formula: 'count()', formulaFields: {} }} onChange={onChange} />);
    fireEvent.change(formulaBox(), { target: { value: 'sum(SeverityText) + nope()' } });
    expect(screen.getByRole('status')).toHaveTextContent('⚠ 2 errors');
    expect(screen.getByText(/needs a number field/)).toBeInTheDocument();
    expect(screen.getByText('Unknown function nope')).toBeInTheDocument();
    fireEvent.blur(formulaBox());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('typing a prefix lists functions with their signature; Enter inserts with brackets closed', () => {
    render(<Harness initial={{ kind: 'metric', id: 'm0', op: 'formula', formula: '', formulaFields: {} }} onChange={() => {}} />);
    const box = formulaBox();
    fireEvent.change(box, { target: { value: 'cou', selectionStart: 3 } });
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveTextContent('count([field: field]?, [kql=string]?)');
    expect(options[0]).toHaveTextContent('The total number of documents');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(box.value).toBe('count()');
  });

  it('typing "(" auto-closes the bracket', () => {
    render(<Harness initial={{ kind: 'metric', id: 'm0', op: 'formula', formula: 'sum', formulaFields: {} }} onChange={() => {}} />);
    const box = formulaBox();
    box.setSelectionRange(3, 3);
    fireEvent.keyDown(box, { key: '(' });
    expect(box.value).toBe('sum()');
  });

  it('the function reference lists every function', () => {
    render(<Harness initial={{ kind: 'metric', id: 'm0', op: 'formula', formula: 'count()', formulaFields: {} }} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Function reference' }));
    expect(screen.getByRole('region', { name: 'Function reference' })).toHaveTextContent(
      'percentile(field: field, [percentile=number]?, [kql=string]?)'
    );
  });

  it('back to Quick function gives Count of records', () => {
    const onChange = jest.fn();
    render(<Harness initial={{ kind: 'metric', id: 'm0', op: 'formula', formula: 'count()', formulaFields: {} }} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Quick function', { selector: 'input' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ op: 'count' }));
  });
});

describe('formulaSuggestions', () => {
  const names = fields.slice(1).map((f) => f.label);
  it('suggests fields inside a function, backticking names that need it', () => {
    const s = formulaSuggestions('unique_count(http', 17, names);
    expect(s).toEqual([expect.objectContaining({ kind: 'field', insert: '`LogAttributes.http-status`' })]);
  });
  it('nothing inside a KQL string', () => {
    expect(formulaSuggestions("count(kql='Sev", 14, names)).toEqual([]);
  });
});
