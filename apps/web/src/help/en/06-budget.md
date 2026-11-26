# Budget

The **Budget** page shows a year, category by category. Choose the year with the arrows, then **Plan** on a category. From there, move to another with **Previous**, **Next** or the search by code or name.

## Two ways to budget, which add up

- The **grid**: an amount per month, without saying which entries will spend it.
- **Planned entries**: future entries of the journal, each with a planned amount.

The budget of a month is the grid **plus** the planned amounts of its entries.

## The grid

Amounts read with the sign of the nature: spending is positive. Last year's budget and actuals are shown above, to help.

- **Account**: the account this budget should be spent from. It is required and drives the projection.
- **Exchange rate** when that account is not in the book currency.
- **Assumptions**: free text on what the plan relies on.

## Following the year

Under the year's **Budget** row, two rows, month by month and in total:

- **Reconciled**: the category's **reconciled** entries. Forecasts do not count, even past ones. The **Actual** row of the previous year counts all entries.
- **Remaining**: the budget less what is reconciled, whether the month is past or not, and whether its Budget line is reconciled or not. It follows the grid and the entries as you type them.

Both read with the sign of the nature. A negative remaining means overspending for spending, and more received than budgeted for income.

Nothing rolls over by itself: to carry over what was not used, add it yourself to the coming months of the grid.

## Filling the grid

The grid fills like a spreadsheet.

- **Move** with Enter and the left and right arrows. While typing, the arrows move in the text; Escape drops what was typed.
- **Select** several months by dragging, Shift+click or Shift+arrows. The sum of the selection is shown.
- **In a cell**: an amount, a formula (`=450*3`), or a change (`+10`, `+3%`, `-5%`, `*2`, `/2`). `-250` is a negative amount.
- **On the selection**, with the field and **Apply**: the same forms; here `-10` takes 10 away.
- **Fill right** (Ctrl+R): the first selected month up to the end of the selection, or to December for a single cell.
- **Copy last year's budget or actuals**: onto the selection, or the whole row when a single cell is selected.
- **Spread a total**: evenly, after the current shape, or after a row of last year. With no total typed, the current one is used.
- **Copy and paste** with a spreadsheet: Ctrl+C copies the selection, Ctrl+V pastes from the active cell. Delete empties a selection.
- **Undo and redo** (Ctrl+Z, Ctrl+Y) until you save.

Reconciled months do not change.

## Planned entries

The list under the grid is edited in place. It is saved with the grid by **Save**, all or nothing: until you save, the journal does not change.

- **Copy the previous year** takes all of the category's entries of the year before, planned or not, one year later, with their description, sub-category, account and payment type. Their amount becomes the planned amount. An entry already there (same date, sub-category and description) is not copied again. Transfers are not copied.
- **Schedule** creates a series of entries: first and last date, frequency, sub-category, description, account, amount. The series is not remembered: these are ordinary entries.
- **Tick** rows to give them a new amount or another day, change their account or sub-category, duplicate or delete them. Shift+click ticks a range; the box in the titles ticks all the rows the **filter** shows.
- The up and down arrows and Enter go from row to row.
- **Undo** takes back the last copy, creation or action on the ticked rows.

A reconciled entry is not changed here. In this list the amount is the **planned** one: changing it also replaces the expected amount.

## The Budget line

Each month whose grid is not zero has a **Budget** line on its last day, in the journal. Its amount is the grid less the month's **unplanned** entries, never past zero. A refund raises it.

Planned entries do not consume the grid: how they differ from their plan is their **variance**.

**Reconciling** the line lets the rest go and locks the month's cell. Until then the rest is expected, even for a past month. Nothing rolls over from a month to the next.

## Transfers

Transfer categories have no grid, only planned transfers.

## Change of the accounts

At the bottom, _income − spending − savings_ shows what the plan does to your accounts. It is information, not a target.
