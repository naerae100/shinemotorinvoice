-- A shipment is recorded once and passes through two stages: a packing slip
-- that captures the weights, then an invoice that prices them.
--
-- The default is 'INVOICED' so every existing row -- including the 91 imported
-- from the export archive -- keeps behaving exactly as it does today. Nothing
-- becomes a packing slip retrospectively.
ALTER TABLE "ExportInvoice" ADD COLUMN "stage" TEXT NOT NULL DEFAULT 'INVOICED';

CREATE INDEX "ExportInvoice_stage_idx" ON "ExportInvoice"("stage");
