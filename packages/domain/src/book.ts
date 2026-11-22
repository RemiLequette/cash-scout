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

export const bookUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  defaultLanguage: languageSchema,
});
export type BookUpdate = z.infer<typeof bookUpdateSchema>;

export const memberInputSchema = z.object({
  email: z.email(),
  role: bookRoleSchema,
});
export type MemberInput = z.infer<typeof memberInputSchema>;

export const memberUpdateSchema = z.object({ role: bookRoleSchema });
