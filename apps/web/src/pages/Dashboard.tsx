import {
  currencyDigits,
  dashboardLines,
  formatMoney,
  parseAmount,
  type DashboardRow,
  type Names,
} from "@cash-scout/domain";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  Switch,
  Table,
  Text,
} from "@mantine/core";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type CSSProperties, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { useDashboard, type DashboardData } from "../dashboard";
import {
  formatDate,
  monthsOfYear,
  shiftText,
  useJournal,
  useMonthEnds,
  type JournalFilters,
} from "../journal";
import { useMonthNames } from "../options";
import { useNameOf, useReference } from "../reference";
import classes from "./Dashboard.module.css";

const PAGE_SIZE = 500;
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const lastDay = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

const pad = (n: number) => String(n).padStart(2, "0");
const rowKey = (row: DashboardRow) => row.key;

/** What the detail panel shows the entries of. */
type Selection =
  /** A row of the grid in a month, or in the whole year when `month` is null. */
  | { kind: "row"; key: string; month: number | null }
  /** A bank account in a month. */
  | { kind: "account"; accountId: string; month: number }
  /** The transfers of a bank account in a month, or in the year when `month` is null. */
  | { kind: "transfers"; accountId: string; month: number | null };

/** The fold of the transfers block, among the keys of the rows. */
const TRANSFERS_KEY = "transfers";

const isSelected = (selection: Selection | null, key: string, month: number | null) =>
  selection?.kind === "row" && selection.key === key && selection.month === month;

// ---------------------------------------------------------------------------
// The detail panel's state: open or not, and its height, kept between visits
// ---------------------------------------------------------------------------

interface PanelState {
  open: boolean;
  height: number;
}

const PANEL_KEY = "dashboardPanel";
const clampHeight = (height: number) =>
  Math.min(Math.max(height, 140), Math.max(220, window.innerHeight - 260));

const ROUNDED_KEY = "dashboardRounded";

/** Whether the grid shows whole amounts, kept between visits; on unless turned off. */
function useRounded() {
  const [rounded, setRounded] = useState(() => localStorage.getItem(ROUNDED_KEY) !== "false");
  useEffect(() => localStorage.setItem(ROUNDED_KEY, String(rounded)), [rounded]);
  return [rounded, setRounded] as const;
}

