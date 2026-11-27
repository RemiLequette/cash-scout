import {
  balanceSeries,
  currencyDigits,
  formatMoney,
  overdrafts,
  parseAmount,
  type BalancePoint,
  type Overdraft,
} from "@cash-scout/domain";
import { Alert, Button, Group, Paper, Select, Stack, Text, Title } from "@mantine/core";
import { useElementSize, useLocalStorage } from "@mantine/hooks";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatDate, today, useProjection } from "../journal";
import { useNameOf, type Reference } from "../reference";

const DAY = 86_400_000;
const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY);

/** The first day of the month `back` months before the one holding `date`. */
function monthStart(date: string, back: number): string {
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - back);
  return d.toISOString().slice(0, 10);
}

/** The last day of the month holding `start`, `months - 1` months later. */
function windowEnd(start: string, months: number): string {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months, 0);
  return d.toISOString().slice(0, 10);
}

const COLORS = [
  "var(--mantine-color-blue-6)",
  "var(--mantine-color-grape-6)",
  "var(--mantine-color-teal-6)",
  "var(--mantine-color-orange-6)",
  "var(--mantine-color-cyan-6)",
  "var(--mantine-color-lime-7)",
  "var(--mantine-color-pink-6)",
  "var(--mantine-color-indigo-6)",
];
const RED = "var(--mantine-color-red-6)";

interface Line {
  id: string;
  name: string;
  color: string;
  currency: string;
  series: BalancePoint[];
  overdrafts: Overdraft[];
}

/** The balance after the last point on or before `date`. */
function balanceOn(series: BalancePoint[], date: string): bigint {
  let balance = series[0]!.balance;
  for (const point of series) {
    if (point.date > date) break;
    balance = point.balance;
  }
  return balance;
}

/** Round tick values covering [min, max]. */
function niceTicks(min: number, max: number, count = 5): number[] {
  const span = max - min || 1;
  const rough = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * magnitude >= rough) ?? 10) * magnitude;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step / 1e6; v += step) ticks.push(v);
  return ticks;
}

/**
 * One chart: the lines of the accounts of a currency. The part of a line under
 * zero is red, over a pale red band, so an overdraft cannot be missed.
 */
