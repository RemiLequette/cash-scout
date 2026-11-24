import {
  currencyDigits,
  dashboardLines,
  formatMoney,
  parseAmount,
  type DashboardRow,
  type Names,
} from "@cash-scout/domain";
import { ActionIcon, Alert, Badge, Button, Group, Loader, Paper, Table, Text } from "@mantine/core";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type CSSProperties, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { useDashboard, type DashboardData } from "../dashboard";
import { useJournal, type JournalFilters } from "../journal";
import { useNameOf, useReference } from "../reference";

const PAGE_SIZE = 500;
const LABEL_WIDTH = 240;
const MONTH_WIDTH = 84;
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

const pad = (n: number) => String(n).padStart(2, "0");
const rowKey = (row: DashboardRow) => row.key;

/** What the detail panel shows the entries of. */
type Selection =
  /** A row of the grid in a month, or in the whole year when `month` is null. */
  | { kind: "row"; key: string; month: number | null }
  /** A bank account in a month. */
  | { kind: "account"; accountId: string; month: number };

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
      data.unused.map((u) => ({
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
      new Set(
        rows
          .filter((r) => r.kind === "nature" || r.kind === "group" || r.kind === "category")
          .map(rowKey),
      ),
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

const stickyLabel: CSSProperties = {
  position: "sticky",
  left: 0,
  zIndex: 1,
  background: "var(--mantine-color-body)",
  minWidth: LABEL_WIDTH,
  maxWidth: LABEL_WIDTH,
};
const numberCell: CSSProperties = {
  textAlign: "right",
  whiteSpace: "nowrap",
  fontVariantNumeric: "tabular-nums",
  minWidth: MONTH_WIDTH,
  cursor: "pointer",
};
const selectedCell: CSSProperties = { background: "var(--mantine-primary-color-light)" };
/** Negative amounts read in red, the text only. */
const negative = (minor: bigint): CSSProperties =>
  minor < 0n ? { color: "var(--mantine-color-red-6)" } : {};

/** Month names in the interface language, "janv." to "déc.". */
function useMonthNames(style: "short" | "long") {
  const { i18n } = useTranslation();
  return MONTHS.map((m) =>
    new Intl.DateTimeFormat(i18n.language, { month: style, timeZone: "UTC" }).format(
      new Date(Date.UTC(2026, m - 1, 1)),
    ),
  );
}

/** A grid amount without its currency (the page says it once): a dash for zero. */
function useAmount(currency: string) {
  const { i18n } = useTranslation();
  const digits = currencyDigits(currency);
  const format = new Intl.NumberFormat(i18n.language, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return (minor: bigint) => {
    if (minor === 0n) return "–";
    const sign = minor < 0n ? "-" : "";
    const abs = minor < 0n ? -minor : minor;
    const whole = abs / 10n ** BigInt(digits);
    const fraction = abs % 10n ** BigInt(digits);
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
  selection: Selection | null;
  select: (selection: Selection) => void;
}) {
  const { t } = useTranslation();
  const { bookId, bookCurrency, data, rows, visible, isExpanded, toggle, selection, select } =
    props;
  const reference = useReference(bookId).data!;
  const nameOf = useNameOf(reference.defaultLanguage);
  const monthNames = useMonthNames("short");
  const amount = useAmount(bookCurrency);

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
      rows.some((r) => r.parentKey === row.key && (r.kind === "sub" || r.kind === "unused")));

  // Months ahead show what is planned: they read differently from the past ones.
  const ahead = (month: number) => month > data.currentMonth;
  const monthStyle = (month: number): CSSProperties =>
    ahead(month) ? { fontStyle: "italic", color: "var(--mantine-color-dimmed)" } : {};

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
      case "unused":
        return t("dashboard.unused");
    }
  }

  const balanceTotals = MONTHS.map((_, i) =>
    data.balances.reduce((sum, a) => sum + parseAmount(a.ends[i]!, bookCurrency).minor, 0n),
  );

  return (
    <Table stickyHeader withColumnBorders={false} verticalSpacing={4} horizontalSpacing="xs">
      <Table.Thead>
        <Table.Tr>
          <Table.Th style={{ ...stickyLabel, zIndex: 3 }}>{t("dashboard.row")}</Table.Th>
          {MONTHS.map((m) => (
            <Table.Th key={m} style={{ ...numberCell, cursor: "default", ...monthStyle(m) }}>
              {monthNames[m - 1]}
            </Table.Th>
          ))}
          <Table.Th style={{ ...numberCell, cursor: "default" }}>{t("dashboard.total")}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {visible.length === 0 && (
          <Table.Tr>
            <Table.Td colSpan={14}>
              <Text c="dimmed" size="sm">
                {t("dashboard.empty")}
              </Text>
            </Table.Td>
          </Table.Tr>
        )}
        {visible.map((row) => {
          const key = rowKey(row);
          const top = row.kind === "nature" || row.kind === "balance";
          const bold = top || row.kind === "group" || row.kind === "category";
          const rowStyle: CSSProperties = {
            fontWeight: top || row.kind === "group" ? 700 : row.kind === "category" ? 600 : 400,
          };
          const color = colorOf(row);
          // A group's line is tinted: over the page's own colour, so that the sticky
          // label stays opaque while the months scroll under it.
          const tint = top
            ? "linear-gradient(var(--mantine-color-gray-light), var(--mantine-color-gray-light)), var(--mantine-color-body)"
            : color
              ? `linear-gradient(var(--mantine-color-${color}-light), var(--mantine-color-${color}-light)), var(--mantine-color-body)`
              : "var(--mantine-color-default-hover)";
          const tinted = top || row.kind === "group";
          return (
            <Table.Tr
              key={key}
              style={{
                ...(tinted ? { background: tint } : {}),
                // A balance closes the section above it.
                ...(row.kind === "balance"
                  ? { borderTop: "2px solid var(--mantine-color-default-border)" }
                  : {}),
              }}
            >
              <Table.Td
                style={{
                  ...stickyLabel,
                  ...rowStyle,
                  paddingLeft: 8 + row.depth * 16,
                  ...(color ? { borderLeft: `4px solid var(--mantine-color-${color}-6)` } : {}),
                  ...(tinted ? { background: tint } : {}),
                  ...(isSelected(selection, key, null) ? selectedCell : {}),
                }}
              >
                <Group gap={4} wrap="nowrap">
                  {hasChildren(row) ? (
                    <ActionIcon
                      size="xs"
                      variant="subtle"
                      color="gray"
                      aria-label={t(isExpanded(key) ? "dashboard.collapse" : "dashboard.expand")}
                      aria-expanded={isExpanded(key)}
                      onClick={() => toggle(key)}
                    >
                      {isExpanded(key) ? "▾" : "▸"}
                    </ActionIcon>
                  ) : (
                    <span style={{ width: 18, flexShrink: 0 }} />
                  )}
                  <Text
                    size="sm"
                    fw="inherit"
                    fs={row.kind === "unused" ? "italic" : undefined}
                    c={row.kind === "unused" ? "dimmed" : undefined}
                    truncate
                    style={{ cursor: "pointer" }}
                    onClick={() => select({ kind: "row", key, month: null })}
                  >
                    {label(row)}
                  </Text>
                </Group>
              </Table.Td>
              {row.months.map((minor, i) => (
                <Table.Td
                  key={i}
                  style={{
                    ...numberCell,
                    ...rowStyle,
                    ...monthStyle(i + 1),
                    ...negative(minor),
                    ...(isSelected(selection, key, i + 1) ? selectedCell : {}),
                  }}
                  onClick={() => select({ kind: "row", key, month: i + 1 })}
                >
                  {amount(minor)}
                </Table.Td>
              ))}
              <Table.Td
                style={{
                  ...numberCell,
                  fontWeight: bold ? 700 : 600,
                  ...negative(row.total),
                  ...(isSelected(selection, key, null) ? selectedCell : {}),
                }}
                onClick={() => select({ kind: "row", key, month: null })}
              >
                {amount(row.total)}
              </Table.Td>
            </Table.Tr>
          );
        })}

        {data.balances.length > 0 && (
          <>
            <Table.Tr>
              <Table.Td colSpan={14} style={{ paddingTop: 20, background: "transparent" }}>
                <Text size="sm" fw={700}>
                  {t("dashboard.balances")}
                </Text>
              </Table.Td>
            </Table.Tr>
            {data.balances.map((account) => (
              <Table.Tr key={account.accountId}>
                <Table.Td style={{ ...stickyLabel, paddingLeft: 24 }}>
                  <Text size="sm" truncate>
                    {nameOf(accounts.get(account.accountId)?.names ?? {})}
                  </Text>
                </Table.Td>
                {account.ends.map((end, i) => {
                  const minor = parseAmount(end, bookCurrency).minor;
                  const picked =
                    selection?.kind === "account" &&
                    selection.accountId === account.accountId &&
                    selection.month === i + 1;
                  return (
                    <Table.Td
                      key={i}
                      style={{
                        ...numberCell,
                        ...monthStyle(i + 1),
                        ...negative(minor),
                        ...(picked ? selectedCell : {}),
                      }}
                      onClick={() =>
                        select({ kind: "account", accountId: account.accountId, month: i + 1 })
                      }
                    >
                      {amount(minor)}
                    </Table.Td>
                  );
                })}
                <Table.Td />
              </Table.Tr>
            ))}
            <Table.Tr style={{ fontWeight: 700 }}>
              <Table.Td style={{ ...stickyLabel, paddingLeft: 24 }}>
                <Text size="sm" fw={700}>
                  {t("dashboard.balanceTotal")}
                </Text>
              </Table.Td>
              {balanceTotals.map((minor, i) => (
                <Table.Td
                  key={i}
                  style={{
                    ...numberCell,
                    cursor: "default",
                    ...monthStyle(i + 1),
                    ...negative(minor),
                  }}
                >
                  {amount(minor)}
                </Table.Td>
              ))}
              <Table.Td />
            </Table.Tr>
          </>
        )}
      </Table.Tbody>
    </Table>
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
  const unusedOnly = row?.kind === "unused";

  const month = selection?.month ?? null;
  const filters: JournalFilters | null =
    selection === null || unusedOnly
      ? null
      : {
          ...(selection.kind === "account" ? { accountId: selection.accountId } : {}),
          ...(selection.kind === "row" ? { subCategoryIds: subIds.join(",") } : {}),
          ...(month === null
            ? { from: `${year}-01-01`, to: `${year}-12-31` }
            : { months: `${year}-${pad(month)}` }),
          limit: PAGE_SIZE,
          offset: 0,
        };
  const journal = useJournal(bookId, filters ?? { limit: 1, offset: 0 }, filters !== null);

  const title = (() => {
    if (!selection) return t("dashboard.detail");
    const what =
      selection.kind === "account"
        ? nameOf(accounts.get(selection.accountId)?.names ?? {})
        : !row
          ? ""
          : row.kind === "nature"
            ? nameOf(natures.get(row.id)?.names ?? {})
            : row.kind === "balance"
              ? nameOf(balances.get(row.id)?.names ?? {})
              : row.kind === "group"
                ? nameOf(groups.get(row.id)?.names ?? {})
                : row.kind === "unused"
                  ? `${nameOf(categories.get(row.id)?.names ?? {})} · ${t("dashboard.unused")}`
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
  const entries = journal.data?.entries ?? [];

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
          {filters && journal.data && (
            <Badge variant="light" color="gray">
              {journal.data.total > entries.length
                ? t("dashboard.showing", { shown: entries.length, total: journal.data.total })
                : t("journal.count", { count: journal.data.total })}
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
          ) : unusedOnly ? (
            <Text c="dimmed" size="sm" p="sm">
              {t("dashboard.unusedHint")}
            </Text>
          ) : journal.error ? (
            <Alert color="red" m="sm">
              {t("common.error", { message: journal.error.message })}
            </Alert>
          ) : entries.length === 0 ? (
            <Text c="dimmed" size="sm" p="sm">
              {journal.isPending ? <Loader size="xs" /> : t("journal.empty")}
            </Text>
          ) : (
            <Table stickyHeader verticalSpacing={3} horizontalSpacing="xs">
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
                {entries.map((entry) => {
                  const sub = subCategories.get(entry.subCategoryId);
                  const category = sub && categories.get(sub.categoryId);
                  return (
                    <Table.Tr key={entry.id}>
                      <Table.Td style={{ whiteSpace: "nowrap" }}>
                        {new Intl.DateTimeFormat(i18n.language, {
                          dateStyle: "medium",
                          timeZone: "UTC",
                        }).format(new Date(`${entry.date}T00:00:00Z`))}
                      </Table.Td>
                      <Table.Td>{nameOf(accounts.get(entry.accountId)?.names ?? {})}</Table.Td>
                      <Table.Td>
                        {category && sub ? `${nameOf(category.names)} › ${nameOf(sub.names)}` : ""}
                      </Table.Td>
                      <Table.Td>{entry.description}</Table.Td>
                      <Table.Td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <Text size="sm" fw={600}>
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
