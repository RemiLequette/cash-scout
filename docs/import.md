# Importing reference data

A book starts with empty reference data. To start from existing lists (a spreadsheet, another tool), export them to CSV files and import them with:

```bash
pnpm import:reference --book <book id> --user <email> --dir <folder>
```

- `--book`: the book's id, as shown in its address (`/books/<id>`).
- `--user`: the email of a user who is an editor or owner of the book. The import runs with this user's rights.
- `--dir`: a folder holding any of the three files below. Keep it under `local/`, which Git ignores, when the data is real.

The import runs in one transaction: if a line is wrong, the command names the line and nothing is imported. Items that already exist are left as they are, so the import can be run again after adding lines.

## Files

The first line holds the column names. The delimiter is a comma or a semicolon, detected from the first line. Files are read as UTF-8.

Name columns are in the book's **default language**. A translation goes in a column with the same name followed by `@` and the language: `category@en`, `name@fr`. Every language used must be one of the book's languages (set in the book's settings).

### categories.csv

One line per sub-category; a category without sub-categories can have an empty `sub_category`.

| Column         | Required | Content                                                                             |
| -------------- | -------- | ----------------------------------------------------------------------------------- |
| `group`        | yes      | Group name. Lines with the same group name share the group.                         |
| `category`     | yes      | Category name                                                                       |
| `code`         | yes      | Category code, unique in the book (`C01`). Lines with the same code share it.       |
| `nature`       | yes      | Name of one of the book's natures, in any of its languages (`Dépenses`, `Revenus`…) |
| `sub_category` | no       | Sub-category name                                                                   |

```csv
group;group@en;category;category@en;code;nature;sub_category;sub_category@en
Vie courante;Daily life;Alimentation;Food;C01;Dépenses;Boulangerie;Bakery
Vie courante;Daily life;Alimentation;Food;C01;Dépenses;Supermarché;Supermarket
Revenus;Income;Salaires;Salaries;R01;Revenus;;
```

An existing group is matched by its name, a category by its code, a sub-category by its name within its category.

### accounts.csv

| Column                  | Required | Content                                                         |
| ----------------------- | -------- | --------------------------------------------------------------- |
| `name`                  | yes      | Account name                                                    |
| `kind`                  | no       | `bank` (default) or `virtual`                                   |
| `currency`              | yes      | ISO 4217 code: `EUR`, `MYR`…                                    |
| `low_balance_threshold` | no       | Warn below this projected balance, e.g. `-200` (bank accounts). |

### payment_types.csv

| Column | Required | Content           |
| ------ | -------- | ----------------- |
| `name` | yes      | Payment type name |

An existing account or payment type is matched by its name.

# Importing a journal

Once the reference data is in place, past and future entries can be imported from one CSV file:

```bash
pnpm import:journal --book <book id> --user <email> --file <journal.csv>
```

`--book` and `--user` work as for the reference data. `--file` is the CSV file; keep it under `local/` when the data is real.

The import runs in one transaction: if a line is wrong, the command names the line and nothing is imported. Each line becomes a new entry, so **running the same file twice imports its entries twice**.

The file follows the same rules as above (header line, comma or semicolon, UTF-8). Accounts, sub-categories and payment types are matched by their name in the book's **default language**, ignoring case. Archived items are matched too, so old entries can use them.

| Column              | Required | Content                                                                                                                                                    |
| ------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `date`              | yes      | `2026-11-22` or `22/11/2026`                                                                                                                               |
| `account`           | yes      | Account name. The amount is in the account's currency.                                                                                                     |
| `sub_category`      | yes      | Sub-category name                                                                                                                                          |
| `category_code`     | no       | Code of the sub-category's category (`C01`). Needed when two sub-categories have the same name.                                                            |
| `description`       | no       | Free text                                                                                                                                                  |
| `payment_type`      | no       | Payment type name                                                                                                                                          |
| `amount`            | yes      | Signed amount, as on the bank statement: `-12.50`, `-12,50` and `-1 234,56` work. The sign is kept; the category decides whether it is spending or income. |
| `planned_amount`    | no       | The amount first planned (the sheets' budget column). Defaults to `amount`.                                                                                |
| `exchange_rate`     | no       | When the account is not in the book currency: 1 unit of the account currency = this many units of the book currency.                                       |
| `book_amount`       | no       | Instead of `exchange_rate`: the amount in the book currency. The rate is computed from the two amounts.                                                    |
| `original_amount`   | no       | For information: the amount actually paid in another currency. Goes with `original_currency`.                                                              |
| `original_currency` | no       | ISO 4217 code of the original amount                                                                                                                       |
| `reconciled`        | no       | `yes` or `no` (also `oui`/`non`, `true`/`false`, `1`/`0`, `x`). Empty means no: the entry is a forecast.                                                   |

An account in another currency than the book needs `exchange_rate` or `book_amount` on each line.

```csv
date;account;sub_category;category_code;description;payment_type;amount;planned_amount;reconciled
02/11/2026;Compte courant;Boulangerie;C01;Pain;Carte;-3,20;;oui
25/11/2026;Compte courant;Paie;R01;Salaire;Virement;2000;1900;non
```
