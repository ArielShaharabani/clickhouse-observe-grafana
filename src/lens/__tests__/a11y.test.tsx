/**
 * SHARED-A11Y-01 on Visualize: keyboard drag and drop with spoken instructions, legend ⋮ menu
 * keyboard, dimension editor Escape.
 */
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import {
  cancelMessage,
  DND_INSTRUCTIONS,
  DropTarget,
  dropMessage,
  liftMessage,
  overMessage,
  stepTarget,
  useKeyboardDrag,
} from '../keyboardDnd';
import { XyChart } from '../render/XyChart';
import { DimensionEditor } from '../DimensionEditor';
import { LensResult } from '../compile';
import { MetricDim } from '../state';
import { LiveRegion } from '../../components/a11y/dialog';

jest.mock('@grafana/runtime', () => ({ ...jest.requireActual('@grafana/runtime'), PanelRenderer: () => null }));

interface Item {
  id: string;
  label: string;
}

function DragHarness({ targets }: { targets: DropTarget[] }) {
  const kb = useKeyboardDrag<Item>(
    () => targets,
    (f) => f.label,
    (f) => f.id
  );
  const item = { id: 'f1', label: 'ServiceName' };
  return (
    <>
      <span id="help">{DND_INSTRUCTIONS}</span>
      <button
        type="button"
        aria-label="Drag ServiceName"
        aria-describedby="help"
        aria-pressed={kb.isLifted(item)}
        onKeyDown={kb.onKeyDown(item)}
        onBlur={kb.onBlur(item)}
      />
      <div data-testid="active">{kb.activeTargetId ?? ''}</div>
      <LiveRegion message={kb.message} />
    </>
  );
}

describe('keyboard drag and drop', () => {
  const mk = () => {
    const workspace = jest.fn();
    const xAxis = jest.fn();
    const targets: DropTarget[] = [
      { id: 'workspace', label: 'the workspace', drop: workspace },
      { id: 'group:Horizontal axis', label: 'Horizontal axis', drop: xAxis },
    ];
    render(<DragHarness targets={targets} />);
    const handle = screen.getByRole('button', { name: 'Drag ServiceName' });
    const live = () => screen.getByRole('status').textContent;
    return { targets, workspace, xAxis, handle, live };
  };

  it('Space lifts, arrows move between targets, Enter drops; every step is spoken', () => {
    const { targets, xAxis, workspace, handle, live } = mk();
    expect(handle).toHaveAccessibleDescription(DND_INSTRUCTIONS);
    fireEvent.keyDown(handle, { key: ' ' });
    expect(handle).toHaveAttribute('aria-pressed', 'true');
    expect(live()).toBe(liftMessage('ServiceName', targets[0], 2));
    expect(live()).toContain('Lifted ServiceName. 2 drop targets. Over the workspace.');
    expect(screen.getByTestId('active').textContent).toBe('workspace');
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(live()).toBe(overMessage('ServiceName', targets[1]));
    expect(screen.getByTestId('active').textContent).toBe('group:Horizontal axis');
    fireEvent.keyDown(handle, { key: 'Enter' });
    expect(xAxis).toHaveBeenCalledTimes(1);
    expect(workspace).not.toHaveBeenCalled();
    expect(live()).toBe('Dropped ServiceName on Horizontal axis.');
    expect(handle).toHaveAttribute('aria-pressed', 'false');
  });

  it('Escape cancels without dropping and does not reach the page', () => {
    const { workspace, xAxis, handle, live } = mk();
    const onDocKey = jest.fn();
    document.addEventListener('keydown', onDocKey);
    fireEvent.keyDown(handle, { key: 'Enter' });
    fireEvent.keyDown(handle, { key: 'Escape' });
    document.removeEventListener('keydown', onDocKey);
    expect(onDocKey).toHaveBeenCalledTimes(1); // only the lifting Enter
    expect(live()).toBe(cancelMessage('ServiceName'));
    expect(workspace).not.toHaveBeenCalled();
    expect(xAxis).not.toHaveBeenCalled();
  });

  it('leaving the handle cancels', () => {
    const { handle, live } = mk();
    fireEvent.keyDown(handle, { key: ' ' });
    fireEvent.blur(handle);
    expect(live()).toBe('Cancelled dragging ServiceName.');
    expect(screen.getByTestId('active').textContent).toBe('');
  });

  it('messages and stepping', () => {
    const t = { id: 'w', label: 'the workspace', drop: () => {} };
    expect(liftMessage('A', undefined, 0)).toBe('A cannot be dropped anywhere right now.');
    expect(liftMessage('A', t, 1)).toContain('1 drop target.');
    expect(dropMessage('A', t)).toBe('Dropped A on the workspace.');
    expect(stepTarget(0, 3, 'ArrowUp')).toBe(2);
    expect(stepTarget(2, 3, 'ArrowRight')).toBe(0);
    expect(stepTarget(0, 3, 'a')).toBeNull();
    expect(stepTarget(0, 0, 'ArrowDown')).toBeNull();
  });
});

