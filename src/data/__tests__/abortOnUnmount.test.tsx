/**
 * R5-TABS: a stuck Discover tab must not stall the next one. Grafana's frontend runs at most 5
 * data queries at once (no HTTP/2) and queues the rest; an unsubscribed request leaves the queue.
 * The fake datasource below models exactly that, so the test fails if a tab's queries outlive it.
 */
import React, { useEffect, useRef } from 'react';
import { act, render } from '@testing-library/react';
import { Observable } from 'rxjs';
import { DataQueryResponse, LoadingState, TimeRange, dateTime } from '@grafana/data';
import { runQueryRows } from '../runQuery';
import { useAbortOnUnmount } from '../abortOnUnmount';

const MAX_IN_FLIGHT = 5;
let inFlight = 0;
const waiting: Array<() => void> = [];

function release() {
  while (inFlight < MAX_IN_FLIGHT && waiting.length) {
    waiting.shift()!();
  }
}

/** sql 'stuck' never answers; anything else answers as soon as it gets a slot. */
const mockQuery = jest.fn(
  (req: { targets: Array<{ rawSql: string }> }) =>
    new Observable<DataQueryResponse>((sub) => {
      let started = false;
      let done = false;
      const start = () => {
        started = true;
        inFlight++;
        if (req.targets[0].rawSql !== 'stuck') {
          done = true;
          inFlight--;
          sub.next({ data: [], state: LoadingState.Done });
          sub.complete();
          release();
        }
      };
      waiting.push(start);
      release();
      return () => {
        const i = waiting.indexOf(start);
        if (i >= 0) {
          waiting.splice(i, 1);
        }
        if (started && !done) {
          inFlight--;
          release();
        }
      };
    })
);

jest.mock('@grafana/runtime', () => ({
  getDataSourceSrv: () => ({ get: async () => ({ query: mockQuery }) }),
}));

const timeRange: TimeRange = {
  from: dateTime('2026-01-01T00:00:00Z'),
  to: dateTime('2026-01-01T01:00:00Z'),
  raw: { from: 'now-1h', to: 'now' },
};

/** A tab that fires `count` queries on mount, each on the latest controller like LogsExplorer. */
function Tab({ sql, count, onDone }: { sql: string; count: number; onDone?: () => void }) {
  const abortRef = useRef<AbortController | null>(null);
  const runRef = useRef(0);
  useAbortOnUnmount([abortRef], [runRef]);
  useEffect(() => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const runId = ++runRef.current;
    const all = Array.from({ length: count }, () =>
      runQueryRows({ datasourceUid: 'ds', sql, timeRange, op: 'logs', signal: ctrl.signal })
    );
    Promise.all(all).then(
      () => runRef.current === runId && onDone?.(),
      () => undefined
    );
  }, [sql, count, onDone]);
  return null;
}

const flush = () => act(async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
});

beforeEach(() => {
  inFlight = 0;
  waiting.length = 0;
  mockQuery.mockClear();
});

it('switching away from a stuck tab frees its query slots, so the next tab answers', async () => {
  const done = jest.fn();
  const { rerender } = render(<Tab key="a" sql="stuck" count={6} />);
  await flush();
  expect(inFlight).toBe(MAX_IN_FLIGHT);

  rerender(<Tab key="b" sql="SELECT 1" count={3} onDone={done} />);
  await flush();
  expect(done).toHaveBeenCalledTimes(1);
  expect(inFlight).toBe(0);
  expect(waiting).toHaveLength(0);
});

it('without the unmount abort the next tab would wait behind the stuck one (the bug)', async () => {
  const done = jest.fn();
  function Leaky({ sql, onDone }: { sql: string; onDone?: () => void }) {
    useEffect(() => {
      Promise.all(Array.from({ length: 5 }, () => runQueryRows({ datasourceUid: 'ds', sql, timeRange, op: 'logs' }))).then(
        () => onDone?.(),
        () => undefined
      );
    }, [sql, onDone]);
    return null;
  }
  const { rerender, unmount } = render(<Leaky key="a" sql="stuck" />);
  await flush();
  rerender(<Leaky key="b" sql="SELECT 1" onDone={done} />);
  await flush();
  expect(done).not.toHaveBeenCalled();
  expect(waiting).toHaveLength(5);
  unmount();
});

it('aborts the latest controller and bumps run ids on unmount only', () => {
  const ctrlRef: React.MutableRefObject<AbortController | null> = { current: new AbortController() };
  const idRef = { current: 3 };
  function Host() {
    useAbortOnUnmount([ctrlRef], [idRef]);
    return null;
  }
  const { rerender, unmount } = render(<Host />);
  rerender(<Host />);
  const first = ctrlRef.current!;
  expect(first.signal.aborted).toBe(false);
  const latest = new AbortController();
  ctrlRef.current = latest;
  unmount();
  expect(latest.signal.aborted).toBe(true);
  expect(first.signal.aborted).toBe(false);
  expect(idRef.current).toBe(4);
});
