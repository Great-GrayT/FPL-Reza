/**
 * A small expression language for derived columns and filters.
 *
 * A formula a reader types is data, never code: it is tokenised, parsed into a
 * tree, and interpreted over columns. Using `eval` or the Function constructor
 * would be shorter and would also mean any shared link could run anything in
 * the next reader's browser.
 *
 * Evaluation is vectorised: every node returns a whole column, so a formula
 * over 253,900 rows is a handful of typed array passes rather than 253,900
 * interpreter walks.
 */
import { mean, quantileSorted, sorted, standardDeviation } from './internal.js';
import type { Frame } from './frame.js';

export class ExpressionError extends Error {
  readonly position: number;

  constructor(message: string, position: number) {
    super(message);
    this.name = 'ExpressionError';
    this.position = position;
  }
}

type TokenKind = 'number' | 'string' | 'identifier' | 'operator' | 'paren' | 'comma' | 'end';

interface Token {
  kind: TokenKind;
  text: string;
  position: number;
}

const OPERATORS = [
  '&&',
  '||',
  '==',
  '!=',
  '<=',
  '>=',
  '+',
  '-',
  '*',
  '/',
  '%',
  '^',
  '<',
  '>',
  '!',
  '?',
  ':',
];

function tokenise(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i] ?? '';
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      i += 1;
      continue;
    }
    if (char === '(' || char === ')') {
      tokens.push({ kind: 'paren', text: char, position: i });
      i += 1;
      continue;
    }
    if (char === ',') {
      tokens.push({ kind: 'comma', text: char, position: i });
      i += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      let text = '';
      i += 1;
      while (i < source.length && source[i] !== quote) {
        text += source[i] ?? '';
        i += 1;
      }
      if (i >= source.length) throw new ExpressionError('unterminated string', i);
      i += 1;
      tokens.push({ kind: 'string', text, position: i });
      continue;
    }
    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      let text = '';
      while (i < source.length && /[0-9._]/.test(source[i] ?? '')) {
        text += source[i] ?? '';
        i += 1;
      }
      tokens.push({ kind: 'number', text: text.replace(/_/g, ''), position: i });
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      let text = '';
      while (i < source.length && /[A-Za-z0-9_.]/.test(source[i] ?? '')) {
        text += source[i] ?? '';
        i += 1;
      }
      tokens.push({ kind: 'identifier', text, position: i });
      continue;
    }
    const two = source.slice(i, i + 2);
    if (OPERATORS.includes(two)) {
      tokens.push({ kind: 'operator', text: two, position: i });
      i += 2;
      continue;
    }
    if (OPERATORS.includes(char)) {
      tokens.push({ kind: 'operator', text: char, position: i });
      i += 1;
      continue;
    }
    throw new ExpressionError(`unexpected character "${char}"`, i);
  }
  tokens.push({ kind: 'end', text: '', position: source.length });
  return tokens;
}

export type Node =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'column'; name: string; position: number }
  | { type: 'unary'; operator: string; operand: Node }
  | { type: 'binary'; operator: string; left: Node; right: Node }
  | { type: 'ternary'; test: Node; whenTrue: Node; whenFalse: Node }
  | { type: 'call'; name: string; args: Node[]; position: number };

/** Binding powers. Comparison binds tighter than the boolean operators, as expected. */
const PRECEDENCE: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '>': 4,
  '<=': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
  '^': 7,
};

