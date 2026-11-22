# cash-scout

A personal finance tool for households: a transaction journal, budgets, a forward cash projection, and reporting. Multilingual (English and French first, any language can be added), open source and self-hosted.

## Objectives

Every feature and decision below serves at least one of these objectives.

| Id     | Objective               | What it means                                                                                   |
| ------ | ----------------------- | ----------------------------------------------------------------------------------------------- |
| **O1** | **Plan**                | Make a yearly budget, with targets that balance income, spending and saving.                    |
| **O2** | **Project forward**     | Avoid overdrafts by projecting each account's balance, especially across several bank accounts. |
| **O3** | **Control and analyse** | Compare actuals with the plan to improve savings and plan the next period better.               |

## Scope

- A journal of past and future transactions, reconciled against the bank (O2, O3).
- Yearly budgets with a saving target, and scheduled predictable transactions (O1, O2).
- A cash projection per account (O2).
- Pivot views and reports (O3).
- Several users, each working in separate **books**, some private and some shared (O1–O3 for a household as well as for each person).
- Open source in a public repository; self-hosted with Docker on a private server (virtual machine or home server).

Out of scope for now: assets, loans, net worth, property, simulators.

## Origin

cash-scout replaces Google Sheets with the same structure, used since 2014: one for a person's private finances, one for the household's shared finances, and one used while living abroad, kept in the local currency with every entry also converted to euros. Each has its own journal, its own reference data and the same reports. Contributions from the private side to the household are typed twice, once in each sheet. This README describes only their structure; personal data never goes into this repository.

The sheets work well. cash-scout exists to remove their two limits:

| Limit of the sheets                                                                                                                                   | What cash-scout does instead                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Brittle formulas, repeated on every row**: year, month, category, group and direction are looked up per row, and helper columns feed other formulas | Derived values are computed by the application from the date and the sub-category, never stored per row. Reports query the journal directly.                                                                                                                                                                         |
| **Tedious, error-prone entry**: rows are copied by hand, it takes discipline, and bank exports cannot be loaded                                       | Bank exports are imported with rules that set the sub-category from the label, and matched against scheduled entries. Manual entry gets autocomplete, duplication of a past entry, and validation against the book's reference data. Schedules generate future entries. Linked entries are typed once for two books. |

## Books

A **book** (_livre_ in French) is a fully separate set of finances, like a _mandant_ in SAP. All books live in the same database, but each has its own:

- journal entries, schedules and budgets;
- accounts;
- reference data: groups, categories, sub-categories, payment types, budget profiles, import profiles.

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

| Field           | Notes                                                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | Year and month are derived from it, not stored                                                                                                  |
| Account         | One of the book's accounts; its currency is the entry's currency                                                                                |
| Sub-category    | Sets the category, the group and the direction                                                                                                  |
| Description     | Free text, from the bank label on import                                                                                                        |
| Payment type    | Card, transfer, direct debit, cash, ATM, cheque, deposit, fees…                                                                                 |
| Amount          | Signed, in the account's currency. The expected amount until reconciled, then the bank amount                                                   |
| Book amount     | The amount in the book's currency, at the entry's exchange rate. Same as the amount when the account is in the book's currency                  |
| Original amount | Optional, for information: amount and currency actually paid, for example a purchase in US dollars paid from a ringgit account                  |
| Planned amount  | The amount first planned. Set equal to the amount when the entry is created, then never changed; the difference with the amount is the variance |
| Reconciled      | Matched with the bank statement. An unreconciled entry is a **forecast**                                                                        |
| Schedule        | The schedule that generated the entry, if any                                                                                                   |
| Link            | The matching entry in another book, if any                                                                                                      |

**Categories** have three levels: group → category → sub-category. A category has a short code (`C01`, `P02`…) that sets its sort order. Each category has a **direction** (expense, income or transfer); transfers between a book's own accounts are left out of spending totals.

**The category decides, not the sign.** An amount's sign never says whether it is income or spending: a tax withheld is negative income, a refund or a health insurance reimbursement is positive spending. Reports add signed amounts within each category and take the direction from the category. Import rules and entry helpers never pick a category from the sign alone.

### Reference data

- A new book starts with **empty** reference data. Each book has its own, at the level of detail its users want: a household book may split food into bakery, butcher, supermarket…, while a private book keeps one food sub-category.
- **Multilingual names**: a book lists its languages and its default language. Groups, categories, sub-categories, accounts and payment types can have a name in each of them; each member sees them in their own interface language, or in the book's default language when a translation is missing. A household whose members speak different languages shares one set of categories, each person reading it in their own language. Codes, rules and reports work on the item, never on its name.
- **Maintenance** has to be easy: create, rename, recode, move a sub-category to another category, merge two of them, archive what is no longer used. Moving or merging reassigns the existing entries; reports follow.
- **Initialization from the existing sheets**: their reference lists (sub-category, category, group, direction, payment types, accounts) are imported first, then their journals.

