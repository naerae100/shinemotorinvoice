-- CreateTable
CREATE TABLE "LocalSupplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "suburb" TEXT,
    "state" TEXT,
    "postcode" TEXT,
    "notes" TEXT,
    "supplierId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "LocalSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "collectionNumber" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "localSupplierId" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "voidReason" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "docketId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "editedAt" TIMESTAMP(3),
    "editedById" TEXT,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionLine" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "materialId" TEXT,
    "description" TEXT,
    "grossWeight" DECIMAL(65,30) NOT NULL,
    "tareWeight" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "netWeight" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "CollectionLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LocalSupplier_name_idx" ON "LocalSupplier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Collection_collectionNumber_key" ON "Collection"("collectionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Collection_docketId_key" ON "Collection"("docketId");

-- CreateIndex
CREATE INDEX "Collection_localSupplierId_idx" ON "Collection"("localSupplierId");

-- CreateIndex
CREATE INDEX "Collection_date_idx" ON "Collection"("date");

-- CreateIndex
CREATE INDEX "Collection_status_idx" ON "Collection"("status");

-- CreateIndex
CREATE INDEX "CollectionLine_collectionId_idx" ON "CollectionLine"("collectionId");

-- AddForeignKey
ALTER TABLE "LocalSupplier" ADD CONSTRAINT "LocalSupplier_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalSupplier" ADD CONSTRAINT "LocalSupplier_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_localSupplierId_fkey" FOREIGN KEY ("localSupplierId") REFERENCES "LocalSupplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionLine" ADD CONSTRAINT "CollectionLine_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionLine" ADD CONSTRAINT "CollectionLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;
