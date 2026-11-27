import type { ImportRequest, ReviewChanges, RuleInput, StatementPreview } from "@cash-scout/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";

/** What the API answered with, as an error with its message when it was not a success. */
async function checked(response: Response): Promise<Response> {
  if (response.ok) return response;
  let message = `HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { error?: string };
    if (typeof body.error === "string") message = body.error;
  } catch {
    // No JSON body.
  }
  throw new ApiError(message, response.status);
}

const base = (bookId: string) => `/api/books/${bookId}/statements`;

export interface Batch {
  id: string;
  accountId: string;
  preset: string;
  fileName: string;
  createdAt: string;
  lines: number;
  toReview: number;
  from: string | null;
  to: string | null;
}

export interface MatchedEntry {
  id: string;
  date: string;
  amount: string;
  description: string;
  subCategoryId: string;
  reconciled: boolean;
  /** One side of a transfer. */
  transfer: boolean;
}

export interface BatchLine {
  id: string;
  row: number;
  date: string;
  amount: string;
  label: string;
  counterparty: string;
  memo: string;
  bankCategory: string;
  balance: string | null;
  status: "review" | "validated" | "ignored" | "imported";
  /** Chosen in the review: the sub-category of the entry to create. */
  subCategoryId: string | null;
  description: string | null;
  /** The rule that proposed the sub-category, the description or ignoring. */
  ruleId: string | null;
  /** For a transfer to create: the other account. */
  transferAccountId: string | null;
  /** The entry of the journal the line is, chosen or created. */
  entry: MatchedEntry | null;
  /** The entries the line may be, the proposal first; only for a line to review. */
  candidates: MatchedEntry[];
  /** An earlier batch of the account already holds this line. */
  duplicate: boolean;
}

export interface BatchDetail {
  id: string;
  accountId: string;
  preset: string;
  fileName: string;
  createdAt: string;
  currency: string;
  bookCurrency: string;
  lines: BatchLine[];
  /** Forecasts of the account no line is, to choose by hand. */
  forecasts: MatchedEntry[];
  /** Forecasts dated within the statement that no line is: likely to be written twice. */
  unmatched: MatchedEntry[];
  /** What the opening balance becomes, when the statement can tell. */
  opening: {
    date: string;
    balance: string;
    current: string;
    proposed: string;
    /** The account has no entry yet: setting it is the expected thing. */
    suggested: boolean;
  } | null;
}

/** The formats of statements the API can read. */
export function usePresets(bookId: string) {
  return useQuery({
    queryKey: ["books", bookId, "statements", "presets"],
    queryFn: async () =>
      (await (await checked(await fetch(`${base(bookId)}/presets`))).json()) as {
        id: string;
        name: string;
      }[],
  });
}

export interface Upload {
  file: File;
  preset: string;
  accountId: string;
}

async function upload(bookId: string, path: string, input: Upload) {
  const query = new URLSearchParams({
    preset: input.preset,
    account: input.accountId,
    name: input.file.name,
  });
  return checked(
    await fetch(`${base(bookId)}/${path}?${query}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: await input.file.arrayBuffer(),
    }),
  );
}

/** Sends the file to be read; nothing is saved, the answer is what the file holds. */
export function usePreview(bookId: string) {
  return useMutation({
    mutationFn: async (input: Upload) =>
      (await (await upload(bookId, "preview", input)).json()) as StatementPreview,
  });
}

/** Keeps the file's lines as an import batch to review. */
export function useKeepBatch(bookId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Upload) =>
      (await (await upload(bookId, "batches", input)).json()) as { id: string; lines: number },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["books", bookId, "statements", "batches"] }),
  });
}

export function useBatches(bookId: string) {
  return useQuery({
    queryKey: ["books", bookId, "statements", "batches"],
    queryFn: async () =>
      (await (await checked(await fetch(`${base(bookId)}/batches`))).json()) as Batch[],
  });
}

export function useBatch(bookId: string, id: string | null) {
  return useQuery({
    queryKey: ["books", bookId, "statements", "batches", id],
    queryFn: async () =>
      (await (await checked(await fetch(`${base(bookId)}/batches/${id}`))).json()) as BatchDetail,
    enabled: id !== null,
  });
}

export function useDeleteBatch(bookId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await checked(await fetch(`${base(bookId)}/batches/${id}`, { method: "DELETE" }));
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["books", bookId, "statements", "batches"] }),
  });
}

async function sendJson(url: string, method: string, body: unknown) {
  return checked(
    await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** Saves decisions on some lines of a batch; the batch is read again after it. */
export function useReviewLines(bookId: string, batchId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (changes: ReviewChanges["changes"]) => {
      await sendJson(`${base(bookId)}/batches/${batchId}/lines`, "PATCH", { changes });
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["books", bookId, "statements", "batches"] }),
  });
}

/** Writes the validated lines into the journal: everything of the book may change. */
export function useImportBatch(bookId: string, batchId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: ImportRequest) =>
      (await (
        await sendJson(`${base(bookId)}/batches/${batchId}/import`, "POST", request)
      ).json()) as { created: number; matched: number; openingSet: boolean },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["books", bookId] }),
  });
}

/** Undoes the import of a batch: created entries are removed, reconciled ones restored. */
export function useUndoImport(bookId: string, batchId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await (await sendJson(`${base(bookId)}/batches/${batchId}/undo`, "POST", {})).json()) as {
        removed: number;
        restored: number;
        skipped: number;
      },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["books", bookId] }),
  });
}

/** An import rule, as the API gives it. */
export interface Rule {
  id: string;
  position: number;
  name: string;
  text: string | null;
  bankCategory: string | null;
  direction: "any" | "in" | "out";
  minAmount: string | null;
  maxAmount: string | null;
  subCategoryId: string | null;
  description: string | null;
  ignore: boolean;
}

const rulesKey = (bookId: string) => ["books", bookId, "statements", "rules"];

export function useRules(bookId: string) {
  return useQuery({
    queryKey: rulesKey(bookId),
    queryFn: async () =>
      (await (await checked(await fetch(`${base(bookId)}/rules`))).json()) as Rule[],
  });
}

/** Creates a rule, or replaces the one with `id`. */
export function useSaveRule(bookId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id?: string; rule: RuleInput }) =>
      (await (
        await sendJson(
          `${base(bookId)}/rules${input.id ? `/${input.id}` : ""}`,
          input.id ? "PUT" : "POST",
          input.rule,
        )
      ).json()) as Rule,
    onSettled: () => queryClient.invalidateQueries({ queryKey: rulesKey(bookId) }),
  });
}

export function useDeleteRule(bookId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await checked(await fetch(`${base(bookId)}/rules/${id}`, { method: "DELETE" }));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: rulesKey(bookId) }),
  });
}

/** Sets the order of the rules, first to last. */
export function useOrderRules(bookId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      await sendJson(`${base(bookId)}/rules/order`, "PUT", { ids });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: rulesKey(bookId) }),
  });
}

/** Tries the rules on the lines of a batch that have nothing chosen yet. */
export function useApplyRules(bookId: string, batchId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await (await sendJson(`${base(bookId)}/batches/${batchId}/rules`, "POST", {})).json()) as {
        applied: number;
      },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["books", bookId, "statements", "batches"] }),
  });
}
