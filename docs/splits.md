# Split entries

Design notes from a brainstorm.

**Built so far:** the model and API (`/books/:bookId/splits`), the journal (create, edit, delete, split an entry, reconcile whole), the Schedule tool and the planned entries list of a category, and the book export. **Not built yet:** the statement import (matching on the bank amount, the remainder taking the difference, undo), copying the previous year, the online help and the README. Until the import is built, it sees the parts as ordinary entries.

## Intent

One bank movement counts in several sub-categories, and stays matched with its statement line.

| Case             | Fixed parts                     | Remainder         |
| ---------------- | ------------------------------- | ----------------- |
| Net rent         | Gross rent, positive            | Manager's charges |
| Net salary       | Gross salary                    | Tax withheld      |
| Loan payment     | Capital repaid, or interest     | The other one     |
| A mixed purchase | The 20 of clothing out of a 100 | Groceries         |

When the gross salary changes too, it is corrected from the payslip, and the tax follows.

The first one is monthly: it is planned, and the charges vary. They must follow from the amount the bank gives, without being typed.

## Model

A split is a set of two or more journal entries, its **parts**, that make one bank movement.

- Each part is an ordinary entry: its own sub-category, description, signed amount and planned amount. Parts may have opposite signs.
- The parts share the **account**, the **date**, the **month shift** and the **reconciled** state. Changing one of these changes all of them.
- The **bank amount** is the sum of the parts. It is not stored.
- Exactly one part is the **remainder**. When the bank amount is set, the other parts keep their amounts and the remainder takes the difference.
- A part cannot be a side of a transfer, nor use a sub-category of a transfer nature.
- For an account in another currency, all parts have the same exchange rate. Each book amount is rounded on its own.

### Example

|                     | Planned | Statement line of 842 |
| ------------------- | ------- | --------------------- |
| Gross rent          | +1000   | +1000                 |
| Charges (remainder) | −150    | −158                  |
| Bank amount         | 850     | 842                   |

The variance of −8 shows on the charges.

Only one part can follow the bank amount. If several parts vary, all but the remainder are typed.

## Storage

A `split` table (book, revision, timestamps). `journal_entry` gains `split_id` and a remainder flag, with at most one remainder per split. The API keeps the shared fields equal and refuses a split of fewer than two parts.

Totals keep adding journal entries by sub-category: the year dashboard and the budgets need no new source.

## Operations

- **Create:** from a form giving the date, account, bank amount and parts. The remainder is computed.
- **Split an existing entry:** add parts to it. It becomes the remainder, so its bank amount does not change.
- **Edit:** the form shows the whole split. Changing the bank amount or a fixed part recomputes the remainder.
- **Remove a part:** the remainder absorbs it. When only the remainder is left, it is an ordinary entry again.
- **Delete, duplicate, reconcile:** the whole split, including from a selection of several entries.

## Journal

One line per part, as for the two sides of a compensation. Each line is marked as a part of a split and shows the bank amount.

## Loans

A payment is split into capital and interest, each an ordinary sub-category. The capital may belong to a nature of its own, to keep it apart from spending. The capital left to repay is not followed.

## Planning

- The **Schedule** tool of the planned entries can create a series of splits. The series is not remembered, as today: each date is an independent split.
- A planned part's amount is its planned amount.
- The planning view of a category shows only the parts of that category, marked as parts of a split. Each is edited there as any row, without opening the split.
- Changing a part's amount or sub-category there changes that part only, and with the amount the bank amount.
- Changing its day or account moves the whole split. Duplicating or deleting it applies to the whole split, parts of other categories included.
- The remainder recomputes only from a bank amount: in the split's form, or in the import.
- **Copy the previous year** copies a split whole, once, whichever of its categories it is started from.

## Statement import

- Matching compares a statement line with the split's **bank amount**, never with one part. The windows and tolerance of [Bank statement import](bank-import.md) apply to that amount.
- A large change of a part can move the bank amount past the tolerance: the forecast is then chosen by hand.
- Reconciling a forecast split gives the parts the bank's date, and the remainder the line's amount minus the other parts.
- The statement line points to the remainder. Undo gives it back its former amount, as for any matched forecast, and gives all parts their former date and reconciled state.
- A line cannot create a split directly. It is imported as one entry, which is then split.

## Other effects

- **Cash projection and account chart:** no change, they add entries.
- **Budgets:** each part consumes or not its own category's grid, from its own planned amount. Splitting an entry afterwards moves no planned amount: the original keeps it, and the new parts are unplanned.
- **Entry suggestions:** parts are left out, as the sides of a transfer are.
- **Book export and import:** splits join the file.
- **CSV import of the journal:** unchanged, it does not create splits.
- **Documentation:** README (journal), online help in English and French.

## Compensations

[Compensations](compensations.md) record an amount in two categories with no bank movement. Splits are about one bank movement. Neither replaces the other.

## Out of scope

- Following rental properties (leases, tenants, charge advances and their yearly settlement): a separate application.
- Computing a loan's capital and interest from its terms.
- Loan accounts: a part that is a transfer, to follow the capital left to repay.
- Import rules that create splits.
- Remembered schedules.
- Grouping existing entries into a split. The past stays as it is, or is grouped by hand, case by case, when asked. Coming months are planned again as splits.
