import { zValidator } from "@hono/zod-validator";
import {
  bookInputSchema,
  bookUpdateSchema,
  defaultNatures,
  memberInputSchema,
  memberUpdateSchema,
  type BookRole,
} from "@cash-scout/domain";
import { and, asc, eq, notInArray } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import { exportBook } from "../archive/export.js";
import { importBook, readArchive } from "../archive/import.js";
import { withUser, type Db, type Tx } from "../db/client.js";
import { scopeOfPath, type BookEvents } from "../events.js";
import { book, bookLanguage, bookMember, nature, user } from "../db/schema.js";
import type { AppEnv } from "../http.js";
import { idOf, languagesOf, missing, requireRole, roleOf } from "./access.js";
import { budgetsRoutes } from "./budgets.js";
import { compensationRoutes } from "./compensations.js";
import { dashboardRoutes } from "./dashboard.js";
import { journalRoutes } from "./journal.js";
import { statementRoutes } from "./statements.js";
import { transferRoutes } from "./transfers.js";
import { referenceRoutes } from "./reference.js";

async function ownerCount(tx: Tx, bookId: string): Promise<number> {
  const owners = await tx
    .select({ userId: bookMember.userId })
    .from(bookMember)
    .where(and(eq(bookMember.bookId, bookId), eq(bookMember.role, "owner")));
  return owners.length;
}

const bookColumns = {
  version: book.version,
  id: book.id,
  name: book.name,
  currency: book.currency,
  defaultLanguage: book.defaultLanguage,
};

const bookIdOf = (param: string) => idOf(param);

/** How often an idle event stream sends a ping, so proxies keep the connection open. */
const PING_MS = 25_000;

/** The largest book file accepted: years of journal and statements take a few MB. */
const MAX_ARCHIVE = 50 * 1024 * 1024;

/** The code of the database error behind an error of a query. */
const databaseCode = (error: unknown) =>
  (error as { code?: string }).code ?? (error as { cause?: { code?: string } }).cause?.code;