export function parse(source: string): Node {
  const tokens = tokenise(source);
  let position = 0;

  const peek = (): Token => tokens[position] ?? { kind: 'end', text: '', position: source.length };
  const next = (): Token => {
    const token = peek();
    position += 1;
    return token;
  };

  function parsePrimary(): Node {
    const token = next();
    if (token.kind === 'number') return { type: 'number', value: Number(token.text) };
    if (token.kind === 'string') return { type: 'string', value: token.text };
    if (token.kind === 'operator' && (token.text === '-' || token.text === '!')) {
      return { type: 'unary', operator: token.text, operand: parseExpression(8) };
    }
    if (token.kind === 'paren' && token.text === '(') {
      const inner = parseExpression(0);
      const closing = next();
      if (closing.kind !== 'paren' || closing.text !== ')') {
        throw new ExpressionError('expected a closing parenthesis', closing.position);
      }
      return inner;
    }
    if (token.kind === 'identifier') {
      if (peek().kind === 'paren' && peek().text === '(') {
        next();
        const args: Node[] = [];
        if (!(peek().kind === 'paren' && peek().text === ')')) {
          for (;;) {
            args.push(parseExpression(0));
            const separator = peek();
            if (separator.kind === 'comma') {
              next();
              continue;
            }
            break;
          }
        }
        const closing = next();
        if (closing.kind !== 'paren' || closing.text !== ')') {
          throw new ExpressionError(
            `expected a closing parenthesis for ${token.text}`,
            closing.position,
          );
        }
        return { type: 'call', name: token.text, args, position: token.position };
      }
      if (token.text === 'true') return { type: 'number', value: 1 };
      if (token.text === 'false') return { type: 'number', value: 0 };
      if (token.text === 'null') return { type: 'number', value: Number.NaN };
      return { type: 'column', name: token.text, position: token.position };
    }
    throw new ExpressionError(
      `unexpected ${token.kind === 'end' ? 'end of formula' : `"${token.text}"`}`,
      token.position,
    );
  }

  function parseExpression(minimumPower: number): Node {
    let left = parsePrimary();
    for (;;) {
      const token = peek();
      if (token.kind === 'operator' && token.text === '?' && minimumPower <= 0) {
        next();
        const whenTrue = parseExpression(0);
        const colon = next();
        if (colon.kind !== 'operator' || colon.text !== ':') {
          throw new ExpressionError('expected ":" in a conditional', colon.position);
        }
        const whenFalse = parseExpression(0);
        left = { type: 'ternary', test: left, whenTrue, whenFalse };
        continue;
      }
      if (token.kind !== 'operator') break;
      const power = PRECEDENCE[token.text];
      if (power === undefined || power < minimumPower) break;
      next();
      // Exponentiation is right associative; everything else is left.
      const right = parseExpression(token.text === '^' ? power : power + 1);
      left = { type: 'binary', operator: token.text, left, right };
    }
    return left;
  }

  const tree = parseExpression(0);
  const trailing = peek();
  if (trailing.kind !== 'end') {
    throw new ExpressionError(
      `unexpected "${trailing.text}" after the end of the formula`,
      trailing.position,
    );
  }
  return tree;
}

export interface EvaluationContext {
  frame: Frame;
  /**
   * Row order within a partition, for the window functions. Each entry is a
   * list of row positions in this view, already in the order they happened.
   */
  partitions?: number[][];
}

type Value = Float64Array | { literal: string } | { codes: Int32Array; dictionary: string[] };

function isStringColumn(value: Value): value is { codes: Int32Array; dictionary: string[] } {
  return !(value instanceof Float64Array) && 'codes' in value;
}

function isLiteral(value: Value): value is { literal: string } {
  return !(value instanceof Float64Array) && 'literal' in value;
}

function numeric(value: Value, length: number): Float64Array {
  if (value instanceof Float64Array) return value;
  if (isLiteral(value)) {
    const parsed = Number(value.literal);
    return new Float64Array(length).fill(Number.isFinite(parsed) ? parsed : Number.NaN);
  }
  const out = new Float64Array(value.codes.length);
  for (let i = 0; i < out.length; i += 1) {
    const code = value.codes[i] ?? -1;
    out[i] = code < 0 ? Number.NaN : code;
  }
  return out;
}

/** Column names a formula reads, so a caller can check them before evaluating. */
export function referencedColumns(node: Node): string[] {
  const names = new Set<string>();
  const walk = (current: Node): void => {
    switch (current.type) {
      case 'column':
        names.add(current.name);
        break;
      case 'unary':
        walk(current.operand);
        break;
      case 'binary':
        walk(current.left);
        walk(current.right);
        break;
      case 'ternary':
        walk(current.test);
        walk(current.whenTrue);
        walk(current.whenFalse);
        break;
      case 'call':
        for (const argument of current.args) walk(argument);
        break;
      default:
        break;
    }
  };
  walk(node);
  return [...names];
}

