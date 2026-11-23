import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

/** Reloads what a change of the given scope can have touched, as announced by the API. */
function reload(queryClient: QueryClient, bookId: string, scope: string) {
  const keys: string[][] =
    scope === "reference"
      ? // Merging sub-categories moves entries; names and archiving show in the journal.
        [["reference"], ["journal"], ["budgets"]]
      : scope === "journal"
        ? [["journal"], ["budgets"]]
        : scope === "members"
          ? [["members"], ["candidates"]]
          : scope === "budgets"
            ? [["budgets"]]
            : [];
  if (keys.length === 0) {
    // The book itself (name, languages, deletion), or something unknown: reload it all.
    void queryClient.invalidateQueries({ queryKey: ["books"] });
    return;
  }
  for (const key of keys) {
    void queryClient.invalidateQueries({ queryKey: ["books", bookId, ...key] });
  }
}

/**
 * Keeps the book up to date with the changes made in other windows, by other
 * members or by the same one: the API announces each change on a stream of
 * server-sent events, and what it touched is reloaded.
 *
 * The browser reconnects by itself after a cut. Changes made meanwhile are
 * missed, so everything of the book is reloaded once the stream is back.
 */
export function useBookEvents(bookId: string) {
  const queryClient = useQueryClient();
  useEffect(() => {
    const source = new EventSource(`/api/books/${bookId}/events`);
    let connected = false;
    source.addEventListener("open", () => {
      if (connected) void queryClient.invalidateQueries({ queryKey: ["books", bookId] });
      connected = true;
    });
    source.addEventListener("change", (event) => {
      reload(queryClient, bookId, (event as MessageEvent<string>).data);
    });
    return () => source.close();
  }, [bookId, queryClient]);
}
