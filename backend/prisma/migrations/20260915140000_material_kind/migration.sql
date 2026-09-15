-- The yard buys and sells the same metal under different names: a supplier is
-- paid for "Copper Bright Wire", and the same metal is sold to an overseas mill
-- as "Mill Berry". One table, split by kind, so a purchase docket offers the
-- buying names and an export invoice the selling ones.
--
-- Defaults to 'PURCHASE' so the existing 33-item price list is untouched.
ALTER TABLE "Material" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'PURCHASE';

CREATE INDEX "Material_kind_idx" ON "Material"("kind");
