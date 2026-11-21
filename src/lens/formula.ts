/**
 * Lens formula (spec LENS-DIM-03, docs/spec/20-lens.md): `count(kql='SeverityText : ERROR') / count()`.
 *
 * Security model — a formula is user text and also rides in shared URLs, so it is never pasted into
 * SQL. It is lexed and parsed into an AST; only whitelisted functions, operators and named
 * arguments are accepted; field references are names resolved through the metric's `fields` map
 * (name → field SQL expression), and those expressions are checked against the discovered fields
 * by `sanitizeLens` exactly like a quick function's `field`. Compiling emits only: our own function
 * names, operators, number tokens (lexer-restricted to digits), `quoteIdentifier(field)` and the
 * output of the existing KQL compiler for `kql=` filters.
 */
import { SourceConfig } from '../types';
import { FieldIndex } from '../sql/fields';
import { parseKql, kqlToSql } from '../sql/kql';
import { quoteIdentifier } from '../sql/queryBuilder';
import { timeExpr } from '../sql/timeExpr';
import {
  counterRateSql,
  cleanRankValue,
  cumulativeSumSql,
  DEFAULT_RANK_VALUE,
  DEFAULT_WINDOW,
  differencesSql,
  MAX_RANK_VALUE,
  MAX_WINDOW,
  movingAverageSql,
  OverallFn,
  overallSql,
  WindowSql,
} from './calc';

export const MAX_FORMULA_LEN = 1000;
const MAX_NODES = 200;
const MAX_DEPTH = 32;

// ── Function registry (also drives autocomplete and the function reference) ──────────────────────

export interface FormulaFnArg {
  name: string;
  type: 'field' | 'number' | 'string' | 'expr';
  optional?: boolean;
  /** Named argument (`kql='…'`, `percentile=95`) rather than positional. */
  named?: boolean;
}

export interface FormulaFn {
  name: string;
  /**
   * agg: an aggregation of a field; math: a row-wise function; series: a time-series calculation
   * over a metric (needs a date histogram); overall: one value per series (overall_*).
   */
  kind: 'agg' | 'math' | 'series' | 'overall';
  args: FormulaFnArg[];
  description: string;
  /** Aggregations: the field must be numeric. */
  numeric?: boolean;
}

const KQL: FormulaFnArg = { name: 'kql', type: 'string', optional: true, named: true };
const FIELD: FormulaFnArg = { name: 'field', type: 'field' };
const X: FormulaFnArg = { name: 'value', type: 'expr' };
const METRIC: FormulaFnArg = { name: 'metric', type: 'expr' };

