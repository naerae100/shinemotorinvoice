# Backups and restore

The short version: a dump of the whole database goes into the yard's Google
Drive every evening, automatically, and it has been restored and checked
before it is filed. If you ever need it back, skip to **Restoring**.

---

## Where they are

**Google Drive → `Shine Metals — database backups` → `2026`**

Open it with the Google account the app is connected to. No Supabase login, no
console, no command line — the files are ordinary downloads. One file per day,
named `prod-YYYYMMDD-HHMMSS.sql.gz`, about 270 KB each. Five years of daily
backups is roughly half a gigabyte.

A second copy of each night's dump is also attached to its GitHub Actions run
and kept for 90 days. That exists in case the Drive upload is the thing that
broke.

## What runs, and when

`.github/workflows/backup.yml`, at **09:00 UTC** — 7pm Sydney in winter, 8pm in
summer, after the yard has shut either way. It runs on GitHub's machines, so
nobody's laptop needs to be open.

Each night it:

1. dumps production with `pg_dump` (PostgreSQL 17 client — the Ubuntu default
   is 16 and *refuses* to read a 17 server, which is precisely how a backup job
   goes green while producing nothing),
2. **restores that dump into an empty PostgreSQL 17 database** and counts the
   tables and rows,
3. uploads it to Drive only if the restore worked,
4. fails the run — and emails you — if any of that goes wrong.

Step 2 is the point. A backup that has never been restored is a file, not a
backup, and the failures it hides (a truncated dump, a version mismatch, a
schema that no longer loads) are invisible until the day it matters.

### The four secrets it needs

In GitHub → Settings → Secrets and variables → Actions:

| Secret | What it is |
| --- | --- |
| `BACKUP_DATABASE_URL` | The **direct** production connection string — the non-pooled one. pgBouncer rejects `pg_dump`. |
| `GOOGLE_CLIENT_ID` | Same three values the photo uploads use. |
| `GOOGLE_CLIENT_SECRET` | |
| `GOOGLE_REFRESH_TOKEN` | |

Whoever administers that GitHub organisation can reach the production database
through `BACKUP_DATABASE_URL`. That is the cost of the job running without a
laptop; if it is not an acceptable one, move this workflow to a private
repository with a shorter list of admins.

## Taking one by hand

Before any migration, or any time you want a checkpoint:

```bash
cd backend
npm run backup:now       # dump, then upload to Drive
```

Or the two halves separately:

```bash
npm run backup:prod                              # writes backups/prod-<stamp>.sql.gz
npm run backup:drive backups/prod-<stamp>.sql.gz # uploads that file
```

`backups/` is gitignored. Nothing here ever reaches the repository.

---

## Restoring

### Into a scratch database, to look at it

This is the safe thing to do first, always. It touches nothing live.

```bash
createdb -h localhost -p 5433 -U postgres restore_check
gunzip -c prod-20260922-135704.sql.gz | psql -h localhost -p 5433 -U postgres -d restore_check
psql -h localhost -p 5433 -U postgres -d restore_check -c 'select count(*) from "Docket";'
```

It takes about a second. If your local PostgreSQL is older than 17 you will see
one error about `transaction_timeout` — that is a setting PostgreSQL 17 writes
and 16 does not recognise. It is harmless and the data restores fine.

### Into a new, empty production database

For a rebuild — a new Supabase project, or a migration somewhere else.

```bash
# The DIRECT url, not the pooled one.
gunzip -c prod-20260922-135704.sql.gz | psql -v ON_ERROR_STOP=1 "<new-direct-url>"
```

Then point `DATABASE_URL` and `DIRECT_URL` at the new database and redeploy.

### Over the top of a live database

Don't, unless you have no choice — and take a fresh dump of the broken state
first, because you cannot get it back afterwards. Ask before doing this.

---

## What a backup does and does not hold

**Holds:** every docket, invoice, collection, supplier, consignee, material and
price, every user login, the company settings, the bank details, and the whole
audit trail.

**Does not hold:** the **photographs**. Those live in Google Drive already, in
their own folders per supplier and collection — the database keeps only their
Drive ids. Losing the database loses the links, not the images; the photos are
still sitting in Drive where anyone can open them.

## The one thing to understand

A backup holds exactly what existed the moment it was taken, and nothing after.

When this was first tested, the restored copy matched production on every table
but one: 123 audit events against 126. Nothing was broken — three more had been
written after the snapshot. That is the shape of every backup gap. With a
nightly job the most you can lose is one day's work; if these ever stop running,
that gap grows silently until you need it.

So: if the nightly run fails, GitHub emails you. Do not ignore that email.
