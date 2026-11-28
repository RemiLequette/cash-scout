# Wealth

Design notes from a brainstorm.

**Built:** loans (the model and API at `/books/:bookId/loans`, the schedule in `packages/domain`, the planned splits of a year, the remaining capital and its check against the journal, the Loans page, the book export, the online help and the README). Holdings, valuations, net worth and performance are not built.

## Intent

See what a book owns and owes, how it changes over the years, and what each holding earns, from the flows the journal already records and values entered by hand.

- **Loans**: their schedule feeds the budget, and their remaining capital the net worth (O1, O2, O3).
- **Investments** that are not bank accounts, such as a life insurance or a managed portfolio: is the manager doing well? (O3)
- **Property**: its value, its loans, and what it earns once rent, charges, tax and interest are counted (O3).

Each book has its own wealth. Nothing is consolidated across books: a person's private book may hold a share of a household property as a holding of its own.

## What it builds on

- Every account stays a bank account: a balance is its opening balance plus its entries. Savings accounts that work that way (_livrets_) are already accounts and count in the net worth through their balance.
- Money that leaves the accounts for a holding the book does not track, such as a payment into a life insurance, is already an entry in a sub-category of a saving nature. A withdrawal reads as negative saving.
- A loan payment is already a [split](splits.md): capital and interest in two sub-categories.

Wealth adds what the journal cannot hold: **values at a date**, and **schedules** of loans.

## Model

### Holding

An item of the book's wealth, in the book's reference data:

| Field          | Notes                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------- |
| Name           | Per language, like other reference data                                                   |
| Kind           | Investment or property                                                                    |
| Sub-categories | The sub-categories whose entries are its flows: payments in, withdrawals, rent, charges…  |
| Opening        | Optional: a value and a date for a holding older than the journal, used as its first flow |
| Archived       | Sold or closed: kept for past years                                                       |

- A sub-category belongs to at most one holding, so a flow is never counted twice.
- A property also lists its loans.

### Valuation

A value at a date, entered by hand: `(holding, date, value, note)`, in the book currency. The note says where it comes from (manager's statement, estimate by an agent…).

- No detail of a portfolio: one value for the whole holding.
- Between two valuations the holding is worth the last one; no index or market price fills the gap.

### Loan (built)

| Field     | Notes                                                                                      |
| --------- | ------------------------------------------------------------------------------------------ |
| Name      | And the lender, and a free note (contract number, contact)                                 |
| Amount    | Capital borrowed                                                                           |
| Rate      | Yearly nominal rate                                                                        |
| Term      | Number of monthly payments, deferred ones included                                         |
| Start     | Date of the first payment                                                                  |
| Insurance | A rate on the capital borrowed, a rate on the remaining capital, or none                   |
| Deferral  | Optional: months with interest only, or with nothing paid (the interest joins the capital) |
| Account   | The account the payments are taken from                                                    |
| Parts     | The sub-categories of the capital, the interest and the insurance                          |

Events, dated, change the schedule from their date:

- **Drawdown**: capital released in steps, as in a purchase off plan.
- **Early repayment**: part of the capital, or all of it. A part keeps either the payment (the loan is shorter) or the term (the payment is lower).
- Each event can carry a free **note**.
- **Buy-back**: a loan is repaid in full by another one. The old loan ends with an early repayment; the new one is a loan of its own.
- **Penalty**: a repayment or a buy-back can carry a penalty. It is a cost of its own, not part of the capital: a planned entry on the payment account, in the loan's penalty sub-category, which the loan must name to have one.
- **Change of insurer**: from its date, the insurance has new terms (none, a rate on the capital borrowed, or on the remaining capital). It counts for the payments of that day on, unlike the other events.

The schedule is never stored: `packages/domain` computes it from the loan and its events, like the cash projection (`loanSchedule`, in `loan.ts`).

How it is computed:

- A French constant-payment loan: each month the interest is a twelfth of the yearly rate on the capital left, the rest of the payment repays capital, the last payment takes what is left. Amounts are minor units, rounded to the nearest.
- The insurance can be **paid apart**: then it is not in the payment (the payment's total leaves it out), and it has its own account, in the loan's currency, which is the payment account by default. A change of insurer can move it in or out of the payment.
- The insurance is a twelfth of its rate on the capital borrowed, or on the capital left at the start of the month; it is paid during a deferral of interest only, and not during one of nothing paid.
- Without drawdowns the whole amount is released at the start. With them, only what they release is borrowed, and their total cannot exceed the amount; each one sets a new payment.
- An event counts after the payments of its date and before the next one. A repayment of all that is left, or a buy-back, ends the loan.
- A loan whose drawdowns predate the journal is entered with its terms and events as they were: the schedule is computed from its start, so no opening capital is needed.
- Out of the loan's currency nothing is converted: its amounts are in the currency of its payment account, which cannot change.

## What the app does with it

### Loans in the budget

- From its schedule, a loan **generates planned splits** for a year: one per payment, on its account, with capital, interest and insurance as parts. The capital part is in a sub-category of a saving nature: repaying capital is saving.
- The **interest is the remainder**: it takes the gap with the statement line, which the import matches as for any planned split, so the capital stays that of the schedule. A payment with a single part (an early repayment, or interest only with no insurance) is an ordinary planned entry. A buy-back plans nothing: the new lender pays the old one.
- An insurance paid apart is a planned entry of its own on its account, outside the split, one per payment. So is the penalty of a repayment or a buy-back, on the payment account. `journal_entry.loan_part` tells them from the payment.
- The entries carry `loan_id`. **Plan** can be run again for a year: it adds the payments the journal lacks, replaces the unreconciled forecasts it planned whose amounts changed (keeping their day), and removes those the schedule no longer has. Reconciled entries are never touched. A payment entered by hand, with the same capital within five days, counts as planned. Deleting a loan unlinks its entries; they stay. Copying the previous year in the budget leaves them out.
- The **remaining capital** at a date comes from the schedule. The capital repaid in the journal is checked against it: the reconciled entries of the capital sub-category, against the schedules of the loans that share it, month by month from the first entry to the last month reconciled on the payment account (a loan may be older than the journal). A gap of more than one unit of the currency is flagged.

### Net worth

At the end of each month or year: the balances of the accounts, plus the last valuation of each holding, minus the remaining capital of each loan. A chart stacks it by kind (accounts, investments, property) with the debts below zero.

### Performance

For a holding, between two valuations:

- **Gain** = closing value − opening value − net flows in.
- **Yearly return**: an internal rate of return on the dated flows of the journal, the opening value and the closing value.

For a property, a yearly table like the sheets' one: rent, charges, tax, interest and insurance, the net cash it costs or brings, the capital repaid, and the change of value.

## Out of scope for now

- Market prices, indices or portfolio positions: every value is entered by hand.
- Whether buying back a loan pays off, which is a simulation.
- Wealth across books, and shares of a holding owned by several books.
- Tax on wealth (IFI).

## Open questions

- Whether valuations get their own screen, one line per holding with its last value, to fill in at once.
