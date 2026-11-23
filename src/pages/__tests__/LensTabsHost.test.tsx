import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { LENS_TABS } from '../../state/lensTabs';
import { LensTabsHost } from '../LensTabsHost';

// The real page is huge; the host only needs its tabStrip / onTitle / onLeave contract.
jest.mock('../../lens/LensPage', () => {
  const { useLocation: useLoc } = jest.requireActual('react-router-dom');
  return {
    LensPage: ({
      tabStrip,
      onTitle,
      onLeave,
    }: {
      tabStrip: React.ReactNode;
      onTitle: (t: string) => void;
      onLeave: () => void;
    }) => {
      const { search } = useLoc();
      return (
        <div>
          {tabStrip}
          <div data-testid="page">{new URLSearchParams(search).get('_tab')}</div>
          <button onClick={() => onTitle('Panel: CPU')}>set-title</button>
          <button onClick={() => onLeave()}>leave</button>
        </div>
      );
    },
  };
});

jest.mock('../../components/App/App', () => {
  const R = jest.requireActual('react');
  return { DataViewContext: R.createContext({ views: [{ id: 'v1' }, { id: 'v2' }] }) };
});

const probe = { search: '' };
function LocationProbe() {
  const { search } = useLocation();
  probe.search = search;
  return null;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/visualize"
          element={
            <>
              <LensTabsHost />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

const LENS = JSON.stringify({ chartType: 'bar', buckets: [], metrics: [{ kind: 'metric', id: 'm0', op: 'count' }] });
const lensParams = (extra = '') => `lens=${encodeURIComponent(LENS)}${extra}`;
const sp = () => new URLSearchParams(probe.search);
const stored = () => JSON.parse(window.sessionStorage.getItem(LENS_TABS.key) ?? 'null');
const seed = (tabs: Array<{ id: string; title: string; params: string }>, activeId: string) =>
  window.sessionStorage.setItem(LENS_TABS.key, JSON.stringify({ tabs, activeId, closed: [] }));

beforeEach(() => {
  window.sessionStorage.clear();
  probe.search = '';
});

it('a link into a fresh (chart-less) tab loads there and gets _tab', async () => {
  renderAt(`/visualize?${lensParams()}`);
  const id = (await screen.findByTestId('page')).textContent!;
  expect(sp().get('_tab')).toBe(id);
  expect(screen.getAllByRole('tab')).toHaveLength(1);
  expect(stored().tabs[0].params).toContain('lens=');
  expect(screen.getByRole('tablist', { name: 'Visualize tabs' })).toBeInTheDocument();
});

it('a link opens in a new tab when the active tab has a chart', async () => {
  seed([{ id: 'taaa0000', title: 'A', params: lensParams() }], 'taaa0000');
  renderAt('/visualize?q=other&from=now-1h&to=now');
  await screen.findByTestId('page');
  expect(screen.getAllByRole('tab')).toHaveLength(2);
  expect(sp().get('_tab')).not.toBe('taaa0000');
  expect(sp().get('q')).toBe('other');
  expect(stored().tabs[0].params).toContain('lens=');
});

it('a link opens in a new tab when the active tab holds a dashboard panel', async () => {
  seed([{ id: 'taaa0000', title: 'A', params: 'dash=d1&panel=3' }], 'taaa0000');
  renderAt(`/visualize?${lensParams()}`);
  await screen.findByTestId('page');
  expect(screen.getAllByRole('tab')).toHaveLength(2);
});

it('the side-menu entry reopens the active tab when it has a chart', async () => {
  seed(
    [
      { id: 'taaa0000', title: 'A', params: 'q=one&from=now-1h&to=now' },
      { id: 'tbbb0000', title: 'B', params: lensParams('&q=two') },
    ],
    'tbbb0000'
  );
  renderAt('/visualize');
  await screen.findByTestId('page');
  expect(sp().get('_tab')).toBe('tbbb0000');
  expect(sp().get('q')).toBe('two');
  expect(sp().has('lens')).toBe(true);
  expect(screen.getAllByRole('tab')).toHaveLength(2);
});

it('the side-menu entry on a chart-less tab follows the last search context, not the tab', async () => {
  seed([{ id: 'taaa0000', title: 'A', params: 'q=stale&from=now-1h&to=now' }], 'taaa0000');
  renderAt('/visualize');
  await screen.findByTestId('page');
  expect(sp().get('_tab')).toBe('taaa0000');
  expect(sp().has('q')).toBe(false);
  expect(screen.getAllByRole('tab')).toHaveLength(1);
});

it('an unknown _tab opens as a new tab', async () => {
  seed([{ id: 'taaa0000', title: 'A', params: lensParams() }], 'taaa0000');
  renderAt('/visualize?q=shared&_tab=tzzz9999');
  expect((await screen.findByTestId('page')).textContent).not.toBe('taaa0000');
  expect(screen.getAllByRole('tab')).toHaveLength(2);
});

it('onTitle renames an unnamed tab but keeps a name the user gave', async () => {
  renderAt(`/visualize?${lensParams()}`);
  await screen.findByTestId('page');
  await act(async () => fireEvent.click(screen.getByText('set-title')));
  expect(screen.getByRole('tab', { name: 'Panel: CPU' })).toBeInTheDocument();
  expect(stored().tabs[0].title).toBe('Panel: CPU');

  fireEvent.doubleClick(screen.getByRole('tab', { name: 'Panel: CPU' }));
  const input = screen.getByLabelText('Tab name');
  fireEvent.change(input, { target: { value: 'Mine' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await act(async () => fireEvent.click(screen.getByText('set-title')));
  expect(screen.getByRole('tab', { name: 'Mine' })).toBeInTheDocument();
});

it('onLeave closes the tab into Recently closed (storage only), leaving a fresh tab', async () => {
  renderAt(`/visualize?${lensParams('&dash=d1&panel=3')}`);
  const id = (await screen.findByTestId('page')).textContent!;
  await act(async () => fireEvent.click(screen.getByText('leave')));
  const s = stored();
  expect(s.closed.map((c: { tab: { id: string } }) => c.tab.id)).toEqual([id]);
  expect(s.tabs).toHaveLength(1);
  expect(s.tabs[0].id).not.toBe(id);
  expect(s.tabs[0].params).toBe('');
});

it('adding and closing tabs works on this strip too', async () => {
  renderAt(`/visualize?${lensParams()}`);
  await screen.findByTestId('page');
  await act(async () => fireEvent.click(screen.getByLabelText('New tab')));
  expect(screen.getAllByRole('tab')).toHaveLength(2);
  expect(sp().has('lens')).toBe(false);
  await act(async () => fireEvent.click(screen.getAllByLabelText(/^Close tab:/)[0]));
  expect(screen.getAllByRole('tab')).toHaveLength(1);
});
