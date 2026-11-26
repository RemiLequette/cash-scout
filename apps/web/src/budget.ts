import { useQuery } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { api, unwrap } from "./api";

const yearEndpoint = api.books[":bookId"].budgets.$get;
/** The budgets of a year, and what the journal holds per category and month. */
export type BudgetYear = InferResponseType<typeof yearEndpoint, 200>;
export type CategoryBudgetRow = BudgetYear["budgets"][number];

export function useBudgetYear(bookId: string, year: number) {
  return useQuery({
    queryKey: ["books", bookId, "budgets", "year", year],
    queryFn: () => unwrap(yearEndpoint({ param: { bookId }, query: { year: String(year) } })),
  });
}
