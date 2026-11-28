# Loans

**Loans** in the menu lists the loans of the book. A loan holds its terms and its events; its **schedule** is computed from them, never typed. From it, the loan plans its payments in the journal, so the budget and the cash projection see them.

## Terms

- **Payment account**: the account the payments are taken from. The loan is in its currency.
- **Amount borrowed**, **yearly rate** (nominal: a month's interest is a twelfth of it) and **number of monthly payments**, deferred ones included.
- **First payment**: the date of the first payment; the next ones fall on the same day of each month (the last day of a shorter month).
- **Insurance**: none, a rate on the capital borrowed (the insurance stays the same), or a rate on the remaining capital (it falls with it).
- **Deferral**: for the first months, either **interest only** (no capital is repaid), or **nothing paid** (the interest joins the capital).
- **Sub-categories** of the capital, the interest and the insurance. Repaying capital is saving: choose a sub-category of a category of a **saving** nature for it, and spending ones for the interest and the insurance. Transfer categories are not offered.

Payments are constant: the interest is computed on the capital left, and the rest of the payment repays capital. The last payment takes what is left. A bank's own rounding or day count can differ by a few cents.

## Events

An event changes the schedule from its date. It counts after the payment of the same day.

- **Drawdown**: capital released in steps, as in a purchase off plan. As soon as a loan has drawdowns, only what they release is borrowed; their total cannot exceed the amount.
- **Early repayment**: an amount, or all that is left. For a part, choose what it **keeps**: the payment (the loan is shorter) or the term (the payment is lower).
- **Buy-back**: the loan is repaid in full by another one. Enter the new loan as a loan of its own. The new lender pays the old one, so no payment is planned for the buy-back.

## Remaining capital

The list gives the capital left at the date you choose (today by default), the next payment and the last one.

The capital repaid in the journal is checked against the schedule, month by month, over the months the journal covers: from the first entry in the capital sub-category to the last month reconciled on the payment account. A gap of more than one unit of the currency is flagged on the list and on the loan. Several loans sharing a capital sub-category are compared together.

## Planning a year

Choose the loan and the year, then **Plan**. For each payment of the year, the journal gets a [split](04-journal.md) on the payment account: the capital, the interest and the insurance, each in its sub-category, with the loan's name as description. A payment with a single part (an early repayment, or interest only with no insurance) is an ordinary planned entry.

- The **interest is the remainder**: when a statement is imported, the line is matched to the planned payment and the interest takes the difference with the bank amount, so the capital stays that of the schedule.
- **Plan** can be run again at any time, after an event for example. It adds the payments the journal lacks, replaces the forecasts it planned whose amounts changed (keeping their day), and removes those the schedule no longer has. Reconciled payments are never touched.
- A payment you entered by hand, with the same capital within five days, counts as planned.
- Deleting a loan leaves the entries planned from it in the journal.
- **Copy the previous year** in the [budget](06-budget.md) does not copy the payments of a loan: plan them again.

The Journal column of the schedule shows what the journal holds for each payment: planned or reconciled.
