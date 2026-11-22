/**
 * R5-TABS: a page (or a Discover session tab) that goes away stops its queries.
 *
 * Grafana's frontend runs at most 5 `/api/ds/query` requests at once when the server has no HTTP/2
 * (`FetchQueueWorker` in Grafana's backend_srv) and queues the rest. A tab switch remounts Discover,
 * so a slow tab whose queries were left running kept those slots, and every query of the next tab
 * (or of Visualize) waited behind them. Aborting unsubscribes the request, which frees its slot
 * and drops the response instead of downloading and decoding rows nobody shows.
 */
import { MutableRefObject, useEffect, useRef } from 'react';

/**
 * On unmount: bumps every run id (so a late result or catch block is a no-op) and aborts every
 * controller's current request. The refs are read at unmount time, so the controllers of the
 * latest runs are the ones aborted.
 */
export function useAbortOnUnmount(
  controllers: Array<MutableRefObject<AbortController | null>>,
  runIds: Array<MutableRefObject<number>> = []
): void {
  // The lists are fixed for the component's life; keep the first ones.
  const lists = useRef({ controllers, runIds });
  useEffect(() => {
    const { controllers: cs, runIds: ids } = lists.current;
    return () => {
      for (const id of ids) {
        id.current++;
      }
      for (const c of cs) {
        c.current?.abort();
      }
    };
  }, []);
}
