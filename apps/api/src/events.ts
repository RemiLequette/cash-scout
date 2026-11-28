/** What part of a book a change touched, as the event carries it. */
export const bookScopes = ["book", "members", "reference", "journal", "budgets", "loans"] as const;
export type BookScope = (typeof bookScopes)[number];

/**
 * The scope of a change from the path of the request that made it, under
 * /books/:bookId: `/api/books/<id>/journal/...` → "journal". Changes to the
 * book itself (name, languages, deletion) have no further segment.
 */
export function scopeOfPath(path: string): BookScope {
  const segment = /\/books\/[^/]+\/([^/]+)/.exec(path)?.[1];
  // A transfer or a compensation is two journal entries, and a plan writes the journal.
  if (
    segment === "transfers" ||
    segment === "compensations" ||
    /\/(budgets|loans\/[^/]+)\/plan$/.test(path)
  )
    return "journal";
  return bookScopes.find((scope) => scope === segment) ?? "book";
}

/**
 * Tells the open windows of a book that something changed, so they reload.
 * Events carry the scope only, never data: what a window reloads is read
 * through the API, with the rights of its own user.
 *
 * In memory, so it serves one API process; several instances behind a load
 * balancer would need to relay events (for example with PostgreSQL's NOTIFY).
 */
export function createBookEvents() {
  const listeners = new Map<string, Set<(scope: BookScope) => void>>();
  return {
    publish(bookId: string, scope: BookScope) {
      for (const listener of listeners.get(bookId) ?? []) listener(scope);
    },
    /** Returns the function that stops listening. */
    subscribe(bookId: string, listener: (scope: BookScope) => void): () => void {
      const set = listeners.get(bookId) ?? new Set();
      set.add(listener);
      listeners.set(bookId, set);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(bookId);
      };
    },
  };
}
export type BookEvents = ReturnType<typeof createBookEvents>;
