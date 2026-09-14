-- The Xero integration's columns reached production through `prisma db push`
-- and were never captured as a migration, so a database built from this folder
-- alone would be missing them and the app would fail on first Xero call.
-- Added idempotently: they already exist wherever the push was run.
ALTER TABLE "CompanySettings"
  ADD COLUMN IF NOT EXISTS "xeroTenantId"       TEXT,
  ADD COLUMN IF NOT EXISTS "xeroAccessToken"    TEXT,
  ADD COLUMN IF NOT EXISTS "xeroRefreshToken"   TEXT,
  ADD COLUMN IF NOT EXISTS "xeroTokenExpiresAt" TIMESTAMP(3);

ALTER TABLE "Docket"        ADD COLUMN IF NOT EXISTS "xeroInvoiceId" TEXT;
ALTER TABLE "ExportInvoice" ADD COLUMN IF NOT EXISTS "xeroInvoiceId" TEXT;
