/**
 * The short note under the Visualize toolbar after a panel was converted (R6-PANELS): which panel it
 * is, that part of it was not carried over (details are in the dialog the save actions open), and a
 * read-only, copyable view of the panel's original query. Nothing here saves or changes anything.
 */
import React, { useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Alert, Button, ClipboardButton, Modal, Spinner, useStyles2 } from '@grafana/ui';
import { PanelImportState } from './usePanelImport';

export function PanelImportNote({ state }: { state: PanelImportState }) {
  const styles = useStyles2(getStyles);
  const [open, setOpen] = useState(false);
  if (state.error) {
    return (
      <Alert severity="warning" title="Could not open the panel" className={styles.note} data-testid="panel-import-error">
        {state.error}
      </Alert>
    );
  }
  if (state.pending && !state.imported) {
    return (
      <div className={styles.note}>
        <Spinner size="sm" inline /> Reading the panel…
      </div>
    );
  }
  const r = state.imported;
  if (!r || r.kind === 'ok') {
    return null;
  }
  const lossy = r.kind === 'partial';
  return (
    <div className={styles.note} data-testid="panel-import-note">
      <span>
        {r.kind === 'unsupported'
          ? `Opened “${r.title || 'panel'}” without a chart: ${r.reason ?? 'it cannot be converted'}.`
          : lossy
            ? `Opened “${r.title || 'panel'}”. ${r.notes.length} setting${r.notes.length === 1 ? '' : 's'} could not be carried over.`
            : `Opened “${r.title || 'panel'}”.`}
      </span>
      {r.originalQuery && (
        <Button size="sm" variant="secondary" fill="text" icon="eye" onClick={() => setOpen(true)}>
          View original query
        </Button>
      )}
      <Modal title="Original query" isOpen={open} onDismiss={() => setOpen(false)}>
        <pre className={styles.query} aria-label="Original query" tabIndex={0}>
          {r.originalQuery}
        </pre>
        <Modal.ButtonRow>
          <ClipboardButton getText={() => r.originalQuery} icon="copy" variant="secondary">
            Copy
          </ClipboardButton>
          <Button variant="primary" onClick={() => setOpen(false)}>
            Close
          </Button>
        </Modal.ButtonRow>
      </Modal>
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  note: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
    flex-wrap: wrap;
    margin: ${theme.spacing(0.5, 0)};
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  query: css`
    max-height: 50vh;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    padding: ${theme.spacing(1)};
    background: ${theme.colors.background.secondary};
    border-radius: ${theme.shape.radius.default};
    font-family: ${theme.typography.fontFamilyMonospace};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
});
