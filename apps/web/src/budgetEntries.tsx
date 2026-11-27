import {
  budgetMonth,
  convert,
  entriesToCopy,
  money,
  monthKept,
  parseAmount,
  rateSchema,
  scheduleDates,
  shiftToKeep,
  type PlanInput,
} from "@cash-scout/domain";
import {
  ActionIcon,
  Button,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  memo,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type SetStateAction,
} from "react";
import { useTranslation } from "react-i18next";
import { decimalInput, formatDate, formatDay, type Entry } from "./journal";
import { useNameOf, type Reference } from "./reference";
import { DataTable } from "./table";

/** A planned entry as the category's list edits it. */
export interface PlanRow {
  key: string;
  /** Set for an entry already in the journal. */
  id?: string;
  version?: number;
  date: string;
  /** The budget month a shifted entry is meant to count in, "2026-11". */
  keptMonth: string | null;
  subCategoryId: string;
  description: string;
  accountId: string;
  paymentTypeId: string | null;
  /** The planned amount as typed, signed, in the account's currency. */
  amount: string;
  /** Used for an account in another currency than the book's. */
  exchangeRate: string;
  reconciled: boolean;
  removed: boolean;
}

type Account = Reference["accounts"][number];

let made = 0;
const newKey = () => `new-${++made}`;

const plain = (amount: string) => amount.replace(/\.0+$/, "");

/** The planned entries of a year, as rows in date order. */
export function rowsOf(entries: readonly Entry[]): PlanRow[] {
  return entries
    .filter((e) => !e.transferId && Number(e.plannedAmount) !== 0)
    .map((e) => ({
      key: e.id,
      id: e.id,
      version: e.version,
      date: e.date,
      keptMonth: e.monthShifted ? budgetMonth(e.date, true) : null,
      subCategoryId: e.subCategoryId,
      description: e.description,
      accountId: e.accountId,
      paymentTypeId: e.paymentTypeId,
      amount: plain(e.plannedAmount),
      exchangeRate: e.exchangeRate,
      reconciled: e.reconciled,
      removed: false,
    }))
    .sort(byDate);
}

const byDate = (a: PlanRow, b: PlanRow) =>
  a.date.localeCompare(b.date) || a.description.localeCompare(b.description);

/** The row's amount in minor units of its account, or null when it cannot be saved. */
function amountOf(row: PlanRow, currency: string): bigint | null {
  try {
    const { minor } = parseAmount(decimalInput(row.amount), currency);
    return minor === 0n ? null : minor;
  } catch {
    return null;
  }
}

interface Context {
  accounts: ReadonlyMap<string, Account>;
  bookCurrency: string;
  year: number;
}

/** The fields of a row the API would refuse. */
function problemsOf(row: PlanRow, { accounts, bookCurrency, year }: Context) {
  const account = accounts.get(row.accountId);
  const foreign = account !== undefined && account.currency !== bookCurrency;
  return {
    date: !monthKept(row.date, row.keptMonth).startsWith(`${year}-`),
    account: !account,
    subCategory: !row.subCategoryId,
    amount: !account || amountOf(row, account.currency) === null,
    rate: foreign && !rateSchema.safeParse(decimalInput(row.exchangeRate)).success,
  };
}

/** How many rows to be saved have something wrong. */
export function invalidRows(rows: readonly PlanRow[], context: Context): number {
  return rows.filter(
    (row) =>
      !row.removed && !row.reconciled && Object.values(problemsOf(row, context)).includes(true),
  ).length;
}

