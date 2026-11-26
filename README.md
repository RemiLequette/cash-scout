# cash-scout

A personal finance tool for households: a transaction journal, budgets, a forward cash projection, and reporting. Multilingual (English and French first, any language can be added), open source and self-hosted.

## Objectives

Every feature and decision below serves at least one of these objectives.

| Id     | Objective               | What it means                                                                                   |
| ------ | ----------------------- | ----------------------------------------------------------------------------------------------- |
| **O1** | **Plan**                | Make a yearly budget for income, spending and saving, and see what it does to the accounts.     |
| **O2** | **Project forward**     | Avoid overdrafts by projecting each account's balance, especially across several bank accounts. |
| **O3** | **Control and analyse** | Compare actuals with the plan to improve savings and plan the next period better.               |

## Scope

- A journal of past and future transactions, reconciled against the bank (O2, O3).
- Yearly budgets, with saving budgeted as a category of its own, and scheduled predictable transactions (O1, O2).
- A cash projection per account (O2).
- Pivot views and reports (O3).
- Several users, each working in separate **books**, some private and some shared (O1–O3 for a household as well as for each person).
- Open source in a public repository; self-hosted with Docker on a private server (virtual machine or home server).

Out of scope for now: assets, loans, net worth, property, simulators.

## Origin

cash-scout replaces Google Sheets with the same structure, used since 2014: one for a person's private finances, one for the household's shared finances, and one used while living abroad, kept in the local currency with every entry also converted to euros. Each has its own journal, its own reference data and the same reports. Contributions from the private side to the household are typed twice, once in each sheet. This README describes only their structure; personal data never goes into this repository.

The sheets work well. cash-scout exists to remove their two limits:

| Limit of the sheets                                                                                                                                | What cash-scout does instead                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Brittle formulas, repeated on every row**: year, month, category, group and nature are looked up per row, and helper columns feed other formulas | Derived values are computed by the application from the date and the sub-category, never stored per row. Reports query the journal directly.                                                                                                                                                                       |
| **Tedious, error-prone entry**: rows are copied by hand, it takes discipline, and bank exports cannot be loaded                                    | Bank exports are imported with rules that set the sub-category from the label, and matched against planned entries. Manual entry gets autocomplete, duplication of a past entry, and validation against the book's reference data. Schedules generate future entries. Linked entries are typed once for two books. |

## Books

A **book** (_livre_ in French) is a fully separate set of finances, like a _mandant_ in SAP. All books live in the same database, but each has its own:

- journal entries, schedules and budgets;
- accounts;
- reference data: groups, categories, sub-categories, payment types, import profiles.

Nothing is shared between books unless it is explicitly linked. A typical setup is one private book per person plus one household book.

### Users and roles

- A user is attached to one or more books, with a role in each:
  - **owner**: manages the book's members and reference data;
  - **editor**: enters transactions and budgets;
  - **viewer**: reads only.
- A book with a single member is private; a book with several is shared.
- A **super user** maintains the installation: users, books, global settings. The super user does not see a book's data without being a member.

### Linked entries between books

Some operations involve two books, such as a contribution from a private book to the household book. It is entered **once**:

- cash-scout creates the matching entry in the other book (outgoing on one side, incoming on the other);
- each side uses its own account and category, picked from its own reference data, with a default per pair of books;
- the two entries stay linked: changing or deleting one updates or flags the other;
- the user needs editor rights on both books.

A book can define **book links** (for example "private → household: contribution") that set the default accounts and categories on each side.

### Virtual accounts and compensations

Not every operation moves money in each book. In the sheets, some are recorded as pairs of **virtual** entries that add up to zero. cash-scout makes this explicit:

- A book can have **virtual accounts**: not tied to a bank, never reconciled, left out of the cash projection. Their balance should come back to zero; a report flags those that don't.
- A **compensation** is a set of entries on a virtual account whose sum is zero. It moves an amount from one category to another without touching any bank balance.
- A linked operation can use a virtual account on either side. Example: a household expense of 100 paid from a private card.
  - Private book: the card line (−100, bank account) is classified as _contribution to the household_.
  - Household book: a compensation on its virtual account, _food_ −100 and _contribution received_ +100.
  - Result: the household's budget sees the food spending and the contribution; the private book sees a contribution; only the private bank balance changes, as in reality.
