import { addDays, entriesToCopy, scheduleDates, type TransferPlanInput } from "@cash-scout/domain";
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Loader,
  Modal,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { memo, useCallback, useEffect, useState, type FormEvent, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, unwrap } from "./api";
import { DateCell, field, moveRows, newKey, useTicks, wrong, type Option } from "./budgetEntries";
import {
  decimalInput,
  formatDate,
  useTransferDefaults,
  useTransfers,
  type YearTransfer,
} from "./journal";
import { needs, validate, type TransferDraft } from "./pages/TransferForm";
import { useNameOf, type Reference } from "./reference";
import { DataTable } from "./table";

/** A planned transfer as the list edits it: one row for its two sides. */
interface TransferRow extends TransferDraft {
  key: string;
  /** One of its sides is reconciled: the plan does not change. */
  reconciled: boolean;
  removed: boolean;
}

const unsigned = (amount: string) => amount.replace(/^[-+]/, "").replace(/\.0+$/, "");

const isPlanned = (transfer: YearTransfer) =>
  Number(transfer.source.plannedAmount) !== 0 || Number(transfer.destination.plannedAmount) !== 0;

/** How many transfers of the list are part of the plan. */
export const plannedCount = (transfers: readonly YearTransfer[]) =>
  transfers.filter(isPlanned).length;

const byDate = (a: TransferRow, b: TransferRow) =>
  a.date.localeCompare(b.date) || a.description.localeCompare(b.description);

/** A stored transfer as a row; `amount` picks which of a side's amounts it holds. */
function rowOf(
  transfer: YearTransfer,
  amount: (side: YearTransfer["source"]) => string,
): TransferRow {
  const { source, destination } = transfer;
  return {
    key: transfer.id,
    id: transfer.id,
    version: transfer.version,
    date: source.date,
    delayDays: String(transfer.delayDays),
    sourceAccountId: source.accountId,
    destinationAccountId: destination.accountId,
    subCategoryId: source.subCategoryId,
    description: source.description,
    amount: unsigned(amount(source)),
    destinationAmount: unsigned(amount(destination)),
    sourceRate: source.exchangeRate,
    destinationRate: destination.exchangeRate,
    reconciled: source.reconciled || destination.reconciled,
    removed: false,
  };
}

const plannedRows = (transfers: readonly YearTransfer[]) =>
  transfers
    .filter(isPlanned)
    .map((t) =>
      rowOf(t, (side) => (Number(side.plannedAmount) !== 0 ? side.plannedAmount : side.amount)),
    )
    .sort(byDate);

interface Context {
  reference: Reference;
  bookCurrency: string;
  year: number;
}

/** The fields of a row the API would refuse. */
function problemsOf(row: TransferRow, { reference, bookCurrency, year }: Context) {
  const { errors } = validate(row, reference, bookCurrency);
  if (!row.date.startsWith(`${year}-`)) errors.date = true;
  return errors;
}

const invalidCount = (rows: readonly TransferRow[], context: Context) =>
  rows.filter(
    (row) => !row.removed && !row.reconciled && Object.keys(problemsOf(row, context)).length > 0,
  ).length;

/** What the rows change, compared with how they were read. Rows must be valid. */
function transferChanges(
  rows: readonly TransferRow[],
  initial: readonly TransferRow[],
  { reference, bookCurrency }: Context,
): Required<TransferPlanInput> {
  const before = new Map(initial.map((row) => [row.key, row]));
  const create: Required<TransferPlanInput>["create"] = [];
  const update: Required<TransferPlanInput>["update"] = [];
  const remove: Required<TransferPlanInput>["remove"] = [];
  for (const row of rows) {
    if (row.removed) {
      if (row.id) remove.push({ id: row.id, version: row.version! });
      continue;
    }
    const old = before.get(row.key);
    if (row.id && (!old || JSON.stringify(old) === JSON.stringify(row))) continue;
    const body = validate(row, reference, bookCurrency).body;
    if (!body) continue;
    if (!row.id) {
      create.push(body);
      continue;
    }
    const { amount, destinationAmount, ...rest } = body;
    // Planned amounts left as they were change neither amount of either side.
    const replanned =
      decimalInput(row.amount) !== decimalInput(old!.amount) ||
      decimalInput(row.destinationAmount) !== decimalInput(old!.destinationAmount);
    update.push({
      ...rest,
      id: row.id,
      version: row.version!,
      ...(replanned && { amount, destinationAmount, planned: true }),
    });
  }
  return { create, update, remove };
}

