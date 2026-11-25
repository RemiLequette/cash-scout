import type { StatementPreview } from "@cash-scout/domain";
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

export interface BatchLine {
  id: string;
  row: number;
  date: string;
  valueDate: string | null;
  amount: string;
  label: string;
  counterparty: string;
  memo: string;
  reference: string;
  bankCategory: string;
  balance: string | null;
  status: "review" | "validated" | "ignored";
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
  lines: BatchLine[];
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
