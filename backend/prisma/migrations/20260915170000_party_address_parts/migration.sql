-- A postal address in the parts a printed document and a customs form ask for.
--
-- Suppliers had street/suburb/postcode but no state or country, so an address
-- could never be written out in full. Buyers had only a single free-text blob,
-- which is how all 91 imported from the export archive arrived.
--
-- Every column is nullable and nothing is backfilled: the existing blob stays
-- exactly as it is and remains what prints until someone fills in the parts.
ALTER TABLE "Supplier" ADD COLUMN "state" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "country" TEXT;

ALTER TABLE "Consignee" ADD COLUMN "street" TEXT;
ALTER TABLE "Consignee" ADD COLUMN "suburb" TEXT;
ALTER TABLE "Consignee" ADD COLUMN "state" TEXT;
ALTER TABLE "Consignee" ADD COLUMN "postcode" TEXT;
