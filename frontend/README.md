# Shine Metals — Frontend

React + Vite + Tailwind. Talks to the backend API at `/api` (proxied to `localhost:4000` in dev).

## Setup

```bash
npm install
npm run dev
```

Visit `http://localhost:5173`. Start the backend first (see `../backend/README.md`) and run its
seed script — log in with `admin@shinemotor.com.au` and the seeded password.

## Design system

- **Colors**: steel (near-black blue, structural) + copper (accent, used sparingly) — see
  `tailwind.config.js` for the full token set. Drawn from the actual materials this business
  trades in, not a generic palette. Note the steel ramp starts at `100`; there is no `steel-50`.
- **Type**: Fraunces (display), Inter (UI/body), IBM Plex Mono (all numeric data — weights,
  prices, totals — so figures align like a real ledger). Apply `.num` to any numeric cell.
- **Signature element**: the New Docket screen is built as a live weighbridge ticket — material
  lines add up in real time like a scale display, echoing the physical paper docket it replaces.

## What's built

- Login (JWT auth)
- Dashboard — today/month totals, recent activity, top materials
- New purchase / new tax invoice — supplier search with create-or-update, material line items,
  live calculation, PAYG statement, vehicle fields for cash-for-cars
- Purchase & tax invoice history — searchable, paginated, filterable by client
- Docket detail — printable view (browser print → Save as PDF)
- Export invoices — list, creation form (consignee, shipping/container fields, tonnage lines),
  and printable detail view showing the bank details as snapshotted at issue time
- Clients — searchable list linking through to each client's purchase and tax invoice history
- Materials & pricing — admin-editable price list, grouped by category
- Settings — company info, bank details, and logo/stamp upload (admin only)

## Conventions

- Routes for the same component under different props (`DocketHistoryPage`, `NewDocketPage`)
  carry an explicit `key` in `App.jsx` so switching sections remounts rather than carrying
  stale search/page state across.
- Any `useEffect` that fetches must list every filter it reads in its dependency array —
  `typeFilter` and `supplierId` included, not just `search` and `page`.
- `ErrorBoundary` wraps the app, so a render-time exception shows a message instead of a
  blank page. It is a safety net, not a licence to skip null checks.

## Not yet built

- Editing an existing docket or invoice from the UI (the API supports `PATCH` for both)
- Server-generated PDF (currently relies on browser print)
- Capturing signatures — `signatureImageUrl`, `supplierSignedAt` and `buyerSignedAt` exist in
  the schema but nothing writes them; printed dockets use pen-and-ink signature lines
- Admin-only "created/edited by" column in history views
- Automated tests and a linter — there are none in either package
