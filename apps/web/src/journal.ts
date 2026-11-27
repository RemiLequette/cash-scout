import {
  budgetMonth,
  type CompensationInput,
  type CompensationUpdate,
  type EntryInput,
  type EntryUpdate,
  type TransferInput,
  type TransferUpdate,
} from "@cash-scout/domain";
import {
  keepPreviousData,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { api, unwrap } from "./api";

const journal = api.books[":bookId"].journal;
export type JournalPage = InferResponseType<typeof journal.$get, 200>;
export type Entry = JournalPage["entries"][number];
export type Balance = InferResponseType<typeof journal.balances.$get, 200>[number];

const transfers = api.books[":bookId"].transfers;
/** A transfer between two accounts: its two journal entries and the delay between them. */
export type Transfer = InferResponseType<(typeof transfers)[":id"]["$get"], 200>;
export type YearTransfer = InferResponseType<typeof transfers.$get, 200>[number];

const compensations = api.books[":bookId"].compensations;
/** A compensation: its two journal entries. */
export type Compensation = InferResponseType<(typeof compensations)[":id"]["$get"], 200>;

const budgets = api.books[":bookId"].budgets;
/** A budget line: what a month's grid amount still expects, at the month's end. */
export type MonthEnd = InferResponseType<(typeof budgets)["month-ends"]["$get"], 200>[number];
export type Projection = InferResponseType<typeof journal.projection.$get, 200>[number];

/** Filters of the journal list, as query parameters. */
export interface JournalFilters {
  from?: string;
  to?: string;
  accountId?: string;
  categoryId?: string;
  subCategoryId?: string;
  /** Comma-separated; "" shows nothing. */
  subCategoryIds?: string;
  /** Comma-separated months ("2026-11"); "" shows nothing. */
  months?: string;
  reconciled?: "true" | "false";
  /** Only the sides of compensations. */
  compensations?: "true";
  q?: string;
  limit: number;
  offset: number;
}

export function useJournal(bookId: string, filters: JournalFilters, enabled = true) {
  const query = Object.fromEntries(
    Object.entries(filters)
      .filter(
        ([key, value]) =>
          value !== undefined && (value !== "" || key === "subCategoryIds" || key === "months"),
      )
      .map(([key, value]) => [key, String(value)]),
  );
  return useQuery({
    queryKey: ["books", bookId, "journal", "list", query],
    queryFn: () => unwrap(journal.$get({ param: { bookId }, query })),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/**
 * The descriptions most used lately, with their latest entry; loaded only
 * when `enabled`, as the menu that shows them opens.
 */
export function useFrequent(bookId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["books", bookId, "journal", "frequent"],
    queryFn: () => unwrap(journal.frequent.$get({ param: { bookId } })),
    enabled,
  });
}

/** One transfer with both of its sides, loaded when its form opens. */
export function useTransfer(bookId: string, id: string | undefined) {
  return useQuery({
    queryKey: ["books", bookId, "journal", "transfer", id],
    queryFn: () => unwrap(transfers[":id"].$get({ param: { bookId, id: id! } })),
    enabled: id !== undefined,
    gcTime: 0,
  });
}

/** One compensation with both of its sides, loaded when its form opens. */
export function useCompensation(bookId: string, id: string | undefined) {
  return useQuery({
    queryKey: ["books", bookId, "journal", "compensation", id],
    queryFn: () => unwrap(compensations[":id"].$get({ param: { bookId, id: id! } })),
    enabled: id !== undefined,
    gcTime: 0,
  });
}

/** The transfers of a year, both sides together, by the date they leave their source. */
export function useTransfers(bookId: string, year: number) {
  return useQuery({
    queryKey: ["books", bookId, "journal", "transfers", year],
    queryFn: () => unwrap(transfers.$get({ param: { bookId }, query: { year: String(year) } })),
    // A plan starts from what is stored now, not from what was read before.
    refetchOnMount: "always",
  });
}

/** The sub-category most used by transfers, to start a new one from. */
export function useTransferDefaults(bookId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["books", bookId, "journal", "transfer-defaults"],
    queryFn: () => unwrap(transfers.defaults.$get({ param: { bookId } })),
    enabled,
  });
}

/** The months holding entries, with their number. */
export function useMonths(bookId: string) {
  return useQuery({
    queryKey: ["books", bookId, "journal", "months"],
    queryFn: () => unwrap(journal.months.$get({ param: { bookId } })),
  });
}

export function useBalances(bookId: string) {
  return useQuery({
    queryKey: ["books", bookId, "journal", "balances"],
    queryFn: () => unwrap(journal.balances.$get({ param: { bookId } })),
  });
}

/**
 * The month-end lines of the given years. They come from the budgets, so they
 * are reloaded with them whenever an entry or a budget changes.
 */