export const FORMULA_FUNCTIONS: FormulaFn[] = [
  {
    name: 'count',
    kind: 'agg',
    args: [{ ...FIELD, optional: true }, KQL],
    description: 'The total number of documents. With a field: documents that have a value for it.',
  },
  { name: 'average', kind: 'agg', numeric: true, args: [FIELD, KQL], description: 'Average of a number field.' },
  { name: 'sum', kind: 'agg', numeric: true, args: [FIELD, KQL], description: 'Total of a number field.' },
  { name: 'min', kind: 'agg', numeric: true, args: [FIELD, KQL], description: 'Smallest value of a number field.' },
  { name: 'max', kind: 'agg', numeric: true, args: [FIELD, KQL], description: 'Largest value of a number field.' },
  { name: 'median', kind: 'agg', numeric: true, args: [FIELD, KQL], description: 'Median of a number field.' },
  {
    name: 'percentile',
    kind: 'agg',
    numeric: true,
    args: [FIELD, { name: 'percentile', type: 'number', optional: true, named: true }, KQL],
    description: 'Value below which the given percentage of values fall (percentile=95 by default).',
  },
  {
    name: 'percentile_rank',
    kind: 'agg',
    numeric: true,
    args: [FIELD, { name: 'value', type: 'number', optional: true, named: true }, KQL],
    description:
      'Share of the values that are less than or equal to the given value, from 0 to 1 (value=0 by default), e.g. percentile_rank(bytes, value=100).',
  },
  {
    name: 'unique_count',
    kind: 'agg',
    args: [FIELD, KQL],
    description: 'Number of distinct values of a field (approximate).',
  },
  {
    name: 'standard_deviation',
    kind: 'agg',
    numeric: true,
    args: [FIELD, KQL],
    description: 'How much the values of a number field vary (population standard deviation).',
  },
  {
    name: 'last_value',
    kind: 'agg',
    numeric: true,
    args: [FIELD, KQL],
    description: 'Value of a number field in the newest document that has it (by the time field).',
  },
  {
    name: 'cumulative_sum',
    kind: 'series',
    args: [METRIC],
    description: 'Running total of a metric over time, per series. Needs a date histogram.',
  },
  {
    name: 'differences',
    kind: 'series',
    args: [METRIC],
    description: 'Change of a metric from the previous bucket, per series. Needs a date histogram.',
  },
  {
    name: 'moving_average',
    kind: 'series',
    args: [METRIC, { name: 'window', type: 'number', optional: true, named: true }],
    description: `Average of the previous buckets (window=${DEFAULT_WINDOW} by default; the current bucket is not included). Needs a date histogram.`,
  },
  {
    name: 'counter_rate',
    kind: 'series',
    args: [METRIC],
    description:
      'Increase of an ever-growing counter per bucket (a drop counts as a reset), e.g. counter_rate(max(bytes)). Needs a date histogram.',
  },
  {
    name: 'overall_sum',
    kind: 'overall',
    args: [METRIC],
    description: 'Sum of a metric over the whole series, e.g. count() / overall_sum(count()) for % of total.',
  },
  {
    name: 'overall_average',
    kind: 'overall',
    args: [METRIC],
    description: 'Average of a metric over the whole series.',
  },
  { name: 'overall_min', kind: 'overall', args: [METRIC], description: 'Smallest value of a metric in the series.' },
  { name: 'overall_max', kind: 'overall', args: [METRIC], description: 'Largest value of a metric in the series.' },
  { name: 'abs', kind: 'math', args: [X], description: 'Absolute value.' },
  {
    name: 'round',
    kind: 'math',
    args: [X, { name: 'decimals', type: 'number', optional: true }],
    description: 'Rounds to the given number of decimals (0 by default).',
  },
  { name: 'floor', kind: 'math', args: [X], description: 'Rounds down.' },
  { name: 'ceil', kind: 'math', args: [X], description: 'Rounds up.' },
  { name: 'sqrt', kind: 'math', args: [X], description: 'Square root.' },
  { name: 'exp', kind: 'math', args: [X], description: 'e raised to the value.' },
  {
    name: 'log',
    kind: 'math',
    args: [X, { name: 'base', type: 'expr', optional: true }],
    description: 'Logarithm (natural by default, or in the given base).',
  },
  { name: 'pow', kind: 'math', args: [X, { name: 'exponent', type: 'expr' }], description: 'Value raised to a power.' },
  { name: 'mod', kind: 'math', args: [X, { name: 'divisor', type: 'expr' }], description: 'Remainder of a division.' },
  {
    name: 'clamp',
    kind: 'math',
    args: [X, { name: 'min', type: 'expr' }, { name: 'max', type: 'expr' }],
    description: 'Limits the value to the range min–max.',
  },
  {
    name: 'pick_max',
    kind: 'math',
    args: [X, { name: 'other', type: 'expr' }],
    description: 'The larger of two values.',
  },
  {
    name: 'pick_min',
    kind: 'math',
    args: [X, { name: 'other', type: 'expr' }],
    description: 'The smaller of two values.',
  },
  {
    name: 'defaults',
    kind: 'math',
    args: [X, { name: 'default', type: 'expr' }],
    description: 'The value, or the default where it is empty.',
  },
];

const FN_BY_NAME = new Map(FORMULA_FUNCTIONS.map((f) => [f.name, f]));

export function fnSignature(f: FormulaFn): string {
  const args = f.args.map((a) => {
    const t = a.type === 'expr' ? 'number' : a.type;
    const s = a.named ? `${a.name}=${t}` : `${a.name}: ${t}`;
    return a.optional ? `[${s}]?` : s;
  });
  return `${f.name}(${args.join(', ')})`;
}

// ── Lexer ────────────────────────────────────────────────────────────────────────────────────────

