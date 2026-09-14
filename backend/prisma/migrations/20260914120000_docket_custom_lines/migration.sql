-- Dockets: tax-inclusive by default, and a line may describe a one-off grade
-- that is not on the price list.

-- The yard quotes suppliers a rate per kilo with GST already in it, so that is
-- what a new docket should assume. Existing dockets keep whatever they recorded:
-- changing the column default does not touch rows that already exist.
ALTER TABLE "Docket" ALTER COLUMN "taxMode" SET DEFAULT 'INCLUSIVE';

ALTER TABLE "DocketLineItem" ADD COLUMN "description" TEXT;
ALTER TABLE "DocketLineItem" ALTER COLUMN "materialId" DROP NOT NULL;

-- Nullable now, so deleting a material blanks the reference instead of being
-- blocked by it; the line keeps its typed description.
ALTER TABLE "DocketLineItem" DROP CONSTRAINT IF EXISTS "DocketLineItem_materialId_fkey";
ALTER TABLE "DocketLineItem"
  ADD CONSTRAINT "DocketLineItem_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;
