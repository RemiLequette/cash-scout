# cash-scout architecture

How cash-scout is built. What it does and why is in the [README](README.md); objectives are referred to as O1 (plan), O2 (project forward) and O3 (control and analyse).

## Overview

```
 Browser (desktop, mobile PWA)
   └─ apps/web     React + Mantine, i18next
          │  HTTPS, typed client
 Node container
   └─ apps/api     Hono + Drizzle, better-auth
          │  SQL, row-level security
 PostgreSQL container
```

Two containers in Docker Compose: one Node container serving the API and the built front end, and PostgreSQL. An optional third service runs backups.

## Repository

A pnpm workspace, TypeScript everywhere:

| Package           | Content                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`        | React front end                                                                                                                                 |
| `apps/api`        | HTTP API, authentication, database access, import                                                                                               |
| `packages/domain` | Types, zod validation schemas, and pure calculations: budget allocation by profile, consumption by mode, cash projection, yearly balance |

`packages/domain` has no dependency on the database or the browser. The API and the front end use the same schemas, so a form validates exactly as the server does, and the calculations are tested in isolation.

## Back end

- **Hono** for the HTTP API: very light, and its typed client gives the front end the API's types without code generation.
- **Drizzle ORM** on **PostgreSQL**: schema and migrations in TypeScript, SQL kept visible for reporting queries.
- **better-auth** for authentication: local accounts, secure session cookies, password hashing. OIDC can be added later. There is no public sign-up: the super user, created at first start from `SUPERUSER_*` variables, creates the users (better-auth admin plugin). A forgotten password is reset by the super user, which ends the user's open sessions; users change their own password from the header. No email is sent.
- **Audit log**: who created, changed or deleted what, per book, so members of a shared book can follow changes.

### Book isolation

Books are fully separate (see the README). Isolation is enforced twice:

1. **In the API**: every request names a book; the API checks the user's membership and role before anything else.
2. **In the database**: every book-owned table carries `book_id`, and PostgreSQL **row-level security** lets a request see only its user's books. A query that forgets a filter still cannot read another book.

How the database side works:

- Migrations run as the database owner. The API then runs every query as the role `cashscout_app`, which is not the table owner and cannot bypass row-level security.
- Each request touching book data runs in a transaction that sets `app.user_id` (`withUser` in `apps/api/src/db/client.ts`). Without it, no book row is visible.
- Policies call `app_book_ids(min_role)`, the books of the current user with at least a role. Reading needs membership; changing a book or its members needs the owner role.
- Every other book-owned table gets the same policies, with `editor` for writes (reference data since `0004_reference_isolation.sql`, the journal since `0006_journal_isolation.sql`).
- A child item refers to its parent through a composite foreign key `(parent_id, book_id)`, so it cannot point to another book's item even through a bug.
- Tests check it directly: unfiltered queries, and writes into another user's book that bypass the API.

Linked entries between two books are written in one transaction, after checking editor rights on both books.

### Data rules

- **Money** is stored as integer minor units (`bigint`), never floating point, with an ISO 4217 currency code; the number of decimals comes from the currency. The sign is kept as entered; the direction comes from the category.
- **Currencies**: an entry stores its amount in the account's currency, the exchange rate (`numeric`: 1 unit of the account currency = rate units of the book currency) and the book amount, all fixed when saved. The rate is 1 when the account is in the book currency; otherwise the request gives it, until the rates table suggests one. Changing the amount keeps the saved rate; only an explicit new rate replaces it. An entry cannot move to an account in another currency. Reports sum book amounts. Display-currency views convert with the period's average rate.
- **Planned amount**: set to the amount when the entry is created; the API never changes it afterwards.
- **Rates**: a global `exchange_rate` table (date, base, quote, rate, source), filled daily by a job from the European Central Bank reference rates, plus manual rates per book that take precedence.
- **Derived values** (year, month, category, group, direction) are never stored on an entry; they come from the date and the sub-category.
- **Reference data names** are stored per item in a `names` JSON column, one name per language (`{"fr": "Alimentation", "en": "Food"}`). The API checks them against the book's languages and requires the default one; names in a language the book drops are kept. Entries, rules and reports reference items by id.
- **Archiving** sets `archived_at`: the item stays for past data and is hidden from choices. A new entry cannot use an archived account, sub-category or payment type; an existing entry keeps the ones it has. Deleting is refused while an item is in use; merging a sub-category moves its entries to another one, then deletes it, in one transaction.
- **Journal entries** reserve `schedule_id` and `link_id` for schedules and linked entries; they stay empty until those exist.

### Reports and projection

- Pivots, dashboards and history are computed in SQL (`GROUP BY` over the journal joined with reference data) and returned as rows (O3).
- Budget allocation and consumption, and the cash projection, are computed on demand by `packages/domain` from the journal, schedules and budgets, so they are never stale (O1, O2).
- If volumes ever require it, aggregates can be cached per book and month; not needed at household scale.

### Import

Reference data and journals are imported from CSV files by `pnpm import:reference` and `pnpm import:journal`, in one transaction and with the rights of an editor of the book ([format](docs/import.md)).

For bank statements: CSV, OFX and QIF parsing, column mappings per account, classification rules, and matching against unreconciled scheduled entries live in the API. Import runs as a preview first: the user reviews, classifies unknown labels, creates rules, then confirms.

## Front end

- **Vite**, **React**, **TanStack Router** (routes) and **TanStack Query** (server state).
- **Mantine** for components: forms, date pickers, notifications, dark mode, locale support.
- **TanStack Table** for the pivot view and the journal; **ECharts** for charts.
- **Responsive**, for desktop and mobile web, installable as a **PWA** on the phone. Always online: no offline entry.

### Internationalisation

- No user-facing text in the code: **i18next** with **ICU** message files, one per language (`locales/en.json`, `locales/fr.json`).
- Dates, numbers and amounts formatted with `Intl` for the user's locale.
- A language is added by contributing a message file, without code changes. Each user picks their interface language; reference data names follow it, with the book's default language as fallback.

## Local development

Everything runs on the developer's machine before any server exists. Two modes, same database:

| Mode            | How                                                                                                                                    | Used for                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Dev**         | `docker compose up db` starts PostgreSQL only; `pnpm dev` runs the API and Vite on the host with hot reload                            | Daily coding                                                                       |
| **Local stack** | `docker compose --profile stack up --build` runs the same `app`, `db` and `backup` services as on a server, at `http://localhost:8080` | Testing the image, migrations at start, backup and restore, before each deployment |