/** What the lists of a row, of the bulk changes and of the schedule offer. */
function useChoices(reference: Reference) {
  const nameOf = useNameOf(reference.defaultLanguage);
  const natures = new Set(reference.natures.filter((n) => n.transfer).map((n) => n.id));
  const categories = new Set(
    reference.categories.filter((c) => natures.has(c.natureId)).map((c) => c.id),
  );
  const byLabel = (a: Option, b: Option) => a.label.localeCompare(b.label);
  const subCategories = reference.subCategories
    .filter((s) => categories.has(s.categoryId))
    .map((s) => ({ value: s.id, label: nameOf(s.names), archived: s.archived }))
    .sort(byLabel);
  const accounts = reference.accounts
    .filter((a) => a.kind === "bank")
    .map((a) => ({
      value: a.id,
      label: nameOf(a.names),
      currency: a.currency,
      archived: a.archived,
    }))
    .sort(byLabel);
  return { subCategories, accounts };
}

type Choices = ReturnType<typeof useChoices>;

/** Reads the transfers of the year and the one before, then starts planning. */
export function PlanTransfers(props: Props) {
  const { t } = useTranslation();
  const { bookId, year } = props;
  const current = useTransfers(bookId, year);
  const previous = useTransfers(bookId, year - 1);
  const defaults = useTransferDefaults(bookId, true);
  if (current.error) {
    return <Alert color="red">{t("common.error", { message: current.error.message })}</Alert>;
  }
  // Only the first read is waited for: a later one must not drop what is typed.
  if (!current.data || !current.isFetchedAfterMount || defaults.isPending) {
    return <Loader size="sm" />;
  }
  return (
    <TransfersPlan
      {...props}
      transfers={current.data}
      previous={previous.isFetchedAfterMount ? previous.data : undefined}
      defaults={{
        subCategoryId: defaults.data?.subCategoryId ?? null,
      }}
    />
  );
}

interface Props {
  bookId: string;
  bookCurrency: string;
  canEdit: boolean;
  year: number;
  reference: Reference;
  onDirty: (dirty: boolean) => void;
  onReload: () => void;
}

/**
 * The planned transfers of a year, edited in place like the planned entries of a
 * category: copied from the previous year, made from a schedule, and changed one
 * by one or by the ticked ones together. Nothing is stored until Save.
 */