export const FUNCTIONS: Record<string, { arity: [number, number]; description: string }> = {
  abs: { arity: [1, 1], description: 'absolute value' },
  ln: { arity: [1, 1], description: 'natural logarithm' },
  log: { arity: [1, 2], description: 'logarithm, base 10 unless a base is given' },
  exp: { arity: [1, 1], description: 'e raised to the value' },
  sqrt: { arity: [1, 1], description: 'square root' },
  floor: { arity: [1, 1], description: 'round down' },
  ceil: { arity: [1, 1], description: 'round up' },
  round: { arity: [1, 2], description: 'round to the given number of places' },
  sign: { arity: [1, 1], description: 'minus one, zero, or one' },
  min: { arity: [2, 8], description: 'smallest of its arguments, per row' },
  max: { arity: [2, 8], description: 'largest of its arguments, per row' },
  clamp: { arity: [3, 3], description: 'value bounded between a low and a high' },
  coalesce: { arity: [2, 8], description: 'first argument that is not missing' },
  if: { arity: [3, 3], description: 'conditional: if(test, then, otherwise)' },
  isnull: { arity: [1, 1], description: 'one where the value is missing' },
  per90: { arity: [2, 2], description: 'per90(total, minutes), zero safe' },
  zscore: { arity: [1, 1], description: 'standardised against the column in scope' },
  rank: { arity: [1, 1], description: 'ascending rank within the column in scope' },
  pct_rank: { arity: [1, 1], description: 'rank as a share between zero and one' },
  quantile: { arity: [2, 2], description: 'quantile(column, p) of the column in scope' },
  lag: { arity: [1, 2], description: 'value n rows earlier within the partition' },
  lead: { arity: [1, 2], description: 'value n rows later within the partition' },
  diff: { arity: [1, 2], description: 'change since n rows earlier within the partition' },
  rolling_mean: { arity: [2, 2], description: 'mean of the last n rows in the partition' },
  rolling_sum: { arity: [2, 2], description: 'sum of the last n rows in the partition' },
  rolling_max: { arity: [2, 2], description: 'largest of the last n rows in the partition' },
  ewma: { arity: [2, 2], description: 'exponentially weighted mean by half life' },
  cumsum: { arity: [1, 1], description: 'running total within the partition' },
};

export function evaluate(node: Node, context: EvaluationContext): Float64Array {
  const value = evaluateNode(node, context);
  return numeric(value, context.frame.length);
}

/** Evaluate to a 0/1 mask, which is what a filter needs. Missing counts as false. */
export function evaluateMask(node: Node, context: EvaluationContext): Uint8Array {
  const values = evaluate(node, context);
  const mask = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] ?? Number.NaN;
    mask[i] = Number.isNaN(value) ? 0 : value !== 0 ? 1 : 0;
  }
  return mask;
}

function evaluateNode(node: Node, context: EvaluationContext): Value {
  const length = context.frame.length;
  switch (node.type) {
    case 'number':
      return new Float64Array(length).fill(node.value);
    case 'string':
      return { literal: node.value };
    case 'column': {
      if (!context.frame.has(node.name)) {
        const suggestion = closestColumn(node.name, context.frame.columns);
        throw new ExpressionError(
          `no column named "${node.name}"${suggestion === null ? '' : `, did you mean "${suggestion}"`}`,
          node.position,
        );
      }
      const column = context.frame.rawColumn(node.name);
      if (column?.kind === 'string') {
        const strings = context.frame.strings(node.name);
        const dictionary: string[] = [];
        const lookup = new Map<string, number>();
        const codes = new Int32Array(length);
        strings.forEach((value, i) => {
          if (value === null) {
            codes[i] = -1;
            return;
          }
          let code = lookup.get(value);
          if (code === undefined) {
            code = dictionary.length;
            dictionary.push(value);
            lookup.set(value, code);
          }
          codes[i] = code;
        });
        return { codes, dictionary };
      }
      return context.frame.values(node.name);
    }
    case 'unary': {
      const operand = numeric(evaluateNode(node.operand, context), length);
      const out = new Float64Array(length);
      for (let i = 0; i < length; i += 1) {
        const value = operand[i] ?? Number.NaN;
        out[i] =
          node.operator === '-' ? -value : Number.isNaN(value) ? Number.NaN : value === 0 ? 1 : 0;
      }
      return out;
    }
    case 'binary':
      return evaluateBinary(node.operator, node.left, node.right, context);
    case 'ternary': {
      const test = numeric(evaluateNode(node.test, context), length);
      const whenTrue = numeric(evaluateNode(node.whenTrue, context), length);
      const whenFalse = numeric(evaluateNode(node.whenFalse, context), length);
      const out = new Float64Array(length);
      for (let i = 0; i < length; i += 1) {
        const flag = test[i] ?? Number.NaN;
        out[i] = Number.isNaN(flag)
          ? Number.NaN
          : flag !== 0
            ? (whenTrue[i] ?? Number.NaN)
            : (whenFalse[i] ?? Number.NaN);
      }
      return out;
    }
    case 'call':
      return evaluateCall(node, context);
    default:
      return new Float64Array(length).fill(Number.NaN);
  }
}

