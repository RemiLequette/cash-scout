import { parseAmount, yearlyLines, type DashboardRow, type Names } from "@cash-scout/domain";
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Loader,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  Tooltip,
} from "@mantine/core";
import { useElementSize, useLocalStorage } from "@mantine/hooks";
import { useMemo, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { useYearly, type YearlyData } from "../dashboard";
import { useNameOf, useReference, type Reference } from "../reference";
import { cx, negative, perMonth, rowTint, useAmount, useRounded } from "./Dashboard";
import classes from "./Dashboard.module.css";

const LABEL_WIDTH = 220;
/** A year's column is never narrower: its chart holds one bar per nature. */
const MIN_YEAR_WIDTH = 112;

/** The fold of the transfers block, among the keys of the rows. */
const TRANSFERS_KEY = "transfers";

const rowKey = (row: DashboardRow) => row.key;
const opensByDefault = (key: string) => key.startsWith("group:") || key.startsWith("nature:");

const groupFill = (color: string | null) =>
  color ? `var(--mantine-color-${color}-6)` : "var(--mantine-color-gray-5)";

/** What both the table and the chart are drawn from: the years shown and their amounts. */
interface View {
  years: number[];
  currentYear: number;
  rows: DashboardRow[];
  transfers: { accountId: string; amounts: bigint[] }[];
  balances: { accountId: string; amounts: bigint[] }[];
  yearClass: (year: number) => string;
}

export function Evolution({ bookId, bookCurrency }: { bookId: string; bookCurrency: string }) {
  const { t, i18n } = useTranslation();
  const reference = useReference(bookId);
  const nameOf = useNameOf(reference.data?.defaultLanguage);
  const yearly = useYearly(bookId);
  const [rounded, setRounded] = useRounded();
  // The first year shown, kept between visits; null: every year.
  const [since, setSince] = useLocalStorage<number | null>({
    key: `cash-scout:evolution-since:${bookId}`,
    defaultValue: null,
    getInitialValueInEffect: false,
  });
  const [unit, setUnit] = useLocalStorage<string>({
    key: "cash-scout:evolution-unit",
    defaultValue: "year",
    getInitialValueInEffect: false,
  });
  const monthly = unit === "month";
  // null: the default, natures and groups open and categories closed.
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const { ref, width } = useElementSize();

  const data = yearly.data;
  const refData = reference.data;

  const view = useMemo(
    () => data && refData && viewOf(data, refData, bookCurrency, since, monthly, byName),
    // `nameOf` changes with the language and the book's default one, both listed here.
    [data, refData, bookCurrency, since, monthly, i18n.language], // eslint-disable-line react-hooks/exhaustive-deps
  );

  function byName(a: { names: Names }, b: { names: Names }) {
    return nameOf(a.names).localeCompare(nameOf(b.names), i18n.language);
  }

  const error = reference.error ?? yearly.error;
  if (error) {
    return <Alert color="red">{t("common.error", { message: error.message })}</Alert>;
  }
  if (!data || !refData || !view) return <Loader />;

  const isExpanded = (key: string) => (expanded ? expanded.has(key) : opensByDefault(key));
  const toggle = (key: string) => {
    const next = new Set(expanded ?? view.rows.map(rowKey).filter(opensByDefault));
    if (!next.delete(key)) next.add(key);
    setExpanded(next);
  };
  const expandAll = () =>
    setExpanded(
      new Set([
        ...view.rows
          .filter((r) => r.kind === "nature" || r.kind === "group" || r.kind === "category")
          .map(rowKey),
        TRANSFERS_KEY,
      ]),
    );

  const count = view.years.length;
  // Whole pixels, rounded down: a fraction over would bring a sideways scroll bar.
  const tableWidth = Math.max(Math.floor(width), LABEL_WIDTH + count * MIN_YEAR_WIDTH);
  const yearWidth = count === 0 ? 0 : (tableWidth - LABEL_WIDTH) / count;

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
          <Select
            size="xs"
            w={140}
            allowDeselect={false}
            aria-label={t("evolution.firstYear")}
            data={data.years.map((year) => ({
              value: String(year),
              label: t("evolution.since", { year: String(year) }),
            }))}
            value={view.years[0] === undefined ? null : String(view.years[0])}
            onChange={(value) =>
              value && setSince(Number(value) === data.years[0] ? null : Number(value))
            }
          />
          <SegmentedControl
            size="xs"
            value={unit}
            onChange={setUnit}
            data={[
              { value: "year", label: t("evolution.perYear") },
              { value: "month", label: t("dashboard.perMonth") },
            ]}
          />
          {yearly.isFetching && <Loader size="xs" />}
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

      <Paper withBorder style={{ minHeight: 0, overflow: "auto" }}>
        {/* Measured inside the border and beside the scroll bar. */}
        <div ref={ref}>
          {count === 0 ? (
            <Text c="dimmed" size="sm" p="sm">
              {t("evolution.empty")}
            </Text>
          ) : (
            width > 0 && (
              <div style={{ width: tableWidth }}>
                <Sheet
                  view={view}
                  reference={refData}
                  bookCurrency={bookCurrency}
                  rounded={rounded}
                  yearWidth={yearWidth}
                  tableWidth={tableWidth}
                  isExpanded={isExpanded}
                  toggle={toggle}
                />
                <Chart
                  bookId={bookId}
                  view={view}
                  reference={refData}
                  bookCurrency={bookCurrency}
                  rounded={rounded}
                  yearWidth={yearWidth}
                  visibleWidth={width}
                />
              </div>
            )
          )}
        </div>
      </Paper>
    </div>
  );
}