export function booksRoutes(db: Db, events: BookEvents) {
  return (
    new Hono<AppEnv>()
      // Every change made to a book is announced to the windows open on it, once
      // its transaction has been committed.
      .use("/:bookId/*", async (c, next) => {
        await next();
        if (c.req.method !== "GET" && c.res.status < 400) {
          events.publish(c.req.param("bookId"), scopeOfPath(c.req.path));
        }
      })

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
          await tx.insert(bookLanguage).values({ bookId: id, language: input.defaultLanguage });
          await tx.insert(nature).values(
            defaultNatures([input.defaultLanguage], input.defaultLanguage).map((n, position) => ({
              ...n,
              bookId: id,
              position,
            })),
          );
        });
        return c.json(
          { id, ...input, languages: [input.defaultLanguage], role: "owner" as BookRole },
          201,
        );
      })

      // A book file, as `GET /:bookId/export` gives it, becomes a new book.
      .post(
        "/import",
        bodyLimit({
          maxSize: MAX_ARCHIVE,
          onError: (c) => c.json({ error: "The file is too large" }, 413),
        }),
        async (c) => {
          const me = c.var.user.id;
          const name = bookInputSchema.shape.name.optional().safeParse(c.req.query("name"));
          if (!name.success) throw new HTTPException(400, { message: "Invalid name" });
          const content: unknown = await c.req.json().catch(() => null);
          const archive = readArchive(content);
          const id = await withUser(db, me, (tx) => importBook(tx, me, archive, name.data)).catch(
            (error: unknown) => {
              // Data and integrity errors: the file does not hold together.
              if (/^2[23]/.test(databaseCode(error) ?? "")) {
                throw new HTTPException(400, { message: "Invalid file: inconsistent data" });
              }
              throw error;
            },
          );
          return c.json({ id }, 201);
        },
      )

      // The whole book as one file. Owners only: it holds account numbers and labels.
      .get("/:bookId/export", async (c) => {
        const me = c.var.user.id;
        const bookId = bookIdOf(c.req.param("bookId"));
        const archive = await withUser(
          db,
          me,
          async (tx) => {
            await requireRole(tx, bookId, me, "owner");
            return exportBook(tx, bookId);
          },
          "repeatable read",
        );
        // The book's name in the file name, and in plain ASCII for old browsers.
        const file = `${archive.book.name}-${archive.exportedAt.slice(0, 10)}.json`;
        const ascii = file.replace(/[^A-Za-z0-9._-]+/g, "_");
        c.header(
          "content-disposition",
          `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file)}`,
        );
        return c.json(archive);
      })

      .get("/:bookId", async (c) => {
        const me = c.var.user.id;
        const bookId = bookIdOf(c.req.param("bookId"));
        const result = await withUser(db, me, async (tx) => {
          const role = await requireRole(tx, bookId, me, "viewer");
          const [row] = await tx.select(bookColumns).from(book).where(eq(book.id, bookId));
          const { languages } = await languagesOf(tx, bookId);
          return { ...row!, languages, role };
        });
        return c.json(result);
      })

      .patch("/:bookId", zValidator("json", bookUpdateSchema), async (c) => {
        const me = c.var.user.id;
        const bookId = bookIdOf(c.req.param("bookId"));
        const { languages, version, ...input } = c.req.valid("json");
        const result = await withUser(db, me, async (tx) => {
          const role = await requireRole(tx, bookId, me, "owner");
          const [row] = await tx
            .update(book)
            .set(input)
            .where(
              version === undefined
                ? eq(book.id, bookId)
                : and(eq(book.id, bookId), eq(book.version, version)),
            )
            .returning(bookColumns);
          if (!row) return missing("Book", version);
          // Names in a removed language are kept, so adding it back restores them.
          await tx.delete(bookLanguage).where(eq(bookLanguage.bookId, bookId));
          await tx.insert(bookLanguage).values(languages.map((language) => ({ bookId, language })));
          const current = await languagesOf(tx, bookId);
          return { ...row, languages: current.languages, role };
        });
        return c.json(result);
      })

      .route("/:bookId/budgets", budgetsRoutes(db))
      .route("/:bookId/dashboard", dashboardRoutes(db))
      .route("/:bookId/journal", journalRoutes(db))
      .route("/:bookId/transfers", transferRoutes(db))
      .route("/:bookId/compensations", compensationRoutes(db))
      .route("/:bookId/reference", referenceRoutes(db))
      .route("/:bookId/statements", statementRoutes(db))

      .delete("/:bookId", async (c) => {
        const me = c.var.user.id;
        const bookId = bookIdOf(c.req.param("bookId"));
        await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "owner");
          await tx.delete(book).where(eq(book.id, bookId));
        });
        return c.body(null, 204);
      })

      // The changes made to a book by anyone, as a stream of server-sent events:
      // `change` with the scope touched, and `ping` while idle.
      .get("/:bookId/events", async (c) => {
        const me = c.var.user.id;
        const bookId = bookIdOf(c.req.param("bookId"));
        await withUser(db, me, (tx) => requireRole(tx, bookId, me, "viewer"));
        return streamSSE(c, async (stream) => {
          const unsubscribe = events.subscribe(bookId, (scope) => {
            void stream.writeSSE({ event: "change", data: scope });
          });
          stream.onAbort(unsubscribe);
          while (!stream.aborted) {
            await stream.writeSSE({ event: "ping", data: "" });
            await stream.sleep(PING_MS);
          }
        });
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

      // Users an owner can add: every user of the installation not yet a member.
      .get("/:bookId/candidates", async (c) => {
        const me = c.var.user.id;
        const bookId = bookIdOf(c.req.param("bookId"));
        const candidates = await withUser(db, me, async (tx) => {
          await requireRole(tx, bookId, me, "owner");
          return tx
            .select({ userId: user.id, name: user.name, email: user.email })
            .from(user)
            .where(
              notInArray(
                user.id,
                tx
                  .select({ id: bookMember.userId })
                  .from(bookMember)
                  .where(eq(bookMember.bookId, bookId)),
              ),
            )
            .orderBy(asc(user.name));
        });
        return c.json(candidates);
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
