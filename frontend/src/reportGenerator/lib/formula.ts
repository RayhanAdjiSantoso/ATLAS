// ══════════════════════════════════════════════════════
// Safe arithmetic formula evaluator for user-defined "custom metrics"
// (Shopee Deep-Dive pivots) — supports +, -, *, / and parentheses over named
// variables. Deliberately NOT `eval`/`Function`-based: the grammar below is
// hand-parsed so a formula can only ever resolve to a number computed from
// the whitelisted variables passed in, never execute arbitrary code.
// ══════════════════════════════════════════════════════

export class FormulaError extends Error {}

type TokenType = 'num' | 'ident' | 'op' | 'lparen' | 'rparen' | 'eof';
interface Token {
  type: TokenType;
  value: string;
}

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < expr.length && /[0-9.]/.test(expr[j])) j++;
      tokens.push({ type: 'num', value: expr.slice(i, j) });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < expr.length && /[a-zA-Z0-9_]/.test(expr[j])) j++;
      tokens.push({ type: 'ident', value: expr.slice(i, j) });
      i = j;
      continue;
    }
    if (c === '+' || c === '-' || c === '*' || c === '/') {
      tokens.push({ type: 'op', value: c });
      i++;
      continue;
    }
    if (c === '(') {
      tokens.push({ type: 'lparen', value: c });
      i++;
      continue;
    }
    if (c === ')') {
      tokens.push({ type: 'rparen', value: c });
      i++;
      continue;
    }
    throw new FormulaError(`Karakter tidak dikenal: "${c}"`);
  }
  tokens.push({ type: 'eof', value: '' });
  return tokens;
}

// Recursive-descent parser, evaluated directly during parsing (no AST
// needed — this is only ever run on short single-formula strings).
// Grammar: expr := term (('+'|'-') term)* ; term := factor (('*'|'/') factor)* ;
// factor := number | ident | '(' expr ')' | '-' factor
export function evaluateFormula(expr: string, vars: Record<string, number>): number {
  const tokens = tokenize(expr);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpr(): number {
    let val = parseTerm();
    while (peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = next().value;
      const rhs = parseTerm();
      val = op === '+' ? val + rhs : val - rhs;
    }
    return val;
  }

  function parseTerm(): number {
    let val = parseFactor();
    while (peek().type === 'op' && (peek().value === '*' || peek().value === '/')) {
      const op = next().value;
      const rhs = parseFactor();
      val = op === '*' ? val * rhs : rhs === 0 ? 0 : val / rhs; // divide-by-zero -> 0, matching the rest of the app's ratio conventions
    }
    return val;
  }

  function parseFactor(): number {
    const t = peek();
    if (t.type === 'op' && t.value === '-') {
      next();
      return -parseFactor();
    }
    if (t.type === 'num') {
      next();
      return parseFloat(t.value);
    }
    if (t.type === 'ident') {
      next();
      const key = Object.keys(vars).find((k) => k.toLowerCase() === t.value.toLowerCase());
      if (key === undefined) throw new FormulaError(`Variabel tidak dikenal: "${t.value}"`);
      return vars[key];
    }
    if (t.type === 'lparen') {
      next();
      const val = parseExpr();
      if (peek().type !== 'rparen') throw new FormulaError('Tanda kurung tidak seimbang.');
      next();
      return val;
    }
    throw new FormulaError(`Formula tidak valid dekat "${t.value || 'akhir formula'}".`);
  }

  if (tokens.length === 1) throw new FormulaError('Formula kosong.');
  const result = parseExpr();
  if (peek().type !== 'eof') throw new FormulaError(`Token tak terduga: "${peek().value}".`);
  if (!Number.isFinite(result)) throw new FormulaError('Hasil perhitungan tidak valid.');
  return result;
}

// Syntax/variable-name check without needing real data — used by the
// "buat metrik custom" form to validate on submit (dummy value of 1 for
// every whitelisted variable, so a valid formula always evaluates cleanly).
export function validateFormula(expr: string, availableVars: string[]): string | null {
  try {
    const dummyVars: Record<string, number> = {};
    availableVars.forEach((v) => {
      dummyVars[v] = 1;
    });
    evaluateFormula(expr, dummyVars);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Formula tidak valid.';
  }
}