type TokKind = 'num' | 'str' | 'ident' | 'op' | 'lp' | 'rp' | 'comma' | 'eq' | 'end';
interface Tok {
  kind: TokKind;
  text: string;
  /** Decoded value of a string / backtick-quoted identifier. */
  value?: string;
  pos: number;
}

export class FormulaError extends Error {
  constructor(
    message: string,
    readonly pos: number
  ) {
    super(message);
    this.name = 'FormulaError';
  }
}

const NUM_RE = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/;
const IDENT_RE = /^[A-Za-z_@][A-Za-z0-9_.@]*/;

function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const rest = src.slice(i);
    const num = NUM_RE.exec(rest);
    if (num) {
      toks.push({ kind: 'num', text: num[0], pos: i });
      i += num[0].length;
      continue;
    }
    const id = IDENT_RE.exec(rest);
    if (id) {
      // A trailing dot is not part of a name.
      const text = id[0].replace(/\.+$/, '');
      toks.push({ kind: 'ident', text, value: text, pos: i });
      i += text.length;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      let out = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') {
          if (j + 1 >= src.length) {
            break;
          }
          out += src[j + 1];
          j += 2;
        } else {
          out += src[j++];
        }
      }
      if (j >= src.length) {
        throw new FormulaError(c === '`' ? 'Unclosed field name' : 'Unclosed string', i);
      }
      toks.push({ kind: c === '`' ? 'ident' : 'str', text: src.slice(i, j + 1), value: out, pos: i });
      i = j + 1;
      continue;
    }
    const single: Record<string, TokKind> = { '(': 'lp', ')': 'rp', ',': 'comma', '=': 'eq' };
    if (single[c]) {
      toks.push({ kind: single[c], text: c, pos: i });
      i++;
      continue;
    }
    if ('+-*/'.includes(c)) {
      toks.push({ kind: 'op', text: c, pos: i });
      i++;
      continue;
    }
    throw new FormulaError(`Unexpected character "${c}"`, i);
  }
  toks.push({ kind: 'end', text: '', pos: src.length });
  return toks;
}

// ── AST + parser ─────────────────────────────────────────────────────────────────────────────────

export type FormulaNode =
  | { type: 'num'; value: string; pos: number }
  | { type: 'field'; name: string; pos: number }
  | { type: 'neg'; operand: FormulaNode; pos: number }
  | { type: 'bin'; op: '+' | '-' | '*' | '/'; left: FormulaNode; right: FormulaNode; pos: number }
  | {
      type: 'call';
      fn: string;
      args: FormulaNode[];
      named: Record<string, { kind: 'str' | 'num'; value: string }>;
      pos: number;
    };

class Parser {
  private i = 0;
  private nodes = 0;
  constructor(private readonly toks: Tok[]) {}

  private peek(): Tok {
    return this.toks[this.i];
  }
  private next(): Tok {
    return this.toks[this.i++];
  }
  private expect(kind: TokKind, what: string): Tok {
    const t = this.peek();
    if (t.kind !== kind) {
      throw new FormulaError(`Expected ${what}${t.kind === 'end' ? '' : ` but found "${t.text}"`}`, t.pos);
    }
    return this.next();
  }
  private count(pos: number) {
    if (++this.nodes > MAX_NODES) {
      throw new FormulaError('Formula is too long', pos);
    }
  }

  parse(): FormulaNode {
    const n = this.expr(0);
    const t = this.peek();
    if (t.kind !== 'end') {
      throw new FormulaError(`Unexpected "${t.text}"`, t.pos);
    }
    return n;
  }

  private expr(depth: number): FormulaNode {
    let left = this.term(depth);
    while (this.peek().kind === 'op' && (this.peek().text === '+' || this.peek().text === '-')) {
      const op = this.next();
      this.count(op.pos);
      left = { type: 'bin', op: op.text as '+' | '-', left, right: this.term(depth), pos: op.pos };
    }
    return left;
  }

  private term(depth: number): FormulaNode {
    let left = this.unary(depth);
    while (this.peek().kind === 'op' && (this.peek().text === '*' || this.peek().text === '/')) {
      const op = this.next();
      this.count(op.pos);
      left = { type: 'bin', op: op.text as '*' | '/', left, right: this.unary(depth), pos: op.pos };
    }
    return left;
  }

