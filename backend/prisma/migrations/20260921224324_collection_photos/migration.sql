-- CreateTable
CREATE TABLE "CollectionPhoto" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "lineId" TEXT,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "CollectionPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CollectionPhoto_collectionId_idx" ON "CollectionPhoto"("collectionId");

-- CreateIndex
CREATE INDEX "CollectionPhoto_lineId_idx" ON "CollectionPhoto"("lineId");

-- AddForeignKey
ALTER TABLE "CollectionPhoto" ADD CONSTRAINT "CollectionPhoto_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionPhoto" ADD CONSTRAINT "CollectionPhoto_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "CollectionLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionPhoto" ADD CONSTRAINT "CollectionPhoto_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
