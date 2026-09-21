-- AlterTable
ALTER TABLE "CollectionLine" ADD COLUMN     "supplierGrossWeight" DECIMAL(65,30),
ADD COLUMN     "supplierNetWeight" DECIMAL(65,30),
ADD COLUMN     "supplierTareWeight" DECIMAL(65,30);
