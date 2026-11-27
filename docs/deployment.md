# Deploying to a server

The production instance runs the `app` and `db` services of `docker-compose.yml` with the overlay `docker-compose.prod.yml`, behind a Caddy that already runs in Docker on the same host. Nothing is published on the host: Caddy reaches the app over a shared Docker network, and the database is reachable only by the app.

Requirements on the server: Docker with Compose 2.24 or later (`docker compose version`), Git, and the name of the Docker network Caddy is attached to (`docker inspect <caddy-container> --format '{{json .NetworkSettings.Networks}}'`).

## First installation

1. **DNS**: an `A` record for the public name (for example `cash.smith.lequette.eu`) pointing to the server.
2. **Clone**:
   ```sh
   git clone https://github.com/RemiLequette/cash-scout.git && cd cash-scout
   ```
3. **Configuration**: `cp .env.example .env`, then edit it. It is never committed.
   - `POSTGRES_PASSWORD`: a new long password (the stack builds the app's `DATABASE_URL` from it).
   - `BETTER_AUTH_SECRET`: `openssl rand -base64 36`.
   - `BETTER_AUTH_URL=https://cash.smith.lequette.eu`.
   - `PROXY_NETWORK`: the Caddy network found above.
   - `SUPERUSER_EMAIL`, `SUPERUSER_PASSWORD`: the administrator, created at first start. Sign-up is closed: the super user creates every account.
4. **Caddy**: add the block of [`deploy/Caddyfile.snippet`](../deploy/Caddyfile.snippet) to the Caddyfile of the server, once: a name defined twice makes the whole file invalid. Validate, and reload only if validation succeeds:
   ```sh
   docker exec <caddy-container> caddy validate --config /etc/caddy/Caddyfile
   docker exec <caddy-container> caddy reload --config /etc/caddy/Caddyfile
   ```
   Do not restart Caddy with an invalid file: it would loop at start, taking down every site it serves.
5. **Start**: `scripts/deploy.sh`. It installs the latest [release](#releasing): builds the image, starts the services and applies the migrations.
6. **Check**: open `https://cash.smith.lequette.eu` and sign in as the super user.
7. **Backups**: add the nightly dump to the crontab (`crontab -e`):
   ```
   15 3 * * * /home/<user>/cash-scout/scripts/backup.sh >> /home/<user>/cash-scout/backups/cron.log 2>&1
   ```
   Dumps go to `backups/` and are kept 14 days. They stay on the server: copy them elsewhere regularly (for example `scp` or `rsync` from the workstation) until an off-site copy is automated.

## Releasing

A release is a Git tag `vX.Y.Z` on `main`; merging into `main` changes nothing in production. From the workstation, on an up to date `main`:

```powershell
scripts/release.ps1 0.2.0
```

It checks that CI passed on the commit, creates the tag and pushes it. Raise the last number for fixes, the middle one for new features. **About**, in the app, shows the version installed.

## Updating

```sh
cd cash-scout && scripts/deploy.sh
```

It fetches the tags, dumps the database as `backups/<date>-pre-deploy.dump`, checks out the latest release, rebuilds and restarts. Migrations run when the app starts. The clone is left on the tag, not on `main`.

`scripts/deploy.sh v0.2.0` installs a given release. Going back to an earlier one does not undo the migrations made since: [restore](#restoring) the dump taken before them too.

**Once, on an instance installed before releases existed**: run `git pull` before `scripts/deploy.sh`, so that the script that runs is the new one.

## Moving the data from dev to prod

Done once, to start production from the real data of the dev database. The target must be a fresh instance (only the super user exists).

```sh
# on the workstation
docker exec cash-scout-db-1 pg_dump -U cashscout -d cashscout -Fc > local/backups/for-prod.dump
scp local/backups/for-prod.dump <user>@<server>:cash-scout/backups/

# on the server
scripts/restore.sh backups/for-prod.dump
```

The restore replaces the content of the production database, including its users: sign in afterwards with the accounts of the dev database. Prod is then the source of truth.

## Refreshing dev from prod

The other direction, to test on real data. It overwrites the dev database, so take a dump of it first.

```sh
# on the server
scripts/backup.sh for-dev
# on the workstation
scp <user>@<server>:cash-scout/backups/<latest>-for-dev.dump local/backups/
docker exec cash-scout-db-1 pg_dump -U cashscout -d cashscout -Fc > local/backups/dev-before-refresh.dump
docker exec -i cash-scout-db-1 pg_restore -U cashscout -d cashscout --clean --if-exists --no-owner < local/backups/<latest>-for-dev.dump
```

Never copy dev over prod after the first move.

## Restoring

`scripts/restore.sh backups/<file>.dump` asks for the database name, dumps the current state as `before-restore`, stops the app, restores, and restarts the app. It rolls back every book, since all share one database.
