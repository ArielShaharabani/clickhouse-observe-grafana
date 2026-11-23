/** Matching for the find bar (FindBar): pure text in, offsets out. */

export interface FindOptions {
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
}

/** Stops counting there (as Monaco caps its own find). */
export const MAX_MATCHES = 2000;

/** The search as a RegExp; null when there is nothing to search, undefined when the regex is not valid. */
export function findRegExp(query: string, o: FindOptions): RegExp | null | undefined {
  if (!query) {
    return null;
  }
  const source = o.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    // Not \b: it needs a word character at both ends, so "-x" would never match as a whole word.
    return new RegExp(o.wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])` : source, o.matchCase ? 'gu' : 'giu');
  } catch {
    return undefined;
  }
}

/** Start / end offsets of every non-empty match in `text`. */
export function matchOffsets(text: string, re: RegExp, max = MAX_MATCHES): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  re.lastIndex = 0;
  while (out.length < max) {
    const m = re.exec(text);
    if (!m) {
      break;
    }
    if (m[0] === '') {
      re.lastIndex++;
      continue;
    }
    out.push([m.index, m.index + m[0].length]);
  }
  return out;
}