  private unary(depth: number): FormulaNode {
    if (depth > MAX_DEPTH) {
      throw new FormulaError('Formula is nested too deeply', this.peek().pos);
    }
    const t = this.peek();
    if (t.kind === 'op' && t.text === '-') {
      this.next();
      this.count(t.pos);
      return { type: 'neg', operand: this.unary(depth + 1), pos: t.pos };
    }
    return this.primary(depth);
  }

  private primary(depth: number): FormulaNode {
    const t = this.next();
    this.count(t.pos);
    if (t.kind === 'num') {
      return { type: 'num', value: t.text, pos: t.pos };
    }
    if (t.kind === 'lp') {
      const n = this.expr(depth + 1);
      this.expect('rp', '")"');
      return n;
    }
    if (t.kind === 'ident') {
      // A function call is a bare name followed by "(" (a backtick name is always a field).
      if (this.peek().kind === 'lp' && t.text[0] !== '`') {
        this.next();
        return this.call(t, depth + 1);
      }
      return { type: 'field', name: t.value!, pos: t.pos };
    }
    if (t.kind === 'end') {
      throw new FormulaError('Formula is incomplete', t.pos);
    }
    throw new FormulaError(`Unexpected "${t.text}"`, t.pos);
  }

  private call(nameTok: Tok, depth: number): FormulaNode {
    const args: FormulaNode[] = [];
    const named: Record<string, { kind: 'str' | 'num'; value: string }> = {};
    if (this.peek().kind !== 'rp') {
      for (;;) {
        const t = this.peek();
        if (t.kind === 'ident' && t.text[0] !== '`' && this.toks[this.i + 1]?.kind === 'eq') {
          this.next();
          this.next();
          // A leading minus belongs to the number (`value=-5`); the text stays lexer-restricted digits.
          const minus = this.peek().kind === 'op' && this.peek().text === '-' && this.toks[this.i + 1]?.kind === 'num';
          if (minus) {
            this.next();
          }
          const v = this.next();
          if (v.kind !== 'str' && v.kind !== 'num') {
            throw new FormulaError(`Expected a string or number for ${t.text}=`, v.pos);
          }
          if (t.text in named) {
            throw new FormulaError(`Argument ${t.text} given twice`, t.pos);
          }
          named[t.text] = { kind: v.kind, value: v.kind === 'str' ? v.value! : `${minus ? '-' : ''}${v.text}` };
        } else {
          args.push(this.expr(depth));
        }
        if (this.peek().kind === 'comma') {
          this.next();
          continue;
        }
        break;
      }
    }
    this.expect('rp', '")"');
    return { type: 'call', fn: nameTok.text, args, named, pos: nameTok.pos };
  }
}

export function parseFormula(src: string): FormulaNode {
  if (src.length > MAX_FORMULA_LEN) {
    throw new FormulaError(`Formula is too long (max ${MAX_FORMULA_LEN} characters)`, MAX_FORMULA_LEN);
  }
  if (!src.trim()) {
    throw new FormulaError('Formula is empty', 0);
  }
  return new Parser(lex(src)).parse();
}

// ── Validation ───────────────────────────────────────────────────────────────────────────────────

/** A field a formula can use (name as written in the formula → field SQL expression). */
export interface FormulaFieldRef {
  expr: string;
  numeric: boolean;
}
export type FormulaFields = Record<string, FormulaFieldRef>;

/** Field names a formula refers to (only names in a function's field position count). */
export function formulaFieldNames(node: FormulaNode): string[] {
  const out = new Set<string>();
  const walk = (n: FormulaNode) => {
    if (n.type === 'field') {
      out.add(n.name);
    } else if (n.type === 'neg') {
      walk(n.operand);
    } else if (n.type === 'bin') {
      walk(n.left);
      walk(n.right);
    } else if (n.type === 'call') {
      n.args.forEach(walk);
    }
  };
  walk(node);
  return [...out];
}

/** Names of the window functions (time-series and overall_*) a parsed formula calls, in order. */
function windowCalls(node: FormulaNode, kinds: ReadonlyArray<FormulaFn['kind']>): string[] {
  const out: string[] = [];
  const walk = (n: FormulaNode) => {
    if (n.type === 'neg') {
      walk(n.operand);
    } else if (n.type === 'bin') {
      walk(n.left);
      walk(n.right);
    } else if (n.type === 'call') {
      const fn = FN_BY_NAME.get(n.fn);
      if (fn && kinds.includes(fn.kind) && !out.includes(fn.name)) {
        out.push(fn.name);
      }
      n.args.forEach(walk);
    }
  };
  walk(node);
  return out;
}

