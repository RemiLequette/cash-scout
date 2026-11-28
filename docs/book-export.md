# Book export and import

Both are built: `apps/api/src/archive/`, with `GET /books/:bookId/export` and `POST /books/import`. The [architecture](../ARCHITECTURE.md#backup) gives the intent.

## Goal

Copy one book, to the same instance or another one. This also restores one book without rolling back the others. Moving or restoring a whole instance stays the job of the database dump.

## Decisions

- **One JSON file** per book, carrying a format version.
- **The whole book** is exported.
- **Import always creates a new book.** It never merges into or overwrites a book. This narrows the "empty book" of the architecture: there is no book to create first.
- **To restore**, import beside the damaged book, compare, then delete the old one by hand.

## Content

| Part           | Tables                                                                              |
| -------------- | ----------------------------------------------------------------------------------- |
| Book           | `book` (name, currency, default language), `book_language`                          |
| Reference data | `category_group`, `nature`, `balance`, `balance_nature`, `category`, `sub_category` |
| Accounts       | `book_account`, with opening balances                                               |
| Journal        | `journal_entry`, `transfer`, `compensation`, `split`                                |
| Loans          | `loan`, `loan_event`                                                                |
| Budgets        | `category_budget`, `budget_settlement`                                              |
| Import         | `import_rule`, `import_batch`, `import_line`                                        |

Archived items are included.

The statements and their lines are part of the copy, although the architecture does not list them: their fingerprints are what marks a line as already seen. Without them, importing an overlapping statement into the copy would create duplicates. Keeping them also keeps "Undo the import" working.

Not exported: members and users. Whoever imports becomes the owner, and the author of a statement is left empty.

Schedules are not built yet. When they are, they join the export.

## Rules

- Only an owner of the book can export it.
- **Identifiers** are new on import, and every reference is remapped, so a book can be imported next to its original. A reference to a row the file does not hold is refused.
- **Names:** the book name is proposed at import and can be changed.
- **Format version:** a file newer than the application is refused. A column added later takes its default when the file does not have it; a change that cannot be read this way raises the version and converts older files.
- **Payment types**, removed since, are left out of the files that hold them: their table, the entries' and lines' values, and the rules whose only action was one.
- **Virtual accounts**, removed since: an unused one is left out of the files that hold it; a file where one holds something is refused.
- **Safety:** the shape of the file is checked, and the database constraints apply; it is written in one transaction, so a failure leaves no partial book. The other business rules of the application are not checked again: a file edited by hand only affects the book it creates.
- **Exact values:** amounts and exchange rates are written as text, to lose no precision.
- **Dates** of creation and update are carried over; revision numbers start again.
- **Size:** a file up to 50 MB is accepted.
- **Interface:** "Export the book" in the menu of the book, "Import a book" on the list of books.
- The file holds account numbers and bank labels in clear text; the online help says so.

## Tests

`apps/api/src/archive.test.ts` fails when a table of a book is neither exported nor set apart, or when a reference between tables is not declared in `archive/tables.ts`. A round trip checks that export, import, export gives the same content (identifiers aside) and the same account balances.

## Out of scope for now

- Merging into an existing book, or importing part of a file.
- Structure only (reference data and rules, without entries): can be added later as an option, without a new format.
- "Duplicate this book" inside the application: a possible shortcut on the same code.
- Scheduled or automatic exports.
- CSV export of the journal for a spreadsheet: a separate need.