- **Requirements**: Node 22 LTS, pnpm (through `corepack enable`), Docker Desktop (WSL 2 on Windows).
- **Configuration**: `.env.example` is versioned; each developer copies it to `.env`, which is ignored.
- **Tests**: `pnpm test` runs the API tests against a `<database>_test` database on the same server, recreated at each run; CI does the same with a PostgreSQL service.
- **Demo data**: `pnpm seed` creates fictitious users and books (a private book, a household book, linked entries, schedules, budgets in two currencies), so every screen can be tried without real data.
- **Real data stays out of the repository**: imports of real books, dumps and the local restic repository go to `local/`, which is ignored by Git. Tests and examples use fictitious data only.
- **Backup in local**: the `backup` service writes dumps to `local/backups` and its off-site copy to a restic repository in `local/offsite`, so the full backup and restore cycle is tested before a real destination is chosen.

## Deployment

- `docker-compose.yml` with:
  - `app`: one Node image built from the workspace, serving the API and the static front end;
  - `db`: PostgreSQL, data on a named volume;
  - `backup` (optional but recommended): see [Backup](#backup).
- Configuration through environment variables; migrations run at start.
- HTTPS is left to the host's reverse proxy (Caddy, Traefik, nginx).

## Backup

The database holds years of financial history that cannot be rebuilt, on a private server with no managed service behind it. At household scale it weighs a few megabytes, so simple full dumps are enough; continuous archiving (WAL, point-in-time recovery) is not worth its complexity when entries are typed by hand and a lost day can be re-entered.

| Layer              | What                                                                                                                                                                                                               | Protects against                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Nightly dump       | The `backup` service runs `pg_dump` (custom format) every night into a mounted folder. It keeps 7 daily, 4 weekly and 12 monthly dumps.                                                                            | Database corruption, a bad manual operation on the server                |
| Pre-migration dump | The `app` service dumps the database before running migrations at start. If a migration fails, the app does not start.                                                                                             | A faulty upgrade                                                         |
| Off-site copy      | The `backup` service sends the dump folder to another place with **restic**: encrypted on the server before sending, deduplicated, to any restic backend (S3-compatible storage, SFTP, a disk on another machine). | Loss of the server or its disk                                           |
| Book export        | A book owner exports a book as a versioned JSON archive: reference data, journal, schedules, budgets, rules. It can be imported into an empty book, on the same instance or another one.                           | Restoring one book without rolling back the others; leaving the instance |

- **Encryption**: the restic password is kept outside the server, in the administrator's password manager. Without it the off-site copy is unreadable, by anyone.
- **Restore is tested**: `scripts/restore-check` restores the latest dump into a temporary PostgreSQL container and checks it (migrations level, row counts per book, journal balances). The `backup` service runs it weekly and reports the result in the super user's admin page; CI runs it against a test dump.
- **Mistakes by users** (a wrong deletion, a bad import) are handled in the application first: the audit log shows what changed, and an import can be undone as one batch. A full restore is the last resort, because all books share one database and it would roll them all back; the book export covers the case of one book.
- **Monitoring**: the admin page shows the date and size of the last dump and of the last off-site copy, and warns when either is older than two days.

## Quality

- **Vitest** for `packages/domain` and the API, against a real PostgreSQL in tests.
- **Playwright** for main flows: entry, import, budget, projection.
- ESLint and Prettier; CI on GitHub Actions.

## License

MIT.