function TransfersPlan({
  bookId,
  bookCurrency,
  canEdit,
  year,
  reference,
  onDirty,
  onReload,
  transfers,
  previous,
  defaults,
}: Props & {
  transfers: YearTransfer[];
  previous: YearTransfer[] | undefined;
  defaults: { subCategoryId: string | null };
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const choices = useChoices(reference);
  // As read when planning started: what is saved is the difference.
  const [read] = useState(() => ({ rows: plannedRows(transfers), transfers }));
  const [rows, setRows] = useState(read.rows);
  const context: Context = { reference, bookCurrency, year };
  const dirty =
    JSON.stringify(rows.filter((r) => r.id || !r.removed)) !== JSON.stringify(read.rows);
  const wrongRows = invalidCount(rows, context);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.books[":bookId"].transfers.plan.$post({
          param: { bookId },
          json: transferChanges(rows, read.rows, context),
        }),
      ),
    onSuccess: async () => {
      onDirty(false);
      await queryClient.invalidateQueries({ queryKey: ["books", bookId] });
      onReload();
    },
  });

  const [filter, setFilter] = useState("");
  const [history, setHistory] = useState<TransferRow[][]>([]);
  const [note, setNote] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState("");

  const labels = new Map(
    [...choices.subCategories, ...choices.accounts].map((o) => [o.value, o.label]),
  );
  const search = filter.trim().toLocaleLowerCase();
  const shown = rows.filter(
    (row) =>
      !row.removed &&
      (!search ||
        [row.description, row.subCategoryId, row.sourceAccountId, row.destinationAccountId]
          .map((v, i) => (i === 0 ? v : (labels.get(v ?? "") ?? "")))
          .join(" ")
          .toLocaleLowerCase()
          .includes(search)),
  );
  const tickable = shown.filter((row) => !row.reconciled);
  const { ticked, setTicked, onTick } = useTicks(tickable.map((row) => row.key));
  const selected = tickable.filter((row) => ticked.has(row.key));
  const selectedKeys = new Set(selected.map((row) => row.key));
  const allTicked = tickable.length > 0 && selected.length === tickable.length;

  /** A change of many rows at once, which can be undone. */
  function apply(next: TransferRow[], message = "") {
    setHistory([...history, rows]);
    setRows(next);
    setNote(message);
  }
  const change = (patch: (row: TransferRow) => Partial<TransferRow>, message?: string) =>
    apply(
      rows.map((row) => (selectedKeys.has(row.key) ? { ...row, ...patch(row) } : row)),
      message,
    );
  const add = (added: TransferRow[], message?: string) =>
    apply([...rows, ...added].sort(byDate), message);

  const onPatch = useCallback(
    (key: string, patch: Partial<TransferRow>) =>
      setRows((old) => old.map((row) => (row.key === key ? { ...row, ...patch } : row))),
    [],
  );

  const currencyOf = (id: string | null) => reference.accounts.find((a) => a.id === id)?.currency;

  /** A ticked row moves to an account when the transfer stays possible. */
  function moveAccount(side: "sourceAccountId" | "destinationAccountId", id: string) {
    const other = side === "sourceAccountId" ? "destinationAccountId" : "sourceAccountId";
    change((row) =>
      row[other] === id || (row.id && currencyOf(id) !== currencyOf(row[side]))
        ? {}
        : { [side]: id },
    );
  }

  /** One amount cannot stand for two currencies: those transfers are left as they are. */
  function setAmounts() {
    const twoCurrencies = (row: TransferRow) => needs(reference, row, bookCurrency).amountInTwo;
    const skipped = selected.filter(twoCurrencies).length;
    change(
      (row) =>
        twoCurrencies(row)
          ? {}
          : { amount: decimalInput(amount), destinationAmount: decimalInput(amount) },
      skipped ? t("budget.transfers.skipped", { count: skipped }) : "",
    );
  }

  const dayNumber = Number(day);
  function moveDay() {
    if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 31) return;
    change((row) => {
      const [y, m] = row.date.split("-").map(Number);
      const end = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
      return {
        date: `${row.date.slice(0, 7)}-${String(Math.min(dayNumber, end)).padStart(2, "0")}`,
      };
    });
  }

  function copyPrevious() {
    if (!previous) return;
    const open = new Set(choices.accounts.filter((a) => !a.archived).map((a) => a.value));
    const subs = new Set(choices.subCategories.filter((s) => !s.archived).map((s) => s.value));
    // Two transfers are alike with the same accounts and description.
    const alike = (row: TransferRow) => ({
      date: row.date,
      subCategoryId: row.subCategoryId!,
      description: JSON.stringify([
        row.description.trim(),
        row.sourceAccountId,
        row.destinationAccountId,
      ]),
      row,
    });
    const usable = previous
      // What was paid, or is expected, becomes the plan.
      .map((transfer) => rowOf(transfer, (side) => side.amount))
      .filter(
        (row) =>
          Number(row.amount) !== 0 &&
          open.has(row.sourceAccountId!) &&
          open.has(row.destinationAccountId!) &&
          subs.has(row.subCategoryId!),
      );
    const planned = rows.filter((r) => !r.removed);
    const unplanned = read.transfers
      .filter((transfer) => !isPlanned(transfer))
      .map((transfer) => rowOf(transfer, (side) => side.amount));
    const copies = entriesToCopy(usable.map(alike), [...planned, ...unplanned].map(alike)).map(
      ({ date, row }): TransferRow => ({
        ...row,
        key: newKey(),
        id: undefined,
        version: undefined,
        date,
        reconciled: false,
      }),
    );
    const message = t("budget.transfers.copied", { count: copies.length });
    if (copies.length > 0) add(copies, message);
    else setNote(message);
  }

  /** A row like the last one, without an amount. */
  function addRow() {
    const last = rows.filter((r) => !r.removed).at(-1);
    apply([
      ...rows,
      {
        key: newKey(),
        date: last?.date ?? `${year}-01-01`,
        delayDays: last?.delayDays ?? "0",
        sourceAccountId: last?.sourceAccountId ?? null,
        destinationAccountId: last?.destinationAccountId ?? null,
        subCategoryId: last?.subCategoryId ?? defaults.subCategoryId,
        description: "",
        amount: "",
        destinationAmount: "",
        sourceRate: last?.sourceRate ?? "",
        destinationRate: last?.destinationRate ?? "",
        reconciled: false,
        removed: false,
      },
    ]);
    setFilter("");
  }

  const saveButton = (
    <Button
      disabled={!dirty || wrongRows > 0}
      loading={save.isPending}
      onClick={() => save.mutate()}
    >
      {t("common.save")}
    </Button>
  );
  const openAccounts = choices.accounts.filter((a) => !a.archived);
  const openSubCategories = choices.subCategories.filter((s) => !s.archived);

  return (
    <Stack>
      <Paper withBorder p="sm">
        <Stack gap="xs">
          {save.error && (
            <Alert color="red">
              <Group justify="space-between">
                <Text size="sm">{t("common.error", { message: save.error.message })}</Text>
                <Button size="xs" variant="default" onClick={onReload}>
                  {t("budget.reload")}
                </Button>
              </Group>
            </Alert>
          )}
          {choices.subCategories.length === 0 && (
            <Alert color="yellow">{t("transfer.noCategory")}</Alert>
          )}
          <Group justify="space-between">
            <Title order={4}>{t("budget.plannedTransfers", { year })}</Title>
            {canEdit && (
              <Group gap="xs">
                <Button size="xs" variant="default" disabled={!previous} onClick={copyPrevious}>
                  {t("budget.entries.copy", { year: String(year - 1) })}
                </Button>
                <Button size="xs" variant="default" onClick={() => setScheduling(true)}>
                  {t("budget.entries.schedule")}
                </Button>
                <Button size="xs" onClick={addRow}>
                  {t("budget.newPlannedTransfer")}
                </Button>
                <ActionIcon
                  variant="default"
                  disabled={history.length === 0}
                  aria-label={t("budget.tools.undo")}
                  title={t("budget.tools.undo")}
                  onClick={() => {
                    setRows(history.at(-1)!);
                    setHistory(history.slice(0, -1));
                    setNote("");
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
              w={260}
              aria-label={t("budget.transfers.filter")}
              placeholder={t("budget.transfers.filter")}
              value={filter}
              onChange={(e) => setFilter(e.currentTarget.value)}
            />
            <Text size="xs" c="dimmed">
              {t("budget.transfers.count", { count: shown.length })}
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
                onClick={setAmounts}
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
              {(["sourceAccountId", "destinationAccountId"] as const).map((side) => {
                const label = t(
                  side === "sourceAccountId" ? "transfer.source" : "transfer.destination",
                );
                return (
                  <Select
                    key={side}
                    size="xs"
                    w={180}
                    aria-label={label}
                    placeholder={label}
                    data={openAccounts}
                    value={null}
                    onChange={(id) => id && moveAccount(side, id)}
                  />
                );
              })}
              <Select
                size="xs"
                w={180}
                searchable
                aria-label={t("journal.subCategory")}
                placeholder={t("journal.subCategory")}
                data={openSubCategories}
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
                  // A row never saved goes; a stored transfer goes when saved.
                  apply(
                    rows.flatMap((row) =>
                      !selectedKeys.has(row.key)
                        ? [row]
                        : row.id
                          ? [{ ...row, removed: true }]
                          : [],
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
              {t("budget.noPlannedTransfers")}
            </Text>
          ) : (
            <DataTable minWidth={980} verticalSpacing={2} horizontalSpacing={4} fz="xs">
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
                  <Table.Th w={110}>{t("journal.date")}</Table.Th>
                  <Table.Th w={60}>{t("budget.transfers.delay")}</Table.Th>
                  <Table.Th w={150}>{t("journal.subCategory")}</Table.Th>
                  <Table.Th>{t("journal.description")}</Table.Th>
                  <Table.Th w={140}>{t("transfer.source")}</Table.Th>
                  <Table.Th w={140}>{t("transfer.destination")}</Table.Th>
                  <Table.Th w={170} ta="right">
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
                    choices={choices}
                    onTick={onTick}
                    onPatch={onPatch}
                  />
                ))}
              </Table.Tbody>
            </DataTable>
          )}
          {canEdit && (
            <Group justify="flex-end">
              {wrongRows > 0 && (
                <Text size="sm" c="red">
                  {t("budget.transfers.problem", { count: wrongRows })}
                </Text>
              )}
              {saveButton}
            </Group>
          )}
        </Stack>
      </Paper>
      <Modal
        opened={scheduling}
        onClose={() => setScheduling(false)}
        title={t("budget.entries.schedule")}
        size="lg"
      >
        {scheduling && (
          <ScheduleForm
            context={context}
            choices={choices}
            defaults={defaults}
            onCancel={() => setScheduling(false)}
            onCreate={(created) => {
              add(created);
              setFilter("");
              setScheduling(false);
            }}
          />
        )}
      </Modal>
    </Stack>
  );
}

