# Book export and import

Design notes from a brainstorm. Nothing here is built yet. The [architecture](../ARCHITECTURE.md#backup) gives the intent; this note fixes the decisions and splits the work into steps that can be delivered one by one.

## Goal

Copy one book, to the same instance or another one. This also restores one book without rolling back the others. Moving or restoring a whole instance stays the job of the database dump.

## Decisions

- **One JSON file** per book, carrying a format version.
- **The whole book** is exported.
- **Import always creates a new book.** It never merges into or overwrites a book. This narrows the "empty book" of the architecture: there is no book to create first.
- **To restore**, import beside the damaged book, compare, then delete the old one by hand.

## Content

| Part           | Tables                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------- |
| Book           | `book` (name, currency, default language), `book_language`                                          |
| Reference data | `category_group`, `nature`, `balance`, `balance_nature`, `category`, `sub_category`, `payment_type` |
| Accounts       | `book_account`, with opening balances                                                               |
| Journal        | `journal_entry`, `transfer`                                                                         |
| Budgets        | `category_budget`, `budget_settlement`                                                              |
| Import         | `import_rule`, `import_batch`, `import_line`                                                        |

Archived items are included.

The statements and their lines are part of the copy, although the architecture does not list them: their fingerprints are what marks a line as already seen. Without them, importing an overlapping statement into the copy would create duplicates. Keeping them also keeps "Undo the import" working.

Not exported: members and users. Whoever imports becomes the owner, and the author of a statement is left empty.

Schedules are not built yet. When they are, they join the export.

## Rules to confirm

Proposed during the brainstorm, not yet confirmed.

- Only an owner of the book can export it.
- **Identifiers** are new on import, and every reference is remapped, so a book can be imported next to its original.
- **Names:** the book name is proposed at import and can be changed.
- **Format version:** an older file is converted, a file newer than the application is refused with a clear message.
- **Safety:** the file is validated as untrusted input and written in one transaction. A failure leaves no partial book.
- **Exact values:** amounts and exchange rates are written as text, to lose no precision.
- **Interface:** "Export" in the book's menu, "Import a book" on the list of books.
- The file holds account numbers and bank labels in clear text; the online help says so.

## Steps

1. **Export.** Includes a test that fails when a table belonging to a book is neither exported nor explicitly excluded, so that a table added later is not forgotten.
2. **Import.** Includes a round-trip test: export, import, export again gives the same content (identifiers aside) and the same account balances.

Until step 2 is delivered, an exported file is not a backup: keep using the database dump.

## Out of scope for now

- Merging into an existing book, or importing part of a file.
- Structure only (reference data and rules, without entries): can be added later as an option, without a new format.
- "Duplicate this book" inside the application: a possible shortcut on the same code.
- Scheduled or automatic exports.
- CSV export of the journal for a spreadsheet: a separate need.

## Open points

- The largest file the import accepts.
- Whether creation and update dates are carried over (they should be, unless something relies on them being new).
