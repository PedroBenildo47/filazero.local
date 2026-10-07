-- Phase 3: B2B payments and subscriptions.
--
-- Adds the customer-facing payment method, a review state for uploaded proofs,
-- a sequential invoice number, the proof storage table and the atomic counter
-- used to number invoices.

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('MULTICAIXA_EXPRESS', 'BANK_TRANSFER', 'CARD');

-- AlterEnum (new value is only used by later writes, never in this migration)
ALTER TYPE "TransactionStatus" ADD VALUE 'UNDER_REVIEW';

-- AlterTable
ALTER TABLE "transactions"
  ADD COLUMN "method" "PaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
  ADD COLUMN "invoice_number" VARCHAR(40),
  ADD COLUMN "proof_submitted_at" TIMESTAMPTZ(6),
  ADD COLUMN "receipt_sent_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE UNIQUE INDEX "transactions_invoice_number_key" ON "transactions"("invoice_number");

-- CreateTable
CREATE TABLE "payment_proofs" (
  "id" UUID NOT NULL,
  "transaction_id" UUID NOT NULL,
  "uploaded_by_id" UUID,
  "file_name" VARCHAR(255) NOT NULL,
  "mime_type" VARCHAR(100) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "content" BYTEA NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_counters" (
  "scope" VARCHAR(40) NOT NULL,
  "period" VARCHAR(10) NOT NULL,
  "value" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "billing_counters_pkey" PRIMARY KEY ("scope", "period")
);

-- CreateIndex
CREATE INDEX "payment_proofs_transaction_id_created_at_idx" ON "payment_proofs"("transaction_id", "created_at");

-- AddForeignKey
ALTER TABLE "payment_proofs"
  ADD CONSTRAINT "payment_proofs_transaction_id_fkey"
  FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_proofs"
  ADD CONSTRAINT "payment_proofs_uploaded_by_id_fkey"
  FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
