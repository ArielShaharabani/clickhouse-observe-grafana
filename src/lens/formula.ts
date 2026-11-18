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
  kind: 'agg' | 'math';
  args: FormulaFnArg[];
  description: string;
  /** Aggregations: the field must be numeric. */
  numeric?: boolean;
}

const KQL: FormulaFnArg = { name: 'kql', type: 'string', optional: true, named: true };
const FIELD: FormulaFnArg = { name: 'field', type: 'field' };
const X: FormulaFnArg = { name: 'value', type: 'expr' };

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
    name: 'unique_count',
    kind: 'agg',
    args: [FIELD, KQL],
    description: 'Number of distinct values of a field (approximate).',
  },
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
  { name: 'pick_max', kind: 'math', args: [X, { name: 'other', type: 'expr' }], description: 'The larger of two values.' },
  { name: 'pick_min', kind: 'math', args: [X, { name: 'other', type: 'expr' }], description: 'The smaller of two values.' },
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
          const v = this.next();
          if (v.kind !== 'str' && v.kind !== 'num') {
            throw new FormulaError(`Expected a string or number for ${t.text}=`, v.pos);
          }
          if (t.text in named) {
            throw new FormulaError(`Argument ${t.text} given twice`, t.pos);
          }
          named[t.text] = { kind: v.kind, value: v.kind === 'str' ? v.value! : v.text };
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

/**
 * All errors of a parsed formula against the fields it may use (the editor shows every one; the
 * compiler refuses a formula with any).
 */
export function validateFormula(node: FormulaNode, fields: FormulaFields): FormulaError[] {
  const errors: FormulaError[] = [];
  let aggs = 0;
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
              new FormulaError(k === 'shift' ? 'Time shift is not supported yet' : `${n.fn} has no argument ${k}`, n.pos)
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
  index?: FieldIndex;
  /**
   * SQL for a saved dashboard panel: `$` in a KQL filter is written as $ (inside string literals
   * / quoted identifiers, the only places KQL output can hold it) so the datasource's macro and
   * variable expander never sees `$…` text that came from a formula.
   */
  dashboard?: boolean;
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
      return emitAgg(n, fn, fields, ctx);
    }
  }
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
  const cond = kqlSql ? `(${ctx.dashboard ? kqlSql.replace(/\$/g, () => '\\x24') : kqlSql})` : undefined;
  // Same cast the quick functions use for a field not typed as a number.
  const x = f && (ref!.numeric ? f : `toFloat64OrNull(toString(${f}))`);

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
    return cond ? `quantileIf(${q})(${x}, ${cond})` : `quantile(${q})(${x})`;
  }
  const agg = AGG_SQL[fn.name];
  const arg = fn.name === 'unique_count' ? f : x;
  return cond ? `${agg}If(${arg}, ${cond})` : `${agg}(${arg})`;
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
export function quickToFormula(op: string, fieldLabel?: string, percentile?: number): string {
  const f = fieldLabel !== undefined ? fieldToken(fieldLabel) : '';
  switch (op) {
    case 'count':
      return 'count()';
    case 'avg':
      return `average(${f})`;
    case 'unique':
      return `unique_count(${f})`;
    case 'percentile':
      return `percentile(${f}, percentile=${percentile ?? 95})`;
    case 'median':
    case 'sum':
    case 'min':
    case 'max':
      return `${op}(${f})`;
    default:
      return 'count()';
  }
}
