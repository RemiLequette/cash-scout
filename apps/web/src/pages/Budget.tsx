import { formatMoney, money, parseAmount, toDecimalString } from "@cash-scout/domain";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Modal,
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
import { cellText, GridTools, useGrid } from "../budgetGrid";
import {
  decimalInput,
  formatDate,
  useJournal,
  useMonthEnds,
  type Entry,
  type MonthEnd,
} from "../journal";
import { useMonthNames } from "../options";
import { useNameOf, useReference, type Reference } from "../reference";
import { DataTable } from "../table";
import {
  draftOf as entryDraftOf,
  emptyDraft,
  EntryForm,
  type Draft as EntryDraft,
} from "./Journal";
import { TransferForm } from "./TransferForm";

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

  if (category) {
    const go = (step: number) =>
      leave(() =>
        setPlanning(categories[(index + step + categories.length) % categories.length]!.id),
      );
    const saved = current.data.budgets.find((b) => b.categoryId === category.id);
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
        <CategoryPlan
          // A saved or reloaded budget starts the draft again.
          key={`${category.id}|${year}|${saved?.version ?? "none"}`}
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
        />
        <PlannedEntries
          bookId={bookId}
          bookCurrency={bookCurrency}
          canEdit={canEdit}
          year={year}
          reference={ref}
          categoryIds={[category.id]}
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
        <PlannedEntries
          bookId={bookId}
          bookCurrency={bookCurrency}
          canEdit={canEdit}
          year={year}
          reference={ref}
          categoryIds={[]}
        />
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
}: {
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
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const nameOf = useNameOf(reference.defaultLanguage);
  const monthNames = useMonthNames("short");
  const now = yearOf(current, category.id);
  const before = yearOf(previous, category.id);
  const [initial] = useState(() => draftFrom(now.saved, before.saved));
  const [draft, setDraft] = useState(initial);

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
  const dirty =
    JSON.stringify({ ...draft, months: grid.map((v) => cellText(v, bookCurrency)) }) !==
    JSON.stringify(initial);
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
          : undefined;

  const save = useMutation({
    mutationFn: () => {
      const keep = budgeted || draft.assumptions.trim() !== "";
      return unwrap(
        api.books[":bookId"].budgets.batch.$post({
          param: { bookId },
          json: {
            year,
            save: keep
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
            remove: keep ? [] : [category.id],
            versions: now.saved ? { [category.id]: now.saved.version } : {},
          },
        }),
      );
    },
    onSuccess: async () => {
      onDirty(false);
      await queryClient.invalidateQueries({ queryKey: ["books", bookId, "budgets"] });
    },
  });

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
    <Paper withBorder p="sm">
      <Stack gap="sm">
        {save.error && (
          <Alert color="red">{t("common.error", { message: save.error.message })}</Alert>
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
            {row(t("budget.entriesOf", { year }), now.planned)}
            {row(
              t("budget.plannedOf", { year }),
              MONTHS.map((m) => grid[m]! + now.planned[m]!),
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
                .filter((a) => (!a.archived && a.kind === "bank") || a.id === draft.accountId)
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
                {t(problem)}
              </Text>
            )}
            <Button
              disabled={!dirty || problem !== undefined}
              loading={save.isPending}
              onClick={() => save.mutate()}
            >
              {t("common.save")}
            </Button>
          </Group>
        )}
      </Stack>
    </Paper>
  );
}

// ---------------------------------------------------------------------------

