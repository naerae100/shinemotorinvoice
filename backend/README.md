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
