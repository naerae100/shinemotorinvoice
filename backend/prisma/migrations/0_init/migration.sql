-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'STAFF',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Material" (
    "id" TEXT NOT NULL,
    "code" INTEGER,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'KG',
    "currentPrice" DECIMAL(65,30) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "suburb" TEXT,
    "postcode" TEXT,
    "phone" TEXT,
    "saleType" TEXT NOT NULL DEFAULT 'PRIVATE',
    "abn" TEXT,
    "licenceNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Docket" (
    "id" TEXT NOT NULL,
    "docketNumber" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'PURCHASE_DOCKET',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supplierId" TEXT NOT NULL,
    "vehicleReg" TEXT,
    "vehicleModel" TEXT,
    "vehicleVin" TEXT,
    "paygStatement" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "voidReason" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "subtotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "discountType" TEXT NOT NULL DEFAULT 'NONE',
    "discountValue" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "gst" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "total" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "supplierSignedAt" TIMESTAMP(3),
    "buyerSignedAt" TIMESTAMP(3),
    "signatureImageUrl" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "editedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Docket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocketLineItem" (
    "id" TEXT NOT NULL,
    "docketId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "netWeight" DECIMAL(65,30) NOT NULL,
    "price" DECIMAL(65,30) NOT NULL,
    "value" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "DocketLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consignee" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "country" TEXT,

    CONSTRAINT "Consignee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportInvoice" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consigneeId" TEXT NOT NULL,
    "shippingTerm" TEXT,
    "fasPort" TEXT,
    "poNumber" TEXT,
    "containerNo" TEXT,
    "seal" TEXT,
    "modeOfTransport" TEXT,
    "containerType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "voidReason" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "subtotalAud" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "discountType" TEXT NOT NULL DEFAULT 'NONE',
    "discountValue" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "applyGst" BOOLEAN NOT NULL DEFAULT false,
    "gstAud" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalAud" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "bankSnapshot" TEXT,
    "createdById" TEXT NOT NULL,
    "editedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExportInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLineItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "description" TEXT,
    "weightTonnes" DECIMAL(65,30) NOT NULL,
    "pricePerMt" DECIMAL(65,30) NOT NULL,
    "totalAud" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "InvoiceLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanySettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "companyName" TEXT NOT NULL DEFAULT 'Shine Motor Corporation Pty Ltd',
    "abn" TEXT,
    "acn" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "fax" TEXT,
    "email" TEXT,
    "website" TEXT,
    "logoUrl" TEXT,
    "stampUrl" TEXT,
    "bankName" TEXT,
    "bankSwift" TEXT,
    "bankAccountNo" TEXT,
    "bankBsb" TEXT,
    "bankAddress" TEXT,
    "beneficiary" TEXT,

    CONSTRAINT "CompanySettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Material_code_key" ON "Material"("code");

-- CreateIndex
CREATE INDEX "Supplier_name_idx" ON "Supplier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Docket_docketNumber_key" ON "Docket"("docketNumber");

-- CreateIndex
CREATE INDEX "Docket_date_idx" ON "Docket"("date");

-- CreateIndex
CREATE INDEX "Docket_supplierId_idx" ON "Docket"("supplierId");

-- CreateIndex
CREATE INDEX "Docket_status_idx" ON "Docket"("status");

-- CreateIndex
CREATE INDEX "DocketLineItem_docketId_idx" ON "DocketLineItem"("docketId");

-- CreateIndex
CREATE UNIQUE INDEX "ExportInvoice_invoiceNumber_key" ON "ExportInvoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "ExportInvoice_date_idx" ON "ExportInvoice"("date");

-- CreateIndex
CREATE INDEX "ExportInvoice_consigneeId_idx" ON "ExportInvoice"("consigneeId");

-- CreateIndex
CREATE INDEX "ExportInvoice_status_idx" ON "ExportInvoice"("status");

-- CreateIndex
CREATE INDEX "InvoiceLineItem_invoiceId_idx" ON "InvoiceLineItem"("invoiceId");

-- AddForeignKey
ALTER TABLE "Docket" ADD CONSTRAINT "Docket_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Docket" ADD CONSTRAINT "Docket_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Docket" ADD CONSTRAINT "Docket_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Docket" ADD CONSTRAINT "Docket_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocketLineItem" ADD CONSTRAINT "DocketLineItem_docketId_fkey" FOREIGN KEY ("docketId") REFERENCES "Docket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocketLineItem" ADD CONSTRAINT "DocketLineItem_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportInvoice" ADD CONSTRAINT "ExportInvoice_consigneeId_fkey" FOREIGN KEY ("consigneeId") REFERENCES "Consignee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportInvoice" ADD CONSTRAINT "ExportInvoice_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportInvoice" ADD CONSTRAINT "ExportInvoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportInvoice" ADD CONSTRAINT "ExportInvoice_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ExportInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