function PlannedEntries({
  bookId,
  bookCurrency,
  canEdit,
  year,
  reference,
  categoryIds,
}: {
  bookId: string;
  bookCurrency: string;
  canEdit: boolean;
  year: number;
  reference: Reference;
  categoryIds: string[];
}) {
  const { t, i18n } = useTranslation();
  const nameOf = useNameOf(reference.defaultLanguage);
  // Without a category, the list is that of the planned transfers: their two sides add up to
  // zero, so they have no budget.
  const transferNatures = new Set(reference.natures.filter((n) => n.transfer).map((n) => n.id));
  const transferCategoryIds = reference.categories
    .filter((c) => transferNatures.has(c.natureId))
    .map((c) => c.id);
  const transfers = categoryIds.length === 0;
  const subCategories = reference.subCategories.filter((s) =>
    (transfers ? transferCategoryIds : categoryIds).includes(s.categoryId),
  );
  const filters = (y: number) => ({
    from: `${y}-01-01`,
    to: `${y}-12-31`,
    subCategoryIds: subCategories.map((s) => s.id).join(","),
    limit: 2000,
    offset: 0,
  });
  const current = useJournal(bookId, filters(year));
  const [editing, setEditing] = useState<EntryDraft | null>(null);
  /** A planned transfer being created (no id) or edited. */
  const [transfer, setTransfer] = useState<{ id?: string } | null>(null);

  const planned = (entry: Entry) => Number(entry.plannedAmount) !== 0;
  // Only the plan: what was not planned consumes the grid instead.
  const entries = (current.data?.entries ?? [])
    .filter(planned)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const format = (amount: string, currency: string) =>
    formatMoney(parseAmount(amount, currency), i18n.language);
  const subOf = new Map(reference.subCategories.map((s) => [s.id, s]));
  const categoryOf = new Map(reference.categories.map((c) => [c.id, c]));
  const accountOf = new Map(reference.accounts.map((a) => [a.id, a]));

  return (
    <Paper withBorder p="sm">
      <Stack>
        <Group justify="space-between">
          <Title order={4}>
            {t(transfers ? "budget.plannedTransfers" : "budget.plannedEntries", { year })}
          </Title>
          {canEdit && (
            <Group>
              {transfers && (
                <Button variant="default" size="xs" onClick={() => setTransfer({})}>
                  {t("budget.newPlannedTransfer")}
                </Button>
              )}
              {!transfers && (
                <Button
                  size="xs"
                  onClick={() => setEditing({ ...emptyDraft(), date: `${year}-01-01` })}
                >
                  {t("budget.newPlanned")}
                </Button>
              )}
            </Group>
          )}
        </Group>
        <Text size="sm" c="dimmed">
          {t(transfers ? "budget.plannedTransfersHint" : "budget.plannedEntriesHint")}
        </Text>
        {current.error && (
          <Alert color="red">{t("common.error", { message: current.error.message })}</Alert>
        )}
        {entries.length === 0 && !current.isPending && (
          <Text c="dimmed">{t("budget.noPlannedEntries")}</Text>
        )}
        {entries.length > 0 && (
          <DataTable minWidth={700} verticalSpacing={4} highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={110}>{t("journal.date")}</Table.Th>
                <Table.Th>{t("journal.subCategory")}</Table.Th>
                <Table.Th>{t("journal.description")}</Table.Th>
                <Table.Th>{t("journal.account")}</Table.Th>
                <Table.Th w={110} ta="right">
                  {t("budget.plannedAmount")}
                </Table.Th>
                <Table.Th w={110} ta="right">
                  {t("journal.amount")}
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {entries.map((entry) => {
                const sub = subOf.get(entry.subCategoryId);
                const category = sub && categoryOf.get(sub.categoryId);
                return (
                  <Table.Tr
                    key={entry.id}
                    style={{ cursor: canEdit && !entry.reconciled ? "pointer" : undefined }}
                    c={entry.reconciled ? "dimmed" : undefined}
                    onClick={() =>
                      // A reconciled entry is no longer part of what can be planned.
                      canEdit &&
                      !entry.reconciled &&
                      (entry.transferId
                        ? setTransfer({ id: entry.transferId })
                        : setEditing(entryDraftOf(entry, "edit")))
                    }
                  >
                    <Table.Td>{formatDate(entry.date, i18n.language)}</Table.Td>
                    <Table.Td>
                      <Text size="sm">
                        {category ? `${category.code} ` : ""}
                        {sub ? nameOf(sub.names) : ""}
                      </Text>
                    </Table.Td>
                    <Table.Td>{entry.description}</Table.Td>
                    <Table.Td>{nameOf(accountOf.get(entry.accountId)?.names ?? {})}</Table.Td>
                    <Table.Td ta="right">{format(entry.plannedAmount, entry.currency)}</Table.Td>
                    <Table.Td ta="right">
                      <Text size="sm" fw={600}>
                        {format(entry.amount, entry.currency)}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </DataTable>
        )}
      </Stack>
      <Modal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.id ? t("journal.editEntry") : t("budget.newPlanned")}
        size="lg"
      >
        {editing && (
          <EntryForm
            key={editing.id ?? "new"}
            bookId={bookId}
            bookCurrency={bookCurrency}
            reference={reference}
            initial={editing}
            planned
            categoryIds={categoryIds}
            onClose={() => setEditing(null)}
          />
        )}
      </Modal>
      <Modal
        opened={transfer !== null}
        onClose={() => setTransfer(null)}
        title={transfer?.id ? t("transfer.edit") : t("budget.newPlannedTransfer")}
        size="lg"
      >
        {transfer && (
          <TransferForm
            key={transfer.id ?? "new"}
            bookId={bookId}
            bookCurrency={bookCurrency}
            reference={reference}
            transferId={transfer.id}
            planned
            initialDate={`${year}-01-01`}
            onClose={() => setTransfer(null)}
          />
        )}
      </Modal>
    </Paper>
  );
}
