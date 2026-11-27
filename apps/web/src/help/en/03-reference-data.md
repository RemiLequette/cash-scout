# Reference data

Reference data describes a book. A new book starts **empty**: build it at the level of detail you want. A household may split food into bakery, butcher and supermarket, while a private book keeps one food sub-category.

## Categories

Categories have three levels: **group → category → sub-category**. Groups can nest to any depth.

- A **category** has a short **code** (C01, P02…) that sets its order, and a **nature**.
- A **sub-category** is what you pick on an entry. It sets the category, the group and the nature.
- Use the arrows to reorder, and give a group a colour for the dashboard. A group without a colour takes its parent's.
- A sub-category can be **moved** to another category. Existing entries follow.
- **Archive** what you no longer use instead of deleting it. Archived items stay on old entries and come back with _Show archived_.
- An item still in use cannot be deleted: the message says by what, and how many (sub-categories, entries, budgets…).

## Natures and balances

A **nature** says what kind of flow a category carries: income, spending, savings, exceptional… It sets the category's section in the dashboard.

- **The category decides, not the sign.** A tax withheld is negative income; a refund is positive spending. Reports add signed amounts within each category.

### Display

Each nature has a **display**:

- **Reversed**, for spending: negative amounts read as positive.
- **As entered**, for income.

It acts on the dashboard, and on the budget in one way only: it says what an amount typed in the grid means, since the grid carries no sign.

| 300 in the grid            | **Reversed** nature (Spending) | **As entered** nature (Income) |
| -------------------------- | ------------------------------ | ------------------------------ |
| What it means              | 300 to spend                   | 300 to receive                 |
| Budget line in the journal | -300                           | +300                           |
| Expected account balance   | goes down                      | goes up                        |
| What consumes the grid     | unplanned negative amounts     | unplanned positive amounts     |

Entries and balances always keep their sign. So changing the display of a nature that already has budgets turns their grids around.

### Transfers and balances

- A nature can be marked **Transfers between accounts**: its categories are used by transfers and stay out of the totals.
- A **balance** is a subtotal: the sum of the natures you choose, as entered.

A new book starts with four natures: Income, Spending, Savings and Transfers.

## Accounts

- An account is a bank account: reconciled with the bank and part of the cash projection. To move an amount between categories without any bank movement, use a [compensation](04-journal.md).
- An account's **currency** cannot be changed once it exists.
- The **opening balance** is the part of the account's balance that no entry explains: what came before the first entry, and whatever is missing. It sits in no category, so in no total or budget. In the account's menu, **Opening balance…**: type the balance read in your bank, and it is worked out so that the reconciled entries give that balance, whatever their date.
- The **low balance warning** is an amount: the account chart warns when the projected balance goes below it.
