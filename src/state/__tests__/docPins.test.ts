import { loadDocPins, saveDocPins } from '../docPins';

describe('DISC-DOC-01 pinned detail fields', () => {
  beforeEach(() => sessionStorage.clear());

  it('keeps pins per table, in pin order', () => {
    saveDocPins('default.spec_logs', ['ServiceName', 'SeverityText']);
    saveDocPins('default.otel_logs', ['Body']);
    expect(loadDocPins('default.spec_logs')).toEqual(['ServiceName', 'SeverityText']);
    expect(loadDocPins('default.otel_logs')).toEqual(['Body']);
    expect(loadDocPins('other.table')).toEqual([]);
  });

  it('ignores the old global list format and corrupt storage', () => {
    sessionStorage.setItem('clickhouse-observe.pinnedDocFields', '["ServiceName"]');
    expect(loadDocPins('default.spec_logs')).toEqual([]);
    sessionStorage.setItem('clickhouse-observe.pinnedDocFields', 'nope');
    expect(loadDocPins('default.spec_logs')).toEqual([]);
  });
});
