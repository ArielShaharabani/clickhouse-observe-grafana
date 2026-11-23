/**
 * Configuration: add the "Edit in Visualize" link to the ClickHouse panels of existing dashboards
 * (data/editLinks.ts). Looking for panels changes nothing; only the ticked dashboards are saved.
 */
import React, { useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Alert, Button, Checkbox, FieldSet, useStyles2 } from '@grafana/ui';
import { applyEditLinks, LinkScan, scanEditLinks } from '../../data/editLinks';
import { errMsg } from '../../errMsg';

export function EditLinksSection() {
  const styles = useStyles2(getStyles);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [found, setFound] = useState<LinkScan[] | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [done, setDone] = useState<Record<string, { ok: boolean; text: string }>>({});

  const scan = async () => {
    setError('');
    setDone({});
    setBusy('Looking for panels…');
    try {
      const list = await scanEditLinks((n, total) => setBusy(`Looking for panels… ${n} of ${total} dashboards`));
      setFound(list);
      setPicked(new Set());
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const apply = async () => {
    const todo = (found ?? []).filter((d) => picked.has(d.uid));
    for (const [i, d] of todo.entries()) {
      setBusy(`Saving ${i + 1} of ${todo.length}…`);
      try {
        const n = await applyEditLinks(d.uid);
        setDone((s) => ({ ...s, [d.uid]: { ok: true, text: n > 0 ? `Added to ${n} panel${n === 1 ? '' : 's'}` : 'Already there' } }));
      } catch (e) {
        setDone((s) => ({ ...s, [d.uid]: { ok: false, text: errMsg(e) } }));
      }
    }
    setPicked(new Set());
    setBusy('');
  };

  const selectable = (found ?? []).filter((d) => !d.blocked && !done[d.uid]?.ok);
  const all = selectable.length > 0 && selectable.every((d) => picked.has(d.uid));

  return (
    <FieldSet label="Edit in Visualize links">
      <div className={styles.hint}>
        Grafana hides &ldquo;Edit in Visualize&rdquo; from the panel menu while a dashboard is in edit mode. A link in the
        panel header stays. Panels saved from Visualize have it; add it to other ClickHouse panels here. Each dashboard
        is saved as a new version you can restore from its version history.
      </div>
      <Button size="sm" variant="secondary" icon="search" onClick={scan} disabled={!!busy}>
        Find panels without the link
      </Button>
      {busy && (
        <span className={styles.busy} role="status">
          {busy}
        </span>
      )}
      {error && (
        <Alert severity="error" title="Could not list the dashboards">
          {error}
        </Alert>
      )}
      {found?.length === 0 && <div className={styles.hint}>Every ClickHouse panel has the link.</div>}
      {found && found.length > 0 && (
        <>
          <div className={styles.list} role="group" aria-label="Dashboards without the link">
            <Checkbox
              label="All dashboards"
              value={all}
              indeterminate={!all && picked.size > 0}
              disabled={!!busy || selectable.length === 0}
              onChange={() => setPicked(all ? new Set() : new Set(selectable.map((d) => d.uid)))}
            />
            {found.map((d) => {
              const result = done[d.uid];
              return (
                <div key={d.uid} className={styles.row} title={d.panels.join('\n')}>
                  <Checkbox
                    label={d.folder ? `${d.folder} / ${d.title}` : d.title}
                    value={picked.has(d.uid)}
                    disabled={!!busy || !!d.blocked || !!result?.ok}
                    onChange={() =>
                      setPicked((s) => {
                        const next = new Set(s);
                        if (!next.delete(d.uid)) {
                          next.add(d.uid);
                        }
                        return next;
                      })
                    }
                  />
                  <span className={result && !result.ok ? styles.failed : styles.info}>
                    {result?.text ?? d.blocked ?? `${d.panels.length} panel${d.panels.length === 1 ? '' : 's'}`}
                  </span>
                </div>
              );
            })}
          </div>
          <Button size="sm" icon="link" onClick={apply} disabled={!!busy || picked.size === 0}>
            {`Add links to ${picked.size} dashboard${picked.size === 1 ? '' : 's'}`}
          </Button>
        </>
      )}
    </FieldSet>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  hint: css`
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
    margin: ${theme.spacing(0, 0, 1.5)};
  `,
  busy: css`
    margin-left: ${theme.spacing(1)};
    color: ${theme.colors.text.secondary};
  `,
  list: css`
    max-height: 320px;
    overflow: auto;
    margin: ${theme.spacing(1.5, 0)};
    padding: ${theme.spacing(1)};
    border: 1px solid ${theme.colors.border.weak};
    border-radius: ${theme.shape.radius.default};
  `,
  row: css`
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: ${theme.spacing(2)};
    padding: ${theme.spacing(0.5, 0)};
  `,
  info: css`
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
    text-align: right;
  `,
  failed: css`
    color: ${theme.colors.error.text};
    font-size: ${theme.typography.bodySmall.fontSize};
    text-align: right;
  `,
});
