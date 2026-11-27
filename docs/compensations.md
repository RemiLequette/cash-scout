# Compensations

Design notes from a brainstorm. Built. Compensations replace the virtual accounts that held pairs of entries adding up to zero.

## Intent

Record an amount that counts in two categories without any money moving in the book, and make it impossible for the two sides not to match.

Example, in a shared book: a member pays 50 of groceries from a private account. The shared book records **one compensation of 50**: +50 in _Contribution to the shared budget_ (income) and −50 in _Food_ (spending). The member's own book records an ordinary bank entry in its _Contribution to the shared account_ category.

Nothing is automated or linked between books.

## What goes away

- **Virtual accounts**, and with them the account kind: every account is a bank account.
- The rule that a virtual account's balance should come back to zero, and the report that was to flag those that do not.

## Model

A compensation is:

| Field         | Notes                                       |
| ------------- | ------------------------------------------- |
| Date          | The same for both sides                     |
| Description   | Free text, the same for both sides          |
| Plus category | The sub-category that receives the amount   |
| Minus         | The sub-category that receives its negation |
| Amount        | Greater than zero, in the book currency     |

- The two sub-categories differ, and neither belongs to a transfer nature: both sides count in the totals.
- To take a compensation back, for a refund for instance, swap the two sub-categories.
- A compensation has **no account** and **no other currency** than the book's.
- It is **not planned**: its planned amount is 0.
- There is **nothing to reconcile**.
- It covers two sub-categories. An amount spread over more takes several compensations.

## Storage

As for a transfer, a compensation is **two journal entries** that are created, changed and deleted together.

- A `compensation` table (book, revision, timestamps); `journal_entry` gains `compensation_id` and the side, plus or minus, unique per compensation.
- `journal_entry.account_id` becomes optional, with a constraint: an entry has no account exactly when it is a side of a compensation.
- Each side holds its signed amount, the same book amount, an exchange rate of 1 and a planned amount of 0.
- Each side is stored as **reconciled**, so that it never counts as a forecast: not in the message about past entries, not under the forecasts filter. The interface shows no checkbox for it.

Totals keep adding journal entries by sub-category, so they need no new source.

## Effects

| Where                            | Effect                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| Year dashboard, categories       | Each side counts in its sub-category, as any entry                                         |
| Year dashboard, balances         | None: no account                                                                           |
| Year dashboard, transfers line   | None. It no longer differs from zero because of a virtual account                          |
| Budgets                          | Both sides are unplanned, so each consumes its category's grid for the month               |
| Cash projection, account chart   | None on the entries. The budget lines they consume get smaller, which does move both       |
| Detail panel                     | Listed with an empty account                                                               |
| Statement import                 | None: matching works account by account                                                    |
| Entry suggestions                | Sides are left out, as the sides of a transfer are                                         |
| Moving or merging sub-categories | Sides follow, as any entry. A merge that would give both sides one sub-category is refused |

## Screens

Everything happens in the journal: there is **no page of its own**.

- **Create:** _New compensation_ in the menu of the _New entry_ button, which opens a form: date, description, plus sub-category, minus sub-category, amount.
- A compensation shows as **two lines**, one per sub-category, with an empty account and no reconciled checkbox.
- **Edit, duplicate, delete:** opening either line opens the form with the whole compensation.
- Neither line can be changed or reconciled on its own, including in a selection of several entries.
- **Filter:** a _Compensations_ choice in the journal's status filter. When it is selected, only compensations show: no budget line and no account chart.
- Editors and owners change compensations; viewers read them.
- No explanatory text in the form: it goes in the online help.

## API

- `GET` of one, `POST`, `PATCH` and `DELETE` under `/books/:bookId/compensations`, with the same membership, role and revision checks as transfers. The journal lists them.
- The journal list takes a parameter that keeps only compensations.
- The entry routes refuse to change or delete a side; reconciling a selection leaves the sides out.

## Migration and compatibility

- The database migration deletes the virtual accounts that nothing uses, and **fails** if one still has entries, an opening balance, a budget or statement lines. It converts nothing.
- It then drops the account kind.
- **Book export:** compensations join the file. An older file loses its unused virtual accounts; a file with a used one is refused.
- **CSV import of reference data:** the `kind` column is ignored when it says `bank`; `virtual` is refused.
- **CSV import of the journal:** unchanged, an account is required. It does not create compensations.

## Out of scope

- A page listing the compensations: the journal and its filter are enough.
- Any link between books, including the [virtual common book](../README.md#virtual-common-book).
- Planned or recurring compensations.
- Counting a compensation in the month before or after its date: its date can be changed, as no bank statement sets it.
- Compensations over more than two sub-categories, or in another currency.