/** The planned amounts of the rows per month, in the book currency, with their true sign. */
export function plannedByMonth(rows: readonly PlanRow[], context: Context): bigint[] {
  const months = Array<bigint>(12).fill(0n);
  for (const row of rows) {
    const account = context.accounts.get(row.accountId);
    const budgetedIn = monthKept(row.date, row.keptMonth);
    if (row.removed || !account || !budgetedIn.startsWith(`${context.year}-`)) continue;
    const minor = amountOf(row, account.currency);
    if (minor === null) continue;
    let inBook = minor;
    if (account.currency !== context.bookCurrency) {
      const rate = decimalInput(row.exchangeRate);
      if (!rateSchema.safeParse(rate).success) continue;
      inBook = convert(money(minor, account.currency), rate, context.bookCurrency).minor;
    }
    const month = Number(budgetedIn.slice(5, 7)) - 1;
    months[month] = months[month]! + inBook;
  }
  return months;
}

/** What the rows change in the journal, compared with how they were read. */
export function entryChanges(
  rows: readonly PlanRow[],
  initial: readonly PlanRow[],
  { accounts, bookCurrency }: Context,
): Required<Pick<PlanInput, "create" | "update" | "remove">> {
  const before = new Map(initial.map((row) => [row.key, row]));
  const create: NonNullable<PlanInput["create"]> = [];
  const update: NonNullable<PlanInput["update"]> = [];
  const remove: NonNullable<PlanInput["remove"]> = [];
  for (const row of rows) {
    const rate =
      accounts.get(row.accountId)?.currency !== bookCurrency
        ? { exchangeRate: decimalInput(row.exchangeRate) }
        : {};
    const fields = {
      date: row.date,
      accountId: row.accountId,
      subCategoryId: row.subCategoryId,
      description: row.description,
      paymentTypeId: row.paymentTypeId,
    };
    if (!row.id) {
      const monthShifted = row.keptMonth !== null && shiftToKeep(row.date, row.keptMonth);
      if (!row.removed) {
        create.push({ ...fields, ...rate, monthShifted, amount: decimalInput(row.amount) });
      }
      continue;
    }
    if (row.removed) {
      remove.push({ id: row.id, version: row.version! });
      continue;
    }
    const old = before.get(row.key);
    if (!old || JSON.stringify(old) === JSON.stringify(row)) continue;
    update.push({
      id: row.id,
      version: row.version!,
      ...fields,
      ...rate,
      // A planned amount left as it was changes neither amount.
      ...(decimalInput(row.amount) !== decimalInput(old.amount) && {
        amount: decimalInput(row.amount),
        planned: true,
      }),
    });
  }
  return { create, update, remove };
}

const field: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  font: "inherit",
  padding: "2px 4px",
  border: "1px solid var(--mantine-color-default-border)",
  borderRadius: 4,
  background: "var(--mantine-color-body)",
  color: "var(--mantine-color-text)",
};
const wrong = (bad: boolean): CSSProperties =>
  bad ? { ...field, borderColor: "var(--mantine-color-error)" } : field;

interface Option {
  value: string;
  label: string;
}

/**
 * A date shown as in the journal, "5 Nov" (with the year when it is not the
 * budget's); a click turns it into the browser's date field.
 */
