-- Export invoices gain a currency, multiple containers, and free-text products.
--
-- Money columns are RENAMED rather than dropped and recreated, so the amounts on
-- every historic invoice survive. They lose their "Aud" suffix because the same
-- column now holds USD on a USD invoice.

-- ── Per-currency bank accounts ───────────────────────────────────────────────
CREATE TABLE "BankAccount" (
  "id"          TEXT NOT NULL,
  "currency"    TEXT NOT NULL,
  "bankName"    TEXT,
  "swift"       TEXT,
  "accountNo"   TEXT,
  "bsb"         TEXT,
  "bankAddress" TEXT,
  "beneficiary" TEXT,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BankAccount_currency_key" ON "BankAccount"("currency");

-- The company has been invoicing in AUD from a single block of bank details, so
-- that block is the AUD account. The USD account is deliberately left empty
-- rather than guessed — it must be entered in Settings before a USD invoice is
-- issued, or the buyer wires to the wrong account.
INSERT INTO "BankAccount" ("id","currency","bankName","swift","accountNo","bsb","bankAddress","beneficiary","updatedAt")
SELECT gen_random_uuid()::text, 'AUD', "bankName", "bankSwift", "bankAccountNo", "bankBsb", "bankAddress", "beneficiary", now()
  FROM "CompanySettings" WHERE "id" = 'singleton';

INSERT INTO "BankAccount" ("id","currency","updatedAt")
SELECT gen_random_uuid()::text, 'USD', now()
WHERE NOT EXISTS (SELECT 1 FROM "BankAccount" WHERE "currency" = 'USD');

-- ── Consignee: the detail the historic archive actually carries ──────────────
ALTER TABLE "Consignee"
  ADD COLUMN "groupName"           TEXT,
  ADD COLUMN "abn"                 TEXT,
  ADD COLUMN "website"             TEXT,
  ADD COLUMN "extraEmails"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "extraPhones"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "defaultCurrency"     TEXT,
  ADD COLUMN "defaultShippingTerm" TEXT,
  ADD COLUMN "notes"               TEXT,
  ADD COLUMN "archiveFolder"       TEXT;
CREATE INDEX "Consignee_groupName_idx" ON "Consignee"("groupName");

-- ── ExportInvoice: currency + contract number, money columns renamed ─────────
ALTER TABLE "ExportInvoice"
  ADD COLUMN "currency"   TEXT NOT NULL DEFAULT 'AUD',
  ADD COLUMN "contractNo" TEXT;

ALTER TABLE "ExportInvoice" RENAME COLUMN "subtotalAud" TO "subtotal";
ALTER TABLE "ExportInvoice" RENAME COLUMN "gstAud"      TO "gst";
ALTER TABLE "ExportInvoice" RENAME COLUMN "totalAud"    TO "total";

-- ── Containers become rows, not three columns on the invoice ────────────────
CREATE TABLE "InvoiceContainer" (
  "id"            TEXT NOT NULL,
  "invoiceId"     TEXT NOT NULL,
  "containerNo"   TEXT,
  "seal"          TEXT,
  "containerType" TEXT,
  "position"      INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "InvoiceContainer_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InvoiceContainer_invoiceId_idx" ON "InvoiceContainer"("invoiceId");
ALTER TABLE "InvoiceContainer"
  ADD CONSTRAINT "InvoiceContainer_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "ExportInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry each existing invoice's single container across as its first container.
INSERT INTO "InvoiceContainer" ("id","invoiceId","containerNo","seal","containerType","position")
SELECT gen_random_uuid()::text, "id", "containerNo", "seal", "containerType", 0
  FROM "ExportInvoice"
 WHERE "containerNo" IS NOT NULL OR "seal" IS NOT NULL OR "containerType" IS NOT NULL;

ALTER TABLE "ExportInvoice"
  DROP COLUMN "containerNo",
  DROP COLUMN "seal",
  DROP COLUMN "containerType";

-- ── Line items: packing-list weights, free-text products, container link ─────
ALTER TABLE "InvoiceLineItem" RENAME COLUMN "weightTonnes" TO "netWeightMt";
ALTER TABLE "InvoiceLineItem" RENAME COLUMN "totalAud"     TO "total";

ALTER TABLE "InvoiceLineItem"
  ADD COLUMN "containerId"   TEXT,
  ADD COLUMN "packageCount"  TEXT,
  ADD COLUMN "grossWeightMt" DECIMAL(65,30),
  ADD COLUMN "tareWeightMt"  DECIMAL(65,30),
  ADD COLUMN "position"      INTEGER NOT NULL DEFAULT 0;

-- A one-off product can now be typed straight onto a line without first being
-- added to the material list.
ALTER TABLE "InvoiceLineItem" ALTER COLUMN "materialId" DROP NOT NULL;

CREATE INDEX "InvoiceLineItem_containerId_idx" ON "InvoiceLineItem"("containerId");
ALTER TABLE "InvoiceLineItem"
  ADD CONSTRAINT "InvoiceLineItem_containerId_fkey"
  FOREIGN KEY ("containerId") REFERENCES "InvoiceContainer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- materialId is now nullable, so deleting a material must blank the reference
-- rather than being blocked by it. The line keeps its typed description.
ALTER TABLE "InvoiceLineItem" DROP CONSTRAINT IF EXISTS "InvoiceLineItem_materialId_fkey";
ALTER TABLE "InvoiceLineItem"
  ADD CONSTRAINT "InvoiceLineItem_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;
