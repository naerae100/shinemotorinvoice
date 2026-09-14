-- Docket.taxMode replaces the old rule that GST was derived from the document
-- type (TAX_INVOICE got GST, PURCHASE_DOCKET did not).
--
-- The column is added idempotently: it already exists on any environment where
-- the schema was pushed directly with `prisma db push` rather than migrated.
ALTER TABLE "Docket" ADD COLUMN IF NOT EXISTS "taxMode" TEXT NOT NULL DEFAULT 'EXCLUSIVE';

-- Backfill.
--
-- Rows written before taxMode existed had their totals computed under the old
-- rule, so a purchase docket stored gst = 0. The blanket 'EXCLUSIVE' column
-- default contradicts those stored totals: the next edit to such a docket
-- recomputes with GST switched on and silently inflates a historical total by
-- 10%. Give those rows the mode that matches the money already recorded.
--
-- The predicate deliberately matches only rows whose stored totals disagree
-- with their taxMode, so dockets genuinely created as EXCLUSIVE or INCLUSIVE
-- (which carry a non-zero gst) are left untouched.
UPDATE "Docket"
   SET "taxMode" = 'NO_TAX'
 WHERE "taxMode" = 'EXCLUSIVE'
   AND "type" = 'PURCHASE_DOCKET'
   AND "gst" = 0
   AND "total" = "subtotal" - "discountAmount";