function Chart({
  lines,
  from,
  to,
  currency,
  locale,
}: {
  lines: Line[];
  from: string;
  to: string;
  currency: string;
  locale: string;
}) {
  const { t } = useTranslation();
  const { ref, width } = useElementSize();
  const [hover, setHover] = useState<string | null>(null);
  const height = 260;
  const margin = { top: 12, right: 12, bottom: 24, left: 64 };
  const plotW = Math.max(0, width - margin.left - margin.right);
  const plotH = height - margin.top - margin.bottom;

  const scale = 10 ** currencyDigits(currency);
  const value = (minor: bigint) => Number(minor) / scale;
  const all = lines.flatMap((l) => l.series.map((p) => value(p.balance)));
  const rawMin = Math.min(0, ...all);
  const rawMax = Math.max(0, ...all);
  const pad10 = (rawMax - rawMin || 1) * 0.08;
  const yMin = rawMin < 0 ? rawMin - pad10 : 0;
  const yMax = rawMax + pad10;
  const d0 = dayNumber(from);
  const d1 = dayNumber(to);
  const x = (date: string) => margin.left + ((dayNumber(date) - d0) / Math.max(1, d1 - d0)) * plotW;
  const y = (v: number) => margin.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;
  const zeroY = y(0);

  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  });
  const ticks = niceTicks(yMin, yMax);

  // Month starts on the x axis.
  const months: string[] = [];
  for (let d = monthStart(from, 0); d <= to; d = monthStart(d, -1)) months.push(d);
  const monthLabel = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
  const step = Math.ceil(months.length / Math.max(1, Math.floor(plotW / 60)));

  const path = (series: BalancePoint[]) => {
    const parts = [`M${x(series[0]!.date)},${y(value(series[0]!.balance))}`];
    for (let i = 1; i < series.length; i++) {
      const p = series[i]!;
      parts.push(`H${x(p.date)}`, `V${y(value(p.balance))}`);
    }
    parts.push(`H${x(to)}`);
    return parts.join("");
  };

  const now = today();
  const todayInWindow = now >= from && now <= to;
  const days = d1 - d0;
  const hoverDate =
    hover === null ? null : new Date((d0 + Number(hover)) * DAY).toISOString().slice(0, 10);

  return (
    <div ref={ref} style={{ width: "100%" }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={t("journal.chartTitle")}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - box.left - margin.left) / (plotW || 1);
            setHover(ratio < 0 || ratio > 1 ? null : String(Math.round(Math.min(1, ratio) * days)));
          }}
        >
          <defs>
            <clipPath id={`above-${currency}`}>
              <rect x={margin.left} y={0} width={plotW} height={Math.max(0, zeroY)} />
            </clipPath>
            <clipPath id={`below-${currency}`}>
              <rect x={margin.left} y={zeroY} width={plotW} height={Math.max(0, height - zeroY)} />
            </clipPath>
          </defs>

          {yMin < 0 && (
            <rect
              x={margin.left}
              y={zeroY}
              width={plotW}
              height={Math.max(0, margin.top + plotH - zeroY)}
              fill="var(--mantine-color-red-light)"
            />
          )}
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={margin.left}
                x2={margin.left + plotW}
                y1={y(tick)}
                y2={y(tick)}
                stroke="var(--mantine-color-default-border)"
                strokeDasharray={tick === 0 ? undefined : "2 3"}
              />
              <text
                x={margin.left - 6}
                y={y(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={11}
                fill={tick < 0 ? RED : "var(--mantine-color-dimmed)"}
              >
                {money.format(tick)}
              </text>
            </g>
          ))}
          {yMin < 0 && (
            <line
              x1={margin.left}
              x2={margin.left + plotW}
              y1={zeroY}
              y2={zeroY}
              stroke={RED}
              strokeWidth={1.5}
            />
          )}
          {months.map((month, i) =>
            i % step === 0 ? (
              <text
                key={month}
                x={Math.max(margin.left, x(month < from ? from : month))}
                y={height - 6}
                fontSize={11}
                fill="var(--mantine-color-dimmed)"
              >
                {monthLabel.format(new Date(`${month}T00:00:00Z`))}
              </text>
            ) : null,
          )}
          {todayInWindow && (
            <g>
              <line
                x1={x(now)}
                x2={x(now)}
                y1={margin.top}
                y2={margin.top + plotH}
                stroke="var(--mantine-color-blue-filled)"
                strokeDasharray="4 3"
              />
              <text
                x={x(now) + 4}
                y={margin.top + 10}
                fontSize={11}
                fill="var(--mantine-color-blue-filled)"
              >
                {t("journal.chartToday")}
              </text>
            </g>
          )}

          {lines.map((line) => (
            <g key={line.id} fill="none" strokeLinejoin="round">
              <path
                d={path(line.series)}
                stroke={line.color}
                strokeWidth={2}
                clipPath={`url(#above-${currency})`}
              />
              <path
                d={path(line.series)}
                stroke={RED}
                strokeWidth={3}
                clipPath={`url(#below-${currency})`}
              />
            </g>
          ))}

          {hoverDate !== null && (
            <line
              x1={x(hoverDate)}
              x2={x(hoverDate)}
              y1={margin.top}
              y2={margin.top + plotH}
              stroke="var(--mantine-color-dimmed)"
            />
          )}
        </svg>
      )}
      {hoverDate !== null && (
        <Group gap="md" wrap="wrap" mt={4}>
          <Text size="xs" fw={600}>
            {formatDate(hoverDate, locale)}
          </Text>
          {lines.map((line) => {
            const balance = balanceOn(line.series, hoverDate);
            return (
              <Text key={line.id} size="xs" c={balance < 0n ? "red" : undefined}>
                <Text span c={line.color} inherit>
                  ●
                </Text>{" "}
                {line.name} {money.format(value(balance))}
              </Text>
            );
          })}
        </Group>
      )}
    </div>
  );
}

const HORIZONS = [2, 4, 6, 12];
const STARTS = [0, 1, 3, 12];

/**
 * A collapsible section at the bottom of the journal: how the balance of the
 * accounts evolves, past and ahead. Only the account filter acts on it; the
 * journal's period, category, status and search leave it as it is. By default it
 * is the cash projection over 4 months from the start of the current month.
 */
