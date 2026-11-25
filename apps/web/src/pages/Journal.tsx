import {
  displayName,
  entryInputSchema,
  formatMoney,
  parseAmount,
  rateSchema,
  type EntryInput,
} from "@cash-scout/domain";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Collapse,
  Divider,
  Group,
  Menu,
  Modal,
  Paper,
  Popover,
  ScrollArea,
  SimpleGrid,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { useDebouncedValue, useElementSize, useMediaQuery } from "@mantine/hooks";
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type Ref,
} from "react";
import { useTranslation } from "react-i18next";
import {
  decimalInput,
  formatDate,
  today,
  useBalances,
  useJournal,
  useFrequent,
  useJournalChange,
  useMonthEnds,
  useMonths,
  useSettle,
  type Entry,
  type MonthEnd,
} from "../journal";
import { currencyOptions } from "../options";
import { useNameOf, useReference, type Reference } from "../reference";
import { AccountChart } from "./AccountChart";
import { TransferForm } from "./TransferForm";

function ErrorAlert({ error }: { error: Error | null }) {
  const { t } = useTranslation();
  return error ? <Alert color="red">{t("common.error", { message: error.message })}</Alert> : null;
}

/** Formats a decimal amount from the API in its currency for the interface language. */
function useMoney() {
  const { i18n } = useTranslation();
  return (amount: string, currency: string) =>
    formatMoney(parseAmount(amount, currency), i18n.language);
}

