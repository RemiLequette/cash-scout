import { displayName, type Names } from "@cash-scout/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { useTranslation } from "react-i18next";
import { api, ApiError, unwrap } from "./api";

const referenceEndpoint = api.books[":bookId"].reference.$get;
export type Reference = InferResponseType<typeof referenceEndpoint, 200>;

export function useReference(bookId: string) {
  return useQuery({
    queryKey: ["books", bookId, "reference"],
    queryFn: () => unwrap(referenceEndpoint({ param: { bookId } })),
  });
}

/** Kinds of reference items, as they appear in the API paths. */
export type ReferenceKind =
  | "groups"
  | "categories"
  | "sub-categories"
  | "payment-types"
  | "accounts"
  | "natures"
  | "balances"
  | "lines";

/** Sends a change to the reference data API; the API validates the body. */
async function send(bookId: string, method: string, path: string, body?: unknown) {
  const response = await fetch(`/api/books/${bookId}/reference${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const payload = (await response.json()) as {
        error?: string | { issues?: { message: string }[] };
      };
      if (typeof payload.error === "string") message = payload.error;
      else if (payload.error?.issues?.[0]) message = payload.error.issues[0].message;
    } catch {
      // No JSON body.
    }
    throw new ApiError(message, response.status);
  }
}

/** Create, update and delete reference items; the reference data is reloaded after each. */
export function useReferenceChange(bookId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: {
      kind: ReferenceKind;
      id?: string;
      method: "POST" | "PATCH" | "DELETE";
      body?: unknown;
    }) =>
      send(
        bookId,
        change.method,
        `/${change.kind}${change.id ? `/${change.id}` : ""}`,
        change.body,
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["books", bookId, "reference"] }),
  });
}

/**
 * Sets an account's opening balance, to an amount or from a balance read at the
 * bank. Balances, the projection and the dashboard are reloaded after it.
 */
export function useSetOpening(bookId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: {
      accountId: string;
      body: { opening: string } | { balance: string };
      exchangeRate?: string;
      version?: number;
    }) =>
      send(bookId, "POST", `/accounts/${change.accountId}/opening`, {
        ...change.body,
        ...(change.exchangeRate && { exchangeRate: change.exchangeRate }),
        version: change.version,
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["books", bookId] }),
  });
}

/** Display name of an item in the interface language. */
export function useNameOf(defaultLanguage: string | undefined) {
  const { i18n } = useTranslation();
  return (names: Names) => displayName(names, i18n.language, defaultLanguage ?? i18n.language);
}