function evaluateBinary(
  operator: string,
  leftNode: Node,
  rightNode: Node,
  context: EvaluationContext,
): Value {
  const length = context.frame.length;
  const left = evaluateNode(leftNode, context);
  const right = evaluateNode(rightNode, context);

  // A string column compared against a literal is the common filter, and it
  // compares dictionary text rather than codes, which are frame specific.
  if ((operator === '==' || operator === '!=') && (isStringColumn(left) || isStringColumn(right))) {
    const column = isStringColumn(left) ? left : isStringColumn(right) ? right : null;
    const other = isStringColumn(left) ? right : left;
    if (column !== null && isLiteral(other)) {
      const target = column.dictionary.indexOf(other.literal);
      const out = new Float64Array(length);
      for (let i = 0; i < length; i += 1) {
        const code = column.codes[i] ?? -1;
        if (code < 0) {
          out[i] = Number.NaN;
          continue;
        }
        const same = code === target;
        out[i] = (operator === '==' ? same : !same) ? 1 : 0;
      }
      return out;
    }
  }

  const a = numeric(left, length);
  const b = numeric(right, length);
  const out = new Float64Array(length);
  for (let i = 0; i < length; i += 1) {
    const x = a[i] ?? Number.NaN;
    const y = b[i] ?? Number.NaN;
    switch (operator) {
      case '+':
        out[i] = x + y;
        break;
      case '-':
        out[i] = x - y;
        break;
      case '*':
        out[i] = x * y;
        break;
      case '/':
        // Division by zero is missing, not infinity: an infinite rate poisons
        // every mean and chart downstream of it.
        out[i] = y === 0 ? Number.NaN : x / y;
        break;
      case '%':
        out[i] = y === 0 ? Number.NaN : x % y;
        break;
      case '^':
        out[i] = x ** y;
        break;
      case '<':
        out[i] = Number.isNaN(x) || Number.isNaN(y) ? Number.NaN : x < y ? 1 : 0;
        break;
      case '>':
        out[i] = Number.isNaN(x) || Number.isNaN(y) ? Number.NaN : x > y ? 1 : 0;
        break;
      case '<=':
        out[i] = Number.isNaN(x) || Number.isNaN(y) ? Number.NaN : x <= y ? 1 : 0;
        break;
      case '>=':
        out[i] = Number.isNaN(x) || Number.isNaN(y) ? Number.NaN : x >= y ? 1 : 0;
        break;
      case '==':
        out[i] = Number.isNaN(x) || Number.isNaN(y) ? Number.NaN : x === y ? 1 : 0;
        break;
      case '!=':
        out[i] = Number.isNaN(x) || Number.isNaN(y) ? Number.NaN : x !== y ? 1 : 0;
        break;
      case '&&':
        out[i] = x !== 0 && y !== 0 ? 1 : 0;
        break;
      case '||':
        out[i] = x !== 0 || y !== 0 ? 1 : 0;
        break;
      default:
        out[i] = Number.NaN;
    }
  }
  return out;
}

