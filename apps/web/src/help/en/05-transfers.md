# Transfers

A **transfer** moves money between two accounts of the same book. It is two entries, a **source** (negative) and a **destination** (positive), created, changed and deleted together.

## Creating one

Use **New transfer** in the journal.

- **Date** is the day it leaves the source account. **Delay** (0 to 60 days) sets when it reaches the destination.
- Between accounts of **different currencies**, enter both amounts: the real exchange rate follows.
- The **sub-category** must belong to a category whose nature is marked _Transfers between accounts_. Create one in the [reference data](03-reference-data.md) first.

## Editing

The amount, accounts, sub-category and description are edited on the transfer, never on one side: opening a side from the journal opens the whole transfer. Only **reconciling** is per side, since each side matches its own bank line.

Transfers are left out of the totals, because they change no balance of the book overall.

A transfer can also be part of the budget's plan (see [Budget](06-budget.md)).