### Entering transactions

Two ways of working, both supported:

- **Manual entry**, preferred by some users: entry helpers are needed to make it fast and safe. They are to be designed in a later session.
- **Bank statement import**, preferred by others: when a statement has labels no rule knows, cash-scout helps classify them, creates missing sub-categories on the way, and turns each choice into a **rule** reused on future statements.

**Adjustments**: an opening balance or correction entry per account, so account balances match the bank.

**Import**: CSV, OFX and QIF bank exports, with a saved column mapping per account and rules that set the sub-category from the bank label. An imported line that matches an unreconciled entry (same account, close date and amount) reconciles it instead of creating a new one. Importing the existing sheets' journals is the first migration path.

### Currencies

- A book has a **book currency**. Budgets, the yearly balance and reports are in it.
- Each account has its **own currency**. An entry is recorded in its account's currency, with its **book amount** at an exchange rate that is suggested from the rates table and can be corrected to the bank's real rate. Once saved, the rate does not change, so past totals never move.
- A transfer between accounts in two currencies keeps both amounts, which gives the real rate.
- A book may set a **display currency**: reports can then be read in it as well, converted at each period's average rate.
- **Rates** are loaded daily from a public source (European Central Bank reference rates) and can be entered by hand.

## Budgets and cash projection

cash-scout keeps two kinds of plans, as the spreadsheets do, but stops using journal tricks for the second one.

### Scheduled entries: predictable transactions

Income, taxes, utilities, rent, subscriptions: transactions whose date and amount are roughly known in advance.

- They are **future entries in the journal**, unreconciled until the bank shows them. They feed the cash projection directly.
- The **planned amount** is set equal to the amount when the entry is created, then **never changes**: it is the budget. Only the amount moves: it is updated as more is known, which changes the cash projection (O2), and set to the bank amount on reconciliation. The variance, amount − planned amount, shows how far reality drifted from the original plan (O3).
- Example: an electricity bill scheduled at −120 is announced at −135, then debited at −138. The planned amount stays −120 and the amount goes −120 → −135 → −138, so the projection follows and the final variance is −18.
- Changing a schedule rewrites the amount _and_ planned amount of its future, unreconciled entries, since that is a new plan.
- A **schedule** (monthly, quarterly, yearly, on a given day) generates them over a horizon, such as the next 12 months, instead of copying rows. Changing a schedule updates its future unreconciled entries.

### Period budgets: spending without a fixed date

Food, outings, holidays, shopping: spending that happens in many small amounts. These are **not journal entries** any more; a budget is its own object, and reports and the projection compute from it.

A budget has:

| Element            | Meaning                                                                         | Examples                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scope              | The categories or sub-categories that consume it                                | Food; Holidays                                                                                                                                                                       |
| Year and amount    | An annual amount                                                                | 3,600 a year                                                                                                                                                                         |
| Profile            | How the annual amount is spread over periods. Profiles are reusable in the book | Even over 12 months; 70 % in July–August, the rest even; one amount in December                                                                                                      |
| Period             | The unit of allocation                                                          | Month (default), quarter, year                                                                                                                                                       |
| Carry-over rule    | What happens to unspent or overspent budget at the end of a period              | **Lapse**: unused food budget is lost each month. **Roll over**: unused outing budget moves to the next period. **Annual pool**: holiday budget can be spent at any time in the year |
| Projection account | The account where the remaining budget is expected to be spent                  | Current account                                                                                                                                                                      |

Consumption: every journal entry in the budget's scope and period consumes it. **Remaining = allocated (after carry-over) − consumed.**

Consumption counts every entry, scheduled or not: a scheduled entry in a budget's scope (for example a holiday deposit) consumes that budget, so nothing is counted twice.