const parsedOrNull = (src: string): FormulaNode | null => {
  try {
    return parseFormula(src);
  } catch {
    return null;
  }
};

/** Whether a formula uses a time-series calculation or overall_* (computed with window functions). */
export function formulaUsesWindow(src: string): boolean {
  const n = parsedOrNull(src);
  return !!n && windowCalls(n, ['series', 'overall']).length > 0;
}

/** The time-series functions a formula uses (they need a date histogram). */
export function formulaTimeSeriesFns(src: string): string[] {
  const n = parsedOrNull(src);
  return n ? windowCalls(n, ['series']) : [];
}

/**
 * All errors of a parsed formula against the fields it may use (the editor shows every one; the
 * compiler refuses a formula with any).
 */
export function validateFormula(node: FormulaNode, fields: FormulaFields): FormulaError[] {
  const errors: FormulaError[] = [];
  let aggs = 0;
  /** Inside a time-series / overall function (they cannot be nested). */
  let inWindow: string | null = null;
  const walk = (n: FormulaNode, inAgg: boolean) => {
    switch (n.type) {
      case 'num':
        return;
      case 'field':
        errors.push(new FormulaError(`Field ${n.name} must be used inside a function, e.g. average(${n.name})`, n.pos));
        return;
      case 'neg':
        walk(n.operand, inAgg);
        return;
      case 'bin':
        walk(n.left, inAgg);
        walk(n.right, inAgg);
        return;
      case 'call': {
        const fn = FN_BY_NAME.get(n.fn);
        if (!fn) {
          errors.push(new FormulaError(`Unknown function ${n.fn}`, n.pos));
          return;
        }
        const positional = fn.args.filter((a) => !a.named);
        const namedArgs = new Map(fn.args.filter((a) => a.named).map((a) => [a.name, a]));
        for (const [k, v] of Object.entries(n.named)) {
          const spec = namedArgs.get(k);
          if (!spec) {
            errors.push(
              new FormulaError(
                k === 'shift' ? 'Time shift is not supported yet' : `${n.fn} has no argument ${k}`,
                n.pos
              )
            );
          } else if (spec.type !== (v.kind === 'str' ? 'string' : 'number')) {
            errors.push(new FormulaError(`${k} must be a ${spec.type}`, n.pos));
          }
        }
        const required = positional.filter((a) => !a.optional).length;
        if (n.args.length < required || n.args.length > positional.length) {
          errors.push(
            new FormulaError(
              `${n.fn} expects ${required === positional.length ? required : `${required}–${positional.length}`} argument${positional.length === 1 ? '' : 's'}`,
              n.pos
            )
          );
          return;
        }
        if (fn.kind === 'series' || fn.kind === 'overall') {
          if (inAgg) {
            errors.push(new FormulaError(`${n.fn} cannot be used inside an aggregation`, n.pos));
            return;
          }
          if (inWindow) {
            errors.push(new FormulaError(`${n.fn} cannot be used inside ${inWindow}`, n.pos));
            return;
          }
          if (n.named.window) {
            const w = Number(n.named.window.value);
            if (!Number.isInteger(w) || w < 1 || w > MAX_WINDOW) {
              errors.push(new FormulaError(`window must be a whole number from 1 to ${MAX_WINDOW}`, n.pos));
            }
          }
          const before = aggs;
          const errorsBefore = errors.length;
          inWindow = n.fn;
          n.args.forEach((a) => walk(a, false));
          inWindow = null;
          if (aggs === before && errors.length === errorsBefore) {
            errors.push(new FormulaError(`${n.fn} needs a metric, e.g. ${n.fn}(count())`, n.pos));
          }
          return;
        }
        if (fn.kind === 'agg') {
          if (inAgg) {
            errors.push(new FormulaError(`${n.fn} cannot be used inside another aggregation`, n.pos));
            return;
          }
          aggs++;
          const f = n.args[0];
          if (f) {
            if (f.type !== 'field') {
              errors.push(new FormulaError(`The first argument of ${n.fn} must be a field`, f.pos));
            } else if (!fields[f.name]) {
              errors.push(new FormulaError(`Unknown field ${f.name}`, f.pos));
            } else if (fn.numeric && !fields[f.name].numeric) {
              errors.push(new FormulaError(`${n.fn} needs a number field; ${f.name} is not a number`, f.pos));
            }
          }
          if (n.named.percentile) {
            const p = Number(n.named.percentile.value);
            if (!(p > 0 && p < 100)) {
              errors.push(new FormulaError('percentile must be between 0 and 100', n.pos));
            }
          }
          if (n.named.value) {
            const v = Number(n.named.value.value);
            if (!Number.isFinite(v) || Math.abs(v) > MAX_RANK_VALUE) {
              errors.push(new FormulaError('value must be a number', n.pos));
            }
          }
          if (n.named.kql) {
            try {
              parseKql(n.named.kql.value);
            } catch (e) {
              errors.push(new FormulaError(`Invalid KQL: ${e instanceof Error ? e.message.split('\n')[0] : e}`, n.pos));
            }
          }
          return;
        }
        if (fn.name === 'round' && n.args[1] && n.args[1].type !== 'num') {
          errors.push(new FormulaError('decimals must be a number', n.args[1].pos));
        }
        n.args.forEach((a) => walk(a, inAgg));
        return;
      }
    }
  };
  walk(node, false);
  if (errors.length === 0 && aggs === 0) {
    errors.push(new FormulaError('A formula needs at least one aggregation, e.g. count()', 0));
  }
  return errors;
}

