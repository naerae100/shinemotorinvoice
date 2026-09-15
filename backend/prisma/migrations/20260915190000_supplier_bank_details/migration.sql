-- Where a supplier is paid.
--
-- The yard does not always pay at the weighbridge; the transfer often happens
-- later. Holding the account against the supplier lets an unpaid docket be
-- settled from the record, and puts the details in front of the operator the
-- next time the same seller comes in.
--
-- All nullable: a walk-in paid on the spot has none of this.
ALTER TABLE "Supplier" ADD COLUMN "bankAccountName" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "bankBsb" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "bankAccountNo" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "payId" TEXT;