/** The years from `since` on, with their rows, transfers and balances. */
function viewOf(
  data: YearlyData,
  reference: Reference,
  currency: string,
  since: number | null,
  monthly: boolean,
  byName: (a: { names: Names }, b: { names: Names }) => number,
): View {
  const kept = data.years.filter((year) => since === null || year >= since);
  // A first year past the last one, after entries were removed: show them all.
  const years = kept.length > 0 ? kept : data.years;
  const from = data.years.length - years.length;
  const minor = (text: string) => parseAmount(text, currency).minor;
  const flow = (amount: bigint) => (monthly ? perMonth(amount) : amount);

  const rows = yearlyLines(
    {
      // Siblings keep the order the book gave its groups.
      groups: [...reference.groups].sort((a, b) => a.position - b.position || byName(a, b)),
      categories: reference.categories,
      subCategories: [...reference.subCategories].sort(byName),
    },
    { natures: reference.natures, balances: reference.balances.filter((b) => !b.archived) },
    data.cells.map((c) => ({ ...c, total: minor(c.total) })),
    data.budgetLines.map((l) => ({ ...l, total: minor(l.total) })),
    years,
  ).map((row) => ({ ...row, months: row.months.map(flow) }));

  const transfers = data.transfers
    .map((a) => ({ accountId: a.accountId, amounts: a.years.slice(from).map(minor).map(flow) }))
    .filter((a) => a.amounts.some((amount) => amount !== 0n));
  // A balance is not a flow: never divided by the months.
  const balances = data.balances.map((a) => ({
    accountId: a.accountId,
    amounts: a.ends.slice(from).map(minor),
  }));

  // Years ahead show what is planned; the year under way is shaded.
  const yearClass = (year: number) =>
    cx(year > data.currentYear && classes.ahead, year === data.currentYear && classes.current);

  return { years, currentYear: data.currentYear, rows, transfers, balances, yearClass };
}

/** The colour of a row: of its group, else of the nearest group around it. */
function useRowColor(rows: DashboardRow[], reference: Reference) {
  const groups = new Map(reference.groups.map((g) => [g.id, g]));
  const byKey = new Map(rows.map((r) => [rowKey(r), r]));
  return (row: DashboardRow): string | null => {
    for (let at: DashboardRow | undefined = row; at;) {
      const color = at.kind === "group" ? groups.get(at.id)?.color : null;
      if (color) return color;
      at = at.parentKey === null ? undefined : byKey.get(at.parentKey);
    }
    return null;
  };
}

