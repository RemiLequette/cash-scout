import type { LoanEventInput, LoanInput, LoanUpdate } from "@cash-scout/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { api, unwrap } from "./api";

const loans = api.books[":bookId"].loans;
export type Loan = InferResponseType<typeof loans.$get, 200>[number];
export type LoanEventRow = Loan["events"][number];
export type Schedule = InferResponseType<(typeof loans)[":id"]["schedule"]["$get"], 200>;
export type ScheduleLine = Schedule["lines"][number];

/** The loans of a book, with the capital left to repay at `date`. */
export function useLoans(bookId: string, date: string) {
  return useQuery({
    queryKey: ["books", bookId, "loans", "list", date],
    queryFn: () => unwrap(loans.$get({ param: { bookId }, query: { date } })),
  });
}

/** A loan's whole schedule, with what the journal holds of each payment. */
export function useSchedule(bookId: string, id: string | undefined) {
  return useQuery({
    queryKey: ["books", bookId, "loans", "schedule", id],
    queryFn: () => unwrap(loans[":id"].schedule.$get({ param: { bookId, id: id! } })),
    enabled: id !== undefined,
  });
}

export type LoanChange =
  | { action: "create"; body: LoanInput }
  | { action: "update"; id: string; body: LoanUpdate }
  | { action: "delete"; id: string }
  | { action: "createEvent"; id: string; body: LoanEventInput }
  | { action: "updateEvent"; id: string; eventId: string; body: LoanEventInput }
  | { action: "deleteEvent"; id: string; eventId: string }
  | { action: "plan"; id: string; year: number; exchangeRate?: string };

/** Changes to the loans; they are reloaded after each, and the journal after a plan. */
export function useLoanChange(bookId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (change: LoanChange) => {
      const param = { bookId };
      switch (change.action) {
        case "create":
          return unwrap(loans.$post({ param, json: change.body }));
        case "update":
          return unwrap(
            loans[":id"].$patch({ param: { ...param, id: change.id }, json: change.body }),
          );
        case "delete":
          return unwrap(loans[":id"].$delete({ param: { ...param, id: change.id } }));
        case "createEvent":
          return unwrap(
            loans[":id"].events.$post({ param: { ...param, id: change.id }, json: change.body }),
          );
        case "updateEvent":
          return unwrap(
            loans[":id"].events[":eventId"].$patch({
              param: { ...param, id: change.id, eventId: change.eventId },
              json: change.body,
            }),
          );
        case "deleteEvent":
          return unwrap(
            loans[":id"].events[":eventId"].$delete({
              param: { ...param, id: change.id, eventId: change.eventId },
            }),
          );
        case "plan":
          return unwrap(
            loans[":id"].plan.$post({
              param: { ...param, id: change.id },
              json: { year: change.year, exchangeRate: change.exchangeRate },
            }),
          );
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["books", bookId] }),
  });
}
