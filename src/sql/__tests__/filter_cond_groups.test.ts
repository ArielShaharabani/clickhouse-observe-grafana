/**
 * R2-FILTER-GROUPS: compound filter pills (conditions combined with OR / AND, nested groups):
 * SQL compile + escaping, sanitize, URL round-trip, labels, tree operations.
 */

import { dateTime } from '@grafana/data';
import { buildWhereConditions } from '../queryBuilder';
import {
  addCondition,
  canAddCondition,
  filterLabel,
  negateFilter,
  removeCondition,
  sanitizeFilterPills,
  samePill,
  soleCondition,
  TreeGroup,
} from '../filters';
import { encodeLogsState, decodeLogsState } from '../../data/urlState';
import { FilterPill, OTEL_COLUMN_MAPPING, DEFAULT_LOGS_QUERY_STATE, SourceConfig } from '../../types';

const config: SourceConfig = {
  datasourceUid: 'test',
  database: 'default',
  logsTable: 'otel_logs',
  isOtel: true,
  columns: { ...OTEL_COLUMN_MAPPING, partitionTimestamp: '-' },
};

const compound = (extra: Partial<FilterPill> = {}): FilterPill => ({
  id: 'p1',
  field: '',
  op: '=',
  value: '',
  cond: {
    join: 'or',
    items: [
      { field: 'ServiceName', op: '=', value: 'payments' },
      { field: 'host.name', op: '=', value: 'node-7' },
    ],
  },
  ...extra,
});

function where(...filters: FilterPill[]): string[] {
  // [0] is the time range; the rest are filter conditions
  return buildWhereConditions(config, { ...DEFAULT_LOGS_QUERY_STATE, filters }).slice(1);
}