export function AccountChart({
  bookId,
  reference,
  accountId,
}: {
  bookId: string;
  reference: Reference;
  accountId: string | null;
}) {
  const { t, i18n } = useTranslation();
  const nameOf = useNameOf(reference.defaultLanguage);
  const [shown, setShown] = useLocalStorage({
    key: "cash-scout:account-chart",
    defaultValue: true,
  });
  const [horizon, setHorizon] = useState("4");
  const [back, setBack] = useState("0");

  const now = today();
  const from = monthStart(now, Number(back));
  // The window always reaches `horizon` months past the current month.
  const to = windowEnd(monthStart(now, 0), Number(horizon));
  const projection = useProjection(bookId, from, to);

  const lines: Line[] = (() => {
    if (!projection.data) return [];
    const byId = new Map(reference.accounts.map((a) => [a.id, a]));
    return projection.data
      .filter((p) => {
        const account = byId.get(p.accountId);
        if (!account) return false;
        if (accountId) return p.accountId === accountId;
        // Archived accounts only while they still move.
        return !account.archived || Number(p.opening) !== 0 || p.changes.length > 0;
      })
      .map((p) => {
        const series = balanceSeries(
          parseAmount(p.opening, p.currency).minor,
          p.changes.map((c) => ({ date: c.date, amount: parseAmount(c.amount, p.currency).minor })),
          from,
          to,
        );
        return {
          id: p.accountId,
          name: nameOf(byId.get(p.accountId)!.names),
          currency: p.currency,
          series,
          overdrafts: overdrafts(series),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((line, i) => ({ ...line, color: COLORS[i % COLORS.length]! }));
  })();

  const currencies = [...new Set(lines.map((l) => l.currency))].sort();
  const overdrawn = lines.filter((l) => l.overdrafts.length > 0);
  const format = (minor: bigint, currency: string) =>
    formatMoney({ minor, currency }, i18n.language);

  return (
    <Paper withBorder radius="md" p="sm" mt="md">
      <Stack gap="xs">
        <Group justify="space-between" wrap="wrap">
          <Title order={5}>{t("journal.chartTitle")}</Title>
          <Group gap="xs">
            {shown && (
              <>
                <Select
                  size="xs"
                  w={150}
                  allowDeselect={false}
                  aria-label={t("journal.chartStart")}
                  data={STARTS.map((n) => ({
                    value: String(n),
                    label:
                      n === 0
                        ? t("journal.chartFromThisMonth")
                        : t("journal.chartFromBack", { count: n }),
                  }))}
                  value={back}
                  onChange={(v) => v && setBack(v)}
                />
                <Select
                  size="xs"
                  w={130}
                  allowDeselect={false}
                  aria-label={t("journal.chartHorizon")}
                  data={HORIZONS.map((n) => ({
                    value: String(n),
                    label: t("journal.chartAhead", { count: n }),
                  }))}
                  value={horizon}
                  onChange={(v) => v && setHorizon(v)}
                />
              </>
            )}
            <Button size="xs" variant="default" onClick={() => setShown(!shown)}>
              {shown ? t("journal.chartHide") : t("journal.chartShow")}
            </Button>
          </Group>
        </Group>

        {shown && (
          <>
            <Text size="xs" c="dimmed">
              {accountId ? t("journal.chartOneAccount") : t("journal.chartAllAccounts")}
            </Text>
            {projection.error && <Alert color="red">{projection.error.message}</Alert>}
            {overdrawn.length > 0 && (
              <Alert color="red" variant="light" title={t("journal.overdraftTitle")}>
                <Stack gap={2}>
                  {overdrawn.flatMap((line) =>
                    line.overdrafts.map((o) => (
                      <Text size="sm" key={`${line.id}-${o.from}`}>
                        <Text span fw={700} inherit>
                          {line.name}
                        </Text>{" "}
                        {t(o.until ? "journal.overdraftBetween" : "journal.overdraftFrom", {
                          from: formatDate(o.from, i18n.language),
                          until: o.until ? formatDate(o.until, i18n.language) : "",
                          lowest: format(o.lowest, line.currency),
                          lowestDate: formatDate(o.lowestDate, i18n.language),
                        })}
                      </Text>
                    )),
                  )}
                </Stack>
              </Alert>
            )}
            {projection.data && lines.length === 0 && (
              <Text c="dimmed">{t("journal.chartEmpty")}</Text>
            )}
            {currencies.map((currency) => {
              const inCurrency = lines.filter((l) => l.currency === currency);
              return (
                <Stack key={currency} gap={4}>
                  <Group gap="md" wrap="wrap">
                    {currencies.length > 1 && (
                      <Text size="xs" fw={700}>
                        {currency}
                      </Text>
                    )}
                    {inCurrency.map((line) => (
                      <Text key={line.id} size="xs">
                        <Text span c={line.color} inherit>
                          ●
                        </Text>{" "}
                        {line.name}
                      </Text>
                    ))}
                  </Group>
                  <Chart
                    lines={inCurrency}
                    from={from}
                    to={to}
                    currency={currency}
                    locale={i18n.language}
                  />
                </Stack>
              );
            })}
          </>
        )}
      </Stack>
    </Paper>
  );
}
