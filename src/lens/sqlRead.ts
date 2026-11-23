/**
 * A small reader for the dashboard SQL a panel can hold (R6-PANELS): one SELECT from one table.
 * Tokenizer + recursive-descent expression parser. It only builds a syntax tree; nothing parsed here
 * is ever put back into SQL (panelImport turns the tree into a Lens state, whose fields and filters go
 * through the usual cleaners). Anything it does not understand throws `SqlReadError` with a reason, so
 * the caller can say "not supported" instead of guessing.
 */

export class SqlReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlReadError';
  }
}

export type Tok =
  | { k: 'id'; v: string; quoted: boolean }
  | { k: 'num'; v: string }
  | { k: 'str'; v: string }
  | { k: 'op'; v: string }
  | { k: 'p'; v: string }
  | { k: 'macro'; v: string }
  | { k: 'var'; v: string };

export const MAX_SQL_LEN = 20_000;
const MAX_TOKENS = 4000;
const MAX_DEPTH = 40;

const isIdStart = (c: string) => /[A-Za-z_]/.test(c);
const isIdChar = (c: string) => /[A-Za-z0-9_]/.test(c);
const isDigit = (c: string) => c >= '0' && c <= '9';

export function tokenize(sql: string): Tok[] {
  if (sql.length > MAX_SQL_LEN) {
    throw new SqlReadError('The SQL is too long');
  }
  const out: Tok[] = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (out.length > MAX_TOKENS) {
      throw new SqlReadError('The SQL is too long');
    }
    if (/\s/.test(c)) {
      i++;
    } else if (c === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') {
        i++;
      }
    } else if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end < 0) {
        throw new SqlReadError('Unterminated comment');
      }
      i = end + 2;
    } else if (c === "'") {
      let v = '';
      i++;
      for (;;) {
        if (i >= n) {
          throw new SqlReadError('Unterminated string');
        }
        if (sql[i] === '\\' && i + 1 < n) {
          const e = sql[i + 1];
          v += e === 'n' ? '\n' : e === 't' ? '\t' : e;
          i += 2;
        } else if (sql[i] === "'" && sql[i + 1] === "'") {
          v += "'";
          i += 2;
        } else if (sql[i] === "'") {
          i++;
          break;
        } else {
          v += sql[i++];
        }
      }
      out.push({ k: 'str', v });
    } else if (c === '`' || c === '"') {
      let v = '';
      i++;
      for (;;) {
        if (i >= n) {
          throw new SqlReadError('Unterminated quoted identifier');
        }
        if (sql[i] === c && sql[i + 1] === c) {
          v += c;
          i += 2;
        } else if (sql[i] === c) {
          i++;
          break;
        } else {
          v += sql[i++];
        }
      }
      if (!v) {
        throw new SqlReadError('Empty identifier');
      }
      out.push({ k: 'id', v, quoted: true });
    } else if (c === '$') {
      if (sql[i + 1] === '{') {
        const end = sql.indexOf('}', i);
        if (end < 0) {
          throw new SqlReadError('Unterminated variable');
        }
        out.push({ k: 'var', v: sql.slice(i, end + 1) });
        i = end + 1;
      } else {
        let j = i + 1;
        while (j < n && isIdChar(sql[j])) {
          j++;
        }
        const name = sql.slice(i + 1, j);
        if (!name) {
          throw new SqlReadError('Unexpected "$"');
        }
        out.push(name.startsWith('__') ? { k: 'macro', v: name.slice(2) } : { k: 'var', v: `$${name}` });
        i = j;
      }
    } else if (c === '[' && sql[i + 1] === '[') {
      const end = sql.indexOf(']]', i);
      if (end < 0) {
        throw new SqlReadError('Unterminated variable');
      }
      out.push({ k: 'var', v: sql.slice(i, end + 2) });
      i = end + 2;
    } else if (isDigit(c) || (c === '.' && isDigit(sql[i + 1] ?? ''))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(sql.slice(i, i + 40));
      if (!m) {
        throw new SqlReadError('Bad number');
      }
      out.push({ k: 'num', v: m[0] });
      i += m[0].length;
    } else if (isIdStart(c)) {
      let j = i + 1;
      while (j < n && isIdChar(sql[j])) {
        j++;
      }
      out.push({ k: 'id', v: sql.slice(i, j), quoted: false });
      i = j;
    } else if ('(),.[];'.includes(c)) {
      out.push({ k: 'p', v: c });
      i++;
    } else {
      const two = sql.slice(i, i + 2);
      if (['!=', '<>', '<=', '>=', '||', '::', '->'].includes(two)) {
        out.push({ k: 'op', v: two });
        i += 2;
      } else if ('=<>+-*/%'.includes(c)) {
        out.push({ k: 'op', v: c });
        i++;
      } else {
        throw new SqlReadError(`Unexpected character "${c.slice(0, 1)}"`);
      }
    }
  }
  return out;
}

