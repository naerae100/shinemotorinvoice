-- Whether a purchase docket has actually been paid.
--
-- The yard does not always pay at the weighbridge. When the manager with bank
-- access is not on site, the scrap is still bought and weighed; the supplier's
-- account details are taken and the transfer happens later. Until now there was
-- nowhere to record that, so an unpaid docket looked identical to a settled one.
--
-- Defaults to PAID, deliberately: every docket already in the system was
-- settled at the time it was written, and a default of UNPAID would make the
-- entire history read as money owed.
ALTER TABLE "Docket" ADD COLUMN "paymentStatus" TEXT NOT NULL DEFAULT 'PAID';
ALTER TABLE "Docket" ADD COLUMN "paidAt" TIMESTAMP(3);
ALTER TABLE "Docket" ADD COLUMN "paymentMethod" TEXT;
ALTER TABLE "Docket" ADD COLUMN "paymentReference" TEXT;
ALTER TABLE "Docket" ADD COLUMN "paidById" TEXT;

ALTER TABLE "Docket" ADD CONSTRAINT "Docket_paidById_fkey"
  FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The payment run filters on this every time it is opened.
CREATE INDEX "Docket_paymentStatus_idx" ON "Docket"("paymentStatus");
