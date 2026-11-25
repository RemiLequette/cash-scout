# Bank statement import and opening balance

Design notes from a brainstorm. Nothing here is built yet. The README ([Entering transactions](../README.md#entering-transactions)) and the [architecture](../ARCHITECTURE.md#import) give the intent; this note fixes the decisions and splits the work into steps that can be delivered one by one.

Real statements are personal data: keep them under `local/statements/`, which Git ignores. Tests use anonymised fixtures with the same structure.

## What the example statements show

Three banks, three formats, no common ground:

|                 | Boursorama                                           | Caisse d'Epargne                            | ABN AMRO                                        |
| --------------- | ---------------------------------------------------- | ------------------------------------------- | ----------------------------------------------- |
| File            | CSV `;`, UTF-8 with BOM                              | CSV `;`, ASCII (accents stripped), CRLF     | `.xls` (binary OLE), one sheet                  |
| Date            | `2026-10-30`, operation and value dates              | `30/10/2026`, three dates                   | `20260820`, a number                            |
| Amount          | one signed column, decimal comma                     | two columns, debit and credit, explicit `+` | one signed number                               |
| Account         | number and name on every line                        | none (only in the file name)                | number and currency on every line               |
| Label           | raw and cleaned                                      | short, long and extra information           | one structured string (`/TRTP/…/NAME/…/REMI/…`) |
| Bank category   | two levels                                           | almost always "to categorise"               | none                                            |
| Line identifier | none                                                 | `Reference`, often empty                    | none                                            |
| Running balance | after every line (decimal point, unlike the amounts) | none                                        | start and end balance on every line             |

Consequences: one parser per bank layout, a spreadsheet reader for `.xls`, no reliable line identifier, and a running balance for two banks out of three.

## Pipeline

```
file → column mapping (per account) → import batch → rules → review → import
```

All of it happens in the web application. There is no command line import for statements.

1. **Parse.** The file is read through the **column mapping** of the target account: encoding, delimiter, header line, the column of each field, date format, decimal separator, sign convention (one signed column, or debit and credit apart). Three presets (Boursorama, Caisse d'Epargne, ABN AMRO) ship with the application; a user duplicates one to describe another bank. Some fields are not a column but a transformation, such as the `NAME` of an ABN AMRO label.
2. **Batch.** The parsed lines are stored as an **import batch**, in the database, not in memory: a review of hundreds of lines spans several sittings, and duplicates are also looked for among earlier batches.
3. **Prepare.** In this order, on each line: look for a duplicate, look for a forecast to reconcile, look for a transfer, then apply the rules to what is left. A line already imported needs no category; a reconciled forecast already has one; a transfer has none to choose.
4. **Review.** The user sees each line with its status (new, probable duplicate, reconciled to a forecast, possible transfer, to categorise), corrects it, creates sub-categories on the way, and creates or edits rules.
5. **Import.** The user confirms; the lines become journal entries in one transaction. Every entry keeps the id of its batch, so a whole import can be undone.

### Batch lines

A line holds: account, operation date, value date, signed amount and currency, raw label, cleaned counterparty, memo, bank reference, the bank's own category (a hint only), running balance, a fingerprint, and the raw source line for traceability. The proposals come next: sub-category, payment type, rule applied, matched entry, transfer counterpart. Then a status: to review, validated, ignored.

### Duplicates

No bank gives a line identifier we can trust. The fingerprint is the account, the date, the amount, the normalised label and the **rank of the occurrence** within the batch (two coffees at 3.20 on the same day are two lines). The running balance, when the bank gives one, settles the doubtful cases.

### Reconciling forecasts

An imported line that matches an unreconciled entry of the journal reconciles it: same account, an amount equal or close (tolerance to settle), a date within a window of a few days. The entry gets the bank amount and keeps its planned amount. When several forecasts fit, the best is proposed and the user chooses. A line with no match becomes a new entry. Every imported entry is reconciled.

### Transfers

A statement line that is one side of a movement between two accounts of the book can be paired with its other side, in the same batch, in another batch, or already in the journal, and imported as a [transfer](../README.md#transfers). The date gap between the two sides is the transfer's delay (0 to 60 days). The pairing is proposed, never done silently.

### Rules

A rule belongs to the book, so editors share it. A condition: text of the counterparty or label (contains, regex), account, direction, amount range, bank category. An action: sub-category, payment type, a rewritten description, "transfer to account X", "ignore". The mapping from a bank category to a sub-category is a rule like any other.

A rule is created from the review ("always do this for this merchant"), and the application shows how many lines of the batch and of the existing journal it would touch before it is saved. Rules have an order, visible and editable. As the README says, the category decides, not the sign: a rule never picks a sub-category from the sign alone.

## Opening balance

### Why

Today the missing past of an account is made up with entries of an "Adjustment" sub-category. It is a plain entry, so it falls in a category, a nature and a direction, and counts in the year dashboard and in the budgets although it is neither spending nor income.

### Decisions

- The **opening balance** is a field of the account (`book_account`), in the account's currency, with the amount in the book currency (the rate is implied by the two amounts). It is **not dated**: it stands for everything before and around the account's entries.
- The balance of an account is its opening balance plus its entries. The opening balance is in no category, so no total, budget or dashboard sees it.
- It is edited in the account's reference data, not in the journal: the journal shows no line for it. The account's reference data is also where the IBAN and account number will go (see [Account identity](#account-identity)).
- **Holes in the middle are not handled.** Whatever is missing is in the opening balance. The balance curve of the past may be wrong; what matters is the right balance now.
- The Adjustment sub-category is removed (see [Removing the adjustments](#removing-the-adjustments)).

### Setting it from a bank balance

One operation, in two modes:

```
opening balance = bank balance − sum of the reconciled entries of the account
```

- **Manual** (a button in the account's reference data): the user types the balance as read in the online bank. Every reconciled entry counts, **whatever its date**: the online banking shows operations dated next Monday.
- **Import**: the balance is the one of the statement's **last line**, so only the reconciled entries up to that line's date count. Entries after it, from a more recent import, must not shift the result.

The preview shows the change, for example `Opening balance: 21 634,75 → 20 100,00 (difference −1 534,75)`. A large difference nobody expects means a line is missing or doubled in the batch: it is the warning that replaces a strict continuity check. When the account holds no entry, the new opening balance is proposed ticked; when it has a history, it is proposed unticked, so the user confirms it knowingly.

Banks without a running balance (Caisse d'Epargne here) ask the user for a balance on a given date.

### Currencies

For an account not in the book currency, the opening balance keeps the account amount, the book amount and the rate, as an entry does. Setting it asks for the rate, proposed from the account's last known rate.

### Removing the adjustments

Done by hand, no command: delete the entries of the Adjustment sub-category in the journal, delete the sub-category in the reference data, then set the opening balance of each account again from its bank balance ("Opening balance…" in the account's menu).

- Dump the database first, as in [Deploying to a server](deployment.md).
- The statistics of the past change: the adjustments leave the flows and the budgets of their months. That is the purpose, but it shows. Balances are wrong until each opening balance is set again.

## Account identity

Boursorama and ABN AMRO give the account number on each line. An account that stores its number (and, later, its IBAN) lets the import **pick the target account** from the file and warn when a file belongs to another account. These are fields of the account's reference data, next to the opening balance, and optional.

## Steps

1. **Opening balance and migration.** The field, the "set from a balance" operation, the places that compute balances (`journal.ts`, `dashboard.ts`, the account chart, the projection), the reference screen, the migration with its dry run. Ready to start; it does not depend on the import.
2. **Batches and mappings.** Parsers and presets, the batch tables, a first review screen without rules. Needs the spreadsheet reader for `.xls`.
3. **Rules.** The rule model, the engine (pure, in `packages/domain`), creation from the review.
4. **Duplicates, reconciliations and transfers.** The matching, then the warnings in the review.

Step 1 is built: the README, the architecture and the online help are updated with it.

## Open points

- The tolerance on amount and date to reconcile a forecast.
- Where the spreadsheet reader runs (browser or API) and which library.
- Whether the rules can be shared across books, or stay in one book.
- Which fields are required to create an account's identity (IBAN format check, masking in the interface).
