/**
 * "Select filters to apply" (spec LENS-INTERACT-01): after a click on a stacked segment / point
 * that carries several dimension values, one pre-ticked checkbox per value; Cancel / Apply.
 */
import React, { useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, Checkbox, Modal, useStyles2 } from '@grafana/ui';
import { FilterPill } from '../types';

export interface FilterChoice {
  label: string;
  /** A filter pill to add… */
  pill?: FilterPill;
  /** …or a time range [from, to] (ms) for a date bucket. */
  time?: [number, number];
}

interface Props {
  choices: FilterChoice[];
  onApply: (picked: FilterChoice[]) => void;
  onCancel: () => void;
}

export function FilterChooser({ choices, onApply, onCancel }: Props) {
  const styles = useStyles2(getStyles);
  const [ticked, setTicked] = useState<boolean[]>(() => choices.map(() => true));
  return (
    <Modal title="Select filters to apply" isOpen onDismiss={onCancel}>
      <div className={styles.list}>
        {choices.map((c, i) => (
          <Checkbox
            key={c.label}
            label={c.label}
            value={ticked[i]}
            onChange={() => setTicked((t) => t.map((v, j) => (j === i ? !v : v)))}
          />
        ))}
      </div>
      <Modal.ButtonRow>
        <Button variant="secondary" fill="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={!ticked.some(Boolean)} onClick={() => onApply(choices.filter((_c, i) => ticked[i]))}>
          Apply
        </Button>
      </Modal.ButtonRow>
    </Modal>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  list: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(1)};
  `,
});