- Such operations are entered once, from a **book link** template ("paid for the household from a private account"), like other linked entries.

## Journal

One entry per transaction, past or future, in a book:

| Field           | Notes                                                                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | Year and month are derived from it, not stored                                                                                                                                                                       |
| Account         | One of the book's accounts; its currency is the entry's currency                                                                                                                                                     |
| Sub-category    | Sets the category, the group and the nature                                                                                                                                                                          |
| Description     | Free text, from the bank label on import                                                                                                                                                                             |
| Payment type    | Card, transfer, direct debit, cash, ATM, cheque, deposit, fees…                                                                                                                                                      |
| Amount          | Signed, in the account's currency. The expected amount until reconciled, then the bank amount                                                                                                                        |
| Book amount     | The amount in the book's currency, at the entry's exchange rate. Same as the amount when the account is in the book's currency                                                                                       |
| Original amount | Optional, for information: amount and currency actually paid, for example a purchase in US dollars paid from a ringgit account                                                                                       |
| Planned amount  | The amount planned for an entry made in the budget's plan, 0 for an entry made in the journal. Changed only in the budget; the difference with the amount is the variance, shown only when there is a planned amount |
| Reconciled      | Matched with the bank statement. An unreconciled entry is a **forecast**                                                                                                                                             |
| Schedule        | The schedule that generated the entry, if any                                                                                                                                                                        |
| Transfer        | The transfer this entry is one side of, and which side, if any                                                                                                                                                       |
| Link            | The matching entry in another book, if any                                                                                                                                                                           |

**Categories** have three levels: group → category → sub-category. A category has a short code (`C01`, `P02`…) that sets its sort order, and belongs to a **nature** (see below). Money that leaves the book's accounts for assets the book does not track, such as a life insurance, is a category like any other, and a negative amount in it is a withdrawal. A movement between two accounts of the book is a **transfer**: it uses a category of a nature marked as holding transfers, and is left out of the totals.