export type Expr =
  | { t: 'col'; parts: string[] }
  | { t: 'idx'; base: Expr; key: string }
  | { t: 'num'; v: string }
  | { t: 'str'; v: string }
  | { t: 'star' }
  | { t: 'call'; name: string; params?: Expr[]; args: Expr[]; distinct?: boolean }
  | { t: 'macro'; name: string; args: Expr[] }
  | { t: 'bin'; op: string; l: Expr; r: Expr }
  | { t: 'un'; op: string; e: Expr }
  | { t: 'and'; items: Expr[] }
  | { t: 'or'; items: Expr[] }
  | { t: 'not'; e: Expr }
  | { t: 'in'; e: Expr; list: Expr[]; neg: boolean }
  | { t: 'like'; e: Expr; pat: Expr; neg: boolean; ci: boolean }
  | { t: 'between'; e: Expr; lo: Expr; hi: Expr; neg: boolean }
  | { t: 'isnull'; e: Expr; neg: boolean }
  | { t: 'interval'; n: Expr; unit: string };

export interface SelectItem {
  expr: Expr;
  alias?: string;
}

export interface OrderItem {
  expr: Expr;
  dir: 'asc' | 'desc';
}

export interface SelectQuery {
  items: SelectItem[];
  database?: string;
  table: string;
  tableAlias?: string;
  where?: Expr;
  groupBy: Expr[];
  orderBy: OrderItem[];
  limit?: number;
  /** Trailing clauses that are ignored (SETTINGS, FORMAT): reported as notes. */
  ignored: string[];
}

const RESERVED = new Set([
  'FROM', 'WHERE', 'GROUP', 'ORDER', 'LIMIT', 'HAVING', 'UNION', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS',
  'ON', 'USING', 'AS', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'ILIKE', 'BETWEEN', 'IS', 'SETTINGS', 'FORMAT', 'WITH',
  'OFFSET', 'BY', 'ASC', 'DESC', 'SELECT', 'DISTINCT', 'FINAL', 'SAMPLE', 'ARRAY', 'PREWHERE', 'WINDOW', 'QUALIFY',
  'INTERSECT', 'EXCEPT', 'LIMIT',
]);

class Parser {
  private p = 0;
  private depth = 0;
  constructor(private readonly toks: Tok[]) {}

  get done(): boolean {
    return this.p >= this.toks.length;
  }
  peek(o = 0): Tok | undefined {
    return this.toks[this.p + o];
  }
  /** Upper-cased bare keyword at the cursor (never a quoted identifier). */
  kw(o = 0): string {
    const t = this.peek(o);
    return t && t.k === 'id' && !t.quoted ? t.v.toUpperCase() : '';
  }
  isP(v: string, o = 0): boolean {
    const t = this.peek(o);
    return !!t && t.k === 'p' && t.v === v;
  }
  isOp(v: string): boolean {
    const t = this.peek();
    return !!t && t.k === 'op' && t.v === v;
  }
  next(): Tok {
    const t = this.toks[this.p++];
    if (!t) {
      throw new SqlReadError('The SQL ends unexpectedly');
    }
    return t;
  }
  eatKw(v: string): boolean {
    if (this.kw() === v) {
      this.p++;
      return true;
    }
    return false;
  }
  expectKw(v: string): void {
    if (!this.eatKw(v)) {
      throw new SqlReadError(`Expected ${v}`);
    }
  }
  eatP(v: string): boolean {
    if (this.isP(v)) {
      this.p++;
      return true;
    }
    return false;
  }
  expectP(v: string): void {
    if (!this.eatP(v)) {
      throw new SqlReadError(`Expected "${v}"`);
    }
  }

