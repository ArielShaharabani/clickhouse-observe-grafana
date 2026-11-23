const grouped3 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });
/** A value as Kibana's default number format shows it (`0,0.[000]`): thousands separators, no abbreviation. */
export const formatNumber = (v: number): string => {
  if (!Number.isFinite(v)) {
    return String(v);
  }
  const a = Math.abs(v);
  if (a > 0 && a < 0.1) {
    // Small numbers keep two significant digits (0.0003, 0.00061), never rounded to 0.
    const digits = Math.min(12, Math.ceil(-Math.log10(a)) + 1);
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(v);
  }
  return grouped3.format(v);
};
/** An axis tick: separators, abbreviated only from a million up (1,000 · 25,000 · 1.5M). Shared by Visualize and the Discover histogram. */
export const formatAxisNumber = (v: number): string => {
  const a = Math.abs(v);
  if (a >= 1e12) {
    return `${grouped3.format(+(v / 1e12).toFixed(2))}T`;
  }
  if (a >= 1e9) {
    return `${+(v / 1e9).toFixed(2)}B`;
  }
  if (a >= 1e6) {
    return `${+(v / 1e6).toFixed(2)}M`;
  }
  return formatNumber(v);
};
