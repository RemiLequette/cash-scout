# Budget planning

Design notes from a brainstorm. Step 1, the grid's spreadsheet tools (without a fill handle) and the entry list are built; the copy of transfers is not. Once all is built, this model replaces the [Budgets and cash projection](../README.md#budgets-and-cash-projection) section of the README.

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

Consumption is **by month**: only the **unplanned** entries (planned amount 0) dated in the month, reconciled or not, consume its grid amount. A planned entry never does: its drift from the plan is its own variance. A refund is not a special case: it is an unplanned entry of the opposite sign, which raises what remains, possibly above the grid amount.

### Budget sub-category

Budget lines show under a sub-category called **Budget** in their category. Like the lines, it is virtual: it is not part of the reference data, so no entry can be put in it, and it cannot be renamed, moved or merged.

Budgets are per category. The other sub-categories only record what money was.

### Budget line

A month with a grid amount other than zero has one **budget line** in the Budget sub-category, dated the last day of the month, on the budget's account.

| Field          | Value                                                               |
| -------------- | ------------------------------------------------------------------- |
| Planned amount | The grid amount                                                     |
| Amount         | The grid amount less the month's unplanned entries, never past zero |
| Reconciled     | Set by the user; the amount is then 0                               |

- The line is a **virtual entry**: computed, not stored. Only the grid and the reconciled months are.
- It is shown as long as its planned amount is not zero, even used up or reconciled.
- In the journal, the only action is **reconciled**, which can be taken back.
- A budget used up or overspent leaves the line at 0.
- The line shows no variance of its own: variance is read on a total (below).
- It appears in the journal, in the detail panel of the year dashboard, and in the cash projection.
- Each month stands alone: nothing rolls over, and there is no annual envelope. Until its line is reconciled, what remains is still expected, **past months included**. Reconciling lets it go.

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

### Signs

The grid reads with the **sign of the category's nature**, so that spending, most of the grid, is entered as positive numbers. What is added to or compared with the grid (previous year, planned entries per month, totals) reads the same way. **Entries**, planned ones included, keep their **true sign**, as in the journal.

### Category budget

One per category and year: the **12 monthly amounts** of the grid in the book currency, the **assumptions** (free text), the **account** of the budget lines and its exchange rate. A category has **one account for its budget in a year**, required as soon as a month is not zero: without it, overdrafts cannot be anticipated. Planned entries keep their own accounts.

## Planning view

The budget page lists the categories of a year. **Plan** on a category hides the others, with Previous, Next and All categories.

It shows:

- the **grid**: the 12 months and the total, editable;
- above it, read only, the previous year: its budget and what the journal holds;
- under it, the planned entries per month;
- the **planned entries** of the year, as an editable list.

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
- **copy the previous year**, one category at a time: all its entries, planned or not, one year later, with their description, sub-category, account and payment type, which later reconciling relies on. The amount of each becomes its planned amount. An entry already there (same date, sub-category and description) is not copied again. Transfers keep their two sides;
- **create from a schedule**: description, sub-category, account, amount, frequency (month, quarter, year), day, first and last date;
- tick rows, all of those a filter on description or sub-category shows included, to delete them, set a new planned amount (such as a rise known from July), or change their day, account or sub-category. No percentages;
- add and duplicate rows.

Undo and redo work until the save.

### Editing rules

- Writing a planned amount **always overwrites** the current amount.
- A **reconciled entry** is read only here, and so is the grid cell of a reconciled month: take the reconciliation back first to change it.
- The grid and the list are saved together by **Save**, all or nothing. Leaving a category with unsaved changes asks first. Nothing is stored before the save.
- A change made by someone else in the meantime is refused, as elsewhere in the application.

There is no "reviewed" mark.

## Effects on the rest of the application

- **Journal**: budget lines replace the month-end lines. Planned and unplanned entries are unchanged. An **alert** reports the past entries that are not reconciled, budget lines included; they are dealt with by hand.
- **Year dashboard**: a cell is the sum of the month's entries and budget line, for every category. The Budget sub-category replaces the unused budget line.
- **Cash projection**: entries plus the unreconciled budget lines, past months included.
- **Yearly balance**: planned income, spending and saving are the planned amounts of entries plus the grids.
- **Bank import**: matching a statement line with its forecast matters more. A line left unmatched becomes an unplanned entry, which consumes the grid while the forecast is still expected.

## Data

- `category_budget`: 12 monthly amounts replace `type`, `amount`, `profile_id` and `consumption`.
- Dropped: `budget_profile`, `category.default_budget_type`, the budget type and consumption mode enums.
- A stored annual amount is spread by its profile into the 12 months, so that no value is lost.

Beyond that, existing data is adjusted by hand.

## Transfers

Categories of a transfer nature have no grid and no Budget sub-category, only planned transfers, created from the planning view as today from the budget page.

## Steps

1. Model and migration: monthly amounts, Budget sub-category, budget lines, journal, dashboard and projection.
2. Planning view: grid and entry list, one atomic save.
3. Spreadsheet tools, after choosing a grid component whose free licence covers ranges, paste and fill, or writing them.
4. Previous year helps, help pages and README.
