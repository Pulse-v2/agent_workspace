/**
 * Safe arithmetic evaluator. A small recursive-descent parser over a fixed
 * grammar; there is no eval, Function constructor, or property access, so model
 * input can only ever compute a number.
 *
 *   expression := term (("+" | "-") term)*
 *   term       := unary (("*" | "/" | "%") unary)*
 *   unary      := ("-" | "+") unary | power
 *   power      := primary ("^" unary)?            (right-associative)
 *   primary    := number | constant | function "(" args ")" | "(" expression ")"
 */

export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpressionError";
  }
}

const MAX_LENGTH = 500;
const MAX_TOKENS = 300;
const MAX_DEPTH = 40;

const constants: Record<string, number> = { pi: Math.PI, e: Math.E };

const functions: Record<string, { arity: [number, number]; apply: (args: number[]) => number }> = {
  abs: { arity: [1, 1], apply: ([x]) => Math.abs(x!) },
  sqrt: { arity: [1, 1], apply: ([x]) => {
    if (x! < 0) throw new ExpressionError("sqrt of a negative number is undefined.");
    return Math.sqrt(x!);
  } },
  round: { arity: [1, 2], apply: ([x, digits = 0]) => {
    if (!Number.isInteger(digits) || digits < 0 || digits > 12) throw new ExpressionError("round digits must be an integer from 0 to 12.");
    const factor = 10 ** digits;
    return Math.round(x! * factor) / factor;
  } },
  floor: { arity: [1, 1], apply: ([x]) => Math.floor(x!) },
  ceil: { arity: [1, 1], apply: ([x]) => Math.ceil(x!) },
  min: { arity: [1, 50], apply: (args) => Math.min(...args) },
  max: { arity: [1, 50], apply: (args) => Math.max(...args) },
  ln: { arity: [1, 1], apply: ([x]) => {
    if (x! <= 0) throw new ExpressionError("ln is only defined for positive numbers.");
    return Math.log(x!);
  } },
  log10: { arity: [1, 1], apply: ([x]) => {
    if (x! <= 0) throw new ExpressionError("log10 is only defined for positive numbers.");
    return Math.log10(x!);
  } },
  exp: { arity: [1, 1], apply: ([x]) => Math.exp(x!) },
  pow: { arity: [2, 2], apply: ([x, y]) => x! ** y! },
};

type Token =
  | { type: "number"; value: number }
  | { type: "identifier"; value: string }
  | { type: "operator"; value: "+" | "-" | "*" | "/" | "%" | "^" | "(" | ")" | "," };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    const number = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(index));
    if (number) {
      tokens.push({ type: "number", value: Number(number[0]) });
      index += number[0].length;
    } else if (/[a-z_]/i.test(char)) {
      const identifier = /^[a-z_][a-z0-9_]*/i.exec(source.slice(index))![0];
      tokens.push({ type: "identifier", value: identifier.toLowerCase() });
      index += identifier.length;
    } else if ("+-*/%^(),".includes(char)) {
      tokens.push({ type: "operator", value: char as Extract<Token, { type: "operator" }>["value"] });
      index += 1;
    } else {
      throw new ExpressionError(`Unexpected character "${char}" at position ${index + 1}.`);
    }
    if (tokens.length > MAX_TOKENS) throw new ExpressionError("Expression is too long.");
  }
  return tokens;
}

export function evaluateExpression(source: string): number {
  if (source.length > MAX_LENGTH) throw new ExpressionError(`Expression must be at most ${MAX_LENGTH} characters.`);
  const tokens = tokenize(source);
  if (tokens.length === 0) throw new ExpressionError("Expression is empty.");
  let position = 0;
  let depth = 0;

  const peek = () => tokens[position];
  const isOperator = (value: string) => {
    const token = peek();
    return token?.type === "operator" && token.value === value;
  };
  const expect = (value: string) => {
    if (!isOperator(value)) throw new ExpressionError(`Expected "${value}".`);
    position += 1;
  };
  const nested = <T>(parse: () => T): T => {
    depth += 1;
    if (depth > MAX_DEPTH) throw new ExpressionError("Expression is nested too deeply.");
    try {
      return parse();
    } finally {
      depth -= 1;
    }
  };

  const parseExpression = (): number => nested(() => {
    let value = parseTerm();
    while (isOperator("+") || isOperator("-")) {
      const operator = (tokens[position++] as { value: string }).value;
      const right = parseTerm();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  });

  const parseTerm = (): number => {
    let value = parseUnary();
    while (isOperator("*") || isOperator("/") || isOperator("%")) {
      const operator = (tokens[position++] as { value: string }).value;
      const right = parseUnary();
      if ((operator === "/" || operator === "%") && right === 0) throw new ExpressionError("Division by zero.");
      value = operator === "*" ? value * right : operator === "/" ? value / right : value % right;
    }
    return value;
  };

  const parseUnary = (): number => nested(() => {
    if (isOperator("-")) {
      position += 1;
      return -parseUnary();
    }
    if (isOperator("+")) {
      position += 1;
      return parseUnary();
    }
    return parsePower();
  });

  const parsePower = (): number => {
    const base = parsePrimary();
    if (isOperator("^")) {
      position += 1;
      return base ** parseUnary();
    }
    return base;
  };

  const parsePrimary = (): number => {
    const token = peek();
    if (!token) throw new ExpressionError("Unexpected end of expression.");
    if (token.type === "number") {
      position += 1;
      return token.value;
    }
    if (token.type === "identifier") {
      position += 1;
      if (token.value in constants && !isOperator("(")) return constants[token.value]!;
      const fn = functions[token.value];
      if (!fn) throw new ExpressionError(`Unknown function or constant "${token.value}".`);
      expect("(");
      const args: number[] = [];
      if (!isOperator(")")) {
        args.push(parseExpression());
        while (isOperator(",")) {
          position += 1;
          args.push(parseExpression());
        }
      }
      expect(")");
      if (args.length < fn.arity[0] || args.length > fn.arity[1]) {
        throw new ExpressionError(`${token.value} expects ${fn.arity[0] === fn.arity[1] ? fn.arity[0] : `${fn.arity[0]}-${fn.arity[1]}`} argument(s).`);
      }
      return fn.apply(args);
    }
    if (token.value === "(") {
      position += 1;
      const value = parseExpression();
      expect(")");
      return value;
    }
    throw new ExpressionError(`Unexpected "${token.value}".`);
  };

  const result = parseExpression();
  if (position !== tokens.length) throw new ExpressionError("Unexpected input after the end of the expression.");
  if (!Number.isFinite(result)) throw new ExpressionError("The result is not a finite number.");
  return result;
}

export type Statistics = {
  count: number; sum: number; mean: number; median: number; min: number; max: number;
  variance: number; std_dev: number;
};

/** Population statistics over finite numbers. */
export function describeValues(values: readonly number[]): Statistics {
  if (values.length === 0) throw new ExpressionError("At least one value is required.");
  if (values.some((value) => !Number.isFinite(value))) throw new ExpressionError("All values must be finite numbers.");
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((total, value) => total + value, 0);
  const mean = sum / count;
  const middle = Math.floor(count / 2);
  const median = count % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  const variance = sorted.reduce((total, value) => total + (value - mean) ** 2, 0) / count;
  return { count, sum, mean, median, min: sorted[0]!, max: sorted[count - 1]!, variance, std_dev: Math.sqrt(variance) };
}

export function percentChange(from: number, to: number) {
  if (from === 0) throw new ExpressionError("Percent change from zero is undefined.");
  return ((to - from) / Math.abs(from)) * 100;
}
