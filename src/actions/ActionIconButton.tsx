import React from 'react';
import { IconButton, Tooltip } from '@grafana/ui';
import { ResolvedAction } from './registry';

/**
 * Icon button for a registry action. The tooltip is the short, shared wording ("Filter for
 * value"); the accessible name is the specific one ("Filter for Service: payments"). Grafana's
 * IconButton uses its `tooltip` prop as the accessible name, so the tooltip is applied by a
 * wrapping <Tooltip> instead.
 */
export function ActionIconButton({ action, size = 'sm' }: { action: ResolvedAction; size?: 'xs' | 'sm' | 'md' }) {
  return (
    <Tooltip content={action.tooltip}>
      <IconButton name={action.icon} size={size} aria-label={action.ariaLabel} onClick={action.run} />
    </Tooltip>
  );
}
