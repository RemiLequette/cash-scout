import { formatMoney, money, parseAmount, toDecimalString } from "@cash-scout/domain";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
} from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, unwrap } from "../api";
import { useBudgetYear, type BudgetYear, type CategoryBudgetRow } from "../budget";
import { entryChanges, invalidRows, PlanEntries, plannedByMonth, rowsOf } from "../budgetEntries";
import { cellText, GridTools, useGrid } from "../budgetGrid";
import { plannedCount, PlanTransfers } from "../budgetTransfers";
import {
  decimalInput,
  useJournal,
  useMonthEnds,
  useTransfers,
  type Entry,
  type MonthEnd,
  monthsOfYear,
} from "../journal";
import { useMonthNames } from "../options";
import { useNameOf, useReference, type Reference } from "../reference";
import { DataTable } from "../table";

/** What is planned when it is not a category: the transfers of the year. */
const TRANSFERS = "transfers";

const MONTHS = Array.from({ length: 12 }, (_, i) => i);

type Category = Reference["categories"][number];

/** What the page edits of a category's budget, as typed. */
interface Draft {
  /** The 12 monthly amounts of the grid; empty for 0. */
  months: string[];
  accountId: string | null;
  exchangeRate: string;
  assumptions: string;
}

/** An amount typed or read as text, in minor units; 0 when empty, null when not a number. */
function parsed(text: string, currency: string): bigint | null {
  if (text.trim() === "") return 0n;
  try {
    return parseAmount(decimalInput(text), currency).minor;
  } catch {
    return null;
  }
}

const minorOf = (text: string | undefined, currency: string) => parsed(text ?? "", currency) ?? 0n;

const sum = (values: readonly bigint[]) => values.reduce((a, b) => a + b, 0n);

/** A year's budget of one category, month by month, in minor units. */
function yearOf(data: BudgetYear, categoryId: string) {
  const saved = data.budgets.find((b) => b.categoryId === categoryId);
  const held = data.journal.find((j) => j.categoryId === categoryId);
  const read = (values: readonly string[] | undefined) =>
    MONTHS.map((m) => minorOf(values?.[m], data.bookCurrency));
  const grid = read(saved?.months);
  const planned = read(held?.planned);
  return {
    saved,
    grid,
    planned,
    actual: read(held?.actual),
    reconciled: read(held?.reconciled),
    /** The budget of a month: its grid amount plus its planned entries. */
    budget: MONTHS.map((m) => grid[m]! + planned[m]!),
  };
}

// ---------------------------------------------------------------------------
// The page: the categories of a year, or one of them being planned
// ---------------------------------------------------------------------------