export function useMonthEnds(bookId: string, years: number[]) {
  return useQueries({
    queries: years.map((year) => ({
      queryKey: ["books", bookId, "budgets", "month-ends", year],
      queryFn: () =>
        unwrap(budgets["month-ends"].$get({ param: { bookId }, query: { year: String(year) } })),
    })),
    combine: (results) => ({
      data: results.some((r) => r.data) ? results.flatMap((r) => r.data ?? []) : undefined,
      error: results.find((r) => r.error)?.error ?? null,
    }),
  });
}

/** Reconciles a month's budget line, or takes it back. */
export function useSettle(bookId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (line: { categoryId: string; year: number; month: number; reconciled: boolean }) =>
      unwrap(budgets.settlements.$post({ param: { bookId }, json: line })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["books", bookId, "budgets"] }),
  });
}

/**
 * The balance of every account over a window, with what changes it day by day.
 * Under the budgets' key, since the budget lines move it as much as entries do.
 */
export function useProjection(bookId: string, from: string, to: string) {
  const now = today();
  return useQuery({
    queryKey: ["books", bookId, "budgets", "projection", from, to, now],
    queryFn: () =>
      unwrap(journal.projection.$get({ param: { bookId }, query: { from, to, today: now } })),
    placeholderData: keepPreviousData,
  });
}

export type JournalChange =
  | { action: "create"; body: EntryInput }
  | { action: "update"; id: string; body: EntryUpdate }
  | { action: "delete"; id: string }
  | { action: "reconcile"; ids: string[]; reconciled: boolean }
  | { action: "createTransfer"; body: TransferInput }
  | { action: "updateTransfer"; id: string; body: TransferUpdate }
  | { action: "deleteTransfer"; id: string }
  | { action: "createCompensation"; body: CompensationInput }
  | { action: "updateCompensation"; id: string; body: CompensationUpdate }
  | { action: "deleteCompensation"; id: string };

/** Changes to the journal; the list and balances are reloaded after each. */
export function useJournalChange(bookId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (change: JournalChange) => {
      const param = { bookId };
      switch (change.action) {
        case "create":
          await unwrap(journal.$post({ param, json: change.body }));
          return;
        case "update":
          await unwrap(
            journal[":id"].$patch({ param: { ...param, id: change.id }, json: change.body }),
          );
          return;
        case "delete":
          await unwrap(journal[":id"].$delete({ param: { ...param, id: change.id } }));
          return;
        case "reconcile":
          await unwrap(
            journal.reconcile.$post({
              param,
              json: { ids: change.ids, reconciled: change.reconciled },
            }),
          );
          return;
        case "createTransfer":
          await unwrap(transfers.$post({ param, json: change.body }));
          return;
        case "updateTransfer":
          await unwrap(
            transfers[":id"].$patch({ param: { ...param, id: change.id }, json: change.body }),
          );
          return;
        case "deleteTransfer":
          await unwrap(transfers[":id"].$delete({ param: { ...param, id: change.id } }));
          return;
        case "createCompensation":
          await unwrap(compensations.$post({ param, json: change.body }));
          return;
        case "updateCompensation":
          await unwrap(
            compensations[":id"].$patch({ param: { ...param, id: change.id }, json: change.body }),
          );
          return;
        case "deleteCompensation":
          await unwrap(compensations[":id"].$delete({ param: { ...param, id: change.id } }));
      }
    },
    onSettled: (_data, error, change) => {
      // What was just deleted is not read again: it would only be retried, and
      // its form would stay open meanwhile.
      const gone =
        !error && (change.action === "deleteTransfer" || change.action === "deleteCompensation")
          ? change.id
          : undefined;
      return Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["books", bookId, "journal"],
          predicate: (query) => gone === undefined || !query.queryKey.includes(gone),
        }),
        // The budgets read the journal: what an entry holds counts in them.
        queryClient.invalidateQueries({ queryKey: ["books", bookId, "budgets"] }),
      ]);
    },
  });
}

/** Today's date in the user's time zone, as "2026-11-22". */
export function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Formats a calendar date ("2026-11-22") for a locale, without time zone shifts. */
export function formatDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

/** "22 Nov" from "2026-11-22", for lists where the year is already given. */
export function formatDay(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

/** "November" from "2026-11". */
export function formatMonthName(month: string, locale: string, style: "long" | "short" = "long") {
  return new Intl.DateTimeFormat(locale, { month: style, timeZone: "UTC" }).format(
    new Date(`${month}-01T00:00:00Z`),
  );
}

/** " → Nov" for a shifted entry, empty otherwise. */
export function shiftText(entry: { date: string; monthShifted: boolean }, locale: string): string {
  if (!entry.monthShifted) return "";
  return ` → ${formatMonthName(budgetMonth(entry.date, true), locale, "short")}`;
}

/** The 12 months of a year, as the journal's `months` filter takes them. */
export function monthsOfYear(year: number): string {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`).join(
    ",",
  );
}

/** Accepts a decimal comma as typed in French: "-12,50" → "-12.50". */
export function decimalInput(text: string): string {
  return text.trim().replace(/\s/g, "").replace(",", ".");
}