describe('compound pill SQL', () => {
  it('OR of two conditions is one parenthesised condition', () => {
    const conds = where(compound());
    expect(conds).toHaveLength(1);
    expect(conds[0]).toMatch(/^\(\(.+\) OR \(.+\)\)$/);
    expect(conds[0]).toContain("'payments'");
    expect(conds[0]).toContain("'node-7'");
  });

  it('AND of ORs nests with parentheses', () => {
    const p = compound({
      cond: {
        join: 'and',
        items: [
          {
            join: 'or',
            items: [
              { field: 'ServiceName', op: '=', value: 'a' },
              { field: 'ServiceName', op: '=', value: 'b' },
            ],
          },
          { field: 'SeverityText', op: '=', value: 'ERROR' },
        ],
      },
    });
    const [c] = where(p);
    expect(c.startsWith('((')).toBe(true);
    expect(c.split(' OR ')).toHaveLength(2);
    expect(c.split(' AND ')).toHaveLength(2);
    // the OR group is closed before the AND
    expect(c.indexOf(' OR ')).toBeLessThan(c.indexOf(' AND '));
  });

  it('negate wraps the whole pill in NOT ( ... )', () => {
    const [c] = where(negateFilter(compound()));
    expect(c.startsWith('NOT (')).toBe(true);
    expect(c.endsWith(')')).toBe(true);
    expect(negateFilter(negateFilter(compound())).negate).toBe(false);
  });

  it('disabled compound pill adds nothing', () => {
    expect(where(compound({ disabled: true }))).toEqual([]);
  });

  it('compound pill participates in a pill-level OR group', () => {
    const plain: FilterPill = { id: 'p2', field: 'SeverityText', op: '=', value: 'ERROR', group: 'g1', groupOp: 'or' };
    const conds = where(compound({ group: 'g1', groupOp: 'or' }), plain);
    expect(conds).toHaveLength(1);
    expect(conds[0]).toContain("'ERROR'");
    expect(conds[0]).toContain("'payments'");
  });

  it('escapes injection attempts in values inside groups', () => {
    const evil = "x' OR 1=1; DROP TABLE t --";
    const [c] = where(
      compound({
        cond: {
          join: 'or',
          items: [
            { field: 'ServiceName', op: '=', value: evil },
            { field: 'ServiceName', op: 'one_of', value: '', values: [evil] },
            { join: 'and', items: [{ field: 'ServiceName', op: 'contains', value: evil }, { field: 'x', op: '=', value: '1' }] },
          ],
        },
      })
    );
    // every quote inside a value is escaped, so the payload never closes the literal
    expect(c).not.toContain("'x' OR 1=1");
    expect(c.match(/x\\' OR 1=1/g)).toHaveLength(3);
  });

  it('quotes hostile field names inside groups as identifiers', () => {
    const [c] = where(
      compound({
        cond: {
          join: 'and',
          items: [
            { field: 'a" OR 1=1 --', op: '=', value: 'v' },
            { field: 'b" ; DROP TABLE t', op: 'exists', value: '' },
          ],
        },
      })
    );
    // the double quote inside the identifier is escaped, so it never closes the quoted name
    expect(c).toContain('"a\\" OR 1=1 --"');
    expect(c).toContain('"b\\" ; DROP TABLE t"');
  });
});

describe('compound pill sanitize and URL', () => {
  it('round-trips through the URL', () => {
    const pills: FilterPill[] = [compound({ negate: true }), { id: 'p2', field: 'a', op: '=', value: 'b' }];
    const sp = encodeLogsState({
      search: '',
      filters: pills,
      columns: [],
      timeRange: { from: dateTime(0), to: dateTime(1000), raw: { from: 'now-1h', to: 'now' } },
    });
    const back = decodeLogsState(sp).filters!;
    expect(back).toHaveLength(2);
    expect(back[0].cond).toEqual(pills[0].cond);
    expect(back[0].negate).toBe(true);
    expect(back[1].cond).toBeUndefined();
    expect(back[1].field).toBe('a');
  });

  it('old single-condition URLs are unchanged', () => {
    const sp = new URLSearchParams({ filters: JSON.stringify([{ id: 'x', field: 'a', op: '!=', value: 'b' }]) });
    expect(decodeLogsState(sp).filters).toEqual([{ id: 'x', field: 'a', op: '!=', value: 'b' }]);
  });

  it('drops pills with a malformed condition tree', () => {
    const base = { field: '', op: '=', value: '' };
    const bad: unknown[] = [
      { id: 'a', ...base, cond: 'x' },
      { id: 'b', ...base, cond: { join: 'xor', items: [{ field: 'a', op: '=', value: '1' }] } },
      { id: 'c', ...base, cond: { join: 'or', items: [] } },
      { id: 'd', ...base, cond: { join: 'or', items: [{ field: 'a', op: 'DROP', value: '1' }] } },
      { id: 'e', ...base, cond: { join: 'or', items: [{ field: 5, op: '=', value: '1' }] } },
      { id: 'f', ...base, cond: { join: 'or', items: [{ field: 'a', op: '=', value: 1 }] } },
      { id: 'g', ...base, cond: { join: 'or', items: [null] } },
    ];
    expect(sanitizeFilterPills(bad)).toEqual([]);
  });

  it('caps depth and size', () => {
    const base = { field: '', op: '=', value: '' };
    let deep: unknown = { join: 'or', items: [{ field: 'a', op: '=', value: '1' }] };
    for (let i = 0; i < 4; i++) {
      deep = { join: i % 2 ? 'or' : 'and', items: [deep] };
    }
    expect(sanitizeFilterPills([{ id: 'd', ...base, cond: deep }])).toEqual([]);
    const many = { join: 'or', items: Array.from({ length: 21 }, () => ({ field: 'a', op: '=', value: '1' })) };
    expect(sanitizeFilterPills([{ id: 'm', ...base, cond: many }])).toEqual([]);
  });

  it('strips unknown keys from conditions and ignores negate on plain pills', () => {
    const [p] = sanitizeFilterPills([
      {
        id: 'a',
        field: '',
        op: '=',
        value: '',
        negate: true,
        cond: { join: 'or', x: 1, items: [{ field: 'a', op: '=', value: '1', evil: 1 }] },
      },
    ]);
    expect(p.negate).toBe(true);
    expect(p.cond).toEqual({ join: 'or', items: [{ field: 'a', op: '=', value: '1' }] });
    const [q] = sanitizeFilterPills([{ id: 'b', field: 'a', op: '=', value: '1', negate: true }]);
    expect(q.negate).toBeUndefined();
  });
});

describe('compound pill labels and identity', () => {
  it('joins condition labels with OR / AND', () => {
    expect(filterLabel(compound())).toBe('ServiceName = payments OR host.name = node-7');
  });

  it('puts nested groups in parentheses and prefixes negation', () => {
    const p = compound({
      negate: true,
      cond: {
        join: 'and',
        items: [
          { field: 'a', op: '=', value: '1' },
          {
            join: 'or',
            items: [
              { field: 'b', op: 'exists', value: '' },
              { field: 'c', op: 'one_of', value: '', values: ['x', 'y'] },
            ],
          },
        ],
      },
    });
    expect(filterLabel(p)).toBe('NOT (a = 1 AND (b exists OR c is one of [x, y]))');
  });

  it('a custom label wins', () => {
    expect(filterLabel(compound({ label: 'mine' }))).toBe('mine');
  });

  it('samePill distinguishes compound pills', () => {
    expect(samePill(compound(), compound())).toBe(true);
    expect(samePill(compound(), compound({ negate: true }))).toBe(false);
    expect(samePill(compound(), { field: '', op: '=', value: '' })).toBe(false);
  });
});

describe('condition tree operations', () => {
  type L = { n: string };
  const leaf = (n: string): L => ({ n });
  const one: TreeGroup<L> = { join: 'and', items: [leaf('a')] };

  it('adding to a single-item group adopts the join', () => {
    expect(addCondition(one, [0], 'or', leaf('b'))).toEqual({ join: 'or', items: [leaf('a'), leaf('b')] });
  });

  it('same join appends after the row, different join nests it', () => {
    const t = addCondition(one, [0], 'or', leaf('b'));
    expect(addCondition(t, [0], 'or', leaf('c')).items).toEqual([leaf('a'), leaf('c'), leaf('b')]);
    expect(addCondition(t, [1], 'and', leaf('c'))).toEqual({
      join: 'or',
      items: [leaf('a'), { join: 'and', items: [leaf('b'), leaf('c')] }],
    });
  });

  it('respects the depth cap', () => {
    let t = addCondition(one, [0], 'or', leaf('b'));
    t = addCondition(t, [1], 'and', leaf('c')); // depth 2
    t = addCondition(t, [1, 1], 'or', leaf('d')); // depth 3
    expect(canAddCondition(t, [1, 1, 1], 'and')).toBe(false);
    expect(addCondition(t, [1, 1, 1], 'and', leaf('e'))).toBe(t);
  });

  it('removing collapses single-item groups and keeps the last row', () => {
    const t = addCondition(addCondition(one, [0], 'or', leaf('b')), [1], 'and', leaf('c'));
    expect(removeCondition(t, [1, 0])).toEqual({ join: 'or', items: [leaf('a'), leaf('c')] });
    expect(removeCondition(one, [0])).toBe(one);
    expect(soleCondition(one)).toEqual(leaf('a'));
    expect(soleCondition(t)).toBeNull();
  });
});
