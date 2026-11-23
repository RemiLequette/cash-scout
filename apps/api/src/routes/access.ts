import { hasRole, type BookRole } from "@cash-scout/domain";
import { and, asc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Tx } from "../db/client.js";
import { book, bookLanguage, bookMember } from "../db/schema.js";

export async function roleOf(
  tx: Tx,
  bookId: string,
  userId: string,
): Promise<BookRole | undefined> {
  const rows = await tx
    .select({ role: bookMember.role })
    .from(bookMember)
    .where(and(eq(bookMember.bookId, bookId), eq(bookMember.userId, userId)));
  return rows[0]?.role;
}

/** Fails with 404 when the book is not visible, 403 when the role is too low. */
export async function requireRole(tx: Tx, bookId: string, userId: string, required: BookRole) {
  const role = await roleOf(tx, bookId, userId);
  if (!role) {
    throw new HTTPException(404, { message: "Book not found" });
  }
  if (!hasRole(role, required)) {
    throw new HTTPException(403, { message: `Requires the ${required} role` });
  }
  return role;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates an id from the URL; an invalid one is reported as not found. */
export function idOf(param: string | undefined, what = "Book"): string {
  if (!param || !UUID.test(param)) {
    throw new HTTPException(404, { message: `${what} not found` });
  }
  return param;
}

/** The book's languages, its default language first. */
export async function languagesOf(tx: Tx, bookId: string) {
  const [row] = await tx
    .select({ defaultLanguage: book.defaultLanguage })
    .from(book)
    .where(eq(book.id, bookId));
  const rows = await tx
    .select({ language: bookLanguage.language })
    .from(bookLanguage)
    .where(eq(bookLanguage.bookId, bookId))
    .orderBy(asc(bookLanguage.language));
  const defaultLanguage = row?.defaultLanguage ?? "en";
  const others = rows.map((r) => r.language).filter((l) => l !== defaultLanguage);
  return { defaultLanguage, languages: [defaultLanguage, ...others] };
}

/** Runs a calculation whose RangeError is the user's to fix, as a 400. */
export function checked<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof RangeError) {
      throw new HTTPException(400, { message: error.message });
    }
    throw error;
  }
}
