/**
 * "Schema" button next to the data view picker (R5-QUERYBAR): opens a modal listing the active
 * view's columns with their ClickHouse types. Reads the columns the field discovery already
 * fetched from system.columns (FieldsContext), so it costs no extra query.
 */
import React, { useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, Icon, Input, Modal, useStyles2 } from '@grafana/ui';
import { useFields } from './FieldsContext';
import { quoteIdentPart } from '../sql/queryBuilder';

export function SchemaButton() {
  const styles = useStyles2(getStyles);
  const { fields, loading } = useFields();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const columns = useMemo(
    () => fields.filter((f) => f.source === 'column' && f.rawType).map((f) => ({ name: f.name, type: f.rawType! })),
    [fields]
  );
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? columns.filter((c) => c.name.toLowerCase().includes(q) || c.type.toLowerCase().includes(q)) : columns;
  }, [columns, filter]);
  const close = () => {
    setOpen(false);
    setFilter('');
  };

  return (
    <>
      <Button
        size="md"
        variant="secondary"
        fill="outline"
        icon="database"
        aria-label="Show schema"
        tooltip="Show the data view's columns and their types"
        onClick={() => setOpen(true)}
      >
        Schema
      </Button>
      <Modal title="Schema" isOpen={open} onDismiss={close}>
        <Input
          prefix={<Icon name="search" />}
          placeholder="Filter columns"
          aria-label="Filter schema columns"
          value={filter}
          onChange={(e) => setFilter(e.currentTarget.value)}
        />
        <div className={styles.list} role="table" aria-label="Schema columns">
          <div className={styles.head} role="row">
            <span role="columnheader">Column</span>
            <span role="columnheader">Type</span>
          </div>
          {shown.map((c) => (
            <div key={c.name} className={styles.line} role="row">
              <span role="cell" className={styles.name} title={quoteIdentPart(c.name)}>
                {c.name}
              </span>
              <span role="cell" className={styles.type}>
                {c.type}
              </span>
            </div>
          ))}
          {shown.length === 0 && (
            <div className={styles.empty}>{loading ? 'Loading columns…' : 'No columns found.'}</div>
          )}
        </div>
      </Modal>
    </>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  list: css`
    margin-top: ${theme.spacing(1)};
    max-height: 60vh;
    overflow: auto;
  `,
  head: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr);
    gap: ${theme.spacing(2)};
    padding: ${theme.spacing(0.5)} 0;
    color: ${theme.colors.text.secondary};
    font-weight: ${theme.typography.fontWeightMedium};
    border-bottom: 1px solid ${theme.colors.border.weak};
    position: sticky;
    top: 0;
    background: ${theme.colors.background.primary};
  `,
  line: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr);
    gap: ${theme.spacing(2)};
    padding: ${theme.spacing(0.5)} 0;
    border-bottom: 1px solid ${theme.colors.border.weak};
  `,
  name: css`
    font-family: ${theme.typography.fontFamilyMonospace};
    overflow-wrap: anywhere;
  `,
  type: css`
    font-family: ${theme.typography.fontFamilyMonospace};
    color: ${theme.colors.text.secondary};
    overflow-wrap: anywhere;
  `,
  empty: css`
    padding: ${theme.spacing(2)} 0;
    color: ${theme.colors.text.secondary};
  `,
});
