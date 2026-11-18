import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { DISCOVER_TABS_KEY } from '../../state/discoverTabs';
import { DiscoverTabsHost } from '../DiscoverTabsHost';

// The real page is huge; the host only needs its tabId / tabStrip contract.
jest.mock('../LogsExplorer', () => ({
  LogsExplorer: ({ tabId, tabStrip }: { tabId: string; tabStrip: React.ReactNode }) => (
    <div>
      {tabStrip}
      <div data-testid="explorer">{tabId}</div>
    </div>
  ),
}));

jest.mock('../../components/App/App', () => {
  const R = jest.requireActual('react');
  return { DataViewContext: R.createContext({ views: [{ id: 'v1' }, { id: 'v2' }] }) };
});

const probe = { search: '' };
function LocationProbe({ onChange }: { onChange: (search: string) => void }) {
  const { search } = useLocation();
  React.useEffect(() => onChange(search), [search, onChange]);
  return null;
}
const recordSearch = (search: string) => {
  probe.search = search;
};

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/logs"
          element={
            <>
              <DiscoverTabsHost />
              <LocationProbe onChange={recordSearch} />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

const sp = () => new URLSearchParams(probe.search);
const stored = () => JSON.parse(window.sessionStorage.getItem(DISCOVER_TABS_KEY) ?? 'null');

beforeEach(() => {
  window.sessionStorage.clear();
  probe.search = '';
});

it('a link without _tab loads into the (first) tab and gets _tab', async () => {
  renderAt('/logs?q=errors&from=now-1h&to=now&ds=v1');
  const id = (await screen.findByTestId('explorer')).textContent!;
  expect(sp().get('_tab')).toBe(id);
  expect(sp().get('q')).toBe('errors');
  expect(stored().tabs[0].params).toContain('q=errors');
});

it('the side-menu entry (no params) reopens the active tab', async () => {
  window.sessionStorage.setItem(
    DISCOVER_TABS_KEY,
    JSON.stringify({
      tabs: [
        { id: 'taaa0000', title: 'A', params: 'q=one&from=now-1h&to=now' },
        { id: 'tbbb0000', title: 'B', params: 'q=two&from=now-1h&to=now' },
      ],
      activeId: 'tbbb0000',
      closed: [],
    })
  );
  renderAt('/logs');
  expect((await screen.findByTestId('explorer')).textContent).toBe('tbbb0000');
  expect(sp().get('q')).toBe('two');
  expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['A', 'B']);
});

it('an unknown _tab opens as a new tab', async () => {
  window.sessionStorage.setItem(
    DISCOVER_TABS_KEY,
    JSON.stringify({ tabs: [{ id: 'taaa0000', title: 'A', params: 'q=one&from=now-1h&to=now' }], activeId: 'taaa0000' })
  );
  renderAt('/logs?q=shared&from=now-1h&to=now&_tab=tzzz9999');
  const id = (await screen.findByTestId('explorer')).textContent!;
  expect(id).not.toBe('taaa0000');
  expect(sp().get('q')).toBe('shared');
  expect(screen.getAllByRole('tab')).toHaveLength(2);
});

it('switching, adding and closing tabs keep each tab’s own state', async () => {
  renderAt('/logs?q=first&from=now-1h&to=now&ds=v2');
  const first = (await screen.findByTestId('explorer')).textContent!;

  // + opens a new tab that keeps only the data view.
  await act(async () => fireEvent.click(screen.getByLabelText('New tab')));
  const second = screen.getByTestId('explorer').textContent!;
  expect(second).not.toBe(first);
  expect(sp().get('ds')).toBe('v2');
  expect(sp().has('q')).toBe(false);

  // Back to the first tab: its query comes back.
  await act(async () => fireEvent.click(screen.getByRole('tab', { name: 'Untitled' })));
  expect(screen.getByTestId('explorer').textContent).toBe(first);
  expect(sp().get('q')).toBe('first');

  // Close it: the other tab becomes active and the closed one is remembered.
  await act(async () => fireEvent.click(screen.getByLabelText('Close tab: Untitled')));
  expect(screen.getByTestId('explorer').textContent).toBe(second);
  expect(stored().closed[0].tab.id).toBe(first);
  expect(screen.getAllByRole('tab')).toHaveLength(1);
  expect(screen.queryByLabelText(/^Close tab:/)).toBeNull();
});

it('rename via double-click; Escape cancels, Enter commits', async () => {
  renderAt('/logs?q=x&from=now-1h&to=now');
  await screen.findByTestId('explorer');
  fireEvent.doubleClick(screen.getByRole('tab', { name: 'Untitled' }));
  const input = screen.getByLabelText('Tab name');
  fireEvent.change(input, { target: { value: 'ignored' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.getByRole('tab', { name: 'Untitled' })).toBeInTheDocument();

  fireEvent.doubleClick(screen.getByRole('tab', { name: 'Untitled' }));
  const input2 = screen.getByLabelText('Tab name');
  fireEvent.change(input2, { target: { value: 'Checkout errors' } });
  fireEvent.keyDown(input2, { key: 'Enter' });
  expect(screen.getByRole('tab', { name: 'Checkout errors' })).toBeInTheDocument();
  expect(stored().tabs[0].title).toBe('Checkout errors');
});

it('tampered storage is sanitized before it reaches the URL', async () => {
  window.sessionStorage.setItem(
    DISCOVER_TABS_KEY,
    JSON.stringify({
      tabs: [
        { id: 'taaa0000', title: '<img src=x onerror=alert(1)>', params: 'q=ok&from=now-1h&to=now&ds=evil&extra=1' },
      ],
      activeId: 'taaa0000',
    })
  );
  renderAt('/logs');
  await screen.findByTestId('explorer');
  expect(sp().get('q')).toBe('ok');
  expect(sp().has('ds')).toBe(false);
  expect(sp().has('extra')).toBe(false);
  // Rendered as text, not markup.
  expect(screen.getByRole('tab').textContent).toBe('<img src=x onerror=alert(1)>');
  expect(document.querySelector('img')).toBeNull();
});