**Natures and balances.** Each category belongs to a **nature** of the book (Income, Spending, Savings, Exceptional…): a name per language and a sign. The sign sets how the nature reads: reversed, spending reads as positive, in the [year dashboard](#year-dashboard) and in the budgets. A nature can also be marked as holding transfers between the book's own accounts. A new book starts with four natures (Income, Spending, Savings, Transfers); the book adds its own, for instance an _Exceptional_ nature. A **balance** is an analytic subtotal, the sum of the amounts as entered of the natures it lists: a _current balance_ adds income and spending, a _total balance_ adds exceptional spending too, and savings can stay outside any balance. Natures and balances form one list in an order the book chooses, which is the order of the dashboard.

**The category decides, not the sign.** An amount's sign never says whether it is income or spending: a tax withheld is negative income, a refund or a health insurance reimbursement is positive spending. Reports add signed amounts within each category and read them with the sign of the category's nature. Import rules and entry helpers never pick a category from the sign alone.

### Reference data

- A new book starts with **empty** reference data. Each book has its own, at the level of detail its users want: a household book may split food into bakery, butcher, supermarket…, while a private book keeps one food sub-category.
- **Multilingual names**: a book lists its languages and its default language. Groups, categories, sub-categories, accounts and payment types can have a name in each of them; each member sees them in their own interface language, or in the book's default language when a translation is missing. A household whose members speak different languages shares one set of categories, each person reading it in their own language. Codes, rules and reports work on the item, never on its name.
- **Maintenance** has to be easy: create, rename, recode, move a sub-category to another category, merge two of them, archive what is no longer used. Moving or merging reassigns the existing entries; reports follow.
- **Initialization from the existing sheets**: their reference lists (sub-category, category, group, nature, payment types, accounts) are imported first, then their journals.

### Entering transactions

Two ways of working, both supported:

- **Manual entry**, preferred by some users: entry helpers are needed to make it fast and safe. They are to be designed in a later session.
- **Bank statement import**, preferred by others: when a statement has labels no rule knows, cash-scout helps classify them, creates missing sub-categories on the way, and turns each choice into a **rule** reused on future statements.

**Opening balance**: each account has an opening balance, set in its reference data, so that account balances match the bank. It holds whatever no entry explains (what came before the first entry, and any gap), is not dated, and sits in no category: no total, budget or dashboard line counts it. It is set from the balance read in the bank, so that the reconciled entries add up to it. There is no "adjustment" entry.

**Import**: CSV, OFX and QIF bank exports, with a saved column mapping per account and rules that set the sub-category from the bank label. An imported line that matches an unreconciled entry (same account, close date and amount) reconciles it instead of creating a new one. Importing the existing sheets' journals is the first migration path.

### Transfers

A **transfer** moves money between two accounts of a book. It is two journal entries, a **source** (negative) and a **destination** (positive), that are created, changed and deleted together.

- **Delay**: the transfer has a date, the source's, and a delay in days (0 to 60). The destination is dated the source's date plus the delay. Changing the date of the transfer moves both sides; changing the delay moves only the destination.
- **One change, two entries**: the amount, the accounts, the sub-category, the description and the payment type are edited on the transfer, never on one side. A side opened from the journal opens the whole transfer. Only reconciling is a side's own: each side is matched with its own bank statement line.
- **Currencies**: between accounts of the same currency one amount is entered. Between two currencies both amounts are kept, which gives the real rate; each account not in the book currency also has its rate into it, as for any entry.
- **Sub-category**: a sub-category of a category of a _transfer_ nature, so both sides are left out of the totals.
- **Planning**: a transfer can be part of the budget's plan, from the list of planned entries. Both sides then get a planned amount equal to their amount, which add up to zero, and the cash projection sees them on their own dates and accounts. A transfer category has no grid: it changes no total.
- **Between books** is another operation, the [linked entries](#linked-entries-between-books).

### Currencies

- A book has a **book currency**. Budgets, the yearly balance and reports are in it.
- Each account has its **own currency**. An entry is recorded in its account's currency, with its **book amount** at an exchange rate that is suggested from the rates table and can be corrected to the bank's real rate. Once saved, the rate does not change, so past totals never move.
- A transfer between accounts in two currencies keeps both amounts, which gives the real rate.
- A book may set a **display currency**: reports can then be read in it as well, converted at each period's average rate.
- **Rates** are loaded daily from a public source (European Central Bank reference rates) and can be entered by hand.

## Budgets and cash projection

A book plans each year category by category. The design notes are in [Budget planning](docs/budget-planning.md).

Any category can be budgeted in two ways, which **add up**:

- **planned entries**: future entries of the journal, each with a planned amount, unreconciled until the bank shows them;
- a **grid**: an amount per month, in the book's currency and read with the sign of the category's nature, for money budgeted without saying which entries will spend it.

The budget of a month is its grid amount plus the planned amounts of its entries. A transfer category has no grid.

### Category budget

One per category and year: the **12 monthly amounts**, free-text **assumptions**, and the **account** the budget should be spent from, with its exchange rate into the book currency. The account is required as soon as a month is not zero, so that overdrafts can be anticipated. Budgets of every past year are kept; no history of revisions is.

### Planned entries and variance

- An entry created as part of the plan gets a **planned amount** equal to its amount. The amount then moves as more is known and takes the bank's on reconciliation.
- An entry made in the journal has a planned amount of **0**: it was not part of the plan.
- The variance, amount − planned amount, shows how far reality drifted from the plan (O3).
- A **schedule** (monthly, quarterly, yearly, on a given day) will generate entries instead of copying rows.

### Budget lines

For every month whose grid amount is not zero, the journal shows a **budget line** on the month's last day, on the budget's account, under a sub-category called Budget.

- It is **virtual**: computed, not stored. Its planned amount is the grid amount; its amount is what the month's **unplanned** entries (planned amount 0) have not used, never past zero. A refund raises it.
- **Reconciling** is the only action: it sets the line to 0 and locks the month's grid amount. It can be taken back.
- Each month stands alone: until its line is reconciled, what remains is expected, past months included.
- It follows the journal's period, account, category and status filters, but not its text search.
- A message above the journal reports the past entries that are not reconciled, budget lines included.

### Yearly balance (O1)

Planned income, spending and saving are the grids plus the planned amounts of the year's entries. Saving is budgeted like any other category; an amount may be negative, for a planned withdrawal. The plan is not meant to balance to zero: planned income − planned spending − planned saving is the **planned change of the book's accounts**, shown for information.

### Cash projection

For each account, in **the account's currency**, the expected daily balance is: the entries, reconciled or not, plus the budget lines that are not reconciled.

### Account chart

A section at the bottom of the journal, which can be hidden, charts the balance of the accounts day by day. Only the **account filter** acts on it; the journal's period, category, status and search do not. By default it is the cash projection over 4 months from the start of the current month, for every bank account; the start and the length can be changed.

- The balance counts reconciled and unreconciled entries, and the budget lines.
- **Overdrafts are shown loudly**: the part of a line under zero is red over a red band, and a message gives, per account, the stretch of the overdraft and its lowest point.
- Accounts in different currencies each get their own chart, since their amounts are not comparable.

## Reports

- **Yearly balance** (O1, O3): income, spending and saving, planned against actual.
- **Pivot view** (O3): rows by group, category, sub-category, account or payment type; columns by month, quarter or year; measures: actual, planned, budget allocated, consumed, remaining, variance. Expand and collapse levels, filter by period, account and reconciled status, export to CSV.
- **Year dashboard** (O3): per category, month by month, for a chosen year; see [Year dashboard](#year-dashboard).
- **Budget planning** (O1): next year's budgets and scheduled entries per category and month, against this year.
- **Multi-year history** (O3): totals per group and category per year, with charts.
- **Cash projection** (O2): daily balance of each account, with a "today" marker and the lowest point ahead; a warning when an account is projected to go below zero or below a threshold set per account.

### Year dashboard

A page for reading and analysing one year, replacing the yearly tabs of the sheets. It never changes data. Everything is in the book currency.

- **Year**: a selector; the same page serves the current year, a past one and a year being budgeted.
- **Columns**: the 12 months and the year's total. Summary columns (monthly average, budget, percentage of budget, previous year) come later.
- **Rows**: the book's natures and balances in the order it set. A nature opens on its groups (which nest), categories and sub-categories, each level expandable and collapsible, with an expand-all and a collapse-all; a group that carries categories of several natures appears under each. A row is the sum of what it contains, shown with its nature's sign. A balance is one line, the sum of its natures as entered; it adds a nature wherever the nature sits in the list. A row with nothing in the selected year (no entry, no budget allocation) is hidden, and so is a group, a nature or a balance left empty. Transfers are left out, as in every total; control lines of the sheets are not rows.
- **Cell**: the sum of the month's entries, reconciled or not, and of the category's budget line. Future values are shown differently from past ones.
- **Budget**: under an expanded category, a line carries its budget lines, so that its sub-categories and this line add up to the category. The detail panel lists them with the entries.
- **Account balances**: a block under the categories, with one line per bank account and a total, giving the balance at the end of each month. It is the sum of the entries' book amounts up to that date, adjustments included, and it is not revalued at today's rate. For future months it is the projected balance of the [cash projection](#cash-projection). Virtual accounts are left out.
- **Detail panel**: a section at the bottom, resizable and hideable, lists the entries behind the selected cell: a row and a month, a row's year total, or an account's month. Its columns are the journal's, it is read-only, and each entry links to the journal.
- **Access**: any member of the book, viewers included.

## Decisions

Functional decisions. Technical choices are in [ARCHITECTURE.md](ARCHITECTURE.md).

| Topic               | Decision                                                                                                                                                           | Serves                             | Notes                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Separation          | Books: fully separate data and reference data in one database                                                                                                      | O1–O3 per person and per household | Every table carries the book; the API checks membership on every request                                                               |
| Between books       | Linked entries, entered once                                                                                                                                       | O2, O3                             | Contributions appear in both books' projections and reports without double entry                                                       |
| Virtual accounts    | Non-bank accounts per book, out of the projection, for zero-sum compensations; usable in linked operations                                                         | O1, O3                             | Covers common spending paid from a private account, without a fake bank movement                                                       |
| Roles               | Owner, editor, viewer per book; one super user                                                                                                                     | — (security)                       |                                                                                                                                        |
| Two ways to budget  | Planned entries and a monthly grid, which add up; only unplanned entries consume the grid                                                                          | O1, O2, O3                         | One plan per entry, so nothing is counted twice                                                                                        |
| Planned entries     | Future entries in the journal with a planned amount; unplanned entries have a planned amount of 0                                                                  | O2, O1, O3                         | Variance = amount − planned amount, unplanned spending included                                                                        |
| Reference data      | Empty in a new book, own level of detail per book, easy maintenance (move, merge, archive), imported from the sheets at initialization                             | O1, O3                             | Detail where the book needs it to plan and analyse                                                                                     |
| Nature              | Set by the category, never by the sign                                                                                                                             | O1, O3                             | Negative income and positive spending are normal                                                                                       |
| Entry               | Manual entry with helpers, and statement import that builds reusable rules                                                                                         | O2, O3                             | Both keep the journal complete and correct                                                                                             |
| Currencies          | Book currency for budgets and reports, currency per account, fixed rate per entry, optional display currency, daily public rates                                   | O1, O2, O3                         | Projection per account in its own currency; analysis in one currency                                                                   |
| Per-person spending | Not a dimension inside a book: a member's own spending goes in their own book                                                                                      | O3                                 | Keeps books simple; linked entries cover contributions. A virtual common book is a possible [future improvement](#future-improvements) |
| Budget lines        | Virtual month-end entries holding what the grid still expects, reconciled to let it go                                                                             | O1, O2, O3                         | The journal and the projection show the budget without storing entries                                                                 |
| Budget revisions    | One amount per category budget, revised freely; past years kept, no history of revisions; free-text assumptions per category and year                              | O1, O3                             | A household tool, not an accounting system                                                                                             |
| Bank data           | File import first: CSV, OFX, QIF, matched against planned entries                                                                                                  | O2, O3                             | Reconciled balances are the starting point of the projection; bank sync can come later                                                 |
| Interface languages | Clean i18n from the start: no text in the code, one message file per language, dates, numbers and currencies formatted by locale. English and French shipped first | — (users)                          | A new language is added by contributing a message file, without code changes; each user picks their language                           |
| Book languages      | Each book lists the languages of its reference data, with a default one                                                                                            | — (users)                          | Members of a multilingual household each read the book's categories in their own language                                              |
| Technical stack     | TypeScript monorepo, Hono + Drizzle on PostgreSQL, React + Mantine, Docker Compose, MIT license                                                                    | — (technical)                      | Details in [ARCHITECTURE.md](ARCHITECTURE.md)                                                                                          |
| Devices             | Responsive web app for desktop and mobile, installable as a PWA, always online                                                                                     | O2, O3                             | Manual entry happens on the phone too                                                                                                  |

## Future improvements

Not planned for the first versions, but the design should not rule them out.

### Virtual common book

For households without a joint bank account, where each member pays shared spending from their own accounts.

- A **virtual book** has members and its own reference data, but **no bank account**.
- A member marks an entry of their private book as **shared** with a virtual book and picks its category there. The entry stays in the private book, with its account and reconciliation; the virtual book only sees the shared part.
- The virtual book then has its own budgets and reports over all shared spending, whoever paid it.
- It also shows **who paid what** and the balance between members, with optional sharing ratios (for example 50/50 or by income), and settling transfers as linked entries.
- Each private book stays private: the other members see only what was shared.

Today this is done by mixing everyone's spending in one book with a "for whom" column, which hides each person's accounts and makes the shared total hard to see.

## Open questions

- Entry helpers for manual entry (to be designed in a later session).
- Whether a user can see a combined view across their books (for example private + household), or each book is always viewed alone.
