import { z } from "zod";
import { currencyDigits } from "./money.js";

export const bookRoles = ["owner", "editor", "viewer"] as const;
export const bookRoleSchema = z.enum(bookRoles);
export type BookRole = z.infer<typeof bookRoleSchema>;

const rank: Record<BookRole, number> = { viewer: 0, editor: 1, owner: 2 };

/** True when `role` grants at least the rights of `required`. */
export function hasRole(role: BookRole, required: BookRole): boolean {
  return rank[role] >= rank[required];
}

export const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .refine((code) => {
    try {
      currencyDigits(code);
      return true;
    } catch {
      return false;
    }
  }, "Unknown currency");

/** BCP 47 language tag, e.g. "fr" or "en-GB". */
export const languageSchema = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
  .max(35);

export const bookInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  currency: currencySchema,
  defaultLanguage: languageSchema,
});
export type BookInput = z.infer<typeof bookInputSchema>;

/**
 * Revision of a row as the client last read it. When given with a change, the
 * API refuses it (409) if the row has changed since; without it, the change wins.
 */
export const versionSchema = z.number().int().positive();

/** Languages of the book's reference data; the default language is one of them. */
export const bookUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    defaultLanguage: languageSchema,
    languages: z.array(languageSchema).min(1).max(10),
    version: versionSchema.optional(),
  })
  .refine((b) => b.languages.includes(b.defaultLanguage), {
    message: "The default language must be one of the book's languages",
    path: ["defaultLanguage"],
  })
  .refine((b) => new Set(b.languages).size === b.languages.length, {
    message: "Languages must be unique",
    path: ["languages"],
  });
export type BookUpdate = z.infer<typeof bookUpdateSchema>;

export const memberInputSchema = z.object({
  email: z.email(),
  role: bookRoleSchema,
});
export type MemberInput = z.infer<typeof memberInputSchema>;

export const memberUpdateSchema = z.object({ role: bookRoleSchema });
