import React, { useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, TimeRange } from '@grafana/data';
import { Button, Input, useStyles2 } from '@grafana/ui';
import { formatDurationBadge, parseTimeShorthand } from '../utils/timeShorthand';

interface Props {
  /** The range currently applied (for the duration badge). */
  range: TimeRange;
  onApply: (range: TimeRange) => void;
}

/**
 * Typed time shorthand next to the time picker plus the window's duration badge (DISC-TIME-01).
 * Typed-but-not-applied text is the time "dirty" state (DISC-TIME-02): an `Update` button appears
 * and Enter / Update applies it.
 */
export function TimeShorthandInput({ range, onApply }: Props) {
  const styles = useStyles2(getStyles);
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  const dirty = text.trim() !== '';

  const apply = () => {
    const parsed = parseTimeShorthand(text);
    if (!parsed) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setText('');
    onApply(parsed);
  };

  return (
    <div className={styles.wrap} data-testid="time-shorthand">
      <Input
        aria-label="Time range shorthand"
        aria-invalid={invalid}
        invalid={invalid}
        title={invalid ? 'Use -7d, -30m, td, yd, tw, tm or ty' : undefined}
        placeholder="-7d, td, yd"
        width={14}
        value={text}
        onChange={(e) => {
          setText(e.currentTarget.value);
          setInvalid(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            apply();
          } else if (e.key === 'Escape') {
            setText('');
            setInvalid(false);
          }
        }}
      />
      {dirty && (
        <Button variant="success" size="md" onClick={apply} aria-label="Update time range">
          Update
        </Button>
      )}
      <span className={styles.badge} data-testid="time-duration-badge" title="Length of the time window">
        {formatDurationBadge(range.to.valueOf() - range.from.valueOf())}
      </span>
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  wrap: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(0.5) }),
  badge: css({
    padding: theme.spacing(0, 0.75),
    borderRadius: theme.shape.radius.pill,
    background: theme.colors.background.secondary,
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    whiteSpace: 'nowrap',
  }),
});