/** Sub-categories grouped under their category, for a select; archived ones only if kept. */
function useSubCategoryOptions(reference: Reference, keep?: string, categoryIds?: string[]) {
  const nameOf = useNameOf(reference.defaultLanguage);
  return reference.categories
    .filter((category) => !categoryIds || categoryIds.includes(category.id))
    .map((category) => ({
      group: `${category.code} ${nameOf(category.names)}`,
      items: reference.subCategories
        .filter((s) => s.categoryId === category.id && (!s.archived || s.id === keep))
        .map((s) => ({ value: s.id, label: nameOf(s.names) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .filter((group) => group.items.length > 0);
}

// ---------------------------------------------------------------------------
// Entry form
// ---------------------------------------------------------------------------

/** What the form edits: an existing entry (id) or a new one, possibly a duplicate. */
export interface Draft {
  id?: string;
  /** Revision of the entry as read, sent back with the change. */
  version?: number;
  date: string;
  accountId: string | null;
  subCategoryId: string | null;
  description: string;
  paymentTypeId: string | null;
  amount: string;
  exchangeRate: string;
  originalAmount: string;
  originalCurrency: string | null;
  reconciled: boolean;
  /** Shown read-only when editing. */
  plannedAmount?: string;
  variance?: string;
  currency?: string;
}

export function draftOf(entry: Entry, mode: "edit" | "duplicate"): Draft {
  return {
    id: mode === "edit" ? entry.id : undefined,
    version: mode === "edit" ? entry.version : undefined,
    date: mode === "edit" ? entry.date : today(),
    accountId: entry.accountId,
    subCategoryId: entry.subCategoryId,
    description: entry.description,
    paymentTypeId: entry.paymentTypeId,
    amount: entry.amount,
    exchangeRate: entry.exchangeRate === "1" ? "" : entry.exchangeRate,
    originalAmount: entry.originalAmount ?? "",
    originalCurrency: entry.originalCurrency,
    reconciled: mode === "edit" ? entry.reconciled : false,
    ...(mode === "edit" && {
      plannedAmount: entry.plannedAmount,
      variance: entry.variance,
      currency: entry.currency,
    }),
  };
}

export const emptyDraft = (): Draft => ({
  date: today(),
  accountId: null,
  subCategoryId: null,
  description: "",
  paymentTypeId: null,
  amount: "",
  exchangeRate: "",
  originalAmount: "",
  originalCurrency: null,
  reconciled: false,
});

type Field =
  | "date"
  | "accountId"
  | "subCategoryId"
  | "amount"
  | "exchangeRate"
  | "originalAmount"
  | "originalCurrency";

/**
 * Checks the draft as the API will, and builds the request body.
 * Returns the fields in error, translated by the caller.
 */
function validate(
  draft: Draft,
  accountCurrency: string | undefined,
  bookCurrency: string,
): { body?: EntryInput; errors: Partial<Record<Field, true>> } {
  const errors: Partial<Record<Field, true>> = {};
  const needsRate = accountCurrency !== undefined && accountCurrency !== bookCurrency;
  const amount = decimalInput(draft.amount);
  const exchangeRate = decimalInput(draft.exchangeRate);
  const originalAmount = decimalInput(draft.originalAmount);
  const candidate = {
    date: draft.date,
    accountId: draft.accountId ?? "",
    subCategoryId: draft.subCategoryId ?? "",
    description: draft.description,
    paymentTypeId: draft.paymentTypeId,
    amount,
    ...(needsRate && { exchangeRate }),
    originalAmount: originalAmount || null,
    originalCurrency: originalAmount ? draft.originalCurrency : null,
    reconciled: draft.reconciled,
  };
  const parsed = entryInputSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors[issue.path[0] as Field] = true;
    }
  }
  // Decimals allowed by the currencies.
  const fits = (value: string, currency: string | null | undefined) => {
    if (!currency) return true;
    try {
      parseAmount(value, currency);
      return true;
    } catch {
      return false;
    }
  };
  if (!fits(amount, accountCurrency)) errors.amount = true;
  if (originalAmount && !fits(originalAmount, draft.originalCurrency)) errors.originalAmount = true;
  if (needsRate && !rateSchema.safeParse(exchangeRate).success) errors.exchangeRate = true;
  return Object.keys(errors).length === 0 ? { body: candidate as EntryInput, errors } : { errors };
}

export function EntryForm({
  bookId,
  bookCurrency,
  reference,
  initial,
  onClose,
  onDuplicate,
  planned = false,
  categoryIds,
}: {
  bookId: string;
  bookCurrency: string;
  reference: Reference;
  initial: Draft;
  onClose: () => void;
  /** Starts a new entry from the saved one. */
  onDuplicate?: (draft: Draft) => void;
  /** The entries created are part of the budget's plan: their planned amount is their amount. */
  planned?: boolean;
  /** Only the sub-categories of these categories can be picked. */
  categoryIds?: string[];
}) {
  const { t, i18n } = useTranslation();
  const nameOf = useNameOf(reference.defaultLanguage);
  const formatAmount = useMoney();
  const change = useJournalChange(bookId);
  const [draft, setDraft] = useState(initial);
  const [shown, setShown] = useState<Partial<Record<Field, true>>>({});
  const [showOriginal, setShowOriginal] = useState(initial.originalAmount !== "");
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });

  // Archived items are offered only when the entry already uses them.
  const accountOptions = reference.accounts
    .filter((a) => !a.archived || a.id === initial.accountId)
    // When editing, the account can only change to one in the same currency.
    .filter((a) => !initial.id || a.currency === initial.currency)
    .map((a) => ({ value: a.id, label: `${nameOf(a.names)} (${a.currency})` }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const subCategoryOptions = useSubCategoryOptions(
    reference,
    initial.id ? (initial.subCategoryId ?? undefined) : undefined,
    categoryIds,
  );
  const paymentTypeOptions = reference.paymentTypes
    .filter((p) => !p.archived || p.id === initial.paymentTypeId)
    .map((p) => ({ value: p.id, label: nameOf(p.names) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const account = reference.accounts.find((a) => a.id === draft.accountId);
  const needsRate = account !== undefined && account.currency !== bookCurrency;
  const { body, errors } = validate(draft, account?.currency, bookCurrency);
  const error = (field: Field) => (shown[field] ? t(`journal.invalid.${field}`) : undefined);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!body) {
      setShown(errors);
      return;
    }
    if (draft.id) {
      // The planned amount is fixed: the API ignores it, so it is not sent.
      change.mutate(
        { action: "update", id: draft.id, body: { ...body, version: draft.version } },
        { onSuccess: onClose },
      );
    } else {
      change.mutate(
        { action: "create", body: planned ? { ...body, planned: true } : body },
        { onSuccess: onClose },
      );
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <ErrorAlert error={change.error} />
        <Group grow align="flex-start">
          <TextInput
            type="date"
            label={t("journal.date")}
            required
            value={draft.date}
            error={error("date")}
            onChange={(e) => set({ date: e.currentTarget.value })}
            data-autofocus
          />
          <Select
            label={t("journal.account")}
            required
            searchable
            data={accountOptions}
            value={draft.accountId}
            error={error("accountId")}
            onChange={(value) => set({ accountId: value })}
          />
        </Group>
        <Select
          label={t("journal.subCategory")}
          description={t("journal.subCategoryHint")}
          required
          searchable
          data={subCategoryOptions}
          value={draft.subCategoryId}
          error={error("subCategoryId")}
          onChange={(value) => set({ subCategoryId: value })}
        />
        <TextInput
          label={t("journal.description")}
          maxLength={500}
          value={draft.description}
          onChange={(e) => set({ description: e.currentTarget.value })}
        />
        <Group grow align="flex-start">
          <TextInput
            label={account ? `${t("journal.amount")} (${account.currency})` : t("journal.amount")}
            description={t("journal.amountHint")}
            required
            inputMode="decimal"
            placeholder={t("journal.amountPlaceholder")}
            value={draft.amount}
            error={error("amount")}
            onChange={(e) => set({ amount: e.currentTarget.value })}
          />
          <Select
            label={t("journal.paymentType")}
            clearable
            data={paymentTypeOptions}
            value={draft.paymentTypeId}
            onChange={(value) => set({ paymentTypeId: value })}
          />
        </Group>
        {needsRate && (
          <TextInput
            label={t("journal.exchangeRate")}
            description={t("journal.exchangeRateHint", {
              from: account.currency,
              to: bookCurrency,
            })}
            required
            inputMode="decimal"
            value={draft.exchangeRate}
            error={error("exchangeRate")}
            onChange={(e) => set({ exchangeRate: e.currentTarget.value })}
          />
        )}
        {draft.id && Number(draft.plannedAmount) !== 0 && draft.plannedAmount && draft.currency && (
          <Text size="sm" c="dimmed">
            {t("journal.plannedAndVariance", {
              planned: formatAmount(draft.plannedAmount, draft.currency),
              variance: formatAmount(draft.variance ?? "0", draft.currency),
            })}
          </Text>
        )}
        <Button
          variant="subtle"
          size="compact-sm"
          style={{ alignSelf: "flex-start" }}
          onClick={() => setShowOriginal(!showOriginal)}
        >
          {t("journal.originalToggle")}
        </Button>
        <Collapse expanded={showOriginal}>
          <Group grow align="flex-start">
            <TextInput
              label={t("journal.originalAmount")}
              description={t("journal.originalHint")}
              inputMode="decimal"
              value={draft.originalAmount}
              error={error("originalAmount")}
              onChange={(e) => set({ originalAmount: e.currentTarget.value })}
            />
            <Select
              label={t("journal.originalCurrency")}
              searchable
              clearable
              data={currencyOptions(i18n.language)}
              value={draft.originalCurrency}
              error={error("originalCurrency")}
              onChange={(value) => set({ originalCurrency: value })}
            />
          </Group>
        </Collapse>
        <Switch
          label={t("journal.reconciled")}
          description={t("journal.reconciledHint")}
          checked={draft.reconciled}
          onChange={(e) => set({ reconciled: e.currentTarget.checked })}
        />
        <Group justify="space-between">
          <Group gap="xs">
            {initial.id && (
              <>
                {onDuplicate && (
                  <Button
                    variant="subtle"
                    onClick={() =>
                      onDuplicate({
                        ...initial,
                        id: undefined,
                        date: today(),
                        reconciled: false,
                        plannedAmount: undefined,
                        variance: undefined,
                        currency: undefined,
                      })
                    }
                  >
                    {t("journal.duplicate")}
                  </Button>
                )}
                <Button
                  variant="subtle"
                  color="red"
                  loading={change.isPending && change.variables?.action === "delete"}
                  onClick={() =>
                    window.confirm(t("journal.deleteConfirm")) &&
                    change.mutate({ action: "delete", id: initial.id! }, { onSuccess: onClose })
                  }
                >
                  {t("common.delete")}
                </Button>
              </>
            )}
          </Group>
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" loading={change.isPending}>
              {draft.id ? t("common.save") : t("common.create")}
            </Button>
          </Group>
        </Group>
      </Stack>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Period
// ---------------------------------------------------------------------------

/** The months shown, as "2026-11"; `null` shows every date. */
type Months = Set<string> | null;

/** Most entries loaded at once: a household's busiest year fits, "All" shows the latest. */
const LOAD_LIMIT = 1000;

const pad = (n: number) => String(n).padStart(2, "0");

const currentMonth = () => today().slice(0, 7);

/** "2026-11" moved by a number of months. */
function addMonths(month: string, step: number): string {
  const [year, number] = month.split("-").map(Number);
  const index = year! * 12 + number! - 1 + step;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/** The current month and the ones before it. */
function lastMonths(count: number): Set<string> {
  return new Set(Array.from({ length: count }, (_, i) => addMonths(currentMonth(), -i)));
}

/** The current month and the next one, shown when the journal opens. */
function currentAndNextMonth(): Set<string> {
  return new Set([currentMonth(), addMonths(currentMonth(), 1)]);
}

function containsToday(months: Months): boolean {
  return months === null || months.has(currentMonth());
}

/** "Novembre 2026" from "2026-11", capitalized for languages that do not. */
function formatMonth(yearMonth: string, locale: string): string {
  const text = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${yearMonth}-01T00:00:00Z`));
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

/** "22 Nov" from "2026-11-22": the month header gives the year. */
function formatDay(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

/** "Sept." or "Sept. 2026" from "2026-09", capitalized. */
function formatShortMonth(yearMonth: string, locale: string, withYear: boolean): string {
  const text = new Intl.DateTimeFormat(locale, {
    month: "short",
    ...(withYear && { year: "numeric" }),
    timeZone: "UTC",
  }).format(new Date(`${yearMonth}-01T00:00:00Z`));
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

/**
 * The months to show, as in a spreadsheet filter: years and their months to
 * tick, with shortcuts for the usual choices. The arrows move the whole
 * choice by one month.
 */
function PeriodPicker({
  bookId,
  value,
  onChange,
  fullWidth,
}: {
  bookId: string;
  value: Months;
  onChange: (value: Months) => void;
  fullWidth?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const counts = useMonths(bookId);
  const entries = new Map((counts.data ?? []).map((row) => [row.month, row.entries]));
  const years = [...new Set([...entries.keys(), currentMonth()].map((m) => m.slice(0, 4)))].sort(
    (a, b) => b.localeCompare(a),
  );
  const monthsOf = (year: string) => Array.from({ length: 12 }, (_, i) => `${year}-${pad(i + 1)}`);
  const allMonths = years.flatMap(monthsOf);
  const isOn = (month: string) => value === null || value.has(month);
  const set = (months: string[], on: boolean) => {
    const next = new Set(value ?? allMonths);
    for (const month of months) {
      if (on) next.add(month);
      else next.delete(month);
    }
    onChange(next.size === allMonths.length ? null : next);
  };

  const sorted = value ? [...value].sort() : [];
  const consecutive = sorted.every((m, i) => i === 0 || addMonths(sorted[i - 1]!, 1) === m);
  const label =
    value === null
      ? t("journal.allDates")
      : sorted.length === 0
        ? t("journal.noMonth")
        : sorted.length === 1
          ? formatMonth(sorted[0]!, i18n.language)
          : consecutive
            ? `${formatShortMonth(
                sorted[0]!,
                i18n.language,
                sorted[0]!.slice(0, 4) !== sorted.at(-1)!.slice(0, 4),
              )} – ${formatShortMonth(sorted.at(-1)!, i18n.language, true)}`
            : t("journal.monthCount", { count: sorted.length });
  const canShift = value !== null && value.size > 0;
  const shift = (step: number) =>
    value && onChange(new Set([...value].map((month) => addMonths(month, step))));

  return (
    <Group gap={2} wrap="nowrap" style={fullWidth ? { flex: 1 } : undefined}>
      <ActionIcon
        variant="subtle"
        color="gray"
        aria-label={t("journal.previous")}
        disabled={!canShift}
        onClick={() => shift(-1)}
      >
        ‹
      </ActionIcon>
      <Popover position="bottom-start" width={300} shadow="md" trapFocus>
        <Popover.Target>
          <Button
            size="xs"
            variant="default"
            justify="space-between"
            rightSection="▾"
            miw={170}
            fullWidth={fullWidth}
            fw={600}
          >
            {label}
          </Button>
        </Popover.Target>
        <Popover.Dropdown p="xs">
          <Stack gap={6}>
            <Group gap={4}>
              <Button size="compact-xs" variant="light" onClick={() => onChange(lastMonths(1))}>
                {t("journal.thisMonth")}
              </Button>
              <Button size="compact-xs" variant="light" onClick={() => onChange(lastMonths(3))}>
                {t("journal.lastMonths", { count: 3 })}
              </Button>
              <Button size="compact-xs" variant="light" onClick={() => onChange(lastMonths(12))}>
                {t("journal.lastMonths", { count: 12 })}
              </Button>
              <Button size="compact-xs" variant="light" onClick={() => onChange(null)}>
                {t("journal.allDates")}
              </Button>
            </Group>
            <Group gap="xs">
              <Button size="compact-xs" variant="subtle" onClick={() => onChange(new Set())}>
                {t("journal.uncheckAll")}
              </Button>
            </Group>
            <ScrollArea.Autosize mah={380} type="auto">
              <Stack gap={8} pr="xs">
                {years.map((year) => {
                  const months = monthsOf(year);
                  const on = months.filter(isOn).length;
                  const total = months.reduce((sum, m) => sum + (entries.get(m) ?? 0), 0);
                  return (
                    <Stack key={year} gap={4}>
                      <Checkbox
                        size="xs"
                        checked={on === 12}
                        indeterminate={on > 0 && on < 12}
                        onChange={(e) => set(months, e.currentTarget.checked)}
                        label={
                          <Text size="xs" fw={600} span>
                            {year}
                            <Text span size="xs" c="dimmed" fw={400} ml={6}>
                              {t("journal.count", { count: total })}
                            </Text>
                          </Text>
                        }
                      />
                      <SimpleGrid cols={4} spacing={4} verticalSpacing={4} ml="lg">
                        {months.map((month) => (
                          <Checkbox
                            key={month}
                            size="xs"
                            checked={isOn(month)}
                            onChange={(e) => set([month], e.currentTarget.checked)}
                            label={
                              <Text size="xs" span c={entries.has(month) ? undefined : "dimmed"}>
                                {formatShortMonth(month, i18n.language, false)}
                              </Text>
                            }
                          />
                        ))}
                      </SimpleGrid>
                    </Stack>
                  );
                })}
              </Stack>
            </ScrollArea.Autosize>
          </Stack>
        </Popover.Dropdown>
      </Popover>
      <ActionIcon
        variant="subtle"
        color="gray"
        aria-label={t("journal.next")}
        disabled={!canShift}
        onClick={() => shift(1)}
      >
        ›
      </ActionIcon>
    </Group>
  );
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

/**
 * The reconciled balance of each account, on one line; clicking an account
 * shows only its entries.
 */
function BalanceCards({
  bookId,
  reference,
  selected,
  onSelect,
}: {
  bookId: string;
  reference: Reference;
  selected: string | null;
  onSelect: (accountId: string | null) => void;
}) {
  const { t } = useTranslation();
  const nameOf = useNameOf(reference.defaultLanguage);
  const formatAmount = useMoney();
  const balances = useBalances(bookId);
  const rows = (balances.data ?? [])
    .map((balance) => ({
      ...balance,
      account: reference.accounts.find((a) => a.id === balance.accountId),
    }))
    // Archived accounts only while they still hold money.
    .filter(
      (b) =>
        b.account && (!b.account.archived || Number(b.total) !== 0 || Number(b.reconciled) !== 0),
    )
    .sort((a, b) => nameOf(a.account!.names).localeCompare(nameOf(b.account!.names)));
  if (balances.error) return <ErrorAlert error={balances.error} />;
  if (rows.length === 0) return null;
  return (
    <Group gap="xs" wrap="nowrap" style={{ overflowX: "auto", scrollbarWidth: "none" }}>
      {rows.map((row) => {
        const active = selected === row.accountId;
        return (
          <UnstyledButton
            key={row.accountId}
            aria-pressed={active}
            title={t("journal.filterOnAccount")}
            style={{ flex: "1 0 auto" }}
            onClick={() => onSelect(active ? null : row.accountId)}
          >
            <Paper
              withBorder
              px="sm"
              py={6}
              radius="md"
              style={
                active
                  ? {
                      borderColor: "var(--mantine-color-blue-filled)",
                      background: "var(--mantine-color-blue-light)",
                    }
                  : undefined
              }
            >
              <Group gap="sm" justify="space-between" wrap="nowrap">
                <Text size="sm" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                  {nameOf(row.account!.names)}
                  {row.account!.kind === "virtual" && ` (${t("accountKinds.virtual")})`}
                </Text>
                <Text
                  size="sm"
                  fw={700}
                  c={Number(row.reconciled) < 0 ? "red" : undefined}
                  title={t("journal.balanceReconciled")}
                  style={{ whiteSpace: "nowrap" }}
                >
                  {formatAmount(row.reconciled, row.currency)}
                </Text>
              </Group>
            </Paper>
          </UnstyledButton>
        );
      })}
    </Group>
  );
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

/** What a row needs from the reference data, resolved once per entry. */
interface Row {
  entry: Entry;
  sub: string;
  category: string;
  categoryCode?: string;
  /** The sign and transfer flag of the category's nature. */
  natureSign?: 1 | -1;
  transfer?: boolean;
  account: string;
  paymentType: string;
}

/**
 * What a month holds, in the book currency: the natures that read as entered
 * ("income"), those that read reversed ("spending") and their net. Transfers
 * are left out.
 */
function monthTotals(rows: Row[], bookCurrency: string) {
  let income = 0n;
  let spending = 0n;
  for (const row of rows) {
    const minor = parseAmount(row.entry.bookAmount, bookCurrency).minor;
    if (row.transfer) continue;
    if (row.natureSign === 1) income += minor;
    if (row.natureSign === -1) spending += minor;
  }
  return {
    income: { minor: income, currency: bookCurrency },
    spending: { minor: spending, currency: bookCurrency },
    net: { minor: income + spending, currency: bookCurrency },
  };
}

function MonthTotals({ rows, bookCurrency }: { rows: Row[]; bookCurrency: string }) {
  const { t, i18n } = useTranslation();
  const totals = monthTotals(rows, bookCurrency);
  const format = (money: { minor: bigint; currency: string }) => formatMoney(money, i18n.language);
  return (
    <Group gap="md" wrap="wrap">
      <Text size="sm" c="teal">
        {t("journal.income", { amount: format(totals.income) })}
      </Text>
      <Text size="sm">{t("journal.spending", { amount: format(totals.spending) })}</Text>
      <Text size="sm" fw={600} c={totals.net.minor < 0n ? "red" : undefined}>
        {t("journal.net", { amount: format(totals.net) })}
      </Text>
    </Group>
  );
}

function Amount({ row, bookCurrency }: { row: Row; bookCurrency: string }) {
  const { t } = useTranslation();
  const formatAmount = useMoney();
  const { entry } = row;
  return (
    <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
      <Text
        size="sm"
        fw={600}
        c={row.transfer ? "dimmed" : row.natureSign === 1 ? "teal" : undefined}
      >
        {formatAmount(entry.amount, entry.currency)}
      </Text>
      {entry.currency !== bookCurrency && (
        <Text size="xs" c="dimmed">
          {formatAmount(entry.bookAmount, bookCurrency)}
        </Text>
      )}
      {Number(entry.plannedAmount) !== 0 && Number(entry.variance) !== 0 && (
        <Text size="xs" c="dimmed">
          {t("journal.plannedShort", {
            planned: formatAmount(entry.plannedAmount, entry.currency),
          })}
        </Text>
      )}
    </div>
  );
}

/** Reconciled or forecast; editors switch it with a click. */
function Status({
  reconciled,
  canEdit,
  onToggle,
}: {
  reconciled: boolean;
  canEdit: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const badge = (
    <Badge
      size="xs"
      style={{ overflow: "visible", ...(canEdit ? { cursor: "pointer" } : {}) }}
      variant={reconciled ? "light" : "outline"}
      color={reconciled ? "teal" : "orange"}
    >
      {reconciled ? t("journal.statusReconciled") : t("journal.statusForecast")}
    </Badge>
  );
  if (!canEdit) return badge;
  const action = reconciled ? t("journal.markForecast") : t("journal.markReconciled");
  return (
    <UnstyledButton onClick={onToggle} aria-label={action} title={action}>
      {badge}
    </UnstyledButton>
  );
}

/** Marks one side of a transfer: leaving the source account, or reaching the destination. */
function TransferBadge({ leg }: { leg: "source" | "destination" | null }) {
  const { t } = useTranslation();
  const label = leg ? t(`transfer.leg.${leg}`) : t("transfer.badge");
  return (
    <Badge variant="light" color="grape" size="xs" mr={6} title={label}>
      {leg === "source" ? "⇄ →" : leg === "destination" ? "→ ⇄" : "⇄"}
    </Badge>
  );
}

function CategoryLabel({ row }: { row: Row }) {
  return (
    <Text size="sm" span style={{ whiteSpace: "nowrap" }}>
      {row.categoryCode && (
        <Text span size="xs" c="dimmed" mr={6}>
          {row.categoryCode}
        </Text>
      )}
      {row.category}
    </Text>
  );
}

/**
 * Which sub-categories to show, as in a spreadsheet filter: a list of
 * categories and their sub-categories to tick. `null` shows them all.
 */
function CategoryFilter({
  reference,
  value,
  onChange,
  fullWidth,
}: {
  reference: Reference;
  value: Set<string> | null;
  onChange: (value: Set<string> | null) => void;
  fullWidth?: boolean;
}) {
  const { t } = useTranslation();
  const nameOf = useNameOf(reference.defaultLanguage);
  const [search, setSearch] = useState("");
  const allIds = reference.subCategories.map((sub) => sub.id);
  const isOn = (id: string) => value === null || value.has(id);
  const set = (ids: string[], on: boolean) => {
    const next = new Set(value ?? allIds);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onChange(next.size === allIds.length ? null : next);
  };

  const needle = search.trim().toLocaleLowerCase();
  const matches = (text: string) => text.toLocaleLowerCase().includes(needle);
  const groups = [...reference.categories]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((category) => {
      const name = nameOf(category.names);
      const subs = reference.subCategories
        .filter((sub) => sub.categoryId === category.id)
        .map((sub) => ({ id: sub.id, name: nameOf(sub.names) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const shown =
        !needle || matches(name) || matches(category.code)
          ? subs
          : subs.filter((sub) => matches(sub.name));
      return { category, name, subs: shown };
    })
    .filter((group) => group.subs.length > 0);
  const visibleIds = groups.flatMap((group) => group.subs.map((sub) => sub.id));

  return (
    <Popover position="bottom-start" width={320} shadow="md" trapFocus>
      <Popover.Target>
        <Button
          size="xs"
          variant={value ? "light" : "default"}
          fullWidth={fullWidth}
          justify="space-between"
          rightSection="▾"
          miw={170}
        >
          {value
            ? t("journal.subCategoriesShown", { count: value.size, total: allIds.length })
            : t("journal.allCategories")}
        </Button>
      </Popover.Target>
      <Popover.Dropdown p="xs">
        <Stack gap={6}>
          <TextInput
            size="xs"
            placeholder={t("journal.search")}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
          <Group gap="xs">
            <Button size="compact-xs" variant="subtle" onClick={() => set(visibleIds, true)}>
              {t("journal.checkAll")}
            </Button>
            <Button size="compact-xs" variant="subtle" onClick={() => set(visibleIds, false)}>
              {t("journal.uncheckAll")}
            </Button>
          </Group>
          <ScrollArea.Autosize mah={380} type="auto">
            <Stack gap={8} pr="xs">
              {groups.map(({ category, name, subs }) => {
                const ids = subs.map((sub) => sub.id);
                const on = ids.filter(isOn).length;
                return (
                  <Stack key={category.id} gap={4}>
                    <Checkbox
                      size="xs"
                      checked={on === ids.length}
                      indeterminate={on > 0 && on < ids.length}
                      onChange={(e) => set(ids, e.currentTarget.checked)}
                      label={
                        <Text size="xs" fw={600} span>
                          <Text span size="xs" c="dimmed" mr={6}>
                            {category.code}
                          </Text>
                          {name}
                        </Text>
                      }
                    />
                    {subs.map((sub) => (
                      <Checkbox
                        key={sub.id}
                        size="xs"
                        ml="lg"
                        checked={isOn(sub.id)}
                        onChange={(e) => set([sub.id], e.currentTarget.checked)}
                        label={sub.name}
                      />
                    ))}
                  </Stack>
                );
              })}
            </Stack>
          </ScrollArea.Autosize>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

/** Marks where today falls between past entries and forecasts. */
function TodayDivider() {
  const { t, i18n } = useTranslation();
  return (
    <Divider
      color="blue"
      labelPosition="left"
      label={
        <Text size="xs" fw={600} c="blue">
          {t("journal.todayDivider", { date: formatDate(today(), i18n.language) })}
        </Text>
      }
    />
  );
}

/** Index of the last row up to today, after which the divider goes; -1 for none. */
function lastPastIndex(rows: Row[]): number {
  const now = today();
  return rows.findLastIndex((row) => row.entry.date <= now);
}

/** Builds the rows of the entries, oldest first, with names in the reader's language. */
function toRows(entries: Entry[], reference: Reference, language: string): Row[] {
  const nameOf = (names: Parameters<typeof displayName>[0]) =>
    displayName(names, language, reference.defaultLanguage);
  const byId = <T extends { id: string }>(items: T[]) => new Map(items.map((i) => [i.id, i]));
  const subs = byId(reference.subCategories);
  const categories = byId(reference.categories);
  const natures = byId(reference.natures);
  const accounts = byId(reference.accounts);
  const paymentTypes = byId(reference.paymentTypes);
  return entries
    .map((entry) => {
      const sub = subs.get(entry.subCategoryId);
      const category = sub && categories.get(sub.categoryId);
      const account = accounts.get(entry.accountId);
      const paymentType = entry.paymentTypeId ? paymentTypes.get(entry.paymentTypeId) : undefined;
      return {
        entry,
        sub: sub ? nameOf(sub.names) : "",
        category: category ? nameOf(category.names) : "",
        categoryCode: category?.code,
        natureSign: category && natures.get(category.natureId)?.sign,
        transfer: category && natures.get(category.natureId)?.transfer,
        account: account ? nameOf(account.names) : "",
        paymentType: paymentType ? nameOf(paymentType.names) : "",
      };
    })
    .reverse();
}

interface EntryViewProps {
  row: Row;
  bookCurrency: string;
  canEdit: boolean;
  onReconcile: (id: string, reconciled: boolean) => void;
  onOpen: (entry: Entry) => void;
}

/** Estimated heights of a not yet drawn entry, so that the page keeps its length. */
const ROW_HEIGHT = 31;
const CARD_HEIGHT = 70;

/** Becomes true once the element comes near the screen, and stays true. */
function useNearScreen<T extends HTMLElement>(eager: boolean) {
  const [element, setElement] = useState<T | null>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (near || eager || !element) return;
    const observer = new IntersectionObserver(
      (records) => {
        if (records.some((record) => record.isIntersecting)) setNear(true);
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near, eager, element]);
  return [setElement, near || eager] as const;
}

/**
 * A month of the table. Its entries are drawn only when it comes near the screen:
 * drawing a year of entries at once takes seconds.
 */
function TableMonth({
  eager,
  header,
  count,
  columns,
  children,
}: {
  eager: boolean;
  header: ReactNode;
  count: number;
  columns: number;
  children: () => ReactNode;
}) {
  const [ref, near] = useNearScreen<HTMLTableSectionElement>(eager);
  return (
    <Table.Tbody ref={ref}>
      {header}
      {near ? (
        children()
      ) : (
        <Table.Tr>
          <Table.Td colSpan={columns} p={0} style={{ height: count * ROW_HEIGHT }} />
        </Table.Tr>
      )}
    </Table.Tbody>
  );
}

/** A month of cards, drawn when near the screen like {@link TableMonth}. */
function CardMonth({
  eager,
  header,
  count,
  children,
}: {
  eager: boolean;
  header: ReactNode;
  count: number;
  children: () => ReactNode;
}) {
  const [ref, near] = useNearScreen<HTMLDivElement>(eager);
  return (
    <Stack ref={ref} gap="xs">
      {header}
      {near ? children() : <div style={{ height: count * CARD_HEIGHT }} />}
    </Stack>
  );
}

/** A table row; memoized so that a change to one entry does not redraw the others. */
const TableEntry = memo(function TableEntry({
  row,
  bookCurrency,
  canEdit,
  onReconcile,
  onOpen,
}: EntryViewProps) {
  const { i18n } = useTranslation();
  const { entry } = row;
  return (
    <Table.Tr
      style={canEdit ? { cursor: "pointer" } : undefined}
      onClick={canEdit ? () => onOpen(entry) : undefined}
    >
      <Table.Td style={{ whiteSpace: "nowrap" }}>{formatDay(entry.date, i18n.language)}</Table.Td>
      <Table.Td>
        {entry.transferId && <TransferBadge leg={entry.transferLeg} />}
        {entry.description}
      </Table.Td>
      <Table.Td>
        <CategoryLabel row={row} />
      </Table.Td>
      <Table.Td style={{ whiteSpace: "nowrap" }}>{row.sub}</Table.Td>
      <Table.Td style={{ whiteSpace: "nowrap" }}>{row.account}</Table.Td>
      <Table.Td c="dimmed" style={{ whiteSpace: "nowrap" }}>
        {row.paymentType}
      </Table.Td>
      <Table.Td>
        <Amount row={row} bookCurrency={bookCurrency} />
      </Table.Td>
      <Table.Td onClick={(e) => e.stopPropagation()}>
        <Status
          reconciled={entry.reconciled}
          canEdit={canEdit}
          onToggle={() => onReconcile(entry.id, !entry.reconciled)}
        />
      </Table.Td>
    </Table.Tr>
  );
});

/** An entry as a card, for narrow screens. */
const CardEntry = memo(function CardEntry({
  row,
  bookCurrency,
  canEdit,
  onReconcile,
  onOpen,
}: EntryViewProps) {
  const { i18n } = useTranslation();
  const { entry } = row;
  return (
    <Paper withBorder radius="md" p="xs">
      <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
        <UnstyledButton
          style={{ flex: 1, minWidth: 0 }}
          disabled={!canEdit}
          onClick={() => onOpen(entry)}
        >
          <Text size="sm" fw={500} truncate>
            {entry.transferId && <TransferBadge leg={entry.transferLeg} />}
            {entry.description || row.sub}
          </Text>
          <Text size="xs" c="dimmed" truncate>
            {[
              formatDay(entry.date, i18n.language),
              entry.description ? `${row.category} › ${row.sub}` : row.category,
              row.account,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </UnstyledButton>
        <Stack gap={4} align="flex-end">
          <Amount row={row} bookCurrency={bookCurrency} />
          <Status
            reconciled={entry.reconciled}
            canEdit={canEdit}
            onToggle={() => onReconcile(entry.id, !entry.reconciled)}
          />
        </Stack>
      </Group>
    </Paper>
  );
});

/**
 * The month-end line of a periodic category: what its budget left unused in the
 * month, on its reference account. It is computed, never edited; settling it
 * ("reconciled") lets the unused budget go and sets the line to 0.
 */
interface MonthEndViewProps {
  line: MonthEnd;
  category: string;
  categoryCode?: string;
  account: string;
  bookCurrency: string;
  canEdit: boolean;
  onSettle: (line: MonthEnd, reconciled: boolean) => void;
}

function MonthEndAmount({ line, bookCurrency }: Pick<MonthEndViewProps, "line" | "bookCurrency">) {
  const { t } = useTranslation();
  const formatAmount = useMoney();
  return (
    <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
      <Text size="sm" fw={600} c={line.reconciled ? "dimmed" : undefined}>
        {formatAmount(line.amount, line.currency)}
      </Text>
      {line.currency !== bookCurrency && !line.reconciled && (
        <Text size="xs" c="dimmed">
          {formatAmount(line.bookAmount, bookCurrency)}
        </Text>
      )}
      {line.reconciled && Number(line.unused) !== 0 && (
        <Text size="xs" c="dimmed">
          {t("journal.monthEndLetGo", { amount: formatAmount(line.unused, bookCurrency) })}
        </Text>
      )}
    </div>
  );
}

function MonthEndStatus({
  line,
  canEdit,
  onSettle,
}: Pick<MonthEndViewProps, "line" | "canEdit" | "onSettle">) {
  return (
    <Status
      reconciled={line.reconciled}
      canEdit={canEdit}
      onToggle={() => onSettle(line, !line.reconciled)}
    />
  );
}

const MonthEndTableRow = memo(function MonthEndTableRow(props: MonthEndViewProps) {
  const { t, i18n } = useTranslation();
  const { line } = props;
  return (
    <Table.Tr bg="var(--mantine-color-default-hover)" title={t("journal.monthEndHint")}>
      <Table.Td style={{ whiteSpace: "nowrap" }}>{formatDay(line.date, i18n.language)}</Table.Td>
      <Table.Td>
        <Group gap={6} wrap="nowrap">
          <Badge size="xs" variant="light" color="gray" style={{ overflow: "visible" }}>
            {t("journal.monthEndBadge")}
          </Badge>
          <Text size="sm" fs="italic" span>
            {t("journal.monthEnd")}
          </Text>
        </Group>
      </Table.Td>
      <Table.Td>
        <Text size="sm" span style={{ whiteSpace: "nowrap" }}>
          {props.categoryCode && (
            <Text span size="xs" c="dimmed" mr={6}>
              {props.categoryCode}
            </Text>
          )}
          {props.category}
        </Text>
      </Table.Td>
      <Table.Td />
      <Table.Td style={{ whiteSpace: "nowrap" }}>{props.account}</Table.Td>
      <Table.Td />
      <Table.Td>
        <MonthEndAmount line={line} bookCurrency={props.bookCurrency} />
      </Table.Td>
      <Table.Td>
        <MonthEndStatus line={line} canEdit={props.canEdit} onSettle={props.onSettle} />
      </Table.Td>
    </Table.Tr>
  );
});

const MonthEndCard = memo(function MonthEndCard(props: MonthEndViewProps) {
  const { t, i18n } = useTranslation();
  const { line } = props;
  return (
    <Paper radius="md" p="xs" bg="var(--mantine-color-default-hover)">
      <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text size="sm" fw={500} fs="italic" truncate>
            {t("journal.monthEnd")} · {props.category}
          </Text>
          <Text size="xs" c="dimmed" truncate>
            {[formatDay(line.date, i18n.language), props.account].filter(Boolean).join(" · ")}
          </Text>
        </div>
        <Stack gap={4} align="flex-end">
          <MonthEndAmount line={line} bookCurrency={props.bookCurrency} />
          <MonthEndStatus line={line} canEdit={props.canEdit} onSettle={props.onSettle} />
        </Stack>
      </Group>
    </Paper>
  );
});

/**
 * "New entry", with an arrow that lists the descriptions most used lately:
 * picking one starts a new entry from the latest one, dated today.
 */
function NewTransferButton({
  disabled,
  compact,
  onOpen,
}: {
  disabled: boolean;
  compact: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  return compact ? (
    <ActionIcon
      size="md"
      variant="default"
      aria-label={t("transfer.new")}
      title={t("transfer.new")}
      disabled={disabled}
      onClick={onOpen}
    >
      ⇄
    </ActionIcon>
  ) : (
    <Button size="xs" variant="default" disabled={disabled} onClick={onOpen}>
      {t("transfer.new")}
    </Button>
  );
}

function NewEntryButton({
  bookId,
  disabled,
  compact,
  onOpen,
}: {
  bookId: string;
  disabled: boolean;
  compact: boolean;
  onOpen: (draft: Draft) => void;
}) {
  const { t } = useTranslation();
  const formatAmount = useMoney();
  const [opened, setOpened] = useState(false);
  const frequent = useFrequent(bookId, opened);
  return (
    <Group gap={0} wrap="nowrap">
      {compact ? (
        <ActionIcon
          size="md"
          aria-label={t("journal.newEntry")}
          disabled={disabled}
          style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
          onClick={() => onOpen(emptyDraft())}
        >
          +
        </ActionIcon>
      ) : (
        <Button
          size="xs"
          disabled={disabled}
          style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
          onClick={() => onOpen(emptyDraft())}
        >
          {t("journal.newEntry")}
        </Button>
      )}
      <Menu opened={opened} onChange={setOpened} position="bottom-end" width={340} withinPortal>
        <Menu.Target>
          <ActionIcon
            size={compact ? "md" : 30}
            disabled={disabled}
            aria-label={t("journal.frequent")}
            title={t("journal.frequent")}
            style={{
              borderTopLeftRadius: 0,
              borderBottomLeftRadius: 0,
              borderLeft: "1px solid var(--mantine-color-blue-3)",
            }}
          >
            ▾
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>{t("journal.frequentHint")}</Menu.Label>
          {frequent.isPending && <Menu.Item disabled>…</Menu.Item>}
          {frequent.data?.length === 0 && <Menu.Item disabled>{t("journal.noFrequent")}</Menu.Item>}
          {frequent.data?.map(({ entry, uses }) => (
            <Menu.Item
              key={entry.id}
              onClick={() => onOpen(draftOf(entry, "duplicate"))}
              rightSection={
                <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                  {formatAmount(entry.amount, entry.currency)}
                </Text>
              }
            >
              <Text size="sm" truncate title={t("journal.uses", { count: uses })}>
                {entry.description}
              </Text>
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function Journal({
  bookId,
  bookCurrency,
  canEdit,
}: {
  bookId: string;
  bookCurrency: string;
  canEdit: boolean;
}) {
  const { t, i18n } = useTranslation();
  const reference = useReference(bookId);
  const nameOf = useNameOf(reference.data?.defaultLanguage);
  const change = useJournalChange(bookId);
  const isMobile = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });

  const [months, setMonths] = useState<Months>(currentAndNextMonth);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [subCategories, setSubCategories] = useState<Set<string> | null>(null);
  const [status, setStatus] = useState<"all" | "true" | "false">("all");
  const [search, setSearch] = useState("");
  const [q] = useDebouncedValue(search, 300);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  /** Changes on each opening, so that the form starts again from its draft. */
  const [formKey, setFormKey] = useState(0);
  const open = useCallback((next: Draft) => {
    setDraft(next);
    setFormKey((key) => key + 1);
  }, []);
  /** The transfer being created (no id) or edited, in its own form. */
  const [transfer, setTransfer] = useState<{ id?: string } | null>(null);
  const openTransfer = useCallback((id?: string) => {
    setTransfer({ id });
    setFormKey((key) => key + 1);
  }, []);

  // Newest first, so that the latest entries are the ones loaded; shown oldest first.
  const list = useJournal(bookId, {
    months: months ? [...months].join(",") : undefined,
    accountId: accountId ?? undefined,
    subCategoryIds: subCategories ? [...subCategories].join(",") : undefined,
    reconciled: status === "all" ? undefined : status,
    q: q || undefined,
    limit: LOAD_LIMIT,
    offset: 0,
  });

  const rows = useMemo(
    () =>
      list.data && reference.data ? toRows(list.data.entries, reference.data, i18n.language) : [],
    [list.data, reference.data, i18n.language],
  );
  // The month-end lines of the unused budgets: of the years the period reaches, and of the
  // last two, whatever the period, so that a past month left unreconciled is always reported.
  const monthsWithEntries = useMonths(bookId);
  const thisYear = Number(today().slice(0, 4));
  const years = [
    ...new Set([
      thisYear - 1,
      thisYear,
      ...(months ? [...months] : (monthsWithEntries.data ?? []).map((m) => m.month)).map((m) =>
        Number(m.slice(0, 4)),
      ),
    ]),
  ].sort();
  const monthEnds = useMonthEnds(bookId, years);
  const { mutate: settleMonth } = useSettle(bookId);
  const onSettle = useCallback(
    (line: MonthEnd, reconciled: boolean) =>
      settleMonth({
        categoryId: line.categoryId,
        year: Number(line.date.slice(0, 4)),
        month: line.month,
        reconciled,
      }),
    [settleMonth],
  );
  const { mutate } = change;
  const onReconcile = useCallback(
    (id: string, reconciled: boolean) => mutate({ action: "reconcile", ids: [id], reconciled }),
    [mutate],
  );
  // A side of a transfer opens the whole transfer: both sides change together.
  const onOpen = useCallback(
    (entry: Entry) =>
      entry.transferId ? openTransfer(entry.transferId) : open(draftOf(entry, "edit")),
    [open, openTransfer],
  );

  // The filters stay above the table; its header sticks just under them.
  const { ref: toolbarRef, height: toolbarHeight } = useElementSize();

  // On the period holding today, bring the today line into view once.
  const todayRef = useRef<HTMLElement>(null);
  const scrolled = useRef(false);
  useEffect(() => {
    if (!scrolled.current && list.data && reference.data) {
      scrolled.current = true;
      todayRef.current?.scrollIntoView({ block: "center" });
    }
  });

  if (reference.error) return <ErrorAlert error={reference.error} />;
  if (!reference.data) return null;
  const ref = reference.data;

  const entries = list.data?.entries ?? [];
  const total = list.data?.total ?? 0;
  const truncated = total > entries.length;
  const byMonth = new Map<string, Row[]>();
  for (const row of rows) {
    const month = row.entry.date.slice(0, 7);
    const inMonth = byMonth.get(month);
    if (inMonth) inMonth.push(row);
    else byMonth.set(month, [row]);
  }

  // The month-end lines follow the journal's filters, except the search, which looks in
  // descriptions they do not have.
  const categoryOf = new Map(ref.categories.map((c) => [c.id, c]));
  const accountName = new Map(ref.accounts.map((a) => [a.id, nameOf(a.names)]));
  const subsOfCategory = new Map<string, string[]>();
  for (const sub of ref.subCategories) {
    subsOfCategory.set(sub.categoryId, [...(subsOfCategory.get(sub.categoryId) ?? []), sub.id]);
  }
  const linesByMonth = new Map<string, MonthEnd[]>();
  for (const line of monthEnds.data ?? []) {
    const month = line.date.slice(0, 7);
    if (
      q ||
      (months && !months.has(month)) ||
      (accountId && line.accountId !== accountId) ||
      (status !== "all" && String(line.reconciled) !== status) ||
      (subCategories && !subsOfCategory.get(line.categoryId)?.some((id) => subCategories.has(id)))
    ) {
      continue;
    }
    linesByMonth.set(month, [...(linesByMonth.get(month) ?? []), line]);
  }
  const monthKeys = [...new Set([...byMonth.keys(), ...linesByMonth.keys()])].sort();
  const hasLines = linesByMonth.size > 0;
  const monthEndProps = (line: MonthEnd): MonthEndViewProps => ({
    line,
    category: nameOf(categoryOf.get(line.categoryId)?.names ?? {}),
    categoryCode: categoryOf.get(line.categoryId)?.code,
    account: accountName.get(line.accountId) ?? "",
    bookCurrency,
    canEdit,
    onSettle,
  });
  // Past months whose unused budget is still a forecast: to be reconciled or settled.
  const pending = [
    ...new Set(
      (monthEnds.data ?? [])
        .filter(
          (line) =>
            !line.reconciled && Number(line.amount) !== 0 && line.date.slice(0, 7) < currentMonth(),
        )
        .map((line) => line.date.slice(0, 7)),
    ),
  ].sort();
  // Only on a period holding today: elsewhere every entry is on the same side.
  const dividerAfter = containsToday(months) ? lastPastIndex(rows) : -1;
  const dividerId = rows[dividerAfter]?.entry.id;
  /** Months drawn at once: a short period, or the one holding the today line. */
  const eager = (inMonth: Row[]) =>
    monthKeys.length <= 2 || inMonth.some((row) => row.entry.id === dividerId);

  const canAdd =
    ref.accounts.some((a) => !a.archived) && ref.subCategories.some((s) => !s.archived);
  const activeFilters = [subCategories, status !== "all" ? status : null].filter(Boolean).length;

  const entryProps = (row: Row): EntryViewProps => ({
    row,
    bookCurrency,
    canEdit,
    onReconcile,
    onOpen,
  });

  const moreFilters = (
    <>
      <CategoryFilter
        reference={ref}
        value={subCategories}
        onChange={setSubCategories}
        fullWidth={isMobile}
      />
      <Select
        size="xs"
        aria-label={t("journal.status")}
        allowDeselect={false}
        w={isMobile ? undefined : 130}
        data={[
          { value: "all", label: t("journal.allStatuses") },
          { value: "true", label: t("journal.reconciledShort") },
          { value: "false", label: t("journal.forecasts") },
        ]}
        value={status}
        onChange={(value) => value && setStatus(value as typeof status)}
      />
    </>
  );

  const columns = 8;

  const top = (
    <Stack gap="xs" pb={6}>
      <BalanceCards bookId={bookId} reference={ref} selected={accountId} onSelect={setAccountId} />

      {isMobile ? (
        <Stack gap={6}>
          <PeriodPicker bookId={bookId} value={months} onChange={setMonths} fullWidth={isMobile} />
          <Group gap={6} wrap="nowrap">
            <TextInput
              size="xs"
              aria-label={t("journal.search")}
              placeholder={t("journal.search")}
              style={{ flex: 1, minWidth: 120 }}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
            />
            <Button size="xs" variant="default" onClick={() => setFiltersOpen(!filtersOpen)}>
              {activeFilters > 0
                ? `${t("journal.filters")} (${activeFilters})`
                : t("journal.filters")}
            </Button>
            {canEdit && (
              <NewTransferButton disabled={!canAdd} compact onOpen={() => openTransfer()} />
            )}
            {canEdit && <NewEntryButton bookId={bookId} disabled={!canAdd} compact onOpen={open} />}
          </Group>
          <Collapse expanded={filtersOpen}>
            <Stack gap={6}>{moreFilters}</Stack>
          </Collapse>
        </Stack>
      ) : (
        <Group gap="xs" wrap="wrap">
          <PeriodPicker bookId={bookId} value={months} onChange={setMonths} fullWidth={isMobile} />
          <TextInput
            size="xs"
            aria-label={t("journal.search")}
            placeholder={t("journal.search")}
            style={{ flex: 1, minWidth: 120 }}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
          {moreFilters}
          {list.data && !truncated && (
            <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
              {t("journal.count", { count: total })}
            </Text>
          )}
          {canEdit && (
            <NewTransferButton disabled={!canAdd} compact={false} onOpen={() => openTransfer()} />
          )}
          {canEdit && (
            <NewEntryButton bookId={bookId} disabled={!canAdd} compact={false} onOpen={open} />
          )}
        </Group>
      )}
      {canEdit && !canAdd && <Text c="dimmed">{t("journal.needsReference")}</Text>}
      <ErrorAlert error={list.error ?? change.error ?? monthEnds.error} />
      {pending.length > 0 && (
        <Alert color="orange" variant="light" py={6}>
          <Group justify="space-between" wrap="nowrap" gap="xs">
            <Text size="sm">
              {t("journal.monthEndPending", {
                months:
                  pending.length > 3
                    ? `${formatMonth(pending[0]!, i18n.language)} – ${formatMonth(pending[pending.length - 1]!, i18n.language)}`
                    : pending.map((month) => formatMonth(month, i18n.language)).join(", "),
                count: pending.length,
              })}
            </Text>
            <Button
              size="compact-xs"
              variant="default"
              onClick={() => {
                setMonths(new Set(pending));
                setStatus("all");
                setSubCategories(null);
                setAccountId(null);
                setSearch("");
              }}
            >
              {t("journal.monthEndShow")}
            </Button>
          </Group>
        </Alert>
      )}
      {truncated && (
        <Text size="xs" c="dimmed">
          {t("journal.truncated", { shown: entries.length, total })}
        </Text>
      )}
    </Stack>
  );

  return (
    <Stack gap={0}>
      {isMobile ? (
        top
      ) : (
        <div
          ref={toolbarRef}
          style={{
            position: "sticky",
            top: "var(--app-shell-header-height, 0px)",
            zIndex: 3,
            background: "var(--mantine-color-body)",
          }}
        >
          {top}
        </div>
      )}
      {list.data && entries.length === 0 && !hasLines && (
        <Text c="dimmed">{t("journal.empty")}</Text>
      )}

      {(entries.length > 0 || hasLines) && isMobile && (
        <Stack gap="lg">
          {monthKeys.map((month, monthIndex) => {
            const inMonth = byMonth.get(month) ?? [];
            const ends = linesByMonth.get(month) ?? [];
            return (
              <CardMonth
                key={month}
                eager={eager(inMonth)}
                count={inMonth.length + ends.length}
                header={
                  <div>
                    <Title order={4}>{formatMonth(month, i18n.language)}</Title>
                    {inMonth.length > 0 && !(truncated && monthIndex === 0) && (
                      <MonthTotals rows={inMonth} bookCurrency={bookCurrency} />
                    )}
                  </div>
                }
              >
                {() =>
                  inMonth
                    .map((row) => (
                      <Fragment key={row.entry.id}>
                        <CardEntry {...entryProps(row)} />
                        {row.entry.id === dividerId && (
                          <div ref={todayRef as Ref<HTMLDivElement>}>
                            <TodayDivider />
                          </div>
                        )}
                      </Fragment>
                    ))
                    .concat(
                      ends.map((line) => (
                        <MonthEndCard
                          key={`end-${line.categoryId}-${line.month}`}
                          {...monthEndProps(line)}
                        />
                      )),
                    )
                }
              </CardMonth>
            );
          })}
        </Stack>
      )}

      {(entries.length > 0 || hasLines) && !isMobile && (
        <Table
          highlightOnHover
          verticalSpacing={3}
          horizontalSpacing="xs"
          fz="sm"
          stickyHeader
          stickyHeaderOffset={`calc(var(--app-shell-header-height, 0px) + ${toolbarHeight}px)`}
        >
          <Table.Thead>
            <Table.Tr style={{ whiteSpace: "nowrap" }}>
              <Table.Th w={64}>{t("journal.date")}</Table.Th>
              <Table.Th>{t("journal.description")}</Table.Th>
              <Table.Th>{t("journal.category")}</Table.Th>
              <Table.Th>{t("journal.subCategory")}</Table.Th>
              <Table.Th>{t("journal.account")}</Table.Th>
              <Table.Th>{t("journal.paymentType")}</Table.Th>
              <Table.Th ta="right">{t("journal.amount")}</Table.Th>
              <Table.Th w={96}>{t("journal.status")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          {monthKeys.map((month, monthIndex) => {
            const inMonth = byMonth.get(month) ?? [];
            const ends = linesByMonth.get(month) ?? [];
            return (
              <TableMonth
                key={month}
                eager={eager(inMonth)}
                count={inMonth.length + ends.length}
                columns={columns}
                header={
                  <Table.Tr bg="var(--mantine-color-default-hover)">
                    <Table.Td colSpan={columns} py={4}>
                      <Group justify="space-between" wrap="wrap">
                        <Text size="sm" fw={700}>
                          {formatMonth(month, i18n.language)}
                        </Text>
                        {inMonth.length > 0 && !(truncated && monthIndex === 0) && (
                          <MonthTotals rows={inMonth} bookCurrency={bookCurrency} />
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                }
              >
                {() =>
                  inMonth
                    .map((row) => (
                      <Fragment key={row.entry.id}>
                        <TableEntry {...entryProps(row)} />
                        {row.entry.id === dividerId && (
                          <Table.Tr ref={todayRef as Ref<HTMLTableRowElement>}>
                            <Table.Td colSpan={columns}>
                              <TodayDivider />
                            </Table.Td>
                          </Table.Tr>
                        )}
                      </Fragment>
                    ))
                    .concat(
                      ends.map((line) => (
                        <MonthEndTableRow
                          key={`end-${line.categoryId}-${line.month}`}
                          {...monthEndProps(line)}
                        />
                      )),
                    )
                }
              </TableMonth>
            );
          })}
        </Table>
      )}

      <AccountChart bookId={bookId} reference={ref} accountId={accountId} />

      <Modal
        size="lg"
        opened={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? t("journal.editEntry") : t("journal.newEntry")}
      >
        {draft && (
          <EntryForm
            key={formKey}
            bookId={bookId}
            bookCurrency={bookCurrency}
            reference={ref}
            initial={draft}
            onClose={() => setDraft(null)}
            onDuplicate={open}
          />
        )}
      </Modal>

      <Modal
        size="lg"
        opened={transfer !== null}
        onClose={() => setTransfer(null)}
        title={transfer?.id ? t("transfer.edit") : t("transfer.new")}
      >
        {transfer && (
          <TransferForm
            key={formKey}
            bookId={bookId}
            bookCurrency={bookCurrency}
            reference={ref}
            transferId={transfer.id}
            onClose={() => setTransfer(null)}
          />
        )}
      </Modal>
    </Stack>
  );
}
