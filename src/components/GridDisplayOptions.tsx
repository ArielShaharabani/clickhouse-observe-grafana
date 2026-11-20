import React, { useId } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, RadioButtonGroup, Toggletip, useStyles2 } from '@grafana/ui';
import { DialogHint } from './a11y/dialog';

/** Results grid display options (spec DISC-TABLE-01 "Display options"). */
export type GridDensity = 'compact' | 'normal' | 'expanded';
export type BodyLines = 1 | 2 | 3 | 5 | 'auto';

export interface GridDisplay {
  density: GridDensity;
  /** Lines the body cell shows before an ellipsis; 'auto' wraps in full. */
  bodyLines: BodyLines;
}

export const DEFAULT_GRID_DISPLAY: GridDisplay = { density: 'normal', bodyLines: 1 };

const STORAGE_KEY = 'clickhouse-observe.gridDisplay';
const DENSITIES: GridDensity[] = ['compact', 'normal', 'expanded'];
const LINES: BodyLines[] = [1, 2, 3, 5, 'auto'];

/** Per-viewer convenience: remembered in localStorage, falls back to defaults when unavailable. */
export function loadGridDisplay(): GridDisplay {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (raw && DENSITIES.includes(raw.density) && LINES.includes(raw.bodyLines)) {
      return { density: raw.density, bodyLines: raw.bodyLines };
    }
  } catch {
    // Storage blocked or corrupt — use defaults.
  }
  return DEFAULT_GRID_DISPLAY;
}

export function saveGridDisplay(d: GridDisplay): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
  } catch {
    // Storage blocked — the choice still applies for this page view.
  }
}

interface Props {
  value: GridDisplay;
  onChange: (d: GridDisplay) => void;
}

export function GridDisplayOptions({ value, onChange }: Props) {
  const styles = useStyles2(getStyles);
  const hintId = useId();
  // Grafana's Toggletip traps focus and closes on Escape but sets no role: announce it as a dialog.
  const content = (
    <div className={styles.body} role="dialog" aria-label="Display options" aria-describedby={hintId}>
      <DialogHint id={hintId} />
      <div className={styles.label} id="grid-density-label">
        Density
      </div>
      <RadioButtonGroup<GridDensity>
        size="sm"
        aria-labelledby="grid-density-label"
        options={[
          { label: 'Compact', value: 'compact' },
          { label: 'Normal', value: 'normal' },
          { label: 'Expanded', value: 'expanded' },
        ]}
        value={value.density}
        onChange={(density) => onChange({ ...value, density })}
      />
      <div className={styles.label} id="grid-lines-label">
        Body cell lines
      </div>
      <RadioButtonGroup<BodyLines>
        size="sm"
        aria-labelledby="grid-lines-label"
        options={LINES.map((l) => ({ label: l === 'auto' ? 'Auto' : String(l), value: l }))}
        value={value.bodyLines}
        onChange={(bodyLines) => onChange({ ...value, bodyLines })}
      />
    </div>
  );
  return (
    <Toggletip content={content} placement="bottom-end" closeButton={false}>
      <Button variant="secondary" fill="text" size="sm" icon="sliders-v-alt" aria-label="Display options">
        Display
      </Button>
    </Toggletip>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  body: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(0.5)};
    min-width: 220px;
  `,
  label: css`
    font-size: ${theme.typography.bodySmall.fontSize};
    color: ${theme.colors.text.secondary};
    margin-top: ${theme.spacing(0.5)};
  `,
});