describe('legend actions menu', () => {
  beforeAll(() => {
    (global as any).ResizeObserver = class {
      cb: any;
      constructor(cb: any) {
        this.cb = cb;
      }
      observe() {
        this.cb([{ contentRect: { width: 600, height: 300 } }]);
      }
      disconnect() {}
    };
  });
  const result: LensResult = {
    xs: ['a'],
    xLabels: ['a'],
    xSynthetic: [false],
    xIsTime: false,
    series: [
      { name: 'payments', breakdown: 'payments', points: new Map([['a', 1]]), metricIndex: 0, zeroFill: true },
      { name: 'auth', breakdown: 'auth', points: new Map([['a', 2]]), metricIndex: 0, zeroFill: true },
    ],
    table: { columns: [], rows: [] },
  } as LensResult;

  it('focus starts on Filter for, arrows move, Escape closes and returns to the ⋮ button', () => {
    const onLegendFilter = jest.fn();
    render(<XyChart chartType="bar" result={result} onLegendFilter={onLegendFilter} />);
    const more = screen.getByRole('button', { name: 'Legend actions for payments' });
    expect(more).toHaveAttribute('aria-haspopup', 'menu');
    act(() => more.focus());
    fireEvent.click(more);
    const menu = screen.getByRole('menu', { name: 'Actions for payments' });
    const [forItem, outItem] = within(menu).getAllByRole('menuitem');
    expect(forItem).toHaveFocus();
    fireEvent.keyDown(forItem, { key: 'ArrowDown' });
    expect(outItem).toHaveFocus();
    fireEvent.keyDown(outItem, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(more).toHaveFocus();
    expect(onLegendFilter).not.toHaveBeenCalled();
  });
});

describe('dimension editor', () => {
  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = (() => ({ measureText: () => ({ width: 10 }), font: '' })) as never;
  });
  const count: MetricDim = { kind: 'metric', id: 'm0', op: 'count' };

  it('is a dialog with the hint; Escape inside closes it and focus goes to the dimension button', () => {
    const onClose = jest.fn();
    const back = document.createElement('button');
    document.body.appendChild(back);
    const { unmount } = render(
      <DimensionEditor
        dim={count}
        group="Vertical axis"
        fields={[]}
        onChange={jest.fn()}
        onRemove={jest.fn()}
        onClose={onClose}
        returnFocus={() => back}
      />
    );
    const dialog = screen.getByRole('dialog', { name: 'Edit Vertical axis' });
    expect(dialog).toHaveAccessibleDescription(/You are in a dialog/);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    // Escape on the page (e.g. from another popover) does not close the inline editor.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    dialog.focus();
    unmount();
    expect(back).toHaveFocus();
    back.remove();
  });
});
