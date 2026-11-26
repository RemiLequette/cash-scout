# Budget planning

Design notes from a brainstorm. Nothing here is built yet. When built, this model replaces the [Budgets and cash projection](../README.md#budgets-and-cash-projection) section of the README.

A [clickable mockup](https://claude.ai/artifact/8vXcbxfpCMEnHrkh8yFBrp) (private, fictitious data) shows the spreadsheet behaviour of the planning view. It predates the model below: it still has the budget type and does not show the budget line.

## Intent

Go through the categories one by one and build or change the budget of a year, for a new year or for the year under way, with the previous year at hand as a help. No source is the default: neither last year's budget nor what really happened.

## What goes away

- The **budget type** (scheduled or periodic), on the category and on the category budget.
- **Profiles**, the annual amount, and the consumption modes (lapse, roll over, annual pool).
- The **Start from the previous year** button and the per-row copy.

## Model

### Two ways to budget, which add up

Any category can hold, for any month:

- **planned entries**: journal entries with a planned amount;
- a **grid amount**: money budgeted for the month without saying which entries will spend it.

The budget of a month is the grid amount **plus** the planned amounts of the month's entries.

Only **unplanned** entries (planned amount 0), reconciled or not, consume the grid amount. A planned entry never does: its drift from the plan is its own variance.

### Budget sub-category

Every category has one sub-category kept by the application, **Budget**, which holds the budget lines. It is created with the category. The user cannot put an entry in it, rename, move, merge or archive it, and neither the entry forms nor the import rules offer it.

Budgets are per category. The other sub-categories only record what money was.

### Budget line

A month with a grid amount other than zero has one **budget line** in the Budget sub-category, dated the last day of the month, on the budget's account.

| Field          | Value                                                              |
| -------------- | ------------------------------------------------------------------ |
| Planned amount | The grid amount                                                    |
| Amount         | The grid amount less the month's unplanned entries, never past zero |
| Reconciled     | Set by the user; the amount is then 0                              |

- The line is **computed**, not stored: only the grid and the reconciled months are.
- In the journal, the only action is **reconciled**, which can be taken back.
- A budget used up or overspent leaves the line at 0.
- The line shows no variance of its own: variance is read on a total (below).
- It appears in the journal, in the detail panel of the year dashboard, and in the cash projection.
- Each month stands alone. Until its line is reconciled, what remains is still expected, **past months included**. Reconciling lets it go.

### Totals

For a category and a month, with the budget line counted:

- the sum of the **planned amounts** is the budget;
- the sum of the **amounts** is the expected outcome;
- the difference is the variance. Nothing is counted twice.

Example: 300 in the grid and one planned entry of 100.

| What happens                       | Budget line | Budget | Outcome | Variance |
| ---------------------------------- | ----------- | ------ | ------- | -------- |
| Nothing yet                        | 300         | 400    | 400     | 0        |
| 50 unplanned                       | 250         | 400    | 400     | 0        |
| The planned entry comes at 138     | 300         | 400    | 438     | 38       |
| 350 unplanned                      | 0           | 400    | 450     | 50       |
| 50 unplanned, then line reconciled | 0           | 400    | 150     | −250     |

Amounts here are read with the sign of the category's nature.

### Category budget

One per category and year: the **12 monthly amounts** of the grid in the book currency, the **assumptions** (free text), the **account** of the budget lines and its exchange rate. The account is required as soon as a month is not zero.

## Planning view

The budget page lists the categories of a year. **Plan** on a category hides the others, with Previous, Next and All categories.

It shows:

- the **grid**: the 12 months and the total, editable;
- above it, read only, the previous year: its budget and what the journal holds;
- under it, the planned entries per month;
- the **planned entries** of the year, as an editable list;
- the entries of the previous year, to pick from.

### Spreadsheet tools

Grid:

- keyboard moves, selection of a range of months;
- copy and paste, from and to a spreadsheet;
- fill to the right, with the keyboard or a handle;
- arithmetic in a cell (`=450*3`) and operations on the selection (`+3 %`, `+10`, `*2`);
- spread a total evenly, keeping the current shape, or after a row of the previous year;
- copy a row of the previous year, whole or for the selected months;
- sum of the selection.

Entry list:

- columns: date, sub-category, description, account, planned amount, and the current amount for information;
- add, duplicate and delete rows; repeat a row every month to the end of the year;
- operations on the selected rows; paste a column of amounts;
- take chosen entries of the previous year, one year later, at their planned amount.

Undo and redo work until the save.

### Editing rules

- Writing a planned amount **always overwrites** the current amount.
- A **reconciled entry** is read only here, and so is the grid cell of a reconciled month.
- The grid and the list are saved together by **Save**, all or nothing. Leaving a category with unsaved changes asks first. Nothing is stored before the save.
- A change made by someone else in the meantime is refused, as elsewhere in the application.

There is no "reviewed" mark.

## Effects on the rest of the application

- **Journal**: budget lines replace the month-end lines. Planned and unplanned entries are unchanged.
- **Year dashboard**: a cell is the sum of the month's entries and budget line, for every category. The Budget sub-category replaces the unused budget line.
- **Cash projection**: entries plus the unreconciled budget lines, past months included.
- **Yearly balance**: planned income, spending and saving are the planned amounts of entries plus the grids.
- **Bank import**: matching a statement line with its forecast matters more. A line left unmatched becomes an unplanned entry, which consumes the grid while the forecast is still expected.

## Data and migration

- `category_budget`: 12 monthly amounts replace `type`, `amount`, `profile_id` and `consumption`.
- `sub_category`: a flag marks the Budget sub-category; the migration creates one per category.
- Dropped: `budget_profile`, `category.default_budget_type`, the budget type and consumption mode enums.
- A periodic budget becomes 12 amounts: its annual amount spread by its profile, without loss.
- A scheduled budget keeps its assumptions, with an empty grid. Its entries do not change.
- Reconciled months are kept.
- The import of the sheets writes the monthly amounts as they are, instead of picking a profile.

## To settle before building

1. **Existing planned entries in periodic categories** consume the budget today and will add to it. The migration must either take them out of the grid or accept that those totals rise. Count them first.
2. **Past unreconciled lines** now stay in the projection, so they can pile up. Proposed: reconcile all the budget lines of a month at once.
3. **Roll over and annual pool budgets** already stored: only December could be reconciled. What happens to their earlier months, which would all get a line?
4. **Transfers**: proposed, no grid and no Budget sub-category for categories of a transfer nature; planned transfers are created from the planning view, as today from the budget page.
5. **Refunds** are unplanned entries of the opposite sign: they raise what remains, possibly above the grid amount. To confirm.
6. **Proposed and not yet confirmed**: line at 0 when used up, locked grid cell for a reconciled month, one account per category and year, computed line.

## Steps

1. Model and migration: monthly amounts, Budget sub-category, budget lines, journal, dashboard and projection.
2. Planning view: grid and entry list, one atomic save.
3. Spreadsheet tools, after choosing a grid component whose free licence covers ranges, paste and fill, or writing them.
4. Previous year helps, help pages and README.
