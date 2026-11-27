# Dashboard

The **Dashboard** reads one year at a glance. It never changes data, and every member can see it, viewers included. Amounts are in the book's currency.

## Reading it

- **Columns**: the 12 months, the year's total and the value per month (a twelfth of the total, forecasts included).
- **Rows**: your natures and balances, in the order set in the reference data. A nature opens on its groups, categories and sub-categories. Use _Expand all_ and _Collapse all_.
- A category's cell is the sum of the month's entries (by their [budget month](04-journal.md)), reconciled or not, and of its Budget line. Future values are shown differently from past ones. The current month is shaded.
- The **Budget** line appears under an expanded category, so that its sub-categories and this line add up to the category.
- **Round** hides the cents.
- **Transfers**, above the balances, gives what transfers brought into (positive) or took out of (negative) the accounts, by date. Unfold the line for each account, and select a cell to see its entries. The overall line is not zero when a transfer straddles two months.
- **Account balances at month end** sums the entries up to each month's end. Future months are the projected balance. Compensations, which have no account, move no balance. Balances follow the dates: with entries counted in another month, a month's change may differ from the sum of its cells.

## Detail panel

Select a cell: the panel at the bottom lists the **entries** behind it, read-only. Resize or hide it, and open the journal from there.

## Evolution

The **Evolution** page takes the rows of the dashboard with one column per year, from the first to the last year holding entries or a budget.

- **From** picks the first year shown and hides the earlier ones. The choice is kept. Balances still count the hidden years.
- Each column is the year's total, forecasts and Budget lines included. The current year is shaded, years ahead are shown differently.
- **Per year / Per month**: the year's total, or a twelfth of it. Balances do not change.
- **Account balances at year end** is December's balance of the dashboard.
- The **chart**, under the table, shows for each year one column per nature, stacked by top-level group in the group's colour. A negative group is drawn below zero. Point at a column for its detail. The boxes on the left pick the natures the chart shows; the table keeps them all, and the choice is kept.
