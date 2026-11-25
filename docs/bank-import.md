# Bank statement import and opening balance

Design notes from a brainstorm. Nothing here is built yet. The README ([Entering transactions](../README.md#entering-transactions)) and the [architecture](../ARCHITECTURE.md#import) give the intent; this note fixes the decisions and splits the work into steps that can be delivered one by one.

Real statements are personal data: keep them under `local/statements/`, which Git ignores. Tests use anonymised fixtures with the same structure.

## What the example statements show

Three banks, three formats, no common ground:

|                 | Boursorama                                                                                    | Caisse d'Epargne                            | ABN AMRO                                        |
| --------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------- |
| File            | CSV `;`, UTF-8 with BOM                                                                       | CSV `;`, ASCII (accents stripped), CRLF     | `.xls` (binary OLE), one sheet                  |
| Date            | `2026-10-30`, operation and value dates                                                       | `30/10/2026`, three dates                   | `20260820`, a number                            |
| Amount          | one signed column, decimal comma                                                              | two columns, debit and credit, explicit `+` | one signed number                               |
| Account         | number and name on every line                                                                 | none (only in the file name)                | number and currency on every line               |
| Label           | raw and cleaned                                                                               | short, long and extra information           | one structured string (`/TRTP/…/NAME/…/REMI/…`) |
| Bank category   | two levels                                                                                    | almost always "to categorise"               | none                                            |
| Line identifier | none                                                                                          | `Reference`, often empty                    | none                                            |
| Running balance | at the end of each day, the same on every line of the day (decimal point, unlike the amounts) | none                                        | start and end balance on every line             |

Consequences: one parser per bank layout, a spreadsheet reader for `.xls`, no reliable line identifier, and a running balance for two banks out of three.

## Statement reading (built)

A file is read in two layers, so the same code serves any bank:

- `packages/domain/src/statement.ts`: a **column mapping** (the columns by header text or position, the date format, the decimal separator, one signed amount or debit and credit columns) turns a table of cells into statement lines. A line that cannot be read is reported and left out; a file that lacks a mapped column is refused, which catches a file given to the wrong preset.
- `apps/api/src/statements/`: reads a CSV file into that table (encoding, delimiter, byte order mark), and holds the **presets** of the banks (Boursorama, Caisse d'Epargne so far; ABN AMRO waits for the `.xls` reader).

A first screen uses it: **Import a statement** in the book's menu. The user picks the account, the bank format and the CSV file; `POST /books/:bookId/statements/preview` reads it and returns the lines, the sum, the account numbers the file mentions, the lines it could not read, and the days whose balance does not follow. Nothing is saved: it is the base of the review screen.

**Batches** keep what was read. "Keep for review" stores the file as an `import_batch` (the account, the format, the file name, who added it) with one `import_line` per line: the fields read, the source cells, a status (to review, validated, ignored) and a **fingerprint**. A batch can be opened again, over several sittings, and deleted with its lines; the journal is not touched. A line is flagged **seen before** when an earlier batch of the same account holds the same fingerprint, so two overlapping exports do not double what they share. Batches are only visible to editors and owners of the book (row-level security), since a statement holds account numbers and labels.

**Review and import** (built). Opening a batch shows each line with what is decided for it: a **new entry** (a sub-category, a description that can be rewritten), an **existing entry** of the journal to reconcile, or **ignored**. Choosing a sub-category or an entry validates the line; several lines can be changed at once. The matching is the one of step 4, in its first form. An entry already **reconciled** is proposed for the **same amount** within **5 days** (`matchWindowDays`). A **forecast** (an entry that is not reconciled; the import concerns the journal, not the budgets) is proposed within **10 days** (`forecastWindowDays`) and, unless it is a side of a transfer, within **10 %** of its amount (`forecastTolerancePercent`, same sign). The best comes first: the exact amount, then the closest date, then a forecast. An entry is proposed to one line only, and never when another statement line already is it. The user can also **choose a forecast by hand** from the account's free forecasts (45 days around the statement), whatever its amount. A proposal is accepted one by one; "Accept the proposed matches" takes only those of the exact amount. The review warns about the **forecasts dated within the statement that no line is**: they are the likely duplicates. Transfers are not detected yet: a transfer already in the journal is found by this matching, otherwise the line is ignored and the transfer entered by hand.

**Import** writes the validated lines in one transaction (the batch is locked, so a double click cannot import it twice): a line with a sub-category becomes a reconciled entry (planned amount 0, `import_batch_id` set); a matched entry is reconciled and takes the bank's date and, for a forecast, the bank's amount (at its own exchange rate), except the side of a transfer, which keeps its date and amount. An entry keeps its planned amount only if it had one: an entry typed in the journal without being part of a plan has none, so its former amount is only kept for the undo (`previous_amount`). A line left in review stays in the batch. The **opening balance** is offered only when no line is left to review (a line imported later would be counted twice) and the statement has balances: the proposal is the statement's last balance minus the reconciled entries up to its date, the entries the batch matched, and the lines about to be imported; it is ticked only when the account has no entry. For an account in another currency the import takes one exchange rate.

**Undo.** "Undo the import" deletes the entries the batch created, gives the entries it reconciled their date, amount and flag back (each matched line keeps them in `previous_date`, `previous_amount` and `previous_reconciled`), and returns the lines to validated, so the batch can be changed or imported again. An entry the user deleted or changed since is left alone and counted. The opening balance is not restored.

Checked on a year of real statements: every line of both files is read. Boursorama's balance is the balance at the **end of the day**, so it checks the sum of a day, not of one line; it held on 165 of 167 day changes.

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

**Built.** A rule is an `import_rule` row of the book, edited in the **Rules** section of the import screen and tried in the order shown (up and down arrows); the first that fits wins. Conditions, all of which must hold: the text of the counterparty, label or memo (**contains**, ignoring case and accents), the bank category (contains), the account, the direction (money in or out), a minimum and a maximum size of the amount. Actions: a sub-category, a **payment type** (card, transfer, cash...), a rewritten description, or **ignore**. Rules are kept in the book, edited, reordered and deleted in the Rules section. A rule needs one condition and one action. Rules only **propose**: when a batch is kept, and on "Try the rules", the first rule that fits a line with nothing chosen sets its sub-category and description (or marks the line to ignore) and remembers the rule (`import_line.rule_id`); the line stays to review, and **Accept the proposals of the rules** validates them, which is choosing the sub-category. Trying again looks at every line still to review that has no entry and nothing the user typed: a line a rule had proposed something for follows the rules as they are now (and loses the proposal if none fits any more), while a change made by hand detaches the line from its rule. Deleting a rule takes back its proposals to lines not yet accepted. A line with a forecast to reconcile is not accepted in bulk: the match comes first. A rule whose sub-category is archived is skipped. From a line with a sub-category, **Create a rule** opens the form filled with its counterparty, and shows how many lines to review of the batch it fits; the rules are then tried on the batch. Not built: regular expressions (a pattern from the user would run on the server), the transfer action, and the count of journal entries a rule would touch.

The design intent:

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

Step 1 is built: the README, the architecture and the online help are updated with it. Step 2 is built except the `.xls` reader (ABN AMRO): reading, preview, batches, the review and the import into the journal are done. Step 3 is built in its first form (see [Rules](#rules)): rules with a text, bank category, account, direction and amount conditions, and a sub-category, description or ignore action; regular expressions and the transfer action wait.

## Open points

- The tolerance on amount and date to reconcile a forecast.
- Where the spreadsheet reader runs (browser or API) and which library.
- Whether the rules can be shared across books, or stay in one book.
- Which fields are required to create an account's identity (IBAN format check, masking in the interface).