Next year's budgets start as a copy of this year's (or from this year's actuals), then are adjusted.

### Yearly balance (O1)

The year's plan is checked as a whole: planned income (scheduled entries and income budgets) − planned spending (scheduled entries and spending budgets) = planned saving, compared with the book's **saving target** for the year. During the year, the same balance is shown with actuals to date plus what remains planned.

### Cash projection

For each account, in **the account's currency**, the expected daily balance is: reconciled entries + unreconciled (scheduled) entries + the **remaining** period budgets, spread over what is left of each period on their projection account. Past periods count nothing: what was not spent is gone, or has moved to a later period by its carry-over rule.

## Reports

- **Yearly balance** (O1, O3): income, spending and saving, planned against actual, with the saving target.
- **Pivot view** (O3): rows by group, category, sub-category, account or payment type; columns by month, quarter or year; measures: actual, planned, budget allocated, consumed, remaining, variance. Expand and collapse levels, filter by period, account and reconciled status, export to CSV.
- **Year dashboard** (O3): per category, month by month: annual total, monthly average, current month against its budget, year to date against the annual budget, comparison with the previous year.
- **Budget planning** (O1): next year's budgets and scheduled entries per category and month, against this year.
- **Multi-year history** (O3): totals per group and category per year, with charts.
- **Cash projection** (O2): daily balance of each account, with a "today" marker and the lowest point ahead; a warning when an account is projected to go below zero or below a threshold set per account.

## Decisions

Functional decisions. Technical choices are in [ARCHITECTURE.md](ARCHITECTURE.md).

| Topic                    | Decision                                                                                                                                                           | Serves                             | Notes                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Separation               | Books: fully separate data and reference data in one database                                                                                                      | O1–O3 per person and per household | Every table carries the book; the API checks membership on every request                                                               |
| Between books            | Linked entries, entered once                                                                                                                                       | O2, O3                             | Contributions appear in both books' projections and reports without double entry                                                       |
| Virtual accounts         | Non-bank accounts per book, out of the projection, for zero-sum compensations; usable in linked operations                                                         | O1, O3                             | Covers common spending paid from a private account, without a fake bank movement                                                       |
| Roles                    | Owner, editor, viewer per book; one super user                                                                                                                     | — (security)                       |                                                                                                                                        |
| Predictable transactions | Scheduled future entries in the journal, with amount and planned amount, reconciled against the bank                                                               | O2, O1, O3                         | Generated by schedules; the planned amount is fixed at creation, only the amount changes; variance = amount − planned amount           |
| Other spending           | Period budgets outside the journal: annual amount, profile, period, carry-over rule                                                                                | O1, O2, O3                         | Replace the special budget entries of the sheets                                                                                       |
| Reference data           | Empty in a new book, own level of detail per book, easy maintenance (move, merge, archive), imported from the sheets at initialization                             | O1, O3                             | Detail where the book needs it to plan and analyse                                                                                     |
| Direction                | Set by the category, never by the sign                                                                                                                             | O1, O3                             | Negative income and positive spending are normal                                                                                       |
| Entry                    | Manual entry with helpers, and statement import that builds reusable rules                                                                                         | O2, O3                             | Both keep the journal complete and correct                                                                                             |
| Currencies               | Book currency for budgets and reports, currency per account, fixed rate per entry, optional display currency, daily public rates                                   | O1, O2, O3                         | Projection per account in its own currency; analysis in one currency                                                                   |
| Per-person spending      | Not a dimension inside a book: a member's own spending goes in their own book                                                                                      | O3                                 | Keeps books simple; linked entries cover contributions. A virtual common book is a possible [future improvement](#future-improvements) |
| No double counting       | Scheduled entries consume the period budget of their scope                                                                                                         | O1, O2                             |                                                                                                                                        |
| Saving target            | A yearly target per book, checked against planned and actual saving                                                                                                | O1, O3                             |                                                                                                                                        |
| Bank data                | File import first: CSV, OFX, QIF, matched against scheduled entries                                                                                                | O2, O3                             | Reconciled balances are the starting point of the projection; bank sync can come later                                                 |
| Interface languages      | Clean i18n from the start: no text in the code, one message file per language, dates, numbers and currencies formatted by locale. English and French shipped first | — (users)                          | A new language is added by contributing a message file, without code changes; each user picks their language                           |
| Book languages           | Each book lists the languages of its reference data, with a default one                                                                                            | — (users)                          | Members of a multilingual household each read the book's categories in their own language                                              |
| Technical stack          | TypeScript monorepo, Hono + Drizzle on PostgreSQL, React + Mantine, Docker Compose, MIT license                                                                    | — (technical)                      | Details in [ARCHITECTURE.md](ARCHITECTURE.md)                                                                                          |
| Devices                  | Responsive web app for desktop and mobile, installable as a PWA, always online                                                                                     | O2, O3                             | Manual entry happens on the phone too                                                                                                  |

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

- Migration: the sheets' special budget entries become period budgets; the sheets' _budget_ column becomes the planned amount.
- Entry helpers for manual entry (to be designed in a later session).
- Whether a user can see a combined view across their books (for example private + household), or each book is always viewed alone.