function evaluateCall(
  node: { name: string; args: Node[]; position: number },
  context: EvaluationContext,
): Value {
  const length = context.frame.length;
  const signature = FUNCTIONS[node.name];
  if (signature === undefined) {
    throw new ExpressionError(`no function named "${node.name}"`, node.position);
  }
  const [minimum, maximum] = signature.arity;
  if (node.args.length < minimum || node.args.length > maximum) {
    throw new ExpressionError(
      `${node.name} takes ${minimum === maximum ? `${minimum}` : `${minimum} to ${maximum}`} arguments`,
      node.position,
    );
  }

  const argument = (index: number): Float64Array => {
    const child = node.args[index];
    if (child === undefined) return new Float64Array(length).fill(Number.NaN);
    return numeric(evaluateNode(child, context), length);
  };
  const constant = (index: number, fallback: number): number => {
    const values = argument(index);
    const value = values[0] ?? fallback;
    return Number.isFinite(value) ? value : fallback;
  };

  const out = new Float64Array(length);
  switch (node.name) {
    case 'abs':
    case 'ln':
    case 'exp':
    case 'sqrt':
    case 'floor':
    case 'ceil':
    case 'sign': {
      const values = argument(0);
      const unary: Record<string, (value: number) => number> = {
        abs: Math.abs,
        ln: (value) => (value > 0 ? Math.log(value) : Number.NaN),
        exp: Math.exp,
        sqrt: (value) => (value >= 0 ? Math.sqrt(value) : Number.NaN),
        floor: Math.floor,
        ceil: Math.ceil,
        sign: Math.sign,
      };
      const fn = unary[node.name] ?? ((value: number): number => value);
      for (let i = 0; i < length; i += 1) out[i] = fn(values[i] ?? Number.NaN);
      return out;
    }
    case 'log': {
      const values = argument(0);
      const base = node.args.length > 1 ? constant(1, 10) : 10;
      for (let i = 0; i < length; i += 1) {
        const value = values[i] ?? Number.NaN;
        out[i] = value > 0 ? Math.log(value) / Math.log(base) : Number.NaN;
      }
      return out;
    }
    case 'round': {
      const values = argument(0);
      const places = node.args.length > 1 ? constant(1, 0) : 0;
      const factor = 10 ** places;
      for (let i = 0; i < length; i += 1)
        out[i] = Math.round((values[i] ?? Number.NaN) * factor) / factor;
      return out;
    }
    case 'min':
    case 'max': {
      const columns = node.args.map((_, index) => argument(index));
      for (let i = 0; i < length; i += 1) {
        let best = Number.NaN;
        for (const column of columns) {
          const value = column[i] ?? Number.NaN;
          if (Number.isNaN(value)) continue;
          if (Number.isNaN(best)) best = value;
          else best = node.name === 'min' ? Math.min(best, value) : Math.max(best, value);
        }
        out[i] = best;
      }
      return out;
    }
    case 'clamp': {
      const values = argument(0);
      const low = argument(1);
      const high = argument(2);
      for (let i = 0; i < length; i += 1) {
        const value = values[i] ?? Number.NaN;
        out[i] = Number.isNaN(value)
          ? Number.NaN
          : Math.min(
              Math.max(value, low[i] ?? Number.NEGATIVE_INFINITY),
              high[i] ?? Number.POSITIVE_INFINITY,
            );
      }
      return out;
    }
    case 'coalesce': {
      const columns = node.args.map((_, index) => argument(index));
      for (let i = 0; i < length; i += 1) {
        let chosen = Number.NaN;
        for (const column of columns) {
          const value = column[i] ?? Number.NaN;
          if (!Number.isNaN(value)) {
            chosen = value;
            break;
          }
        }
        out[i] = chosen;
      }
      return out;
    }
    case 'if': {
      const test = argument(0);
      const whenTrue = argument(1);
      const whenFalse = argument(2);
      for (let i = 0; i < length; i += 1) {
        const flag = test[i] ?? Number.NaN;
        out[i] = Number.isNaN(flag)
          ? Number.NaN
          : flag !== 0
            ? (whenTrue[i] ?? Number.NaN)
            : (whenFalse[i] ?? Number.NaN);
      }
      return out;
    }
    case 'isnull': {
      const values = argument(0);
      for (let i = 0; i < length; i += 1) out[i] = Number.isNaN(values[i] ?? Number.NaN) ? 1 : 0;
      return out;
    }
    case 'per90': {
      const totals = argument(0);
      const minutes = argument(1);
      for (let i = 0; i < length; i += 1) {
        const played = minutes[i] ?? Number.NaN;
        out[i] = !(played > 0) ? Number.NaN : ((totals[i] ?? Number.NaN) * 90) / played;
      }
      return out;
    }
    case 'zscore': {
      const values = argument(0);
      const finite = Array.from(values).filter((value) => Number.isFinite(value));
      const m = mean(finite);
      const sd = standardDeviation(finite);
      for (let i = 0; i < length; i += 1) {
        const value = values[i] ?? Number.NaN;
        out[i] = sd > 0 ? (value - m) / sd : Number.NaN;
      }
      return out;
    }
    case 'rank':
    case 'pct_rank': {
      const values = argument(0);
      const order = Array.from({ length }, (_, i) => i).filter((i) =>
        Number.isFinite(values[i] ?? Number.NaN),
      );
      order.sort((a, b) => (values[a] ?? 0) - (values[b] ?? 0));
      out.fill(Number.NaN);
      order.forEach((row, position) => {
        out[row] =
          node.name === 'rank'
            ? position + 1
            : order.length <= 1
              ? 0.5
              : position / (order.length - 1);
      });
      return out;
    }
    case 'quantile': {
      const values = argument(0);
      const p = constant(1, 0.5);
      const ascending = sorted(Array.from(values).filter((value) => Number.isFinite(value)));
      out.fill(quantileSorted(ascending, p));
      return out;
    }
    case 'lag':
    case 'lead':
    case 'diff': {
      const values = argument(0);
      const offset = node.args.length > 1 ? Math.round(constant(1, 1)) : 1;
      out.fill(Number.NaN);
      for (const partition of partitionsOf(context)) {
        partition.forEach((row, position) => {
          const source = node.name === 'lead' ? position + offset : position - offset;
          const other = partition[source];
          if (other === undefined) return;
          const value = values[other] ?? Number.NaN;
          out[row] = node.name === 'diff' ? (values[row] ?? Number.NaN) - value : value;
        });
      }
      return out;
    }
    case 'rolling_mean':
    case 'rolling_sum':
    case 'rolling_max': {
      const values = argument(0);
      const window = Math.max(1, Math.round(constant(1, 3)));
      out.fill(Number.NaN);
      for (const partition of partitionsOf(context)) {
        partition.forEach((row, position) => {
          if (position + 1 < window) return;
          let total = 0;
          let best = Number.NEGATIVE_INFINITY;
          let counted = 0;
          for (let k = position - window + 1; k <= position; k += 1) {
            const other = partition[k];
            if (other === undefined) continue;
            const value = values[other] ?? Number.NaN;
            if (Number.isNaN(value)) continue;
            total += value;
            best = Math.max(best, value);
            counted += 1;
          }
          if (counted === 0) return;
          out[row] =
            node.name === 'rolling_sum'
              ? total
              : node.name === 'rolling_max'
                ? best
                : total / counted;
        });
      }
      return out;
    }
    case 'ewma': {
      const values = argument(0);
      const life = Math.max(constant(1, 3), 1e-9);
      const alpha = 1 - Math.exp(-Math.LN2 / life);
      out.fill(Number.NaN);
      for (const partition of partitionsOf(context)) {
        let current = Number.NaN;
        for (const row of partition) {
          const value = values[row] ?? Number.NaN;
          if (!Number.isNaN(value)) {
            current = Number.isNaN(current) ? value : alpha * value + (1 - alpha) * current;
          }
          out[row] = current;
        }
      }
      return out;
    }
    case 'cumsum': {
      const values = argument(0);
      out.fill(Number.NaN);
      for (const partition of partitionsOf(context)) {
        let total = 0;
        let seen = false;
        for (const row of partition) {
          const value = values[row] ?? Number.NaN;
          if (!Number.isNaN(value)) {
            total += value;
            seen = true;
          }
          out[row] = seen ? total : Number.NaN;
        }
      }
      return out;
    }
    default:
      throw new ExpressionError(
        `function "${node.name}" is declared but not implemented`,
        node.position,
      );
  }
}

/** With no partitions declared the whole view is one ordered partition. */
function partitionsOf(context: EvaluationContext): number[][] {
  if (context.partitions !== undefined) return context.partitions;
  return [Array.from({ length: context.frame.length }, (_, i) => i)];
}

/** Levenshtein distance, used only to suggest the column a typo meant. */
function closestColumn(name: string, candidates: string[]): string | null {
  let best: { name: string; distance: number } | null = null;
  const target = name.toLowerCase();
  for (const candidate of candidates) {
    const distance = editDistance(target, candidate.toLowerCase());
    if (best === null || distance < best.distance) best = { name: candidate, distance };
  }
  if (best === null) return null;
  return best.distance <= Math.max(2, Math.floor(name.length / 3)) ? best.name : null;
}

function editDistance(a: string, b: string): number {
  const previous: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  const current: number[] = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j] ?? 0;
  }
  return previous[b.length] ?? 0;
}

/** Parse and evaluate in one call, which is what a panel does per keystroke. */
export function compute(formula: string, context: EvaluationContext): Float64Array {
  return evaluate(parse(formula), context);
}
