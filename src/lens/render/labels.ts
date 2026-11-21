/** A label cut to fit `px` (about 6.6 px a character at the 11 px tick font), with an ellipsis. */
export function truncateLabel(label: string, px: number): string {
  const max = Math.max(3, Math.floor((px - 8) / 6.6));
  return label.length <= max ? label : `${label.slice(0, max - 1)}…`;
}