/** Parse + validate; the errors of a formula as typed (empty = valid). */
export function formulaErrors(src: string, fields: FormulaFields): FormulaError[] {
  try {
    return validateFormula(parseFormula(src), fields);
  } catch (e) {
    return [e instanceof FormulaError ? e : new FormulaError(String(e), 0)];
  }
}

// ── Compile ──────────────────────────────────────────────────────────────────────────────────────

const AGG_SQL: Record<string, string> = {
  average: 'avg',
  sum: 'sum',
  min: 'min',
  max: 'max',
  unique_count: 'uniq',
};

const MATH_SQL: Record<string, (a: string[]) => string> = {
  abs: (a) => `abs(${a[0]})`,
  round: (a) => `round(${a[0]}, ${a[1] ?? '0'})`,
  floor: (a) => `floor(${a[0]})`,
  ceil: (a) => `ceil(${a[0]})`,
  sqrt: (a) => `sqrt(${a[0]})`,
  exp: (a) => `exp(${a[0]})`,
  log: (a) => (a[1] ? `(log(${a[0]}) / nullIf(log(${a[1]}), 0))` : `log(${a[0]})`),
  pow: (a) => `pow(${a[0]}, ${a[1]})`,
  mod: (a) => `(${a[0]} % nullIf(${a[1]}, 0))`,
  clamp: (a) => `least(greatest(${a[0]}, ${a[1]}), ${a[2]})`,
  pick_max: (a) => `greatest(${a[0]}, ${a[1]})`,
  pick_min: (a) => `least(${a[0]}, ${a[1]})`,
  defaults: (a) => `ifNull(if(isNaN(${a[0]}), NULL, ${a[0]}), ${a[1]})`,
};

export interface FormulaSqlContext {
  config: SourceConfig;
  /**
   * Window mode (LENS-CALC-01): the chart query is wrapped. Every aggregation is registered as a
   * column of the inner grouped query (`inner` returns its alias) and the formula becomes a row
   * expression of the outer SELECT, where the time-series / overall functions are window functions.
   */
  window?: WindowSql & { inner: (aggSql: string) => string };
  index?: FieldIndex;
  /**
   * SQL for a saved dashboard panel: `$` in a KQL filter is written as $ (inside string literals
   * / quoted identifiers, the only places KQL output can hold it) so the datasource's macro and
   * variable expander never sees `$…` text that came from a formula.
   */
  dashboard?: boolean;
  /**
   * Extra row condition every aggregate of the formula must also apply (our own SQL, e.g. the
   * time-shift copy selector `__s = 0` when another metric of the chart is time-shifted).
   */
  rowCond?: string;
}