function usePanel() {
  const [panel, setPanel] = useState<PanelState>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PANEL_KEY) ?? "null") as Partial<PanelState>;
      return { open: saved?.open !== false, height: clampHeight(Number(saved?.height) || 280) };
    } catch {
      return { open: true, height: 280 };
    }
  });
  useEffect(() => localStorage.setItem(PANEL_KEY, JSON.stringify(panel)), [panel]);
  return [panel, setPanel] as const;
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export function Dashboard({ bookId, bookCurrency }: { bookId: string; bookCurrency: string }) {
  const { t, i18n } = useTranslation();
  const reference = useReference(bookId);
  const nameOf = useNameOf(reference.data?.defaultLanguage);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [rounded, setRounded] = useRounded();
  const dashboard = useDashboard(bookId, year);
  // null: the default, natures and groups open and categories closed.
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [panel, setPanel] = usePanel();

  const data = dashboard.data;
  const refData = reference.data;
  const loadingYear = data !== undefined && data.year !== year;

  const rows = useMemo(() => {
    if (!data || !refData) return [];
    const byName = (a: { names: Names }, b: { names: Names }) =>
      nameOf(a.names).localeCompare(nameOf(b.names), i18n.language);
    const subCategories = [...refData.subCategories].sort(byName);
    // Siblings keep the order the book gave its groups.
    const groups = [...refData.groups].sort((a, b) => a.position - b.position || byName(a, b));
    return dashboardLines(
      { groups, categories: refData.categories, subCategories },
      {
        natures: refData.natures,
        balances: refData.balances.filter((b) => !b.archived),
      },
      data.cells.map((cell) => ({
        subCategoryId: cell.subCategoryId,
        month: cell.month,
        total: parseAmount(cell.total, bookCurrency).minor,
      })),
      data.budgetLines.map((u) => ({
        categoryId: u.categoryId,
        months: u.months.map((m) => parseAmount(m, bookCurrency).minor),
      })),
    );
    // `nameOf` changes with the language and the book's default one, both listed here.
  }, [data, refData, bookCurrency, i18n.language]); // eslint-disable-line react-hooks/exhaustive-deps

  const opensByDefault = (key: string) => key.startsWith("group:") || key.startsWith("nature:");
  const isExpanded = (key: string) => (expanded ? expanded.has(key) : opensByDefault(key));
  // A row shows when its parent is shown and open.
  const visible: DashboardRow[] = [];
  const shown = new Set<string>();
  for (const row of rows) {
    const parent = row.parentKey;
    if (parent === null || (shown.has(parent) && isExpanded(parent))) {
      visible.push(row);
      shown.add(rowKey(row));
    }
  }

  const toggle = (key: string) => {
    const next = new Set(expanded ?? rows.map(rowKey).filter(opensByDefault));
    if (!next.delete(key)) next.add(key);
    setExpanded(next);
  };
  const expandAll = () =>
    setExpanded(
      new Set([
        ...rows
          .filter((r) => r.kind === "nature" || r.kind === "group" || r.kind === "category")
          .map(rowKey),
        TRANSFERS_KEY,
      ]),
    );

  const error = reference.error ?? dashboard.error;
  if (error) {
    return <Alert color="red">{t("common.error", { message: error.message })}</Alert>;
  }
  if (!data || !refData) return <Loader />;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--mantine-spacing-xs)",
        height: "calc(100dvh - 48px - 2 * var(--mantine-spacing-sm))",
      }}
    >
      <Group justify="space-between" wrap="wrap" gap="xs">
        <Group gap="xs">
          <ActionIcon
            variant="default"
            aria-label={t("dashboard.previousYear")}
            disabled={year <= 2000}
            onClick={() => setYear(year - 1)}
          >
            ‹
          </ActionIcon>
          <Text fw={600} w={48} ta="center">
            {year}
          </Text>
          <ActionIcon
            variant="default"
            aria-label={t("dashboard.nextYear")}
            disabled={year >= 2200}
            onClick={() => setYear(year + 1)}
          >
            ›
          </ActionIcon>
          {(loadingYear || dashboard.isFetching) && <Loader size="xs" />}
        </Group>
        <Group gap="xs">
          <Text size="sm" c="dimmed">
            {t("dashboard.currency", { currency: bookCurrency })}
          </Text>
          <Switch
            size="xs"
            label={t("dashboard.rounded")}
            checked={rounded}
            onChange={(event) => setRounded(event.currentTarget.checked)}
          />
          <Button size="compact-sm" variant="default" onClick={expandAll}>
            {t("dashboard.expandAll")}
          </Button>
          <Button size="compact-sm" variant="default" onClick={() => setExpanded(new Set())}>
            {t("dashboard.collapseAll")}
          </Button>
        </Group>
      </Group>

      <Paper
        withBorder
        style={{ flex: 1, minHeight: 0, overflow: "auto", opacity: loadingYear ? 0.5 : 1 }}
      >
        <Grid
          bookId={bookId}
          bookCurrency={bookCurrency}
          data={data}
          rows={rows}
          visible={visible}
          isExpanded={isExpanded}
          toggle={toggle}
          rounded={rounded}
          selection={selection}
          select={(next) => {
            setSelection(next);
            setPanel((p) => ({ ...p, open: true }));
          }}
        />
      </Paper>

      <DetailPanel
        bookId={bookId}
        bookCurrency={bookCurrency}
        year={data.year}
        rows={rows}
        selection={selection}
        panel={panel}
        setPanel={setPanel}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The grid: categories, then the balances of the accounts
