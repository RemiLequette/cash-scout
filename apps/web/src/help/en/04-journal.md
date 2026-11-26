# Journal

The journal holds one entry per transaction, **past or future**, for the open book.

## An entry

| Field           | Notes                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------ |
| Date            | Year and month are derived from it                                                               |
| Account         | Its currency is the entry's currency                                                             |
| Sub-category    | Sets the category, group and nature                                                              |
| Description     | Free text                                                                                        |
| Payment type    | Card, transfer, cash…                                                                            |
| Amount          | **Signed**, as on the bank statement: −12.50 for a payment                                       |
| Exchange rate   | Shown when the account is not in the book's currency. Kept when saved, so past totals never move |
| Original amount | Optional, for information: what you really paid in another currency                              |
| Reconciled      | Matched with the bank statement. An entry that is not reconciled is a **forecast**               |

The category decides whether an amount is income or spending, never its sign.

## Entering fast

- **New entry** opens the form. **Start from a frequent entry** proposes the ones you use most in the last 12 months, dated today.
- **Duplicate** copies an existing entry.
- **Mark reconciled** and **Mark as forecast** change the status of an entry from the list.

## Finding things

Filter by period (year, months), account, category, sub-category, status and free-text search. The header shows the income, spending and net of what is displayed. A line marks **today** between past and future entries.

## Forecasts and reconciling

Enter what you know is coming (rent, a bill) as a forecast. When the bank shows it, set the amount to the bank's and tick **Reconciled**. Forecasts feed the cash projection.

## Budget lines

At the end of each month budgeted in a category's grid, a computed **Budget** line shows what is still expected, on the budget's account (see [Budget](06-budget.md)). It cannot be edited; reconciling it lets the rest go.

A message above the journal reports the past entries that are not reconciled, Budget lines included.

## Account chart

At the bottom of the journal, a chart shows the balance of your accounts day by day, past and projected. Only the **account filter** acts on it. Change its start and length from its own controls, or hide it.

**Overdrafts are shown loudly**: the part under zero turns red, and a message gives, per account, the stretch of the overdraft and its lowest point.
