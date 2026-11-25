import { eq } from "drizzle-orm";
import { APP_ROLE, createDb, withUser, type Tx } from "../db/client.js";
import { user } from "../db/schema.js";
import { loadEnv } from "../env.js";
import { requireRole } from "../routes/access.js";
import { ImportError } from "./reference.js";

/**
 * Runs an import as the user with this email, who must be an editor or owner
 * of the book, in one transaction: on any error nothing is imported.
 * Prints the error and sets the exit code instead of throwing.
 */
export async function runImport<T>(
  email: string,
  bookId: string,
  run: (tx: Tx) => Promise<T>,
): Promise<T | undefined> {
  const env = loadEnv();
  const { db, sql } = createDb(env.databaseUrl, { role: APP_ROLE });
  try {
    const [found] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email.toLowerCase()));
    if (!found) {
      throw new ImportError(`No user with the email ${email}`);
    }
    return await withUser(db, found.id, async (tx) => {
      await requireRole(tx, bookId, found.id, "editor");
      return run(tx);
    });
  } catch (error) {
    console.error(`Failed, nothing was changed: ${(error as Error).message}`);
    process.exitCode = 1;
    return undefined;
  } finally {
    await sql.end();
  }
}
