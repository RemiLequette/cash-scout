/**
 * The calculations of the budget grid, which fills like a spreadsheet. Amounts
 * are in minor units; `digits` is the number of decimals of their currency.
 */

/** A number as typed or pasted from a spreadsheet: "1 234,56 €", "1,234.56". */
function normalized(text: string): string {
  const compact = text.replace(/[\s\p{Sc}]/gu, "");
  const comma = compact.lastIndexOf(",");
  if (comma < 0) return compact;
  // Both signs: the last one is the decimal separator.
  return compact.lastIndexOf(".") > comma
    ? compact.replace(/,/g, "")
    : compact.replace(/\./g, "").replace(",", ".");
}

/** A small arithmetic reader: + - * / and parentheses; null when it is not one. */
function evaluate(text: string): number | null {
  const s = text.replace(/\s/g, "").replace(/,/g, ".").replace(/[×x]/g, "*");
  let at = 0;
  const factor = (): number => {
    if (s[at] === "-") {
      at++;
      return -factor();
    }
    if (s[at] === "(") {
      at++;
      const value = sumOf();
      if (s[at++] !== ")") return Number.NaN;
      return value;
    }
    const number = /^\d+(\.\d*)?/.exec(s.slice(at));
    if (!number) return Number.NaN;
    at += number[0].length;
    return Number(number[0]);
  };
  const product = (): number => {
    let value = factor();
    while (s[at] === "*" || s[at] === "/") {
      const operator = s[at++];
      const other = factor();
      value = operator === "*" ? value * other : value / other;
    }
    return value;
  };
  const sumOf = (): number => {
    let value = product();
    while (s[at] === "+" || s[at] === "-") {
      const operator = s[at++];
      const other = product();
      value = operator === "+" ? value + other : value - other;
    }
    return value;
  };
  const value = sumOf();
  return at === s.length && Number.isFinite(value) ? value : null;
}

/**
 * What an amount becomes when `text` is typed on it; null when the text means
 * nothing.
 *
 * - "" is 0, "250" or "=450*3" replace the amount;
 * - "+10", "+3%", "-5%", "*2", "/2" change it;
 * - "-10" is a negative amount typed in a cell, but takes 10 away when it is an
 *   operation on a selection.
 */
export function gridInput(
  old: bigint,
  text: string,
  digits: number,
  mode: "cell" | "operation" = "cell",
): bigint | null {
  const scale = 10 ** digits;
  const before = Number(old) / scale;
  const t = text.replace(/\s/g, "");
  const percent = /^([+-])(.+)%$/.exec(t);
  let value: number | null;
  if (t === "") return mode === "cell" ? 0n : old;
  if (percent) {
    const rate = evaluate(percent[2]!);
    value = rate === null ? null : before * (1 + ((percent[1] === "-" ? -1 : 1) * rate) / 100);
  } else if (t.startsWith("=")) {
    value = evaluate(normalized(t.slice(1)));
  } else if (/^[*×x/]/.test(t)) {
    const factor = evaluate(t.slice(1));
    value = factor === null ? null : t.startsWith("/") ? before / factor : before * factor;
  } else if (t.startsWith("+") || (mode === "operation" && t.startsWith("-"))) {
    const change = evaluate(normalized(t.slice(1)));
    value = change === null ? null : before + (t.startsWith("-") ? -change : change);
  } else {
    value = evaluate(normalized(t));
  }
  if (value === null || !Number.isFinite(value)) return null;
  return BigInt(Math.round(value * scale));
}

/** The cells of a range copied from a spreadsheet, row after row; null for what is no amount. */
export function pastedAmounts(text: string, digits: number): (bigint | null)[] {
  return text
    .replace(/\r/g, "")
    .replace(/\n+$/, "")
    .split(/[\t\n]/)
    .map((cell) => {
      const value = evaluate(normalized(cell === "" ? "0" : cell));
      return value === null ? null : BigInt(Math.round(value * 10 ** digits));
    });
}

/**
 * Spreads a total over the months that are not locked, after the proportions of
 * `shape` (evenly when it holds nothing there). Locked months keep their amount,
 * which counts in the total; the last free month takes the rounding remainder.
 */
export function spreadTotal(
  total: bigint,
  months: readonly bigint[],
  shape: readonly bigint[],
  locked: ReadonlySet<number> = new Set(),
): bigint[] {
  const free = months.map((_, i) => i).filter((i) => !locked.has(i));
  const result = [...months];
  if (free.length === 0) return result;
  const rest = total - months.reduce((sum, m, i) => (locked.has(i) ? sum + m : sum), 0n);
  const weight = free.reduce((sum, i) => sum + shape[i]!, 0n);
  let given = 0n;
  free.forEach((i, rank) => {
    const share =
      rank === free.length - 1
        ? rest - given
        : weight === 0n
          ? rest / BigInt(free.length)
          : (rest * shape[i]!) / weight;
    result[i] = share;
    given += share;
  });
  return result;
}