function useRowLabel(reference: Reference) {
  const { t } = useTranslation();
  const nameOf = useNameOf(reference.defaultLanguage);
  const lists = {
    nature: new Map(reference.natures.map((n) => [n.id, n.names])),
    balance: new Map(reference.balances.map((b) => [b.id, b.names])),
    group: new Map(reference.groups.map((g) => [g.id, g.names])),
    category: new Map(reference.categories.map((c) => [c.id, c.names])),
    sub: new Map(reference.subCategories.map((s) => [s.id, s.names])),
  };
  return (row: DashboardRow) =>
    row.kind === "budget" ? t("dashboard.budgetRow") : nameOf(lists[row.kind].get(row.id) ?? {});
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

function Sheet({
  view,
  reference,
  bookCurrency,
  rounded,
  yearWidth,
  tableWidth,
  isExpanded,
  toggle,
}: {
  view: View;
  reference: Reference;
  bookCurrency: string;
  rounded: boolean;
  yearWidth: number;
  tableWidth: number;
  isExpanded: (key: string) => boolean;
  toggle: (key: string) => void;
}) {
  const { t } = useTranslation();
  const nameOf = useNameOf(reference.defaultLanguage);
  const amount = useAmount(bookCurrency, rounded);
  const colorOf = useRowColor(view.rows, reference);
  const label = useRowLabel(reference);
  const accounts = new Map(reference.accounts.map((a) => [a.id, a]));
  const { years, rows, transfers, balances, yearClass } = view;

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
  const hasChildren = (row: DashboardRow) =>
    row.kind === "nature" ||
    row.kind === "group" ||
    (row.kind === "category" && rows.some((r) => r.parentKey === row.key));

  const sumOf = (list: { amounts: bigint[] }[]) =>
    years.map((_, i) => list.reduce((sum, a) => sum + a.amounts[i]!, 0n));
  const transfersOpen = isExpanded(TRANSFERS_KEY);

  const cells = (amounts: bigint[]) =>
    amounts.map((minor, i) => (
      <td
        key={years[i]}
        className={cx(classes.number, classes.fixed, yearClass(years[i]!), negative(minor))}
      >
        {amount(minor)}
      </td>
    ));
  const toggleButton = (key: string) => (
    <button
      type="button"
      className={classes.toggle}
      aria-label={t(isExpanded(key) ? "dashboard.collapse" : "dashboard.expand")}
      aria-expanded={isExpanded(key)}
      onClick={() => toggle(key)}
    >
      {isExpanded(key) ? "▾" : "▸"}
    </button>
  );
  const accountRow = ({ accountId, amounts }: { accountId: string; amounts: bigint[] }) => (
    <tr key={accountId}>
      <td className={cx(classes.label, classes.account, classes.fixed)}>
        <div className={classes.labelText}>{nameOf(accounts.get(accountId)?.names ?? {})}</div>
      </td>
      {cells(amounts)}
    </tr>
  );

  return (
    // Fixed layout: every year gets the same width, which the chart lines up on.
    <table className={classes.sheet} style={{ tableLayout: "fixed", width: tableWidth }}>
      <colgroup>
        <col style={{ width: LABEL_WIDTH }} />
        {years.map((year) => (
          <col key={year} style={{ width: yearWidth }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          <th className={classes.label}>{t("dashboard.row")}</th>
          {years.map((year) => (
            <th key={year} className={cx(classes.number, yearClass(year))}>
              {year}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {visible.map((row) => {
          const key = rowKey(row);
          // Natures, balances and groups are bold; categories and below are not.
          const bold = row.kind === "nature" || row.kind === "balance" || row.kind === "group";
          const color = colorOf(row);
          const tint = rowTint(row, color);
          return (
            <tr
              key={key}
              style={{
                fontWeight: bold ? 700 : 400,
                ...(tint ? ({ "--row": tint } as CSSProperties) : {}),
              }}
            >
              <td
                className={cx(classes.label, classes.fixed)}
                style={{ paddingLeft: 4 + row.depth * 14 }}
              >
                {color && (
                  <span className={classes.mark} style={{ background: groupFill(color) }} />
                )}
                <div className={classes.labelContent}>
                  {hasChildren(row) ? toggleButton(key) : <span className={classes.toggle} />}
                  <span
                    className={cx(classes.labelText, row.kind === "budget" && classes.ahead)}
                    onClick={() => hasChildren(row) && toggle(key)}
                  >
                    {label(row)}
                  </span>
                </div>
              </td>
              {cells(row.months)}
            </tr>
          );
        })}

        {transfers.length > 0 && (
          <>
            <tr className={classes.sum}>
              <td className={cx(classes.label, classes.fixed)}>
                <div className={classes.labelContent}>
                  {toggleButton(TRANSFERS_KEY)}
                  <span className={classes.labelText} onClick={() => toggle(TRANSFERS_KEY)}>
                    {t("dashboard.transfers")}
                  </span>
                </div>
              </td>
              {cells(sumOf(transfers))}
            </tr>
            {transfersOpen && transfers.map(accountRow)}
          </>
        )}

        {balances.length > 0 && (
          <>
            <tr>
              <td colSpan={years.length + 1} className={cx(classes.section, classes.fixed)}>
                <span className={classes.sectionText}>{t("evolution.balances")}</span>
              </td>
            </tr>
            {balances.map(accountRow)}
            <tr className={classes.sum}>
              <td className={cx(classes.label, classes.account, classes.fixed)}>
                {t("dashboard.balanceTotal")}
              </td>
              {cells(sumOf(balances))}
            </tr>
          </>
        )}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// The chart: per year, one column per nature, stacked by top-level group
// ---------------------------------------------------------------------------

/** Round tick values covering [min, max]. */
function niceTicks(min: number, max: number, count = 4): number[] {
  const rough = (max - min || 1) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * magnitude >= rough) ?? 10) * magnitude;
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; v < max + step; v += step) ticks.push(v);
  return ticks;
}

const PLOT_HEIGHT = 260;
const PLOT_TOP = 8;
/** Under the plot: the natures' names, then the year. */
const AXIS_HEIGHT = 34;
const SEGMENT_GAP = 2;

/** A segment of a column, rounded at its data end only. */
function segmentPath(x: number, y: number, w: number, h: number, end: "top" | "bottom" | null) {
  const r = end ? Math.min(4, h, w / 2) : 0;
  if (end === "top") {
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  if (end === "bottom") {
    return `M${x},${y}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w - r}Q${x + w},${y + h} ${x + w},${y + h - r}V${y}Z`;
  }
  return `M${x},${y}H${x + w}V${y + h}H${x}Z`;
}

function Chart({
  bookId,
  view,
  reference,
  bookCurrency,
  rounded,
  yearWidth,
  visibleWidth,
}: {
  bookId: string;
  view: View;
  reference: Reference;
  bookCurrency: string;
  rounded: boolean;
  yearWidth: number;
  visibleWidth: number;
}) {
  const { t, i18n } = useTranslation();
  const amount = useAmount(bookCurrency, rounded);
  const label = useRowLabel(reference);
  const colorOf = useRowColor(view.rows, reference);
  const { years, rows } = view;
  // The natures left out of the chart, kept between visits; the table keeps them.
  const [hidden, setHidden] = useLocalStorage<string[]>({
    key: `cash-scout:evolution-hidden:${bookId}`,
    defaultValue: [],
    getInitialValueInEffect: false,
  });

  const all = rows
    .filter((r) => r.kind === "nature")
    .map((nature) => ({
      nature,
      groups: rows.filter((r) => r.kind === "group" && r.parentKey === nature.key),
    }));
  if (all.length === 0) return null;
  const natures = all.filter(({ nature }) => !hidden.includes(nature.id));
  const toggleNature = (id: string) =>
    setHidden(hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id]);

  // Amounts as numbers for drawing only; the figures shown stay exact.
  const unit = Number(parseAmount("1", bookCurrency).minor);
  const value = (minor: bigint) => Number(minor) / unit;
  const stacks = natures.flatMap(({ groups }) =>
    years.flatMap((_, i) => {
      const values = groups.map((g) => value(g.months[i]!));
      return [
        values.reduce((sum, v) => sum + Math.max(0, v), 0),
        values.reduce((sum, v) => sum + Math.min(0, v), 0),
      ];
    }),
  );
  const ticks = niceTicks(Math.min(0, ...stacks), Math.max(0, ...stacks));
  const low = ticks[0]!;
  const high = ticks.at(-1)!;
  const y = (v: number) => PLOT_TOP + (1 - (v - low) / (high - low || 1)) * PLOT_HEIGHT;
  const height = PLOT_TOP + PLOT_HEIGHT + AXIS_HEIGHT;
  const plotWidth = yearWidth * years.length;
  const slot = (yearWidth - 12) / Math.max(1, natures.length);
  const barWidth = Math.max(4, Math.min(24, slot - 4));
  const tickFormat = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });
  /** What fits of a nature's name under its column. */
  const short = (name: string) => {
    const room = Math.max(1, Math.floor(slot / 6));
    return name.length <= room ? name : `${name.slice(0, Math.max(1, room - 1))}.`;
  };

  // The groups met, once each: a group carrying several natures keeps its colour.
  const legend = [
    ...new Map(natures.flatMap(({ groups }) => groups.map((g) => [g.id, g] as const))).values(),
  ];

  return (
    <div>
      {/* Stays in view while the years scroll sideways. */}
      <Group
        gap="md"
        wrap="wrap"
        px="sm"
        py={6}
        style={{ position: "sticky", left: 0, width: visibleWidth }}
      >
        <Text size="xs" fw={700}>
          {t("evolution.chart")}
        </Text>
        {legend.map((group) => (
          <Group key={group.id} gap={4} wrap="nowrap">
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: groupFill(colorOf(group)),
              }}
            />
            <Text size="xs">{label(group)}</Text>
          </Group>
        ))}
      </Group>
      <div style={{ display: "flex" }}>
        {/* Under the labels: the natures to show, then the scale along the plot. */}
        <div
          style={{
            position: "sticky",
            left: 0,
            zIndex: 1,
            flexShrink: 0,
            width: LABEL_WIDTH,
            height,
            background: "var(--mantine-color-body)",
          }}
        >
          <Stack
            gap={6}
            role="group"
            aria-label={t("evolution.natures")}
            style={{
              position: "absolute",
              top: PLOT_TOP,
              left: 12,
              width: LABEL_WIDTH - 72,
              maxHeight: PLOT_HEIGHT,
              overflow: "auto",
            }}
          >
            {all.map(({ nature }) => (
              <Checkbox
                key={nature.key}
                size="xs"
                label={label(nature)}
                checked={!hidden.includes(nature.id)}
                onChange={() => toggleNature(nature.id)}
              />
            ))}
          </Stack>
          <svg
            width={LABEL_WIDTH}
            height={height}
            aria-hidden
            style={{ display: "block", pointerEvents: "none" }}
          >
            {ticks.map((tick) => (
              <text
                key={tick}
                x={LABEL_WIDTH - 6}
                y={y(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={11}
                fill="var(--mantine-color-dimmed)"
              >
                {tickFormat.format(tick)}
              </text>
            ))}
          </svg>
        </div>
        <svg width={plotWidth} height={height} role="img" aria-label={t("evolution.chart")}>
          {ticks.map((tick) => (
            <line
              key={tick}
              x1={0}
              x2={plotWidth}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--mantine-color-default-border)"
              strokeDasharray={tick === 0 ? undefined : "2 3"}
            />
          ))}
          {years.map((year, i) => (
            <g key={year}>
              <line
                x1={yearWidth * i}
                x2={yearWidth * i}
                y1={PLOT_TOP}
                y2={height}
                stroke="var(--mantine-color-default-border)"
              />
              <text
                x={yearWidth * (i + 0.5)}
                y={height - 6}
                textAnchor="middle"
                fontSize={12}
                fontWeight={year === view.currentYear ? 700 : 400}
                fill="var(--mantine-color-text)"
              >
                {year}
              </text>
              {natures.map(({ nature, groups }, n) => {
                const center = yearWidth * i + 6 + slot * (n + 0.5);
                const x = center - barWidth / 2;
                let up = 0;
                let down = 0;
                const segments = groups.flatMap((group) => {
                  const v = value(group.months[i]!);
                  if (v === 0) return [];
                  const from = v > 0 ? up : down;
                  const to = from + v;
                  if (v > 0) up = to;
                  else down = to;
                  return [{ group, from, to }];
                });
                return (
                  <g key={nature.key}>
                    <Tooltip.Floating
                      label={
                        <div>
                          <Text size="xs" fw={700}>
                            {label(nature)} · {year} : {amount(nature.months[i]!)}
                          </Text>
                          {groups
                            .filter((g) => g.months[i] !== 0n)
                            .map((g) => (
                              <Group key={g.key} gap={6} wrap="nowrap" justify="space-between">
                                <Group gap={4} wrap="nowrap">
                                  <span
                                    style={{
                                      width: 8,
                                      height: 8,
                                      background: groupFill(colorOf(g)),
                                    }}
                                  />
                                  <Text size="xs">{label(g)}</Text>
                                </Group>
                                <Text size="xs">{amount(g.months[i]!)}</Text>
                              </Group>
                            ))}
                        </div>
                      }
                    >
                      <g opacity={year > view.currentYear ? 0.5 : 1}>
                        {/* The whole height of the slot answers the pointer. */}
                        <rect
                          x={center - slot / 2}
                          y={PLOT_TOP}
                          width={slot}
                          height={PLOT_HEIGHT}
                          fill="transparent"
                        />
                        {segments.map(({ group, from, to }) => {
                          const positive = to > from;
                          const top = y(Math.max(from, to));
                          const bottom = y(Math.min(from, to));
                          const last = to === (positive ? up : down);
                          // The gap separates a segment from the one before it.
                          const gap = from === 0 ? 0 : SEGMENT_GAP;
                          const h = Math.max(1, bottom - top - gap);
                          return (
                            <path
                              key={group.key}
                              d={segmentPath(
                                x,
                                positive ? top : top + gap,
                                barWidth,
                                h,
                                last ? (positive ? "top" : "bottom") : null,
                              )}
                              fill={groupFill(colorOf(group))}
                            />
                          );
                        })}
                      </g>
                    </Tooltip.Floating>
                    <text
                      x={center}
                      y={PLOT_TOP + PLOT_HEIGHT + 12}
                      textAnchor="middle"
                      fontSize={10}
                      fill="var(--mantine-color-dimmed)"
                    >
                      <title>{label(nature)}</title>
                      {short(label(nature))}
                    </text>
                  </g>
                );
              })}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