/**
 * The SQL aggregate expression of a formula, or null when the formula is invalid for these
 * fields. Only reached with a validated AST; every branch emits our own text or escaped parts.
 */
export function formulaToSql(src: string, fields: FormulaFields, ctx: FormulaSqlContext): string | null {
  let node: FormulaNode;
  try {
    node = parseFormula(src);
  } catch {
    return null;
  }
  if (validateFormula(node, fields).length > 0) {
    return null;
  }
  try {
    return emit(node, fields, ctx);
  } catch {
    return null;
  }
}

function emit(n: FormulaNode, fields: FormulaFields, ctx: FormulaSqlContext): string {
  switch (n.type) {
    case 'num':
      // Lexer-restricted to digits, ".", "e", sign — never other text.
      if (!/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(n.value)) {
        throw new Error('bad number');
      }
      return n.value;
    case 'field':
      throw new Error('field outside aggregation');
    case 'neg':
      return `(-${emit(n.operand, fields, ctx)})`;
    case 'bin': {
      const l = emit(n.left, fields, ctx);
      const r = emit(n.right, fields, ctx);
      // Division by zero gives an empty value instead of inf / nan.
      return n.op === '/' ? `(${l} / nullIf(${r}, 0))` : `(${l} ${n.op} ${r})`;
    }
    case 'call': {
      const fn = FN_BY_NAME.get(n.fn);
      if (!fn) {
        throw new Error('unknown function');
      }
      if (fn.kind === 'math') {
        const builder = MATH_SQL[fn.name];
        return builder(n.args.map((a) => emit(a, fields, ctx)));
      }
      if (fn.kind === 'series' || fn.kind === 'overall') {
        return emitWindow(n, fn, fields, ctx);
      }
      const agg = emitAgg(n, fn, fields, ctx);
      return ctx.window ? ctx.window.inner(agg) : agg;
    }
  }
}

/** A time-series / overall function over its (outer) metric expression. */
function emitWindow(
  n: Extract<FormulaNode, { type: 'call' }>,
  fn: FormulaFn,
  fields: FormulaFields,
  ctx: FormulaSqlContext
): string {
  const w = ctx.window;
  if (!w) {
    throw new Error('window function outside window mode');
  }
  const a = emit(n.args[0], fields, ctx);
  if (fn.kind === 'overall') {
    return overallSql(fn.name.slice('overall_'.length) as OverallFn, a, w.overall);
  }
  // Without a date histogram there is no series order: no value (the chart shows why instead).
  if (w.series === null) {
    return 'NULL';
  }
  switch (fn.name) {
    case 'cumulative_sum':
      return cumulativeSumSql(a, w.series);
    case 'differences':
      return differencesSql(a, w.series);
    case 'moving_average':
      // A number we parse and clamp, never the text.
      return movingAverageSql(a, w.series, n.named.window ? Number(n.named.window.value) : DEFAULT_WINDOW);
    case 'counter_rate':
      return counterRateSql(a, w.series);
  }
  throw new Error('unknown window function');
}

/** Population standard deviation (as Elasticsearch's std_deviation); always OrNull: no values -> empty, never nan / 0. Shared by the quick function and the formula. */
export function stdDevSql(x: string, cond?: string): string {
  return cond ? `stddevPopIfOrNull(${x}, ${cond})` : `stddevPopOrNull(${x})`;
}

/**
 * Percentile rank (Kibana's `percentile_rank`): the share (0–1, shown as a percent) of the values
 * that are less than or equal to `value`; documents without the field do not count. Always OrNull:
 * no values -> empty. `value` is a number we parsed and bounded, printed by us. Shared by the quick
 * function and the formula.
 */
export function percentileRankSql(x: string, value: number, cond?: string): string {
  const v = cleanRankValue(value);
  const lt = `toFloat64(${x} <= ${String(v)})`;
  return cond ? `avgIfOrNull(${lt}, ${cond})` : `avgOrNull(${lt})`;
}

/** The newest document that has a value (Kibana: top hit by the time field where the field exists). Shared by the quick function and the formula. */
export function lastValueSql(x: string, cond: string | undefined, config: SourceConfig): string {
  if (!config.columns.timestamp) {
    return 'NULL';
  }
  const c = [`${x} IS NOT NULL`, cond].filter(Boolean).join(' AND ');
  return `argMaxIfOrNull(${x}, ${timeExpr(config)}, ${c})`;
}