function DateCell({
  value,
  year,
  disabled,
  bad,
  onChange,
}: {
  value: string;
  year: number;
  disabled: boolean;
  bad: boolean;
  onChange: (date: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [editing, setEditing] = useState(false);
  if (!disabled && (editing || !value)) {
    return (
      <input
        type="date"
        aria-label={t("journal.date")}
        style={wrong(bad)}
        autoFocus={editing}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        // Also keeps an empty field open while its date is being typed.
        onFocus={() => setEditing(true)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") setEditing(false);
        }}
      />
    );
  }
  const format = value.startsWith(`${year}-`) ? formatDay : formatDate;
  const text = value ? format(value, i18n.language) : "";
  return (
    <button
      type="button"
      aria-label={`${t("journal.date")} ${text}`}
      style={{ ...wrong(bad), textAlign: "left", whiteSpace: "nowrap" }}
      disabled={disabled}
      onClick={() => setEditing(true)}
    >
      {text}
    </button>
  );
}

/** Up and down, or Enter, go to the same column of the next row. */
function moveRows(event: KeyboardEvent<HTMLInputElement>) {
  const step =
    event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" || event.key === "Enter" ? 1 : 0;
  if (!step) return;
  event.preventDefault();
  const column = event.currentTarget.dataset.column!;
  const inputs = [
    ...(event.currentTarget
      .closest("table")
      ?.querySelectorAll<HTMLInputElement>(`input[data-column="${column}"]:not(:disabled)`) ?? []),
  ];
  const next = inputs[inputs.indexOf(event.currentTarget) + step];
  next?.focus();
  next?.select();
}

const Row = memo(function Row({
  row,
  ticked,
  canEdit,
  context,
  subCategories,
  accountOptions,
  onTick,
  onPatch,
}: {
  row: PlanRow;
  ticked: boolean;
  canEdit: boolean;
  context: Context;
  subCategories: Option[];
  accountOptions: Option[];
  onTick: (key: string, range: boolean) => void;
  onPatch: (key: string, patch: Partial<PlanRow>) => void;
}) {
  const { t } = useTranslation();
  const locked = !canEdit || row.reconciled;
  const problems = row.reconciled ? undefined : problemsOf(row, context);
  const account = context.accounts.get(row.accountId);
  const foreign = account && account.currency !== context.bookCurrency;
  // An entry of the journal only moves to an account of the same currency.
  const accounts = row.id
    ? accountOptions.filter((o) => context.accounts.get(o.value)?.currency === account?.currency)
    : accountOptions;
  return (
    <Table.Tr c={row.reconciled ? "dimmed" : undefined}>
      <Table.Td>
        <input
          type="checkbox"
          aria-label={`${row.date} ${row.description}`}
          checked={ticked}
          disabled={locked}
          onChange={() => {}}
          onClick={(e: MouseEvent) => onTick(row.key, e.shiftKey)}
        />
      </Table.Td>
      <Table.Td>
        <DateCell
          value={row.date}
          year={context.year}
          disabled={locked}
          bad={!!problems?.date}
          onChange={(date) => onPatch(row.key, { date })}
        />
      </Table.Td>
      <Table.Td>
        <select
          aria-label={t("journal.subCategory")}
          style={wrong(!!problems?.subCategory)}
          value={row.subCategoryId}
          disabled={locked}
          onChange={(e) => onPatch(row.key, { subCategoryId: e.currentTarget.value })}
        >
          <option value="" />
          {subCategories.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Table.Td>
      <Table.Td>
        <input
          data-column="description"
          aria-label={t("journal.description")}
          style={field}
          maxLength={500}
          value={row.description}
          disabled={locked}
          onKeyDown={moveRows}
          onChange={(e) => onPatch(row.key, { description: e.currentTarget.value })}
        />
      </Table.Td>
      <Table.Td>
        <select
          aria-label={t("journal.account")}
          style={wrong(!!problems?.account)}
          value={row.accountId}
          disabled={locked}
          onChange={(e) => onPatch(row.key, { accountId: e.currentTarget.value })}
        >
          <option value="" />
          {accounts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Table.Td>
      <Table.Td>
        <Group gap={4} wrap="nowrap">
          <input
            data-column="amount"
            aria-label={t("budget.plannedAmount")}
            style={{ ...wrong(!!problems?.amount), textAlign: "right" }}
            inputMode="decimal"
            value={row.amount}
            disabled={locked}
            onKeyDown={moveRows}
            onChange={(e) => onPatch(row.key, { amount: e.currentTarget.value })}
          />
          {foreign && (
            <input
              data-column="rate"
              aria-label={t("journal.exchangeRate")}
              title={t("journal.exchangeRate")}
              style={{ ...wrong(!!problems?.rate), width: 70 }}
              inputMode="decimal"
              value={row.exchangeRate}
              disabled={locked}
              onKeyDown={moveRows}
              onChange={(e) => onPatch(row.key, { exchangeRate: e.currentTarget.value })}
            />
          )}
        </Group>
      </Table.Td>
    </Table.Tr>
  );
});

/**
 * The planned entries of one category and year, edited in place: copied from
 * the previous year, made from a schedule, and changed one by one or by the
 * ticked ones together. Nothing is saved here: the category's Save does it.
 */
export function PlanEntries({
  canEdit,
  year,
  reference,
  categoryId,
  bookCurrency,
  rows,
  setRows,
  previous,
  unplanned,
}: {
  canEdit: boolean;
  year: number;
  reference: Reference;
  categoryId: string;
  bookCurrency: string;
  rows: PlanRow[];
  setRows: Dispatch<SetStateAction<PlanRow[]>>;
  /** The entries of the category the year before, once read. */
  previous: Entry[] | undefined;
  /** Entries of the year that are not planned: a copy does not repeat them. */
  unplanned: Entry[];
}) {
  const { t } = useTranslation();
  const nameOf = useNameOf(reference.defaultLanguage);
  const [filter, setFilter] = useState("");
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [history, setHistory] = useState<PlanRow[][]>([]);
  const [note, setNote] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState("");
  const lastTicked = useRef<string | null>(null);

  const accounts = new Map(reference.accounts.map((a) => [a.id, a]));
  const context: Context = { accounts, bookCurrency, year };
  const subCategories = reference.subCategories
    .filter((s) => s.categoryId === categoryId)
    .map((s) => ({ value: s.id, label: nameOf(s.names), archived: s.archived }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const accountOptions = reference.accounts.map((a) => ({
    value: a.id,
    label: nameOf(a.names),
    archived: a.archived,
  }));
  const subName = new Map(subCategories.map((s) => [s.value, s.label]));

  const search = filter.trim().toLocaleLowerCase();
  const shown = rows.filter(
    (row) =>
      !row.removed &&
      (!search ||
        `${row.description} ${subName.get(row.subCategoryId) ?? ""}`
          .toLocaleLowerCase()
          .includes(search)),
  );
  const tickable = shown.filter((row) => !row.reconciled);
  const selected = tickable.filter((row) => ticked.has(row.key));
  const selectedKeys = new Set(selected.map((row) => row.key));
  const allTicked = tickable.length > 0 && selected.length === tickable.length;

  /** A change of many rows at once, which can be undone. */
  function apply(next: PlanRow[]) {
    setHistory([...history, rows]);
    setRows(next);
    setNote("");
  }
  const change = (patch: (row: PlanRow) => Partial<PlanRow>) =>
    apply(rows.map((row) => (selectedKeys.has(row.key) ? { ...row, ...patch(row) } : row)));
  const add = (added: PlanRow[]) => apply([...rows, ...added].sort(byDate));

  const onPatch = useCallback(
    (key: string, patch: Partial<PlanRow>) =>
      setRows((old) => old.map((row) => (row.key === key ? { ...row, ...patch } : row))),
    [setRows],
  );

  // The rows shown, for a Shift+click, read when it happens.
  const visible = useRef<string[]>([]);
  const tickedNow = useRef(ticked);
  useLayoutEffect(() => {
    visible.current = tickable.map((row) => row.key);
    tickedNow.current = ticked;
  });
  const onTick = useCallback((key: string, range: boolean) => {
    const next = new Set(tickedNow.current);
    const on = !next.has(key);
    const from = range && lastTicked.current ? visible.current.indexOf(lastTicked.current) : -1;
    const to = visible.current.indexOf(key);
    const keys =
      from < 0 ? [key] : visible.current.slice(Math.min(from, to), Math.max(from, to) + 1);
    for (const k of keys) {
      if (on) next.add(k);
      else next.delete(k);
    }
    lastTicked.current = key;
    setTicked(next);
  }, []);

  function copyPrevious() {
    if (!previous) return;
    const usable = previous.filter(
      (e) =>
        !e.transferId &&
        Number(e.amount) !== 0 &&
        !accounts.get(e.accountId)?.archived &&
        subCategories.some((s) => s.value === e.subCategoryId && !s.archived),
    );
    const copies = entriesToCopy(usable, [...rows.filter((r) => !r.removed), ...unplanned]);
    if (copies.length > 0) {
      add(
        copies.map((e) => ({
          key: newKey(),
          date: e.date,
          keptMonth: e.monthShifted ? budgetMonth(e.date, true) : null,
          subCategoryId: e.subCategoryId,
          description: e.description,
          accountId: e.accountId,
          paymentTypeId: e.paymentTypeId,
          // What was paid, or is expected, becomes the plan.
          amount: plain(e.amount),
          exchangeRate: e.exchangeRate,
          reconciled: false,
          removed: false,
        })),
      );
    }
    setNote(t("budget.entries.copied", { count: copies.length }));
  }

  const dayNumber = Number(day);
  const moveDay = () => {
    if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 31) return;
    change((row) => {
      const month = monthKept(row.date, row.keptMonth);
      const [y, m] = month.split("-").map(Number);
      const end = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
      return { date: `${month}-${String(Math.min(dayNumber, end)).padStart(2, "0")}` };
    });
  };

  return (
    <Paper withBorder p="sm">
      <Stack gap="xs">
        <Group justify="space-between">
          <Title order={4}>{t("budget.plannedEntries", { year })}</Title>
          {canEdit && (
            <Group gap="xs">
              <Button size="xs" variant="default" disabled={!previous} onClick={copyPrevious}>
                {t("budget.entries.copy", { year: String(year - 1) })}
              </Button>
              <Button size="xs" variant="default" onClick={() => setScheduling(true)}>
                {t("budget.entries.schedule")}
              </Button>
              <Button
                size="xs"
                onClick={() => {
                  const last = rows.filter((r) => !r.removed).at(-1);
                  apply([
                    ...rows,
                    {
                      key: newKey(),
                      date: last?.date ?? `${year}-01-01`,
                      keptMonth: null,
                      subCategoryId:
                        last?.subCategoryId ?? subCategories.find((s) => !s.archived)?.value ?? "",
                      description: "",
                      accountId: last?.accountId ?? "",
                      paymentTypeId: last?.paymentTypeId ?? null,
                      amount: "",
                      exchangeRate: last?.exchangeRate ?? "",
                      reconciled: false,
                      removed: false,
                    },
                  ]);
                  setFilter("");
                }}
              >
                {t("budget.newPlanned")}
              </Button>
              <ActionIcon
                variant="default"
                disabled={history.length === 0}
                aria-label={t("budget.tools.undo")}
                title={t("budget.tools.undo")}
                onClick={() => {
                  setRows(history.at(-1)!);
                  setHistory(history.slice(0, -1));
                }}
              >
                ↶
              </ActionIcon>
            </Group>
          )}
        </Group>
        <Group gap="xs">
          <TextInput
            size="xs"
            w={220}
            aria-label={t("budget.entries.filter")}
            placeholder={t("budget.entries.filter")}
            value={filter}
            onChange={(e) => setFilter(e.currentTarget.value)}
          />
          <Text size="xs" c="dimmed">
            {t("journal.count", { count: shown.length })}
          </Text>
          {note && <Text size="xs">{note}</Text>}
        </Group>
        {canEdit && selected.length > 0 && (
          <Group gap="xs">
            <Text size="xs" fw={600}>
              {t("budget.entries.ticked", { count: selected.length })}
            </Text>
            <TextInput
              size="xs"
              w={110}
              aria-label={t("budget.entries.newAmount")}
              placeholder={t("budget.entries.newAmount")}
              value={amount}
              onChange={(e) => setAmount(e.currentTarget.value)}
            />
            <Button
              size="compact-xs"
              variant="default"
              disabled={amount.trim() === ""}
              onClick={() => change(() => ({ amount: decimalInput(amount) }))}
            >
              {t("budget.tools.apply")}
            </Button>
            <TextInput
              size="xs"
              w={70}
              aria-label={t("budget.entries.day")}
              placeholder={t("budget.entries.day")}
              inputMode="numeric"
              value={day}
              onChange={(e) => setDay(e.currentTarget.value)}
            />
            <Button
              size="compact-xs"
              variant="default"
              disabled={day.trim() === ""}
              onClick={moveDay}
            >
              {t("budget.tools.apply")}
            </Button>
            <Select
              size="xs"
              w={180}
              aria-label={t("journal.account")}
              placeholder={t("journal.account")}
              data={accountOptions.filter((a) => !a.archived)}
              value={null}
              onChange={(id) => {
                if (!id) return;
                change((row) =>
                  // An entry of the journal keeps its currency.
                  row.id && accounts.get(id)?.currency !== accounts.get(row.accountId)?.currency
                    ? {}
                    : { accountId: id },
                );
              }}
            />
            <Select
              size="xs"
              w={180}
              searchable
              aria-label={t("journal.subCategory")}
              placeholder={t("journal.subCategory")}
              data={subCategories.filter((s) => !s.archived)}
              value={null}
              onChange={(id) => id && change(() => ({ subCategoryId: id }))}
            />
            <Button
              size="compact-xs"
              variant="default"
              onClick={() =>
                add(
                  selected.map((row) => ({
                    ...row,
                    key: newKey(),
                    id: undefined,
                    version: undefined,
                  })),
                )
              }
            >
              {t("journal.duplicate")}
            </Button>
            <Button
              size="compact-xs"
              color="red"
              variant="light"
              onClick={() => {
                // A row never saved goes; an entry of the journal goes when saved.
                apply(
                  rows.flatMap((row) =>
                    !selectedKeys.has(row.key) ? [row] : row.id ? [{ ...row, removed: true }] : [],
                  ),
                );
                setTicked(new Set());
              }}
            >
              {t("common.delete")}
            </Button>
          </Group>
        )}
        {shown.length === 0 ? (
          <Text size="sm" c="dimmed">
            {t("budget.noPlannedEntries")}
          </Text>
        ) : (
          <DataTable minWidth={760} verticalSpacing={2} horizontalSpacing={4} fz="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={28}>
                  <input
                    type="checkbox"
                    aria-label={t("budget.entries.tickAll")}
                    title={t("budget.entries.tickAll")}
                    checked={allTicked}
                    disabled={!canEdit || tickable.length === 0}
                    onChange={() =>
                      setTicked(allTicked ? new Set() : new Set(tickable.map((r) => r.key)))
                    }
                  />
                </Table.Th>
                <Table.Th w={130}>{t("journal.date")}</Table.Th>
                <Table.Th w={170}>{t("journal.subCategory")}</Table.Th>
                <Table.Th>{t("journal.description")}</Table.Th>
                <Table.Th w={150}>{t("journal.account")}</Table.Th>
                <Table.Th w={130} ta="right">
                  {t("budget.plannedAmount")}
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {shown.map((row) => (
                <Row
                  key={row.key}
                  row={row}
                  ticked={ticked.has(row.key)}
                  canEdit={canEdit}
                  context={context}
                  subCategories={subCategories.filter(
                    (s) => !s.archived || s.value === row.subCategoryId,
                  )}
                  accountOptions={accountOptions.filter(
                    (a) => !a.archived || a.value === row.accountId,
                  )}
                  onTick={onTick}
                  onPatch={onPatch}
                />
              ))}
            </Table.Tbody>
          </DataTable>
        )}
      </Stack>
      <Modal
        opened={scheduling}
        onClose={() => setScheduling(false)}
        title={t("budget.entries.schedule")}
        size="lg"
      >
        {scheduling && (
          <ScheduleForm
            reference={reference}
            bookCurrency={bookCurrency}
            year={year}
            subCategories={subCategories.filter((s) => !s.archived)}
            accountOptions={accountOptions.filter((a) => !a.archived)}
            onCancel={() => setScheduling(false)}
            onCreate={(created) => {
              add(created);
              setFilter("");
              setScheduling(false);
            }}
          />
        )}
      </Modal>
    </Paper>
  );
}

function ScheduleForm({
  reference,
  bookCurrency,
  year,
  subCategories,
  accountOptions,
  onCancel,
  onCreate,
}: {
  reference: Reference;
  bookCurrency: string;
  year: number;
  subCategories: Option[];
  accountOptions: Option[];
  onCancel: () => void;
  onCreate: (rows: PlanRow[]) => void;
}) {
  const { t } = useTranslation();
  const nameOf = useNameOf(reference.defaultLanguage);
  const [draft, setDraft] = useState({
    first: `${year}-01-01`,
    last: `${year}-12-31`,
    every: "1",
    subCategoryId: subCategories.length === 1 ? subCategories[0]!.value : "",
    description: "",
    accountId: "",
    paymentTypeId: "",
    amount: "",
    exchangeRate: "",
  });
  const set = (patch: Partial<typeof draft>) => setDraft({ ...draft, ...patch });

  const accounts = new Map(reference.accounts.map((a) => [a.id, a]));
  const account = accounts.get(draft.accountId);
  const foreign = account !== undefined && account.currency !== bookCurrency;
  const rows: PlanRow[] = scheduleDates(draft.first, draft.last, Number(draft.every)).map(
    (date) => ({
      key: newKey(),
      date,
      keptMonth: null,
      subCategoryId: draft.subCategoryId,
      description: draft.description,
      accountId: draft.accountId,
      paymentTypeId: draft.paymentTypeId || null,
      amount: decimalInput(draft.amount),
      exchangeRate: draft.exchangeRate,
      reconciled: false,
      removed: false,
    }),
  );
  const ready = rows.length > 0 && invalidRows(rows, { accounts, bookCurrency, year }) === 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (ready) onCreate(rows);
  }

  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <Group grow>
          <TextInput
            type="date"
            label={t("budget.entries.first")}
            value={draft.first}
            onChange={(e) => set({ first: e.currentTarget.value })}
          />
          <TextInput
            type="date"
            label={t("budget.entries.last")}
            value={draft.last}
            onChange={(e) => set({ last: e.currentTarget.value })}
          />
          <Select
            label={t("budget.entries.every")}
            allowDeselect={false}
            data={["1", "3", "6", "12"].map((value) => ({
              value,
              label: t(`budget.entries.frequency.m${value}`),
            }))}
            value={draft.every}
            onChange={(value) => value && set({ every: value })}
          />
        </Group>
        <Select
          label={t("journal.subCategory")}
          searchable
          data={subCategories}
          value={draft.subCategoryId || null}
          onChange={(value) => set({ subCategoryId: value ?? "" })}
        />
        <TextInput
          label={t("journal.description")}
          maxLength={500}
          value={draft.description}
          onChange={(e) => set({ description: e.currentTarget.value })}
        />
        <Group grow>
          <Select
            label={t("journal.account")}
            data={accountOptions}
            value={draft.accountId || null}
            onChange={(value) => set({ accountId: value ?? "" })}
          />
          <Select
            label={t("journal.paymentType")}
            clearable
            data={reference.paymentTypes
              .filter((p) => !p.archived)
              .map((p) => ({ value: p.id, label: nameOf(p.names) }))}
            value={draft.paymentTypeId || null}
            onChange={(value) => set({ paymentTypeId: value ?? "" })}
          />
        </Group>
        <Group grow>
          <TextInput
            label={t("budget.plannedAmount")}
            inputMode="decimal"
            placeholder={t("journal.amountPlaceholder")}
            value={draft.amount}
            onChange={(e) => set({ amount: e.currentTarget.value })}
          />
          {foreign && (
            <TextInput
              label={t("journal.exchangeRate")}
              inputMode="decimal"
              value={draft.exchangeRate}
              onChange={(e) => set({ exchangeRate: e.currentTarget.value })}
            />
          )}
        </Group>
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={!ready}>
            {t("budget.createPlanned", { count: rows.length })}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
