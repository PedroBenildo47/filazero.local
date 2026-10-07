-- Phase 4 / Block 1: fiscal invoices and AGT compliance.
--
-- Adds the taxpayer NIF, the official document series per organization/year and
-- the fiscal fields a Portuguese/Angolan invoice must carry (VAT breakdown,
-- issuer/customer NIF, integrity hash, QR payload, certification flag).

-- CreateEnum
CREATE TYPE "InvoiceDocumentType" AS ENUM ('FT', 'FR');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "tax_id" VARCHAR(20);

-- AlterTable
ALTER TABLE "transactions"
  ADD COLUMN "series_id" UUID,
  ADD COLUMN "series_code" VARCHAR(20),
  ADD COLUMN "sequence" INTEGER,
  ADD COLUMN "subtotal_cents" INTEGER,
  ADD COLUMN "vat_cents" INTEGER,
  ADD COLUMN "vat_rate_bps" INTEGER,
  ADD COLUMN "customer_tax_id" VARCHAR(20),
  ADD COLUMN "issuer_tax_id" VARCHAR(20),
  ADD COLUMN "invoice_hash" VARCHAR(200),
  ADD COLUMN "invoice_qr" TEXT,
  ADD COLUMN "invoice_issued_at" TIMESTAMPTZ(6),
  ADD COLUMN "invoice_voided_at" TIMESTAMPTZ(6),
  ADD COLUMN "invoice_void_reason" VARCHAR(300),
  ADD COLUMN "agt_certified" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "invoice_series" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "document_type" "InvoiceDocumentType" NOT NULL DEFAULT 'FR',
  "year" INTEGER NOT NULL,
  "code" VARCHAR(20) NOT NULL,
  "next_number" INTEGER NOT NULL DEFAULT 1,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "invoice_series_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_series_organization_id_document_type_year_key"
  ON "invoice_series"("organization_id", "document_type", "year");

-- CreateIndex
CREATE INDEX "invoice_series_organization_id_year_idx"
  ON "invoice_series"("organization_id", "year");

-- CreateIndex
CREATE INDEX "transactions_organization_id_invoice_issued_at_idx"
  ON "transactions"("organization_id", "invoice_issued_at");

-- AddForeignKey
ALTER TABLE "invoice_series"
  ADD CONSTRAINT "invoice_series_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_series_id_fkey"
  FOREIGN KEY ("series_id") REFERENCES "invoice_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;
