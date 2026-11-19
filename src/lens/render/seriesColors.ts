/**
 * Stable series colours (Kibana parity): a breakdown value keeps its colour across chart types,
 * filters and re-queries, because the colour comes from the value itself, not from its position.
 * Shared by the Visualize charts (XY now; Pie / Metric / Table can reuse `assignColorSlots`).
 *
 * Each key hashes to a preferred slot among the first `preferred` palette entries (the distinct
 * base colours). Keys are placed in priority order (the legend order: biggest first), so on a
 * collision the bigger series keeps its colour and the smaller one takes the next free slot; with
 * more keys than preferred slots the rest take the remaining palette entries in order.
 */

/** 32-bit FNV-1a hash of a string (deterministic across sessions and browsers). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Number of distinct base colours a value hashes into (Kibana's categorical palette has 10). */
export const PREFERRED_SLOTS = 10;

/**
 * Palette index per key, keys given in priority order. Deterministic: the same keys in the same
 * order always get the same slots, and a key alone always gets its own hash slot.
 */
export function assignColorSlots(keys: string[], paletteSize: number, preferred = PREFERRED_SLOTS): number[] {
  const size = Math.max(1, paletteSize);
  const pref = Math.max(1, Math.min(preferred, size));
  const used = new Set<number>();
  const slots: number[] = [];
  let overflow = pref;
  for (const k of keys) {
    let slot = -1;
    const h = hashString(k) % pref;
    for (let i = 0; i < pref; i++) {
      const c = (h + i) % pref;
      if (!used.has(c)) {
        slot = c;
        break;
      }
    }
    if (slot < 0) {
      // Every base colour is taken: the rest of the palette, then wrap around.
      slot = overflow < size ? overflow++ : overflow++ % size;
    }
    used.add(slot);
    slots.push(slot);
  }
  return slots;
}

/** The colour key of a series: its breakdown value when it has one (the same value → the same colour). */
export function seriesColorKey(s: { name: string; breakdown?: string; synthetic?: boolean }): string {
  return s.breakdown === undefined ? s.name : `${s.synthetic ? '\u0000' : ''}${s.name}`;
}

/** Valid stored colour (`#rrggbb`). */
export const isHexColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

/**
 * Stable colours for named slices / series (Pie, dashboard export): a legend pick (`picked`) wins,
 * else the value's hash slot in the palette (the same value → the same colour as in the XY chart).
 * `keys` are in priority order (biggest first); `synthetic` marks the Other / (missing) buckets.
 */
export function stableColors(
  names: string[],
  synthetic: boolean[],
  palette: string[],
  resolve: (paletteName: string) => string,
  picked?: (name: string) => string | undefined
): string[] {
  const keys = names.map((n, i) => seriesColorKey({ name: n, breakdown: n, synthetic: synthetic[i] }));
  const slots = assignColorSlots(keys, palette.length);
  return names.map((n, i) => picked?.(n) ?? resolve(palette[slots[i] % palette.length]));
}
