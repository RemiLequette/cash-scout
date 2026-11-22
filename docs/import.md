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

| Column         | Required | Content                                                                          |
| -------------- | -------- | -------------------------------------------------------------------------------- |
| `group`        | yes      | Group name. Lines with the same group name share the group.                      |
| `category`     | yes      | Category name                                                                    |
| `code`         | yes      | Category code, unique in the book (`C01`). Lines with the same code share it.    |
| `direction`    | yes      | `expense`, `income` or `transfer` (French `dépense`, `recette`, `virement` work) |
| `sub_category` | no       | Sub-category name                                                                |

```csv
group;group@en;category;category@en;code;direction;sub_category;sub_category@en
Vie courante;Daily life;Alimentation;Food;C01;expense;Boulangerie;Bakery
Vie courante;Daily life;Alimentation;Food;C01;expense;Supermarché;Supermarket
Revenus;Income;Salaires;Salaries;R01;income;;
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
