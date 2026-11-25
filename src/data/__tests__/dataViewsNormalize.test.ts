import { loadPersonalViews, migrateLegacyConfig, savePersonalView } from '../dataViews';
import { loadPruneHint, savePruneHint } from '../pruneHints';
import { DEFAULT_SOURCE_CONFIG } from '../../types';

const KEY = 'poortuna-clickhouse-observe:data-views';

describe('views from any store have one shape', () => {
  beforeEach(() => localStorage.clear());

  it('fills missing columns, sets the origin and reads a text timeout', () => {
    const view = { id: 'a', name: 'a', columns: { timestamp: 'ts' }, queryTimeoutSeconds: '40' };
    const [v] = migrateLegacyConfig({ dataViews: [view] } as never);
    expect(v).toMatchObject({ origin: 'shared', queryTimeoutSeconds: 40, columns: { timestamp: 'ts', serviceName: '' } });
  });

  it('a malformed entry does not cost the other personal views', () => {
    localStorage.setItem(KEY, JSON.stringify([{ ...DEFAULT_SOURCE_CONFIG, id: 'a', name: 'a' }, null]));
    expect(loadPersonalViews().map((v) => v.id)).toEqual(['a']);
    savePersonalView({ ...DEFAULT_SOURCE_CONFIG, name: 'b' });
    expect(loadPersonalViews().map((v) => v.name)).toEqual(['a', 'b']);
  });
});

describe('prune hints', () => {
  it('round-trips, clears, and rejects anything but an identifier', () => {
    expect(loadPruneHint('k')).toBeUndefined();
    savePruneHint('k', { column: 'day', widenSeconds: 172800 });
    expect(loadPruneHint('k')).toEqual({ column: 'day', widenSeconds: 172800 });
    savePruneHint('k', null);
    expect(loadPruneHint('k')).toBeNull();
    savePruneHint('k', { column: '1=1 OR x', widenSeconds: 1 });
    expect(loadPruneHint('k')).toBeUndefined();
  });
});
