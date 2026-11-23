import { filtersForDiscoverSwitch } from '../sharedSearch';
import { sanitizeFilterPills, toggleDisabled } from '../../sql/filters';
import { FilterPill } from '../../types';

const pill = (o: Partial<FilterPill> = {}): FilterPill => ({ id: 'a', field: 'S', op: '=', value: 'x', ...o });
const sw = (f: FilterPill[], from: string, to: string) => filtersForDiscoverSwitch(f, [], from, to, `db.${to}`);

describe('filtersForDiscoverSwitch', () => {
  it('keeps a pill disabled on every other view and applies it again on its own', () => {
    const b = sw([pill()], 'A', 'B');
    expect(b).toEqual([pill({ disabled: true, homeView: 'A' })]);
    const c = sw(b, 'B', 'C');
    expect(c).toEqual(b);
    expect(sw(c, 'C', 'A')).toEqual([pill()]);
  });
  it('a pill the user disabled stays disabled', () => {
    const b = sw([pill({ disabled: true })], 'A', 'B');
    expect(sw(b, 'B', 'A')).toEqual([pill({ disabled: true })]);
  });
  it('a pill the user re-enabled on the new view belongs to that view', () => {
    const b = toggleDisabled(sw([pill()], 'A', 'B'), 'a');
    expect(b).toEqual([pill({ disabled: false })]);
    expect(sw(b, 'B', 'A')).toEqual([pill({ disabled: true, homeView: 'B' })]);
  });
  it('a pinned pill follows its table', () => {
    const pin = { ...pill({ pinned: true }), pinnedTable: 'db.A' };
    expect(filtersForDiscoverSwitch([pill({ pinned: true })], [pin], 'A', 'B', 'db.B')[0].disabled).toBe(true);
    const back = filtersForDiscoverSwitch([pill({ pinned: true, disabled: true })], [pin], 'B', 'A', 'db.A');
    expect(back).toEqual([pill({ pinned: true })]);
  });
  it('homeView from a link is validated', () => {
    expect(sanitizeFilterPills([pill({ homeView: 5 as never })])[0]).not.toHaveProperty('homeView');
    expect(sanitizeFilterPills([pill({ homeView: 'v' })])[0].homeView).toBe('v');
  });
});
