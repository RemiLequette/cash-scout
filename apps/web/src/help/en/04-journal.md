# Journal

The journal holds one entry per transaction, **past or future**, for the open book.

## An entry

| Field           | Notes                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------ |
| Date            | Year and month are derived from it                                                               |
| Account         | Its currency is the entry's currency                                                             |
| Sub-category    | Sets the category, group and nature                                                              |
| Description     | Free text                                                                                        |
| Amount          | **Signed**, as on the bank statement: −12.50 for a payment                                       |
| Exchange rate   | Shown when the account is not in the book's currency. Kept when saved, so past totals never move |
| Original amount | Optional, for information: what you really paid in another currency                              |
| Reconciled      | Matched with the bank statement. An entry that is not reconciled is a **forecast**               |

The category decides whether an amount is income or spending, never its sign.

## Budget month

An entry counts in the month of its date. When it falls just before or just after the month it belongs to (a salary paid on the 31st, a rent taken on the 2nd), tick **Count in …**: up to the 15th it counts in the month before, from the 16th in the month after. The journal says so next to its date (“→ Nov”).

- Budgets, the dashboard and the journal's period filter follow that month.
- Balances, the projection and reconciling always follow the date.
- When importing a statement moves a forecast to another month, the box is ticked for you, so that it stays in its month.
- If you change the date, the box stays ticked as long as the same month can be reached.

## Entering fast

- **New entry** opens the form. **Start from a frequent entry** proposes the entries you made yourself most often in the last 12 months (planned ones are left out), dated today. A new entry is ticked **Reconciled**: untick it to enter a forecast.
- The arrow of **New entry** also starts a **transfer** or a **compensation**.
- **Duplicate** copies an existing entry.
- **Mark reconciled** and **Mark as forecast** change the status of an entry from the list.

## Compensations

A **compensation** counts an amount in two sub-categories without any money moving. Example, in a shared book: a member pays 50 of groceries from their own account. **New entry ▾ › New compensation**, 50, with _Contribution_ in + and _Food_ in −.

- It shows as two lines, with a **±** mark, no account and nothing to reconcile.
- Open either line to change, duplicate or delete the whole compensation.
- The amount is positive, in the book's currency. For a refund, swap the two sub-categories.
- Both lines count in the totals and the dashboard, and use up the budget of their categories. No account balance moves.
- Sub-categories of a transfer category are not offered.
- Nothing is linked between books: in their own book, the member records their ordinary bank entry.

## Finding things

Filter by period (year, months), account, category, sub-category, status and free-text search. The account cards filter on an account. **Filters** opens the category and status choices; the status choice **Compensations** shows only the compensations. The header shows the income, spending and net of what is displayed. A line marks **today** between past and future entries.

## Forecasts and reconciling

Enter what you know is coming (rent, a bill) as a forecast. When the bank shows it, set the amount to the bank's and tick **Reconciled**. Forecasts feed the cash projection.

## Budget lines

At the end of each month budgeted in a category's grid, a computed **Budget** line shows what is still expected, on the budget's account (see [Budget](06-budget.md)). It cannot be edited; reconciling it lets the rest go.

A message above the journal reports the past entries that are not reconciled, Budget lines included.

## Account chart

At the bottom of the journal, a chart shows the balance of your accounts day by day, past and projected. Only the **account filter** acts on it. Change its start and length from its own controls, or hide it.

**Overdrafts are shown loudly**: the part under zero turns red, and a message gives, per account, the stretch of the overdraft and its lowest point.