// ---------------------------------------------------------------------------

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");
/** Negative amounts read in red, the text only. */
const negative = (minor: bigint) => minor < 0n && classes.negative;
/** A twelfth of a year's amount, half away from zero. */
const perMonth = (total: bigint) => (total * 2n + (total < 0n ? -12n : 12n)) / 24n;

/**
 * A grid amount without its currency (the page says it once): a dash for zero.
 * Rounded, it shows whole units, half away from zero.
 */
function useAmount(currency: string, rounded: boolean) {
  const { i18n } = useTranslation();
  const digits = rounded ? 0 : currencyDigits(currency);
  const format = new Intl.NumberFormat(i18n.language, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const unit = 10n ** BigInt(currencyDigits(currency));
  return (minor: bigint) => {
    if (minor === 0n) return "–";
    const sign = minor < 0n ? "-" : "";
    const abs = minor < 0n ? -minor : minor;
    if (rounded) {
      const whole = (abs + unit / 2n) / unit;
      return format.format(Number(`${whole === 0n ? "" : sign}${whole}`));
    }
    const whole = abs / unit;
    const fraction = abs % unit;
    return format.format(Number(`${sign}${whole}.${String(fraction).padStart(digits, "0")}`));
  };
}

function Grid(props: {
  bookId: string;
  bookCurrency: string;
  data: DashboardData;
  rows: DashboardRow[];
  visible: DashboardRow[];
  isExpanded: (key: string) => boolean;
  toggle: (key: string) => void;
  rounded: boolean;
  selection: Selection | null;
  select: (selection: Selection) => void;
}) {
  const { t } = useTranslation();
  const {
    bookId,
    bookCurrency,
    data,
    rows,
    visible,
    isExpanded,
    toggle,
    rounded,
    selection,
    select,
  } = props;
  const reference = useReference(bookId).data!;
  const nameOf = useNameOf(reference.defaultLanguage);
  const monthNames = useMonthNames("short");
  const amount = useAmount(bookCurrency, rounded);

  const natures = new Map(reference.natures.map((n) => [n.id, n]));
  const balances = new Map(reference.balances.map((b) => [b.id, b]));
  const groups = new Map(reference.groups.map((g) => [g.id, g]));
  const categories = new Map(reference.categories.map((c) => [c.id, c]));
  const subCategories = new Map(reference.subCategories.map((s) => [s.id, s]));
  const accounts = new Map(reference.accounts.map((a) => [a.id, a]));
  const byKey = new Map(rows.map((r) => [rowKey(r), r]));
  // A row takes the colour of its group, else of the nearest group around it.
  const colorOf = (row: DashboardRow): string | null => {
    for (let at: DashboardRow | undefined = row; at;) {
      const color = at.kind === "group" ? groups.get(at.id)?.color : null;
      if (color) return color;
      at = at.parentKey === null ? undefined : byKey.get(at.parentKey);
    }
    return null;
  };
  const hasChildren = (row: DashboardRow) =>
    row.kind === "nature" ||
    row.kind === "group" ||
    (row.kind === "category" &&
      rows.some((r) => r.parentKey === row.key && (r.kind === "sub" || r.kind === "budget")));

  // Months ahead show what is planned: they read differently from the past ones.
  // The month under way is shaded.
  const thisYear = data.year === new Date().getFullYear();
  const monthClass = (month: number) =>
    cx(
      month > data.currentMonth && classes.ahead,
      thisYear && month === data.currentMonth && classes.current,
    );

  function label(row: DashboardRow): string {
    switch (row.kind) {
      case "nature":
        return nameOf(natures.get(row.id)?.names ?? {});
      case "balance":
        return nameOf(balances.get(row.id)?.names ?? {});
      case "group":
        return nameOf(groups.get(row.id)?.names ?? {});
      case "category":
        return nameOf(categories.get(row.id)?.names ?? {});
      case "sub":
        return nameOf(subCategories.get(row.id)?.names ?? {});
      case "budget":
        return t("dashboard.budgetRow");
    }
  }

  const balanceTotals = MONTHS.map((_, i) =>
    data.balances.reduce((sum, a) => sum + parseAmount(a.ends[i]!, bookCurrency).minor, 0n),
  );

  const transfers = data.transfers.map((account) => {
    const months = account.months.map((m) => parseAmount(m, bookCurrency).minor);
    return { accountId: account.accountId, months, total: months.reduce((a, b) => a + b, 0n) };
  });
  // The block's own line: what the bank accounts gained or lost by transfers, all together.
  const transferTotals = MONTHS.map((_, i) => transfers.reduce((sum, a) => sum + a.months[i]!, 0n));
  const transferTotal = transferTotals.reduce((a, b) => a + b, 0n);
  const transfersOpen = isExpanded(TRANSFERS_KEY);

  return (
    <table className={classes.sheet}>
      <thead>
        <tr>
          <th className={classes.label}>{t("dashboard.row")}</th>
          {MONTHS.map((m) => (
            <th key={m} className={cx(classes.number, monthClass(m))}>
              {monthNames[m - 1]}
            </th>
          ))}
          <th className={cx(classes.number, classes.total)}>{t("dashboard.total")}</th>
          <th className={cx(classes.number, classes.total)}>{t("dashboard.perMonth")}</th>
        </tr>
      </thead>
      <tbody>
        {visible.length === 0 && (
          <tr>
            <td colSpan={15} className={classes.fixed}>
              <Text c="dimmed" size="xs">
                {t("dashboard.empty")}
              </Text>
            </td>
          </tr>
        )}
        {visible.map((row) => {
          const key = rowKey(row);
          const top = row.kind === "nature" || row.kind === "balance";
          // Natures, balances and groups are bold; categories and below are not.
          const bold = top || row.kind === "group";
          const color = colorOf(row);
          // A group's line is tinted: over the page's own colour, so that the frozen
          // label stays opaque while the months scroll under it.
          const tint =
            row.kind === "balance"
              ? "light-dark(var(--mantine-color-gray-4), var(--mantine-color-dark-3))"
              : row.kind === "nature"
                ? "light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-4))"
                : row.kind === "group"
                  ? color
                    ? `color-mix(in srgb, var(--mantine-color-${color}-6) 14%, var(--mantine-color-body))`
                    : "light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))"
                  : null;
          return (
            <tr
              key={key}
              style={{
                fontWeight: bold ? 700 : 400,
                ...(tint ? ({ "--row": tint } as CSSProperties) : {}),
              }}
            >
              <td
                className={cx(classes.label, isSelected(selection, key, null) && classes.selected)}
                style={{ paddingLeft: 4 + row.depth * 14 }}
              >
                {color && (
                  <span
                    className={classes.mark}
                    style={{ background: `var(--mantine-color-${color}-6)` }}
                  />
                )}
                <div className={classes.labelContent}>
                  {hasChildren(row) ? (
                    <button
                      type="button"
                      className={classes.toggle}
                      aria-label={t(isExpanded(key) ? "dashboard.collapse" : "dashboard.expand")}
                      aria-expanded={isExpanded(key)}
                      onClick={() => toggle(key)}
                    >
                      {isExpanded(key) ? "▾" : "▸"}
                    </button>
                  ) : (
                    <span className={classes.toggle} />
                  )}
                  <span
                    className={cx(classes.labelText, row.kind === "budget" && classes.ahead)}
                    onClick={() => select({ kind: "row", key, month: null })}
                  >
                    {label(row)}
                  </span>
                </div>
              </td>
              {row.months.map((minor, i) => (
                <td
                  key={i}
                  className={cx(
                    classes.number,
                    monthClass(i + 1),
                    negative(minor),
                    isSelected(selection, key, i + 1) && classes.selected,
                  )}
                  onClick={() => select({ kind: "row", key, month: i + 1 })}
                >
                  {amount(minor)}
                </td>
              ))}
              <td
                className={cx(
                  classes.number,
                  classes.total,
                  negative(row.total),
                  isSelected(selection, key, null) && classes.selected,
                )}
                onClick={() => select({ kind: "row", key, month: null })}
              >
                {amount(row.total)}
              </td>
              <td
                className={cx(
                  classes.number,
                  classes.total,
                  negative(row.total),
                  isSelected(selection, key, null) && classes.selected,
                )}
                onClick={() => select({ kind: "row", key, month: null })}
              >
                {amount(perMonth(row.total))}
              </td>
            </tr>
          );
        })}

        {transfers.length > 0 && (
          <>
            <tr className={classes.sum}>
              <td className={cx(classes.label, classes.fixed)}>
                <div className={classes.labelContent}>
                  <button
                    type="button"
                    className={classes.toggle}
                    aria-label={t(transfersOpen ? "dashboard.collapse" : "dashboard.expand")}
                    aria-expanded={transfersOpen}
                    onClick={() => toggle(TRANSFERS_KEY)}
                  >
                    {transfersOpen ? "▾" : "▸"}
                  </button>
                  <span className={classes.labelText} onClick={() => toggle(TRANSFERS_KEY)}>
                    {t("dashboard.transfers")}
                  </span>
                </div>
              </td>
              {transferTotals.map((minor, i) => (
                <td
                  key={i}
                  className={cx(classes.number, classes.fixed, monthClass(i + 1), negative(minor))}
                >
                  {amount(minor)}
                </td>
              ))}
              {[transferTotal, perMonth(transferTotal)].map((minor, i) => (
                <td
                  key={i}
                  className={cx(classes.number, classes.total, classes.fixed, negative(minor))}
                >
                  {amount(minor)}
                </td>
              ))}
            </tr>
            {transfersOpen &&
              transfers.map(({ accountId, months, total }) => {
                const picked = (month: number | null) =>
                  selection?.kind === "transfers" &&
                  selection.accountId === accountId &&
                  selection.month === month;
                const pick = (month: number | null) =>
                  select({ kind: "transfers", accountId, month });
                return (
                  <tr key={accountId}>
                    <td
                      className={cx(
                        classes.label,
                        classes.account,
                        picked(null) && classes.selected,
                      )}
                      onClick={() => pick(null)}
                    >
                      <div className={classes.labelText}>
                        {nameOf(accounts.get(accountId)?.names ?? {})}
                      </div>
                    </td>
                    {months.map((minor, i) => (
                      <td
                        key={i}
                        className={cx(
                          classes.number,
                          monthClass(i + 1),
                          negative(minor),
                          picked(i + 1) && classes.selected,
                        )}
                        onClick={() => pick(i + 1)}
                      >
                        {amount(minor)}
                      </td>
                    ))}
                    {[total, perMonth(total)].map((minor, i) => (
                      <td
                        key={i}
                        className={cx(
                          classes.number,
                          classes.total,
                          negative(minor),
                          picked(null) && classes.selected,
                        )}
                        onClick={() => pick(null)}
                      >
                        {amount(minor)}
                      </td>
                    ))}
                  </tr>
                );
              })}
          </>
        )}

        {data.balances.length > 0 && (
          <>
            <tr>
              <td colSpan={15} className={cx(classes.section, classes.fixed)}>
                <span className={classes.sectionText}>{t("dashboard.balances")}</span>
              </td>
            </tr>
            {data.balances.map((account) => (
              <tr key={account.accountId}>
                <td className={cx(classes.label, classes.account, classes.fixed)}>
                  <div className={classes.labelText}>
                    {nameOf(accounts.get(account.accountId)?.names ?? {})}
                  </div>
                </td>
                {account.ends.map((end, i) => {
                  const minor = parseAmount(end, bookCurrency).minor;
                  const picked =
                    selection?.kind === "account" &&
                    selection.accountId === account.accountId &&
                    selection.month === i + 1;
                  return (
                    <td
                      key={i}
                      className={cx(
                        classes.number,
                        monthClass(i + 1),
                        negative(minor),
                        picked && classes.selected,
                      )}
                      onClick={() =>
                        select({ kind: "account", accountId: account.accountId, month: i + 1 })
                      }
                    >
                      {amount(minor)}
                    </td>
                  );
                })}
                <td className={cx(classes.total, classes.fixed)} />
                <td className={cx(classes.total, classes.fixed)} />
              </tr>
            ))}
            <tr className={classes.sum}>
              <td className={cx(classes.label, classes.account, classes.fixed)}>
                {t("dashboard.balanceTotal")}
              </td>
              {balanceTotals.map((minor, i) => (
                <td
                  key={i}
                  className={cx(classes.number, classes.fixed, monthClass(i + 1), negative(minor))}
                >
                  {amount(minor)}
                </td>
              ))}
              <td className={cx(classes.total, classes.fixed)} />
              <td className={cx(classes.total, classes.fixed)} />
            </tr>
          </>
        )}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// The detail panel: the entries behind the selection, read only
// ---------------------------------------------------------------------------

function DetailPanel({
  bookId,
  bookCurrency,
  year,
  rows,
  selection,
  panel,
  setPanel,
}: {
  bookId: string;
  bookCurrency: string;
  year: number;
  rows: DashboardRow[];
  selection: Selection | null;
  panel: PanelState;
  setPanel: (update: (previous: PanelState) => PanelState) => void;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const reference = useReference(bookId).data!;
  const nameOf = useNameOf(reference.defaultLanguage);
  const monthNames = useMonthNames("long");

  const natures = new Map(reference.natures.map((n) => [n.id, n]));
  const balances = new Map(reference.balances.map((b) => [b.id, b]));
  const groups = new Map(reference.groups.map((g) => [g.id, g]));
  const categories = new Map(reference.categories.map((c) => [c.id, c]));
  const subCategories = new Map(reference.subCategories.map((s) => [s.id, s]));
  const accounts = new Map(reference.accounts.map((a) => [a.id, a]));

  // The row selected, with the sub-categories whose entries it adds up.
  const row = selection?.kind === "row" ? rows.find((r) => rowKey(r) === selection.key) : undefined;
  const byKey = new Map(rows.map((r) => [rowKey(r), r]));
  // Whether `r` is inside `ancestor`, however deep the groups nest.
  const isInside = (r: DashboardRow, ancestor: DashboardRow) => {
    for (let at: DashboardRow | undefined = r; at && at.parentKey !== null;) {
      if (at.parentKey === ancestor.key) return true;
      at = byKey.get(at.parentKey);
    }
    return false;
  };
  // A balance adds up the natures it lists: the entries of all their rows.
  const within =
    row?.kind === "balance"
      ? rows.filter((r) => r.kind === "nature" && balances.get(row.id)?.natureIds.includes(r.id))
      : row
        ? [row]
        : [];
  const subIds = !row
    ? []
    : row.kind === "sub"
      ? [row.id]
      : rows
          .filter((r) => r.kind === "sub" && within.some((ancestor) => isInside(r, ancestor)))
          .map((r) => r.id);
  const budgetOnly = row?.kind === "budget";
  // The categories whose budget lines the selection adds up: the lines are not entries.
  const lineCategories = new Set(
    !row
      ? []
      : budgetOnly || row.kind === "category"
        ? [row.id]
        : rows
            .filter((r) => r.kind === "budget" && within.some((ancestor) => isInside(r, ancestor)))
            .map((r) => r.id),
  );

  // From the reference data, not the grid: transfer natures have no rows there.
  const transferSubIds = () => {
    const moving = new Set(reference.natures.filter((n) => n.transfer).map((n) => n.id));
    return reference.subCategories
      .filter((s) => moving.has(categories.get(s.categoryId)?.natureId ?? ""))
      .map((s) => s.id);
  };

  const month = selection?.month ?? null;
  const filters: JournalFilters | null =
    selection === null || budgetOnly
      ? null
      : {
          ...(selection.kind !== "row" ? { accountId: selection.accountId } : {}),
          ...(selection.kind === "row" ? { subCategoryIds: subIds.join(",") } : {}),
          ...(selection.kind === "transfers" ? { subCategoryIds: transferSubIds().join(",") } : {}),
          // Cells add up budget months; balances and transfers follow the dates.
          ...(selection.kind !== "row"
            ? month === null
              ? { from: `${year}-01-01`, to: `${year}-12-31` }
              : { from: `${year}-${pad(month)}-01`, to: lastDay(year, month) }
            : { months: month === null ? monthsOfYear(year) : `${year}-${pad(month)}` }),
          limit: PAGE_SIZE,
          offset: 0,
        };
  const journal = useJournal(bookId, filters ?? { limit: 1, offset: 0 }, filters !== null);
  const monthEnds = useMonthEnds(bookId, [year]);

  const title = (() => {
    if (!selection) return t("dashboard.detail");
    const what =
      selection.kind === "account"
        ? nameOf(accounts.get(selection.accountId)?.names ?? {})
        : selection.kind === "transfers"
          ? `${nameOf(accounts.get(selection.accountId)?.names ?? {})} · ${t("dashboard.transfers")}`
          : !row
            ? ""
            : row.kind === "nature"
              ? nameOf(natures.get(row.id)?.names ?? {})
              : row.kind === "balance"
                ? nameOf(balances.get(row.id)?.names ?? {})
                : row.kind === "group"
                  ? nameOf(groups.get(row.id)?.names ?? {})
                  : row.kind === "budget"
                    ? `${nameOf(categories.get(row.id)?.names ?? {})} · ${t("dashboard.budgetRow")}`
                    : row.kind === "category"
                      ? nameOf(categories.get(row.id)?.names ?? {})
                      : nameOf(subCategories.get(row.id)?.names ?? {});
    return `${what} · ${month === null ? year : `${monthNames[month - 1]} ${year}`}`;
  })();

  function startResize(event: PointerEvent<HTMLDivElement>) {
    const startY = event.clientY;
    const startHeight = panel.height;
    const move = (e: globalThis.PointerEvent) =>
      setPanel((p) => ({ ...p, height: clampHeight(startHeight + startY - e.clientY) }));
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  const format = (amount: string, currency: string) =>
    formatMoney(parseAmount(amount, currency), i18n.language);
  const entries = filters ? (journal.data?.entries ?? []) : [];
  const budgetLines = (monthEnds.data ?? []).filter(
    (line) =>
      selection !== null &&
      (month === null || line.month === month) &&
      (selection.kind === "account"
        ? line.accountId === selection.accountId
        : lineCategories.has(line.categoryId)),
  );

  return (
    <Paper withBorder style={{ flexShrink: 0, display: "flex", flexDirection: "column" }}>
      {panel.open && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={t("dashboard.resize")}
          onPointerDown={startResize}
          style={{
            height: 6,
            cursor: "row-resize",
            background: "var(--mantine-color-default-border)",
          }}
        />
      )}
      <Group justify="space-between" px="sm" py={6} wrap="nowrap">
        <Group gap="xs" miw={0} wrap="nowrap">
          <Text fw={600} size="sm" truncate>
            {title}
          </Text>
          {selection && (!filters || journal.data) && (
            <Badge variant="light" color="gray">
              {(journal.data?.total ?? 0) > entries.length && filters
                ? t("dashboard.showing", { shown: entries.length, total: journal.data!.total })
                : t("journal.count", { count: entries.length + budgetLines.length })}
            </Badge>
          )}
        </Group>
        <Group gap="xs" wrap="nowrap">
          <Button
            size="compact-sm"
            variant="subtle"
            onClick={() => void navigate({ to: "/books/$bookId", params: { bookId } })}
          >
            {t("dashboard.openJournal")}
          </Button>
          <Button
            size="compact-sm"
            variant="default"
            onClick={() => setPanel((p) => ({ ...p, open: !p.open }))}
          >
            {t(panel.open ? "dashboard.hideDetail" : "dashboard.showDetail")}
          </Button>
        </Group>
      </Group>
      {panel.open && (
        <div style={{ height: panel.height, overflow: "auto" }}>
          {!selection ? (
            <Text c="dimmed" size="sm" p="sm">
              {t("dashboard.selectHint")}
            </Text>
          ) : journal.error ? (
            <Alert color="red" m="sm">
              {t("common.error", { message: journal.error.message })}
            </Alert>
          ) : entries.length === 0 && budgetLines.length === 0 ? (
            <Text c="dimmed" size="sm" p="sm">
              {filters && journal.isPending ? <Loader size="xs" /> : t("journal.empty")}
            </Text>
          ) : (
            <Table
              stickyHeader
              withColumnBorders
              highlightOnHover
              verticalSpacing={1}
              horizontalSpacing={6}
              fz="xs"
            >
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("journal.date")}</Table.Th>
                  <Table.Th>{t("journal.account")}</Table.Th>
                  <Table.Th>{t("journal.subCategory")}</Table.Th>
                  <Table.Th>{t("journal.description")}</Table.Th>
                  <Table.Th style={{ textAlign: "right" }}>{t("journal.amount")}</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {budgetLines.map((line) => (
                  <Table.Tr key={`${line.categoryId}-${line.month}`}>
                    <Table.Td style={{ whiteSpace: "nowrap" }}>
                      {formatDate(line.date, i18n.language)}
                    </Table.Td>
                    <Table.Td>{nameOf(accounts.get(line.accountId)?.names ?? {})}</Table.Td>
                    <Table.Td>
                      {`${nameOf(categories.get(line.categoryId)?.names ?? {})} › ${t("dashboard.budgetRow")}`}
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {t("journal.plannedShort", {
                          planned: format(line.plannedAmount, line.currency),
                        })}
                      </Text>
                    </Table.Td>
                    <Table.Td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <Text size="xs" fw={600}>
                        {format(line.amount, line.currency)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {!line.reconciled && (
                        <Badge variant="light" color="orange">
                          {t("journal.forecasts")}
                        </Badge>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
                {entries.map((entry) => {
                  const sub = subCategories.get(entry.subCategoryId);
                  const category = sub && categories.get(sub.categoryId);
                  return (
                    <Table.Tr key={entry.id}>
                      <Table.Td style={{ whiteSpace: "nowrap" }}>
                        {formatDate(entry.date, i18n.language)}
                        <Text span size="xs" c="blue">
                          {shiftText(entry, i18n.language)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        {nameOf(accounts.get(entry.accountId ?? "")?.names ?? {})}
                      </Table.Td>
                      <Table.Td>
                        {category && sub ? `${nameOf(category.names)} › ${nameOf(sub.names)}` : ""}
                      </Table.Td>
                      <Table.Td>{entry.description}</Table.Td>
                      <Table.Td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <Text size="xs" fw={600}>
                          {format(entry.amount, entry.currency)}
                        </Text>
                        {entry.currency !== bookCurrency && (
                          <Text size="xs" c="dimmed">
                            {format(entry.bookAmount, bookCurrency)}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {!entry.reconciled && (
                          <Badge variant="light" color="orange">
                            {t("journal.forecasts")}
                          </Badge>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          )}
        </div>
      )}
    </Paper>
  );
}