export function BudgetPage({
  bookId,
  bookCurrency,
  canEdit,
}: {
  bookId: string;
  bookCurrency: string;
  canEdit: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [year, setYear] = useState(new Date().getFullYear());
  const [planning, setPlanning] = useState<string | null>(null);
  /** Raised to start the category's editor again, from what is stored. */
  const [revision, setRevision] = useState(0);
  /** Whether the category being planned has changes not saved yet. */
  const [dirty, setDirty] = useState(false);
  const reference = useReference(bookId);
  const current = useBudgetYear(bookId, year);
  const previous = useBudgetYear(bookId, year - 1);
  const lines = useMonthEnds(bookId, [year]);
  const nameOf = useNameOf(reference.data?.defaultLanguage);

  /** Runs a move away from the category, after asking when something would be lost. */
  const leave = (move: () => void) => {
    if (dirty && !window.confirm(t("budget.leaveUnsaved"))) return;
    setDirty(false);
    move();
  };

  const failure = reference.error ?? current.error ?? previous.error ?? lines.error;
  const header = (
    <Group gap="xs">
      <ActionIcon
        variant="default"
        aria-label={t("budget.previousYear")}
        onClick={() => leave(() => setYear(year - 1))}
      >
        ◀
      </ActionIcon>
      <Title order={3}>{t("budget.title", { year })}</Title>
      <ActionIcon
        variant="default"
        aria-label={t("budget.nextYear")}
        onClick={() => leave(() => setYear(year + 1))}
      >
        ▶
      </ActionIcon>
    </Group>
  );

  if (!reference.data || !current.data || !previous.data || !lines.data) {
    return (
      <Stack>
        {header}
        {failure && <Alert color="red">{t("common.error", { message: failure.message })}</Alert>}
      </Stack>
    );
  }

  const ref = reference.data;
  const groups = [...ref.groups].filter((g) => !g.archived).sort((a, b) => a.position - b.position);
  const transferNatures = new Set(ref.natures.filter((n) => n.transfer).map((n) => n.id));
  const categories = groups.flatMap((group) =>
    ref.categories
      .filter((c) => c.groupId === group.id && !c.archived && !transferNatures.has(c.natureId))
      .sort((a, b) => a.code.localeCompare(b.code)),
  );
  const index = categories.findIndex((c) => c.id === planning);
  const category = categories[index];
  const text = (minor: bigint) => formatMoney(money(minor, bookCurrency), i18n.language);

  if (planning === TRANSFERS) {
    return (
      <Stack>
        {header}
        {failure && <Alert color="red">{t("common.error", { message: failure.message })}</Alert>}
        <Group gap="xs">
          <Button size="xs" variant="default" onClick={() => leave(() => setPlanning(null))}>
            {t("budget.allCategories")}
          </Button>
        </Group>
        <PlanTransfers
          key={`${year}|${revision}`}
          bookId={bookId}
          bookCurrency={bookCurrency}
          canEdit={canEdit}
          year={year}
          reference={ref}
          onDirty={setDirty}
          onReload={() => setRevision((r) => r + 1)}
        />
      </Stack>
    );
  }

  if (category) {
    const go = (step: number) =>
      leave(() =>
        setPlanning(categories[(index + step + categories.length) % categories.length]!.id),
      );
    return (
      <Stack>
        {header}
        {failure && <Alert color="red">{t("common.error", { message: failure.message })}</Alert>}
        <Group gap="xs">
          <Button size="xs" variant="default" onClick={() => leave(() => setPlanning(null))}>
            {t("budget.allCategories")}
          </Button>
          <Button size="xs" variant="default" onClick={() => go(-1)}>
            {t("budget.previousCategory")}
          </Button>
          <Button size="xs" variant="default" onClick={() => go(1)}>
            {t("budget.nextCategory")}
          </Button>
          <Select
            size="xs"
            w={240}
            searchable
            allowDeselect={false}
            aria-label={t("budget.searchCategory")}
            placeholder={t("budget.searchCategory")}
            nothingFoundMessage={t("budget.noCategory")}
            // By code or by name, within the book's groups.
            data={groups
              .map((group) => ({
                group: nameOf(group.names),
                items: categories
                  .filter((c) => c.groupId === group.id)
                  .map((c) => ({ value: c.id, label: `${c.code} ${nameOf(c.names)}` })),
              }))
              .filter((group) => group.items.length > 0)}
            value={category.id}
            // The current name is selected, so that typing starts a search.
            onFocus={(event) => event.currentTarget.select()}
            onClick={(event) => event.currentTarget.select()}
            onChange={(id) => id && id !== category.id && leave(() => setPlanning(id))}
          />
          <Badge variant="light">{category.code}</Badge>
          <Title order={4}>{nameOf(category.names)}</Title>
        </Group>
        <CategoryEditor
          // Not on the saved version: the editor starts again once everything is reloaded.
          key={`${category.id}|${year}|${revision}`}
          bookId={bookId}
          bookCurrency={bookCurrency}
          canEdit={canEdit}
          year={year}
          reference={ref}
          category={category}
          current={current.data}
          previous={previous.data}
          lines={lines.data}
          onDirty={setDirty}
          onReload={() => setRevision((r) => r + 1)}
        />
      </Stack>
    );
  }

  const natureById = new Map(ref.natures.map((n) => [n.id, n]));
  const totals = new Map<string, bigint>();
  const lastYear = new Map<string, bigint>();
  for (const c of categories) {
    totals.set(c.natureId, (totals.get(c.natureId) ?? 0n) + sum(yearOf(current.data, c.id).budget));
    lastYear.set(
      c.natureId,
      (lastYear.get(c.natureId) ?? 0n) + sum(yearOf(previous.data, c.id).actual),
    );
  }
  const summaryNatures = [...ref.natures]
    .filter((n) => !n.transfer && (!n.archived || totals.get(n.id) || lastYear.get(n.id)))
    .sort((a, b) => a.position - b.position);
  // The change adds each nature with its own sign: income up, spending down.
  const change = (values: Map<string, bigint>) =>
    summaryNatures.reduce((total, n) => total + BigInt(n.sign) * (values.get(n.id) ?? 0n), 0n);

  return (
    <Stack>
      {header}
      {failure && <Alert color="red">{t("common.error", { message: failure.message })}</Alert>}
      <Paper withBorder>
        <DataTable minWidth={760} verticalSpacing={4} highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("budget.category")}</Table.Th>
              <Table.Th ta="right">{t("budget.actualOf", { year: year - 1 })}</Table.Th>
              <Table.Th ta="right">{t("budget.plannedOf", { year: year - 1 })}</Table.Th>
              <Table.Th ta="right">{t("budget.gridOf", { year })}</Table.Th>
              <Table.Th ta="right">{t("budget.entriesOf", { year })}</Table.Th>
              <Table.Th ta="right">{t("budget.plannedOf", { year })}</Table.Th>
              <Table.Th w={100} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {groups.map((group) => {
              const rows = categories.filter((c) => c.groupId === group.id);
              if (rows.length === 0) return null;
              return [
                <Table.Tr key={group.id}>
                  <Table.Td colSpan={7} bg="var(--mantine-color-gray-light)">
                    <Text fw={600}>{nameOf(group.names)}</Text>
                  </Table.Td>
                </Table.Tr>,
                ...rows.map((c) => {
                  const now = yearOf(current.data, c.id);
                  const before = yearOf(previous.data, c.id);
                  return (
                    <Table.Tr key={c.id}>
                      <Table.Td>
                        <Group gap="xs" wrap="nowrap">
                          <Badge variant="light" style={{ flexShrink: 0 }}>
                            {c.code}
                          </Badge>
                          <Text size="sm">{nameOf(c.names)}</Text>
                          <Badge size="xs" variant="dot" style={{ flexShrink: 0 }}>
                            {nameOf(natureById.get(c.natureId)?.names ?? {})}
                          </Badge>
                        </Group>
                      </Table.Td>
                      <Table.Td ta="right">{text(sum(before.actual))}</Table.Td>
                      <Table.Td ta="right">{text(sum(before.budget))}</Table.Td>
                      <Table.Td ta="right">{text(sum(now.grid))}</Table.Td>
                      <Table.Td ta="right">{text(sum(now.planned))}</Table.Td>
                      <Table.Td ta="right" fw={600}>
                        {text(sum(now.budget))}
                      </Table.Td>
                      <Table.Td ta="right">
                        <Button size="compact-xs" onClick={() => setPlanning(c.id)}>
                          {t("budget.plan")}
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  );
                }),
              ];
            })}
          </Table.Tbody>
        </DataTable>
      </Paper>
      {transferNatures.size > 0 && (
        <TransfersSummary bookId={bookId} year={year} onPlan={() => setPlanning(TRANSFERS)} />
      )}
      <Paper withBorder p="sm">
        <DataTable minWidth={360}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th />
              <Table.Th ta="right">{t("budget.actualOf", { year: year - 1 })}</Table.Th>
              <Table.Th ta="right">{t("budget.plannedOf", { year })}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {summaryNatures.map((nature) => (
              <Table.Tr key={nature.id}>
                <Table.Td>{nameOf(nature.names)}</Table.Td>
                <Table.Td ta="right">{text(lastYear.get(nature.id) ?? 0n)}</Table.Td>
                <Table.Td ta="right">{text(totals.get(nature.id) ?? 0n)}</Table.Td>
              </Table.Tr>
            ))}
            <Table.Tr>
              <Table.Td fw={600}>
                <Tooltip label={t("budget.changeHint")}>
                  <span>{t("budget.change")}</span>
                </Tooltip>
              </Table.Td>
              <Table.Td ta="right" fw={600}>
                {text(change(lastYear))}
              </Table.Td>
              <Table.Td ta="right" fw={600}>
                {text(change(totals))}
              </Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </DataTable>
      </Paper>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// One category: its grid, with the previous year at hand
// ---------------------------------------------------------------------------

function draftFrom(
  saved: CategoryBudgetRow | undefined,
  previous: CategoryBudgetRow | undefined,
): Draft {
  const shown = (amount: string) => (Number(amount) === 0 ? "" : amount.replace(/\.0+$/, ""));
  // A year not budgeted yet starts with last year's account, and no amount.
  const from = saved ?? previous;
  return {
    months: saved ? saved.months.map(shown) : MONTHS.map(() => ""),
    accountId: from?.accountId ?? null,
    exchangeRate: from?.exchangeRate ?? "",
    assumptions: saved?.assumptions ?? "",
  };
}

type CategoryProps = {
  bookId: string;
  bookCurrency: string;
  canEdit: boolean;
  year: number;
  reference: Reference;
  category: Category;
  current: BudgetYear;
  previous: BudgetYear;
  lines: MonthEnd[];
  onDirty: (dirty: boolean) => void;
  onReload: () => void;
};

/** Reads the category's entries of the year and the one before, then starts planning. */
function CategoryEditor(props: CategoryProps) {
  const { t } = useTranslation();
  const { bookId, year, reference, category } = props;
  const subCategoryIds = reference.subCategories
    .filter((s) => s.categoryId === category.id)
    .map((s) => s.id)
    .join(",");
  const filters = (y: number) => ({
    months: monthsOfYear(y),
    subCategoryIds,
    limit: 2000,
    offset: 0,
  });
  const entries = useJournal(bookId, filters(year));
  const before = useJournal(bookId, filters(year - 1));
  // The list shown while another loads is of another category: wait for ours.
  if (entries.error) {
    return <Alert color="red">{t("common.error", { message: entries.error.message })}</Alert>;
  }
  if (!entries.data || entries.isPlaceholderData || entries.isFetching) return <Loader size="sm" />;
  return (
    <CategoryPlan
      {...props}
      entries={entries.data.entries}
      previousEntries={before.isPlaceholderData ? undefined : before.data?.entries}
    />
  );
}

function CategoryPlan({
  bookId,
  bookCurrency,
  canEdit,
  year,
  reference,
  category,
  current,
  previous,
  lines,
  onDirty,
  onReload,
  entries,
  previousEntries,
}: CategoryProps & { entries: Entry[]; previousEntries: Entry[] | undefined }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const nameOf = useNameOf(reference.defaultLanguage);
  const monthNames = useMonthNames("short");
  const now = yearOf(current, category.id);
  const before = yearOf(previous, category.id);
  const [initial] = useState(() => draftFrom(now.saved, before.saved));
  const [draft, setDraft] = useState(initial);
  // As read when planning started: what is saved is the difference.
  const [read] = useState(() => ({ rows: rowsOf(entries), entries }));
  const [rows, setRows] = useState(read.rows);
  const context = {
    accounts: new Map(reference.accounts.map((a) => [a.id, a])),
    bookCurrency,
    year,
  };
  const sign = BigInt(reference.natures.find((n) => n.id === category.natureId)?.sign ?? 1);
  /** The planned entries per month, read like the grid. */
  const planned = plannedByMonth(rows, context).map((v) => sign * v);
  const changes = entryChanges(rows, read.rows, context);
  const entriesChanged =
    changes.create.length + changes.splits.length + changes.update.length + changes.remove.length >
    0;
  const wrongRows = invalidRows(rows, context);

  const update = (patch: Partial<Draft>) => setDraft((old) => ({ ...old, ...patch }));
  const locked = new Set(
    lines.filter((l) => l.categoryId === category.id && l.reconciled).map((l) => l.month - 1),
  );
  const editor = useGrid({
    values: MONTHS.map((m) => minorOf(draft.months[m], bookCurrency)),
    onChange: (values) => update({ months: values.map((v) => cellText(v, bookCurrency)) }),
    locked,
    currency: bookCurrency,
  });
  /** The amounts as they would be saved, what is being typed included. */
  const grid = editor.effective;
  const budgetChanged =
    JSON.stringify({ ...draft, months: grid.map((v) => cellText(v, bookCurrency)) }) !==
    JSON.stringify(initial);
  const dirty = budgetChanged || entriesChanged;
  /** The budget of the year as being planned: what is typed included. */
  const budget = MONTHS.map((m) => grid[m]! + planned[m]!);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const budgeted = grid.some((a) => a !== 0n);
  const account = reference.accounts.find((a) => a.id === draft.accountId);
  const needsRate = account !== undefined && account.currency !== bookCurrency;
  const problem =
    editor.invalid !== null
      ? "budget.problemAmount"
      : budgeted && !draft.accountId
        ? "budget.problemAccount"
        : draft.accountId && needsRate && draft.exchangeRate.trim() === ""
          ? "budget.problemRate"
          : wrongRows > 0
            ? "budget.problemEntries"
            : undefined;

  const save = useMutation({
    mutationFn: () => {
      const keep = budgeted || draft.assumptions.trim() !== "";
      const budget = {
        year,
        save:
          budgetChanged && keep
            ? [
                {
                  categoryId: category.id,
                  year,
                  assumptions: draft.assumptions.trim(),
                  months: grid.map((minor) => toDecimalString(money(minor, bookCurrency))),
                  ...(draft.accountId && {
                    accountId: draft.accountId,
                    ...(needsRate && { exchangeRate: decimalInput(draft.exchangeRate) }),
                  }),
                },
              ]
            : [],
        remove: budgetChanged && !keep && now.saved ? [category.id] : [],
        versions: now.saved ? { [category.id]: now.saved.version } : {},
      };
      return unwrap(
        api.books[":bookId"].budgets.plan.$post({
          param: { bookId },
          json: { budget, ...changes },
        }),
      );
    },
    onSuccess: async () => {
      onDirty(false);
      await queryClient.invalidateQueries({ queryKey: ["books", bookId] });
      onReload();
    },
  });

  const saveButton = (
    <Button
      disabled={!dirty || problem !== undefined}
      loading={save.isPending}
      onClick={() => save.mutate()}
    >
      {t("common.save")}
    </Button>
  );

  const figure = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 });
  const text = (minor: bigint) =>
    figure.format(Number(toDecimalString(money(minor, bookCurrency))));
  const row = (label: string, values: readonly bigint[], strong = false) => (
    <Table.Tr>
      <Table.Td style={{ whiteSpace: "nowrap" }}>{label}</Table.Td>
      {values.map((value, i) => (
        <Table.Td key={i} ta="right" fw={strong ? 600 : undefined}>
          {value === 0n ? "–" : text(value)}
        </Table.Td>
      ))}
      <Table.Td ta="right" fw={600}>
        {text(sum(values))}
      </Table.Td>
    </Table.Tr>
  );

  return (
    <Stack>
      <Paper withBorder p="sm">
        <Stack gap="sm">
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
          {canEdit && (
            <GridTools
              grid={editor}
              monthNames={monthNames}
              format={text}
              previousBudget={before.budget}
              previousActual={before.actual}
              year={year}
            />
          )}
          <DataTable minWidth={820} verticalSpacing={4} horizontalSpacing={2} fz="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th />
                {MONTHS.map((m) => (
                  <Table.Th key={m} ta="right">
                    {monthNames[m]}
                  </Table.Th>
                ))}
                <Table.Th ta="right">{t("budget.total")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {row(t("budget.plannedOf", { year: year - 1 }), before.budget)}
              {row(t("budget.actualOf", { year: year - 1 }), before.actual)}
              <Table.Tr>
                <Table.Td fw={600} style={{ whiteSpace: "nowrap" }}>
                  {t("budget.gridOf", { year })}
                </Table.Td>
                {MONTHS.map((m) => {
                  const { selected, ...cell } = editor.cell(m);
                  return (
                    <Table.Td key={m}>
                      <TextInput
                        {...cell}
                        size="xs"
                        miw={44}
                        aria-label={`${t("budget.gridOf", { year })} ${monthNames[m]}`}
                        title={locked.has(m) ? t("budget.locked") : undefined}
                        disabled={!canEdit || locked.has(m)}
                        error={editor.invalid === m}
                        styles={{
                          input: {
                            textAlign: "right",
                            paddingInline: 3,
                            ...(selected && { background: "var(--mantine-color-blue-light)" }),
                          },
                        }}
                      />
                    </Table.Td>
                  );
                })}
                <Table.Td ta="right" fw={600}>
                  {text(sum(grid))}
                </Table.Td>
              </Table.Tr>
              {row(t("budget.entriesOf", { year }), planned)}
              {row(t("budget.plannedOf", { year }), budget, true)}
              {row(t("budget.reconciledOf", { year }), now.reconciled)}
              {row(
                t("budget.remainingOf", { year }),
                MONTHS.map((m) => budget[m]! - now.reconciled[m]!),
                true,
              )}
            </Table.Tbody>
          </DataTable>
          <Group align="flex-start" grow>
            <Stack gap="xs">
              <Select
                size="xs"
                label={t("budget.account")}
                description={t("budget.accountHint")}
                disabled={!canEdit}
                withAsterisk={budgeted}
                clearable={!budgeted}
                error={problem === "budget.problemAccount"}
                data={reference.accounts
                  .filter((a) => !a.archived || a.id === draft.accountId)
                  .map((a) => ({ value: a.id, label: `${nameOf(a.names)} (${a.currency})` }))}
                value={draft.accountId}
                onChange={(value) => update({ accountId: value, exchangeRate: "" })}
              />
              {needsRate && (
                <TextInput
                  size="xs"
                  label={t("budget.rate", { from: account.currency, to: bookCurrency })}
                  disabled={!canEdit}
                  inputMode="decimal"
                  value={draft.exchangeRate}
                  error={problem === "budget.problemRate"}
                  onChange={(e) => update({ exchangeRate: e.currentTarget.value })}
                />
              )}
            </Stack>
            <Textarea
              size="xs"
              label={t("budget.assumptions")}
              disabled={!canEdit}
              autosize
              minRows={2}
              maxLength={2000}
              value={draft.assumptions}
              onChange={(e) => update({ assumptions: e.currentTarget.value })}
            />
          </Group>
          {canEdit && (
            <Group justify="flex-end">
              {problem && (
                <Text size="sm" c="red">
                  {t(problem, { count: wrongRows })}
                </Text>
              )}
              {saveButton}
            </Group>
          )}
        </Stack>
      </Paper>
      <PlanEntries
        canEdit={canEdit}
        year={year}
        reference={reference}
        categoryId={category.id}
        bookCurrency={bookCurrency}
        rows={rows}
        setRows={setRows}
        previous={previousEntries}
        unplanned={read.entries.filter((e) => Number(e.plannedAmount) === 0)}
      />
      {canEdit && <Group justify="flex-end">{saveButton}</Group>}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Planned transfers: their two sides add up to zero, so they have no budget
// ---------------------------------------------------------------------------

function TransfersSummary({
  bookId,
  year,
  onPlan,
}: {
  bookId: string;
  year: number;
  onPlan: () => void;
}) {
  const { t } = useTranslation();
  const transfers = useTransfers(bookId, year);
  return (
    <Paper withBorder p="sm">
      <Group justify="space-between">
        <Group gap="xs">
          <Title order={4}>{t("budget.plannedTransfers", { year })}</Title>
          {transfers.data && (
            <Text size="sm" c="dimmed">
              {t("budget.transfers.count", { count: plannedCount(transfers.data) })}
            </Text>
          )}
        </Group>
        <Button size="compact-xs" onClick={onPlan}>
          {t("budget.plan")}
        </Button>
      </Group>
      {transfers.error && (
        <Alert color="red">{t("common.error", { message: transfers.error.message })}</Alert>
      )}
    </Paper>
  );
}