  private enter(): void {
    if (++this.depth > MAX_DEPTH) {
      throw new SqlReadError('The expression is nested too deeply');
    }
  }
  private leave(): void {
    this.depth--;
  }

  parseQuery(): SelectQuery {
    const first = this.kw();
    if (first === 'WITH') {
      throw new SqlReadError('WITH (common table expressions) is not supported');
    }
    if (first !== 'SELECT') {
      throw new SqlReadError('Only a SELECT query can be read');
    }
    this.p++;
    if (this.kw() === 'DISTINCT') {
      throw new SqlReadError('SELECT DISTINCT is not supported');
    }
    const items: SelectItem[] = [];
    do {
      const expr = this.expr();
      let alias: string | undefined;
      if (this.eatKw('AS')) {
        alias = this.ident();
      } else {
        const t = this.peek();
        if (t && t.k === 'id' && (t.quoted || !RESERVED.has(t.v.toUpperCase()))) {
          alias = this.ident();
        }
      }
      items.push({ expr, alias });
    } while (this.eatP(','));
    this.expectKw('FROM');
    if (this.isP('(')) {
      throw new SqlReadError('A subquery is not supported');
    }
    const first1 = this.ident();
    let database: string | undefined;
    let table = first1;
    if (this.eatP('.')) {
      database = first1;
      table = this.ident();
    }
    if (this.isP('(')) {
      throw new SqlReadError('A table function is not supported');
    }
    let tableAlias: string | undefined;
    if (this.eatKw('AS')) {
      tableAlias = this.ident();
    } else {
      const t = this.peek();
      if (t && t.k === 'id' && (t.quoted || !RESERVED.has(t.v.toUpperCase()))) {
        tableAlias = this.ident();
      }
    }
    const q: SelectQuery = { items, database, table, tableAlias, groupBy: [], orderBy: [], ignored: [] };
    for (;;) {
      const k = this.kw();
      if (this.eatP(',')) {
        throw new SqlReadError('Several tables (a join) are not supported');
      }
      if (['JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'ARRAY', 'GLOBAL', 'ANY', 'ALL', 'ASOF'].includes(k)) {
        throw new SqlReadError('A join is not supported');
      }
      if (k === 'FINAL' || k === 'SAMPLE' || k === 'PREWHERE') {
        throw new SqlReadError(`${k} is not supported`);
      }
      if (k === 'WHERE') {
        this.p++;
        q.where = this.expr();
      } else if (k === 'GROUP') {
        this.p++;
        this.expectKw('BY');
        do {
          q.groupBy.push(this.expr());
        } while (this.eatP(','));
        if (this.kw() === 'WITH') {
          throw new SqlReadError('GROUP BY WITH ROLLUP / CUBE / TOTALS is not supported');
        }
      } else if (k === 'HAVING') {
        throw new SqlReadError('HAVING is not supported');
      } else if (k === 'ORDER') {
        this.p++;
        this.expectKw('BY');
        do {
          const expr = this.expr();
          let dir: 'asc' | 'desc' = 'asc';
          if (this.eatKw('DESC')) {
            dir = 'desc';
          } else {
            this.eatKw('ASC');
          }
          if (['WITH', 'NULLS', 'COLLATE'].includes(this.kw())) {
            throw new SqlReadError('ORDER BY modifiers (WITH FILL, NULLS, COLLATE) are not supported');
          }
          q.orderBy.push({ expr, dir });
        } while (this.eatP(','));
      } else if (k === 'LIMIT') {
        this.p++;
        const t = this.next();
        if (t.k !== 'num' || !/^\d{1,9}$/.test(t.v)) {
          throw new SqlReadError('LIMIT must be a whole number');
        }
        q.limit = Number(t.v);
        if (this.isP(',') || this.kw() === 'OFFSET' || this.kw() === 'BY') {
          throw new SqlReadError('LIMIT with an offset or BY is not supported');
        }
      } else if (k === 'UNION' || k === 'INTERSECT' || k === 'EXCEPT') {
        throw new SqlReadError(`${k} is not supported`);
      } else if (k === 'SETTINGS' || k === 'FORMAT') {
        q.ignored.push(k);
        this.p = this.toks.length;
      } else if (k === 'WINDOW' || k === 'QUALIFY') {
        throw new SqlReadError(`${k} is not supported`);
      } else if (this.eatP(';')) {
        // trailing semicolon
      } else {
        break;
      }
    }
    if (!this.done) {
      throw new SqlReadError('The SQL has parts that cannot be read');
    }
    return q;
  }

  ident(): string {
    const t = this.next();
    if (t.k !== 'id') {
      throw new SqlReadError('Expected a name');
    }
    return t.v;
  }

  expr(): Expr {
    this.enter();
    try {
      return this.orExpr();
    } finally {
      this.leave();
    }
  }

  private orExpr(): Expr {
    const items = [this.andExpr()];
    while (this.eatKw('OR')) {
      items.push(this.andExpr());
    }
    return items.length === 1 ? items[0] : { t: 'or', items };
  }

  private andExpr(): Expr {
    const items = [this.notExpr()];
    while (this.kw() === 'AND') {
      this.p++;
      items.push(this.notExpr());
    }
    return items.length === 1 ? items[0] : { t: 'and', items };
  }

  private notExpr(): Expr {
    if (this.kw() === 'NOT' && this.kw(1) !== 'IN' && this.kw(1) !== 'LIKE') {
      this.p++;
      this.enter();
      try {
        return { t: 'not', e: this.notExpr() };
      } finally {
        this.leave();
      }
    }
    return this.cmpExpr();
  }

  private cmpExpr(): Expr {
    const l = this.addExpr();
    const t = this.peek();
    if (t && t.k === 'op' && ['=', '!=', '<>', '<', '>', '<=', '>='].includes(t.v)) {
      this.p++;
      return { t: 'bin', op: t.v === '<>' ? '!=' : t.v, l, r: this.addExpr() };
    }
    let neg = false;
    if (this.kw() === 'NOT') {
      neg = true;
      this.p++;
    }
    const k = this.kw();
    if (k === 'IN') {
      this.p++;
      this.expectP('(');
      if (this.kw() === 'SELECT') {
        throw new SqlReadError('A subquery is not supported');
      }
      const list: Expr[] = [];
      do {
        list.push(this.addExpr());
      } while (this.eatP(','));
      this.expectP(')');
      return { t: 'in', e: l, list, neg };
    }
    if (k === 'LIKE' || k === 'ILIKE') {
      this.p++;
      return { t: 'like', e: l, pat: this.addExpr(), neg, ci: k === 'ILIKE' };
    }
    if (k === 'BETWEEN') {
      this.p++;
      const lo = this.addExpr();
      this.expectKw('AND');
      return { t: 'between', e: l, lo, hi: this.addExpr(), neg };
    }
    if (neg) {
      throw new SqlReadError('Unsupported NOT');
    }
    if (k === 'IS') {
      this.p++;
      const n2 = this.eatKw('NOT');
      this.expectKw('NULL');
      return { t: 'isnull', e: l, neg: n2 };
    }
    return l;
  }

  private addExpr(): Expr {
    let l = this.mulExpr();
    for (;;) {
      const t = this.peek();
      if (t && t.k === 'op' && (t.v === '+' || t.v === '-' || t.v === '||')) {
        this.p++;
        l = { t: 'bin', op: t.v, l, r: this.mulExpr() };
      } else {
        return l;
      }
    }
  }

  private mulExpr(): Expr {
    let l = this.unary();
    for (;;) {
      const t = this.peek();
      if (t && t.k === 'op' && (t.v === '*' || t.v === '/' || t.v === '%')) {
        this.p++;
        l = { t: 'bin', op: t.v, l, r: this.unary() };
      } else {
        return l;
      }
    }
  }

  private unary(): Expr {
    if (this.isOp('-')) {
      this.p++;
      const e = this.unary();
      return e.t === 'num' ? { t: 'num', v: `-${e.v}` } : { t: 'un', op: '-', e };
    }
    return this.postfix();
  }

  private postfix(): Expr {
    let e = this.primary();
    while (this.isP('[')) {
      this.p++;
      const k = this.next();
      if (k.k !== 'str') {
        throw new SqlReadError('Only a string key is supported in [ ]');
      }
      this.expectP(']');
      e = { t: 'idx', base: e, key: k.v };
    }
    if (this.isOp('::') || this.isOp('->')) {
      throw new SqlReadError('Casts with :: and lambdas are not supported');
    }
    return e;
  }

  private args(): Expr[] {
    const list: Expr[] = [];
    if (this.eatP(')')) {
      return list;
    }
    do {
      list.push(this.isOp('*') ? (this.p++, { t: 'star' } as Expr) : this.expr());
    } while (this.eatP(','));
    this.expectP(')');
    return list;
  }

  private primary(): Expr {
    const t = this.next();
    switch (t.k) {
      case 'num':
        return { t: 'num', v: t.v };
      case 'str':
        return { t: 'str', v: t.v };
      case 'var':
        throw new SqlReadError(`It uses the template variable ${t.v.slice(0, 40)}`);
      case 'macro': {
        let args: Expr[] = [];
        if (this.eatP('(')) {
          args = this.args();
        }
        return { t: 'macro', name: t.v, args };
      }
      case 'op':
        if (t.v === '*') {
          return { t: 'star' };
        }
        throw new SqlReadError(`Unexpected "${t.v}"`);
      case 'p':
        if (t.v === '(') {
          if (this.kw() === 'SELECT' || this.kw() === 'WITH') {
            throw new SqlReadError('A subquery is not supported');
          }
          const inner = this.expr();
          if (this.isP(',')) {
            throw new SqlReadError('Tuples are not supported');
          }
          this.expectP(')');
          return inner;
        }
        throw new SqlReadError(`Unexpected "${t.v}"`);
      case 'id': {
        const up = t.quoted ? '' : t.v.toUpperCase();
        if (up === 'CASE' || up === 'CAST' || up === 'EXISTS') {
          throw new SqlReadError(`${up} expressions are not supported`);
        }
        if (up === 'INTERVAL') {
          const n = this.unary();
          const u = this.next();
          if (u.k !== 'id') {
            throw new SqlReadError('Bad INTERVAL');
          }
          return { t: 'interval', n, unit: u.v.toLowerCase() };
        }
        if (up === 'NULL' || up === 'TRUE' || up === 'FALSE') {
          throw new SqlReadError(`${up} literals are not supported`);
        }
        if (this.isP('(') && !t.quoted) {
          this.p++;
          let distinct = false;
          if (this.kw() === 'DISTINCT') {
            this.p++;
            distinct = true;
          }
          let params: Expr[] | undefined;
          let args = this.args();
          if (this.isP('(')) {
            // parametric aggregate: quantile(0.95)(x)
            this.p++;
            params = args;
            args = this.args();
          }
          if (this.kw() === 'OVER') {
            throw new SqlReadError('Window functions are not supported');
          }
          return { t: 'call', name: t.v, args, ...(params ? { params } : {}), ...(distinct ? { distinct } : {}) };
        }
        const parts = [t.v];
        while (this.isP('.')) {
          this.p++;
          const n = this.next();
          if (n.k !== 'id') {
            throw new SqlReadError('Expected a name after "."');
          }
          parts.push(n.v);
        }
        return { t: 'col', parts };
      }
    }
  }
}

/** Reads one SELECT. Throws SqlReadError with a human reason when it is not the supported shape. */
export function readSelect(sql: string): SelectQuery {
  return new Parser(tokenize(sql)).parseQuery();
}

/** Stable text of an expression, for comparing select items with GROUP BY / ORDER BY. */
export const exprKey = (e: Expr): string => JSON.stringify(e);