function emitAgg(
  n: Extract<FormulaNode, { type: 'call' }>,
  fn: FormulaFn,
  fields: FormulaFields,
  ctx: FormulaSqlContext
): string {
  const fieldNode = n.args[0];
  const ref = fieldNode && fieldNode.type === 'field' ? fields[fieldNode.name] : undefined;
  if (fieldNode && !ref) {
    throw new Error('unknown field');
  }
  const f = ref ? quoteIdentifier(ref.expr) : undefined;
  const kql = n.named.kql?.value.trim();
  const kqlSql = kql ? kqlToSql(parseKql(kql), ctx.config, ctx.index) : undefined;
  const kqlCond = kqlSql ? `(${ctx.dashboard ? kqlSql.replace(/\$/g, () => '\\x24') : kqlSql})` : undefined;
  const cond = [ctx.rowCond, kqlCond].filter(Boolean).join(' AND ') || undefined;
  // Same cast the quick functions use for a field not typed as a number.
  const x = f && (ref!.numeric ? f : `toFloat64OrNull(toString(${f}))`);
  // Window mode: an aggregate over no values is NULL (an empty bucket), not 0 / nan (Kibana's
  // empty rows); count, sum and unique count of nothing stay 0.
  const orNull = ctx.window ? 'OrNull' : '';

  if (fn.name === 'standard_deviation') {
    return stdDevSql(x!, cond);
  }
  if (fn.name === 'last_value') {
    return lastValueSql(x!, cond, ctx.config);
  }
  if (fn.name === 'percentile_rank') {
    return percentileRankSql(x!, n.named.value ? Number(n.named.value.value) : DEFAULT_RANK_VALUE, cond);
  }

  if (fn.name === 'count') {
    if (!f) {
      return cond ? `countIf(${cond})` : 'count()';
    }
    return cond ? `countIf(isNotNull(${f}) AND ${cond})` : `count(${f})`;
  }
  if (fn.name === 'median' || fn.name === 'percentile') {
    const level =
      fn.name === 'median' ? 0.5 : Math.min(0.9999, Math.max(0.0001, Number(n.named.percentile?.value ?? 95) / 100));
    // A number we computed, printed by us.
    const q = Number(level.toFixed(4));
    return cond ? `quantileIf${orNull}(${q})(${x}, ${cond})` : `quantile${orNull}(${q})(${x})`;
  }
  const agg = AGG_SQL[fn.name];
  const arg = fn.name === 'unique_count' ? f : x;
  const nul = fn.name === 'sum' || fn.name === 'unique_count' ? '' : orNull;
  return cond ? `${agg}If${nul}(${arg}, ${cond})` : `${agg}${nul}(${arg})`;
}

// ── Helpers for the editor ───────────────────────────────────────────────────────────────────────

/** How a field name is written in a formula: bare when it lexes as one name, else `backticked`. */
export function fieldToken(name: string): string {
  const id = IDENT_RE.exec(name);
  if (id && id[0] === name && !name.endsWith('.') && !FN_BY_NAME.has(name)) {
    return name;
  }
  return `\`${name.replace(/[\\`]/g, (c) => `\\${c}`)}\``;
}

/** Formula text for a quick function (switching a metric to Formula converts it). */
export function quickToFormula(op: string, fieldLabel?: string, percentile?: number, rankValue?: number): string {
  const f = fieldLabel !== undefined ? fieldToken(fieldLabel) : '';
  switch (op) {
    case 'count':
      return 'count()';
    case 'avg':
      return `average(${f})`;
    case 'unique':
      return `unique_count(${f})`;
    case 'std_dev':
      return `standard_deviation(${f})`;
    case 'last_value':
      return `last_value(${f})`;

    case 'percentile':
      return `percentile(${f}, percentile=${percentile ?? 95})`;
    case 'percentile_rank':
      return `percentile_rank(${f}, value=${cleanRankValue(rankValue)})`;
    case 'median':
    case 'sum':
    case 'min':
    case 'max':
      return `${op}(${f})`;
    default:
      return 'count()';
  }
}
