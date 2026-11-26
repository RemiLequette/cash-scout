import {
  currencyDigits,
  gridInput,
  money,
  pastedAmounts,
  spreadTotal,
  toDecimalString,
} from "@cash-scout/domain";
import { ActionIcon, Button, Group, Text, TextInput } from "@mantine/core";
import { useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

const LAST = 11;

/** An amount as a grid cell holds it: empty for 0, without useless decimals. */
export function cellText(minor: bigint, currency: string): string {
  return minor === 0n ? "" : toDecimalString(money(minor, currency)).replace(/\.0+$/, "");
}

/**
 * The editing of the 12 amounts of a grid, as in a spreadsheet: a selection of
 * months, what is typed in a cell until it is left, and undo and redo until the
 * budget is saved. Locked months never change.
 */
export function useGrid({
  values,
  onChange,
  locked,
  currency,
}: {
  values: readonly bigint[];
  onChange: (values: bigint[]) => void;
  locked: ReadonlySet<number>;
  currency: string;
}) {
  const digits = currencyDigits(currency);
  const [selection, setSelection] = useState({ from: 0, to: 0 });
  const [typed, setTyped] = useState<{ index: number; text: string } | null>(null);
  const [history, setHistory] = useState<{ past: bigint[][]; future: bigint[][] }>({
    past: [],
    future: [],
  });
  /** Set when a focus extends the selection instead of replacing it. */
  const extending = useRef(false);

  const typedValue = typed ? gridInput(values[typed.index]!, typed.text, digits) : null;
  /** The amounts as they would be saved: what is being typed included. */
  const effective = values.map((v, i) => (typed?.index === i ? (typedValue ?? v) : v));
  const invalid = typed && typedValue === null ? typed.index : null;
  const first = Math.min(selection.from, selection.to);
  const last = Math.max(selection.from, selection.to);

  function write(next: readonly bigint[]) {
    setTyped(null);
    const kept = next.map((v, i) => (locked.has(i) ? values[i]! : v));
    if (kept.every((v, i) => v === values[i])) return;
    setHistory({ past: [...history.past, [...values]], future: [] });
    onChange(kept);
  }
  const commit = () => {
    if (typed) write(effective);
  };
  const undo = () => {
    const before = history.past.at(-1);
    setTyped(null);
    if (!before) return;
    setHistory({ past: history.past.slice(0, -1), future: [[...values], ...history.future] });
    onChange(before);
  };
  const redo = () => {
    const [after, ...future] = history.future;
    setTyped(null);
    if (!after) return;
    setHistory({ past: [...history.past, [...values]], future });
    onChange(after);
  };

  const inSelection = (i: number) => i >= first && i <= last;
  /** A single selected cell stands for the whole row when copying one. */
  const copyRow = (row: readonly bigint[]) =>
    write(effective.map((v, i) => (first === last || inSelection(i) ? row[i]! : v)));
  const fillRight = () => {
    const end = first === last ? LAST : last;
    write(effective.map((v, i) => (i > first && i <= end ? effective[first]! : v)));
  };
  /** False when the operation means nothing. */
  const operate = (operation: string) => {
    const next = effective.map((v, i) =>
      inSelection(i) ? gridInput(v, operation, digits, "operation") : v,
    );
    if (next.includes(null)) return false;
    write(next as bigint[]);
    return true;
  };
  /** Spreads a total typed as an amount or an operation on the current total. */
  const spread = (total: string, shape: readonly bigint[]) => {
    const now = effective.reduce((a, b) => a + b, 0n);
    const wanted = total.trim() === "" ? now : gridInput(now, total, digits);
    if (wanted === null) return false;
    write(spreadTotal(wanted, effective, shape, locked));
    return true;
  };

  function focusCell(from: HTMLElement, index: number) {
    const cell = from
      .closest("tr")
      ?.querySelector<HTMLInputElement>(`input[data-month="${index}"]`);
    cell?.focus();
    cell?.select();
  }

  /** The next cell that can be edited, going `step` from `index`. */
  function neighbour(index: number, step: number) {
    for (let i = index + step; i >= 0 && i <= LAST; i += step) {
      if (!locked.has(i)) return i;
    }
    return index;
  }

  const cell = (index: number) => ({
    "data-month": index,
    value: typed?.index === index ? typed.text : cellText(values[index]!, currency),
    selected: first !== last && inSelection(index),
    onChange: (event: { currentTarget: HTMLInputElement }) =>
      setTyped({ index, text: event.currentTarget.value }),
    onFocus: (event: { currentTarget: HTMLInputElement }) => {
      event.currentTarget.select();
      if (extending.current) {
        extending.current = false;
        return;
      }
      setSelection({ from: index, to: index });
    },
    onBlur: commit,
    onMouseDown: (event: MouseEvent) => {
      if (!event.shiftKey) return;
      event.preventDefault();
      setSelection({ ...selection, to: index });
    },
    // Dragging with the button held extends the selection.
    onMouseEnter: (event: MouseEvent) => {
      if (event.buttons === 1) setSelection((s) => ({ ...s, to: index }));
    },
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      const ctrl = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const editing = typed?.index === index;
      if (ctrl && key === "r") {
        event.preventDefault();
        fillRight();
      } else if (ctrl && key === "z" && !editing) {
        event.preventDefault();
        undo();
      } else if (ctrl && key === "y" && !editing) {
        event.preventDefault();
        redo();
      } else if (event.key === "Escape") {
        setTyped(null);
      } else if (event.key === "Enter") {
        event.preventDefault();
        commit();
        focusCell(event.currentTarget, neighbour(index, 1));
      } else if (event.key === "Delete" && first !== last) {
        event.preventDefault();
        write(effective.map((v, i) => (inSelection(i) ? 0n : v)));
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const step = event.key === "ArrowRight" ? 1 : -1;
        if (event.shiftKey) {
          event.preventDefault();
          commit();
          const to = Math.max(0, Math.min(LAST, selection.to + step));
          setSelection({ ...selection, to });
        } else if (!editing) {
          // While typing, the arrows move in the text, as in a spreadsheet.
          event.preventDefault();
          focusCell(event.currentTarget, neighbour(index, step));
        }
      }
    },
    onCopy: (event: ClipboardEvent) => {
      if (first === last) return;
      event.preventDefault();
      const row = effective.slice(first, last + 1).map((v) => toDecimalString(money(v, currency)));
      event.clipboardData.setData("text/plain", row.join("\t"));
    },
    onPaste: (event: ClipboardEvent) => {
      const amounts = pastedAmounts(event.clipboardData.getData("text"), digits);
      if (amounts.length < 2) return;
      event.preventDefault();
      write(effective.map((v, i) => (i >= index ? (amounts[i - index] ?? v) : v)));
      setSelection({ from: index, to: Math.min(LAST, index + amounts.length - 1) });
    },
  });

  return {
    effective,
    invalid,
    first,
    last,
    selectedSum: effective.reduce((sum, v, i) => (inSelection(i) ? sum + v : sum), 0n),
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    cell,
    undo,
    redo,
    copyRow,
    fillRight,
    operate,
    spread,
  };
}

