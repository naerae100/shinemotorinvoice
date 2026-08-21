# Shine Metals — Backend API

Node/Express + Prisma backend for the docket & export invoice system.

> **Database:** this runs on **SQLite** (`prisma/dev.db`) as configured. The migrations in
> `prisma/migrations/` are SQLite-specific and will not replay against PostgreSQL — moving to
> Postgres means changing the `datasource` provider and regenerating migrations from scratch.
> See [Moving to PostgreSQL](#moving-to-postgresql) before deploying.

## Setup

```bash
npm install
cp .env.example .env
# edit .env with a generated JWT_SECRET
npx prisma migrate dev
npm run seed
npm run dev
```

The seed creates:
- The 33 materials from the paper docket (prices set to 0 — update via the Materials page)
- An admin user: `admin@shinemotor.com.au` / value of `SEED_ADMIN_PASSWORD`
- The company settings row, with real ABN/address/bank details and the logo

Re-running the seed is safe: material prices and any uploaded logo/stamp are preserved.

No stamp image ships with the repo. Upload one via **Settings → Logo & stamp**; until then
printed invoices simply omit it.

## API overview

| Route | Purpose |
|---|---|
| `POST /api/auth/login` | Login, returns JWT (rate limited) |
| `GET /api/auth/me` | Current user, for session check on app load |
| `GET/POST/PATCH/DELETE /api/materials` | Price list management (admin writes, everyone reads) |
| `GET/POST/PATCH /api/suppliers` | Supplier lookup/creation for docket entry |
| `GET/POST/PATCH /api/dockets` | Purchase docket & tax invoice CRUD, auto-calculates discount/GST/totals |
| `POST /api/dockets/:id/void` · `/restore` | Reversible cancellation with a required reason |
| `DELETE /api/dockets/:id` | Permanent delete — **admin only**, last resort |
| `GET/POST/PATCH /api/invoices` | Sales invoice CRUD, optional GST, snapshots bank details |
| `POST /api/invoices/:id/void` · `/restore` · `DELETE` | As above, for invoices |
| `GET/POST/PATCH /api/users` | Staff logins — **admin only** |
| `GET /api/reports/overview` | Dashboard analytics for any date range |
| `GET /api/reports/supplier/:id` · `/consignee/:id` | One client's full trading picture |
| `GET/POST/PATCH /api/consignees` | Export buyer management |
| `GET/PATCH /api/settings` | Company info, logo, stamp, bank details (admin only for writes) |
| `POST /api/settings/upload` | Logo/stamp image upload (admin only) |
| `GET /api/reports/dashboard` | Today/month totals, recent dockets, top materials |

## Demo data

```bash
npm run demo         # ~90 days of realistic trading, to explore the dashboard
npm run demo:clear   # remove every one of them again
```

Everything it creates is named `DEMO …` or `DEMO-…`, and `demo:clear` matches on exactly that
prefix — your own records are never touched.

## Performance — read this before optimising anything else

Response time here is dominated by **where the function runs relative to the
database**, not by query efficiency or data volume. Measured against the live
database while it held 3 dockets and 0 invoices:

| | |
|---|---|
| Round trip to the database | ~178 ms |
| Dashboard, six sequential query waves | 6037 ms |
| Dashboard, one wave (current) | 1215 ms |

A 4 KB response took 2.5 seconds. No index or query rewrite fixes that — it is
latency multiplied by the number of round trips. So:

1. **Keep the functions in the database's region.** `vercel.json` pins
   `"regions": ["hnd1"]` (Tokyo) because the Supabase project is in
   `ap-northeast-1`. If either moves, move the other — co-located, a round trip
   is ~1-5 ms instead of ~178 ms. This note lives here rather than in
   `vercel.json` because that file is strict JSON: Vercel validates it against a
   schema and rejects unknown keys, including the `"//"` comment convention that
   works in `package.json`.
2. **Issue independent queries in one `Promise.all`, not one after another.**
   Each extra wave costs a full round trip. The dashboard and both per-client
   reports each collapsed from five or six waves to one.
3. **Ideal end state:** database in `ap-southeast-2` (Sydney) and `regions:
   ["syd1"]`, which also shortens the hop from the yard itself.

Company settings are cached in the browser for the tab's lifetime
(`frontend/src/lib/settings.js`) — they carry the logo and stamp as base64 and
were being refetched on every docket and invoice screen.

## Tests

```bash
npm test                       # money unit tests always run
```

The 42 API integration tests need a scratch PostgreSQL database, because that is
what the schema targets:

```bash
docker run --rm -d -p 5433:5432 -e POSTGRES_PASSWORD=test --name shine-test postgres:16
export TEST_DATABASE_URL="postgresql://postgres:test@localhost:5433/postgres"
npm test
```

Without `TEST_DATABASE_URL` those tests **skip loudly** and the run reports a
skip — deliberately, so a green run can never mean "42 tests silently did not
execute". The harness refuses any non-local URL, since it drops and recreates
the schema on every run.

## Migrations

`prisma/migrations/0_init/migration.sql` is a baseline generated from the current
schema. The live database was built with `db push`, so mark the baseline as
already applied once, then use normal migrations from then on:

```bash
npx prisma migrate resolve --applied 0_init
npx prisma migrate deploy
```

## Behaviour worth knowing

- **Money maths lives in one place**, `src/lib/money.js`, shared by purchases and sales so the
  two can never disagree about the order of operations. That order is:
  `subtotal → less discount → GST on what remains → total`. A discount larger than the subtotal
  is capped, so a total can never go negative.
- **GST on a purchase is derived from the document type** and cannot be set by the client:
  `TAX_INVOICE` carries 10%, `PURCHASE_DOCKET` none. **GST on a sales invoice is a per-invoice
  choice** — exports are GST-free, a local sale is not, and the operator decides rather than the
  system guessing from the shipping fields.
- **Voiding, not deleting, is the normal way to cancel.** A voided record keeps its number, stays
  in history with the reason and who did it, and is excluded from every total and report. Hard
  delete exists for admins only, for genuine mistakes like a test entry.
- **Every report counts ACTIVE records only** — a voided docket must never appear in a figure
  being reconciled against the bank.
- **Totals sum the rounded line values**, so a printed docket always adds up to its own subtotal.
- **Docket numbers** are allocated as `max + 1` in application code (SQLite has no sequence on
  non-id columns). Simultaneous saves collide on the unique index; the loser retries with the
  next number, so concurrent entry on multiple terminals is safe.
- **Bank details are snapshotted** onto each export invoice as JSON at creation time, and are
  deliberately *not* updated by `PATCH` — the buyer may already have paid against them.
- **The dashboard response is `private, no-store`.** It is per-account financial
  data behind `requireAuth`, and a shared CDN keys its cache on the URL rather
  than the `Authorization` header — an `s-maxage` here could hand the figures to
  a request that never presented a token. The in-process cache gives the speed
  without that risk.
- **Uploads are capped at 1 MB.** Images are stored as base64 data URIs, which
  inflates them by a third and puts them inside JSON bodies, so the cap has to
  stay well under the `express.json` limit.
- **Every route handler is wrapped in `asyncHandler`.** Express 4 does not catch rejected
  promises from async handlers; without the wrapper a single failed query terminates the
  process. Add new routes the same way.

## Security notes

- Passwords are hashed with bcrypt, never stored in plain text
- JWTs expire after 12 hours; `JWT_SECRET` is validated at boot and the server refuses to start
  without it
- Rate limiting applies to `POST /api/auth/login` only — deliberately *not* to `GET /auth/me`,
  which every client calls on load and which would otherwise exhaust the quota for a whole
  office sharing one public IP
- `app.set('trust proxy', 1)` is enabled in production so the limiter sees real client IPs
- Uploads are capped at 5 MB, restricted to PNG/JPEG/WebP/SVG, and stored under a random
  filename with an extension we choose — never one taken from the uploaded filename
- `/uploads` is served without authentication (an `<img>` tag cannot send a bearer token), which
  is why the filenames are unguessable

## Deployment

1. Create a Railway project and deploy this `backend/` folder as a service
2. Set `JWT_SECRET` (long random string), `FRONTEND_URL` (deployed frontend URL), and
   `NODE_ENV=production`
3. Set `DATABASE_URL` — see below if using Postgres
4. Run `npx prisma migrate deploy` and `npm run seed` once via Railway's shell
5. **Log in immediately and change the seeded admin password**

If the frontend and backend end up on different domains, note that `settings.logoUrl` defaults
to `/branding/logo.png`, which is served by the *frontend*. Uploaded images live at `/uploads/…`
on the *backend*. Whichever origin serves the app needs to resolve both — either put them behind
one domain, or upload the logo through Settings so both paths point at the backend.

## Moving to PostgreSQL

Not a config flip. In order:

1. Change `provider` to `postgresql` in `prisma/schema.prisma`
2. Delete `prisma/migrations/` and run `npx prisma migrate dev --name init` against Postgres
3. Case-insensitive search is already handled — `src/lib/search.js` adds Prisma's
   `mode: 'insensitive'` automatically when `DATABASE_URL` is a Postgres URL, since SQLite
   rejects that flag but Postgres needs it
4. Consider switching `Decimal` money columns to `@db.Decimal(12, 2)`. On SQLite they are
   floating point, which is tolerable at this volume but wrong in principle for a ledger
5. Migrate existing `dev.db` rows across if there is live data worth keeping
