import { z } from "zod";
import { rateSchema } from "./journal.js";

/**
 * The opening balance of an account: the part of its balance no entry explains
 * (what came before the first entry, and whatever the journal misses). It is
 * not dated and sits in no category, so no total or budget sees it.
 *
 * It is set from a balance read at the bank: the opening balance is what makes
 * the reconciled entries add up to that balance.
 */
export function openingFromBalance(balance: bigint, reconciledTotal: bigint): bigint {
  return balance - reconciledTotal;
}

const decimal = z.string().regex(/^[+-]?\d+(\.\d+)?$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Sets the opening balance of an account, either to a given amount (`opening`)
 * or from a bank balance (`balance`): with `upTo`, the balance is the one of that
 * day and only the reconciled entries up to it count (a statement's last line);
 * without it, every reconciled entry counts, whatever its date (the balance read
 * in the online bank). The rate is for an account not in the book currency.
 */
export const openingInputSchema = z
  .object({
    opening: decimal.optional(),
    balance: decimal.optional(),
    upTo: day.optional(),
    exchangeRate: rateSchema.optional(),
    version: z.number().int().positive().optional(),
  })
  .refine((v) => (v.opening === undefined) !== (v.balance === undefined), {
    message: "Give either opening or balance",
  })
  .refine((v) => v.upTo === undefined || v.balance !== undefined, {
    message: "upTo goes with balance",
  });
export type OpeningInput = z.input<typeof openingInputSchema>;
