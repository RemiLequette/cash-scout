import { zValidator } from "@hono/zod-validator";
import {
  bookInputSchema,
  bookUpdateSchema,
  hasRole,
  memberInputSchema,
  memberUpdateSchema,
  type BookRole,
} from "@cash-scout/domain";
import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { withUser, type Db, type Tx } from "../db/client.js";
import { book, bookMember, user } from "../db/schema.js";
import type { AppEnv } from "../http.js";

async function roleOf(tx: Tx, bookId: string, userId: string): Promise<BookRole | undefined> {
  const rows = await tx
    .select({ role: bookMember.role })
    .from(bookMember)
    .where(and(eq(bookMember.bookId, bookId), eq(bookMember.userId, userId)));
  return rows[0]?.role;
}

/** Fails with 404 when the book is not visible, 403 when the role is too low. */
async function requireRole(tx: Tx, bookId: string, userId: string, required: BookRole) {
  const role = await roleOf(tx, bookId, userId);
  if (!role) {
    throw new HTTPException(404, { message: "Book not found" });
  }
  if (!hasRole(role, required)) {
    throw new HTTPException(403, { message: `Requires the ${required} role` });
  }
  return role;
}

async function ownerCount(tx: Tx, bookId: string): Promise<number> {
  const owners = await tx
    .select({ userId: bookMember.userId })
    .from(bookMember)
    .where(and(eq(bookMember.bookId, bookId), eq(bookMember.role, "owner")));
  return owners.length;
}

const bookColumns = {
  id: book.id,
  name: book.name,
  currency: book.currency,
  defaultLanguage: book.defaultLanguage,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bookIdOf(param: string): string {
  if (!UUID.test(param)) {
    throw new HTTPException(404, { message: "Book not found" });
  }
  return param;
}

export function booksRoutes(db: Db) {
  return (
    new Hono<AppEnv>()
      .get("/", async (c) => {
        const me = c.var.user.id;
        const books = await withUser(db, me, (tx) =>
          tx
            .select({ ...bookColumns, role: bookMember.role })
            .from(book)
            .innerJoin(bookMember, eq(bookMember.bookId, book.id))
            .where(eq(bookMember.userId, me))
            .orderBy(asc(book.name)),
        );
        return c.json(books);
      })

      .post("/", zValidator("json", bookInputSchema), async (c) => {
        const me = c.var.user.id;
        const input = c.req.valid("json");
        const id = crypto.randomUUID();
        await withUser(db, me, async (tx) => {
          await tx.insert(book).values({ id, ...input });
          await tx.insert(bookMember).values({ bookId: id, userId: me, role: "owner" });
        });
        return c.json({ id, ...input, role: "owner" as BookRole }, 201);
      })

      .get("/:bookId", async (c) => {
        const me = c.var.user.id;
        const bookId = bookIdOf(c.req.param("bookId"));
        const result = await withUser(db, me, async (tx) => {
          const role = await requireRole(tx, bookId, me, "viewer");
          const [row] = await tx.select(bookColumns).from(book).where(eq(book.id, bookId));
          return { ...row!, role };
        });
        return c.json(result);
      })

      .patch("/:bookId", zValidator("json", bookUpdateSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = bookIdOf(c.req.param("bookId"));
        const input = c.req.valid("json");
        const result = await withUser(db, me, async (tx) => {
          const role = await requireRole(tx, bookId, me, "owner");
          const [row] = await tx
            .update(book)
            .set(input)
            .where(eq(book.id, bookId))
            .returning(bookColumns);
          return { ...row!, role };
        });
        return c.json(result);
      })

      .delete("/:bookId", async (c) => {
        const me = c.var.user.id;
        const bookId = bookIdOf(c.req.param("bookId"));
        await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "owner");
          await tx.delete(book).where(eq(book.id, bookId));
        });
        return c.body(null, 204);
      })

      .get("/:bookId/members", async (c) => {
        const me = c.var.user.id;
        const bookId = bookIdOf(c.req.param("bookId"));
        const members = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "viewer");
          return tx
            .select({
              userId: bookMember.userId,
              name: user.name,
              email: user.email,
              role: bookMember.role,
            })
            .from(bookMember)
            .innerJoin(user, eq(user.id, bookMember.userId))
            .where(eq(bookMember.bookId, bookId))
            .orderBy(asc(user.name));
        });
        return c.json(members);
      })

      .post("/:bookId/members", zValidator("json", memberInputSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = bookIdOf(c.req.param("bookId"));
        const { email, role } = c.req.valid("json");
        const member = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "owner");
          const [target] = await tx
            .select({ id: user.id, name: user.name, email: user.email })
            .from(user)
            .where(eq(user.email, email.toLowerCase()));
          if (!target) {
            throw new HTTPException(404, { message: "No user with this email" });
          }
          if (await roleOf(tx, bookId, target.id)) {
            throw new HTTPException(409, { message: "Already a member" });
          }
          await tx.insert(bookMember).values({ bookId, userId: target.id, role });
          return { userId: target.id, name: target.name, email: target.email, role };
        });
        return c.json(member, 201);
      })

      .patch("/:bookId/members/:userId", zValidator("json", memberUpdateSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = bookIdOf(c.req.param("bookId"));
        const userId = c.req.param("userId");
        const { role } = c.req.valid("json");
        await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "owner");
          const current = await roleOf(tx, bookId, userId);
          if (!current) {
            throw new HTTPException(404, { message: "Not a member" });
          }
          if (current === "owner" && role !== "owner" && (await ownerCount(tx, bookId)) === 1) {
            throw new HTTPException(409, { message: "A book needs at least one owner" });
          }
          await tx
            .update(bookMember)
            .set({ role })
            .where(and(eq(bookMember.bookId, bookId), eq(bookMember.userId, userId)));
        });
        return c.json({ userId, role });
      })

      // Owners remove members; any member can leave.
      .delete("/:bookId/members/:userId", async (c) => {
        const me = c.var.user.id;
        const bookId = bookIdOf(c.req.param("bookId"));
        const userId = c.req.param("userId");
        await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, userId === me ? "viewer" : "owner");
          const current = await roleOf(tx, bookId, userId);
          if (!current) {
            throw new HTTPException(404, { message: "Not a member" });
          }
          if (current === "owner" && (await ownerCount(tx, bookId)) === 1) {
            throw new HTTPException(409, { message: "A book needs at least one owner" });
          }
          await tx
            .delete(bookMember)
            .where(and(eq(bookMember.bookId, bookId), eq(bookMember.userId, userId)));
        });
        return c.body(null, 204);
      })
  );
}