/** The tools above the grid: operations on the selection, copies and spreading a total. */
export function GridTools({
  grid,
  monthNames,
  format,
  previousBudget,
  previousActual,
  year,
}: {
  grid: ReturnType<typeof useGrid>;
  monthNames: string[];
  format: (minor: bigint) => string;
  previousBudget: readonly bigint[];
  previousActual: readonly bigint[];
  year: number;
}) {
  const { t } = useTranslation();
  const [operation, setOperation] = useState("");
  const [total, setTotal] = useState("");
  const [wrong, setWrong] = useState<"operation" | "total" | null>(null);
  const apply = () => setWrong(grid.operate(operation) ? null : "operation");
  const spread = (shape: readonly bigint[]) => setWrong(grid.spread(total, shape) ? null : "total");
  const button = (label: string, onClick: () => void) => (
    <Button size="compact-xs" variant="default" onClick={onClick}>
      {label}
    </Button>
  );
  const months =
    grid.first === grid.last
      ? monthNames[grid.first]
      : `${monthNames[grid.first]} – ${monthNames[grid.last]}`;

  return (
    <>
      <Group gap="xs">
        <Text size="xs" fw={600} miw={150}>
          {months} : {format(grid.selectedSum)}
        </Text>
        <TextInput
          size="xs"
          w={110}
          aria-label={t("budget.tools.operation")}
          placeholder="+3 %, =450"
          value={operation}
          error={wrong === "operation"}
          onChange={(e) => setOperation(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && apply()}
        />
        {button(t("budget.tools.apply"), apply)}
        {button(t("budget.tools.fillRight"), grid.fillRight)}
        {button(t("budget.tools.copyBudget", { year: year - 1 }), () =>
          grid.copyRow(previousBudget),
        )}
        {button(t("budget.tools.copyActual", { year: year - 1 }), () =>
          grid.copyRow(previousActual),
        )}
        <ActionIcon
          size="sm"
          variant="default"
          disabled={!grid.canUndo}
          aria-label={t("budget.tools.undo")}
          title={t("budget.tools.undo")}
          onClick={grid.undo}
        >
          ↶
        </ActionIcon>
        <ActionIcon
          size="sm"
          variant="default"
          disabled={!grid.canRedo}
          aria-label={t("budget.tools.redo")}
          title={t("budget.tools.redo")}
          onClick={grid.redo}
        >
          ↷
        </ActionIcon>
      </Group>
      <Group gap="xs">
        <Text size="xs" fw={600} miw={150}>
          {t("budget.tools.spread")}
        </Text>
        <TextInput
          size="xs"
          w={110}
          aria-label={t("budget.tools.spread")}
          placeholder={t("budget.total")}
          inputMode="decimal"
          value={total}
          error={wrong === "total"}
          onChange={(e) => setTotal(e.currentTarget.value)}
        />
        {button(t("budget.tools.even"), () => spread(previousBudget.map(() => 0n)))}
        {button(t("budget.tools.currentShape"), () => spread(grid.effective))}
        {button(t("budget.tools.budgetShape", { year: year - 1 }), () => spread(previousBudget))}
        {button(t("budget.tools.actualShape", { year: year - 1 }), () => spread(previousActual))}
      </Group>
    </>
  );
}