const Row = memo(function Row({
  row,
  ticked,
  canEdit,
  context,
  choices,
  onTick,
  onPatch,
}: {
  row: TransferRow;
  ticked: boolean;
  canEdit: boolean;
  context: Context;
  choices: Choices;
  onTick: (key: string, range: boolean) => void;
  onPatch: (key: string, patch: Partial<TransferRow>) => void;
}) {
  const { t, i18n } = useTranslation();
  const locked = !canEdit || row.reconciled;
  const problems = row.reconciled ? {} : problemsOf(row, context);
  const wants = needs(context.reference, row, context.bookCurrency);
  const delay = Number(row.delayDays);
  const arrival =
    problems.date || problems.delayDays || !Number.isInteger(delay)
      ? undefined
      : t("transfer.arrival", { date: formatDate(addDays(row.date, delay), i18n.language) });

  const account = (side: "sourceAccountId" | "destinationAccountId") => {
    const other = side === "sourceAccountId" ? row.destinationAccountId : row.sourceAccountId;
    const current = choices.accounts.find((a) => a.value === row[side]);
    return (
      <select
        aria-label={t(side === "sourceAccountId" ? "transfer.source" : "transfer.destination")}
        style={wrong(!!problems[side])}
        value={row[side] ?? ""}
        disabled={locked}
        onChange={(e) => onPatch(row.key, { [side]: e.currentTarget.value || null })}
      >
        <option value="" />
        {choices.accounts
          .filter((a) => a.value === row[side] || (!a.archived && a.value !== other))
          // A stored transfer only moves to an account of the same currency.
          .filter((a) => !row.id || a.currency === current?.currency)
          .map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
      </select>
    );
  };

  /** A line of the amount cell: an amount, with its rate for a foreign account. */
  const amounts = (
    amount: "amount" | "destinationAmount" | null,
    rate: "sourceRate" | "destinationRate" | null,
    currency: string | undefined,
  ) => (
    <Group gap={4} wrap="nowrap" justify="flex-end">
      {amount && (
        <input
          data-column={amount}
          aria-label={t(
            amount === "amount" ? "budget.plannedAmount" : "transfer.destinationAmount",
          )}
          title={`${t(amount === "amount" ? "transfer.amount" : "transfer.destinationAmount")} ${currency ?? ""}`}
          style={{ ...wrong(!!problems[amount]), textAlign: "right" }}
          inputMode="decimal"
          value={row[amount]}
          disabled={locked}
          onKeyDown={moveRows}
          onChange={(e) => onPatch(row.key, { [amount]: e.currentTarget.value })}
        />
      )}
      {rate && (
        <input
          data-column={rate}
          aria-label={`${t("journal.exchangeRate")} ${currency}`}
          title={`${t("journal.exchangeRate")} ${currency}`}
          style={{ ...wrong(!!problems[rate]), width: 70, flexShrink: 0 }}
          inputMode="decimal"
          value={row[rate]}
          disabled={locked}
          onKeyDown={moveRows}
          onChange={(e) => onPatch(row.key, { [rate]: e.currentTarget.value })}
        />
      )}
    </Group>
  );

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
          bad={!!problems.date}
          onChange={(date) => onPatch(row.key, { date })}
        />
      </Table.Td>
      <Table.Td>
        <input
          data-column="delay"
          aria-label={t("transfer.delay")}
          title={arrival}
          style={{ ...wrong(!!problems.delayDays), textAlign: "right" }}
          inputMode="numeric"
          value={row.delayDays}
          disabled={locked}
          onKeyDown={moveRows}
          onChange={(e) => onPatch(row.key, { delayDays: e.currentTarget.value })}
        />
      </Table.Td>
      <Table.Td>
        <select
          aria-label={t("journal.subCategory")}
          style={wrong(!!problems.subCategoryId)}
          value={row.subCategoryId ?? ""}
          disabled={locked}
          onChange={(e) => onPatch(row.key, { subCategoryId: e.currentTarget.value || null })}
        >
          <option value="" />
          {choices.subCategories
            .filter((s) => !s.archived || s.value === row.subCategoryId)
            .map((o) => (
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
      <Table.Td>{account("sourceAccountId")}</Table.Td>
      <Table.Td>{account("destinationAccountId")}</Table.Td>
      <Table.Td>
        <Stack gap={2}>
          {amounts("amount", wants.sourceRate ? "sourceRate" : null, wants.sourceCurrency)}
          {(wants.amountInTwo || wants.destinationRate) &&
            amounts(
              wants.amountInTwo ? "destinationAmount" : null,
              wants.destinationRate ? "destinationRate" : null,
              wants.destinationCurrency,
            )}
        </Stack>
      </Table.Td>
    </Table.Tr>
  );
});

function ScheduleForm({
  context,
  choices,
  defaults,
  onCancel,
  onCreate,
}: {
  context: Context;
  choices: Choices;
  defaults: { subCategoryId: string | null };
  onCancel: () => void;
  onCreate: (rows: TransferRow[]) => void;
}) {
  const { t } = useTranslation();
  const { reference, bookCurrency, year } = context;
  const [period, setPeriod] = useState({
    first: `${year}-01-01`,
    last: `${year}-12-31`,
    every: "1",
  });
  const [draft, setDraft] = useState({
    delayDays: "0",
    sourceAccountId: null as string | null,
    destinationAccountId: null as string | null,
    subCategoryId: defaults.subCategoryId,
    description: "",
    amount: "",
    destinationAmount: "",
    sourceRate: "",
    destinationRate: "",
  });
  const set = (patch: Partial<typeof draft>) => setDraft({ ...draft, ...patch });

  const wants = needs(reference, { ...draft, date: period.first }, bookCurrency);
  const rows: TransferRow[] = scheduleDates(period.first, period.last, Number(period.every)).map(
    (date) => ({ ...draft, date, key: newKey(), reconciled: false, removed: false }),
  );
  const ready = rows.length > 0 && invalidCount(rows, context) === 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (ready) onCreate(rows);
  }

  const accountSelect = (side: "sourceAccountId" | "destinationAccountId") => (
    <Select
      label={t(side === "sourceAccountId" ? "transfer.source" : "transfer.destination")}
      searchable
      data={choices.accounts.filter(
        (a) =>
          !a.archived &&
          a.value !==
            (side === "sourceAccountId" ? draft.destinationAccountId : draft.sourceAccountId),
      )}
      value={draft[side]}
      onChange={(value) => set({ [side]: value })}
    />
  );
  const input = (
    name: "amount" | "destinationAmount" | "sourceRate" | "destinationRate",
    label: string,
  ) => (
    <TextInput
      label={label}
      inputMode="decimal"
      value={draft[name]}
      onChange={(e) => set({ [name]: e.currentTarget.value })}
    />
  );

  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <Group grow>
          <TextInput
            type="date"
            label={t("budget.entries.first")}
            value={period.first}
            onChange={(e) => setPeriod({ ...period, first: e.currentTarget.value })}
          />
          <TextInput
            type="date"
            label={t("budget.entries.last")}
            value={period.last}
            onChange={(e) => setPeriod({ ...period, last: e.currentTarget.value })}
          />
          <Select
            label={t("budget.entries.every")}
            allowDeselect={false}
            data={["1", "3", "6", "12"].map((value) => ({
              value,
              label: t(`budget.entries.frequency.m${value}`),
            }))}
            value={period.every}
            onChange={(value) => value && setPeriod({ ...period, every: value })}
          />
        </Group>
        <Group grow>
          {accountSelect("sourceAccountId")}
          {accountSelect("destinationAccountId")}
          <TextInput
            type="number"
            min={0}
            max={60}
            label={t("transfer.delay")}
            value={draft.delayDays}
            onChange={(e) => set({ delayDays: e.currentTarget.value })}
          />
        </Group>
        <Select
          label={t("journal.subCategory")}
          searchable
          data={choices.subCategories.filter((s) => !s.archived)}
          value={draft.subCategoryId}
          onChange={(value) => set({ subCategoryId: value })}
        />
        <TextInput
          label={t("journal.description")}
          maxLength={500}
          value={draft.description}
          onChange={(e) => set({ description: e.currentTarget.value })}
        />
        <Group grow>
          {input("amount", t("budget.plannedAmount"))}
          {wants.amountInTwo && input("destinationAmount", t("transfer.destinationAmount"))}
        </Group>
        {(wants.sourceRate || wants.destinationRate) && (
          <Group grow>
            {wants.sourceRate &&
              input("sourceRate", `${t("journal.exchangeRate")} (${wants.sourceCurrency})`)}
            {wants.destinationRate &&
              input(
                "destinationRate",
                `${t("journal.exchangeRate")} (${wants.destinationCurrency})`,
              )}
          </Group>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={!ready}>
            {t("budget.transfers.create", { count: rows.length })}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
