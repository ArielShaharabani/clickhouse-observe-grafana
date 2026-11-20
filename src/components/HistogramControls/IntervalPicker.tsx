import React, { useEffect, useRef, useState } from 'react';
import { useStyles2, Icon } from '@grafana/ui';
import { TimeRange } from '@grafana/data';
import { IntervalMode } from '../../types';
import { resolveInterval } from '../VolumeHistogram';
import { getToolbarButtonStyles } from './_toolbarButton';

interface Props {
  value: IntervalMode;
  onChange: (mode: IntervalMode) => void;
  timeRange: TimeRange;
}

interface Option {
  mode: IntervalMode;
  label: string;
}

const OPTIONS: Option[] = [
  { mode: 'auto',   label: 'Auto' },
  { mode: 'millisecond', label: 'Millisecond' },
  { mode: 'second', label: 'Second' },
  { mode: 'minute', label: 'Minute' },
  { mode: 'hour',   label: 'Hour' },
  { mode: 'day',    label: 'Day' },
  { mode: 'week',   label: 'Week' },
  { mode: 'month',  label: 'Month' },
  { mode: 'year',   label: 'Year' },
];

function triggerLabel(mode: IntervalMode): string {
  const opt = OPTIONS.find((o) => o.mode === mode);
  return `${opt?.label ?? 'Auto'} interval`;
}

export function IntervalPicker({ value, onChange, timeRange }: Props) {
  const styles = useStyles2(getToolbarButtonStyles);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  function select(mode: IntervalMode) {
    onChange(mode);
    setOpen(false);
  }

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button className={styles.trigger} onClick={() => setOpen((v) => !v)}>
        <span>{triggerLabel(value)}</span>
        <Icon name={open ? 'angle-up' : 'angle-down'} size="md" />
      </button>

      {open && (
        <div className={styles.dropdown}>
          <div className={styles.menuHeader}>Select time interval</div>
          {OPTIONS.map((opt) => {
            // Never disabled (Kibana): an interval too fine for the range is scaled up to the
            // finest one within the bucket cap, and the histogram caption says so.
            const scaledTo = opt.mode !== 'auto' ? resolveInterval(opt.mode, timeRange).scaledTo : undefined;
            const active = opt.mode === value;
            return (
              <button
                key={opt.mode}
                className={`${styles.item} ${active ? styles.itemActive : ''}`}
                onClick={() => select(opt.mode)}
                title={scaledTo ? `Scaled to ${scaledTo} on this time range` : undefined}
              >
                <span className={styles.itemCheck}>
                  {active && <Icon name="check" size="sm" />}
                </span>
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
