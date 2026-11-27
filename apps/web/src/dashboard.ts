import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { api, unwrap } from "./api";
import { today } from "./journal";

const dashboardEndpoint = api.books[":bookId"].dashboard.$get;
/** What the year dashboard is made of: cells per sub-category and month, unused budgets, balances. */
export type DashboardData = InferResponseType<typeof dashboardEndpoint, 200>;

/**
 * The year dashboard. Under the budgets' key, since entries and budgets both
 * move it and the book's events reload that key.
 */
export function useDashboard(bookId: string, year: number) {
  const now = today();
  return useQuery({
    queryKey: ["books", bookId, "budgets", "dashboard", year, now],
    queryFn: () =>
      unwrap(dashboardEndpoint({ param: { bookId }, query: { year: String(year), today: now } })),
    placeholderData: keepPreviousData,
  });
}

const yearlyEndpoint = api.books[":bookId"].dashboard.years.$get;
/** The figures of every year of a book, one amount per year. */
export type YearlyData = InferResponseType<typeof yearlyEndpoint, 200>;

/** Under the budgets' key too, to be reloaded with them. */
export function useYearly(bookId: string) {
  const now = today();
  return useQuery({
    queryKey: ["books", bookId, "budgets", "yearly", now],
    queryFn: () => unwrap(yearlyEndpoint({ param: { bookId }, query: { today: now } })),
  });
}
