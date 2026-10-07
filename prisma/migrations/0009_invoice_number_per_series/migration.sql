-- Phase 4 / Block 1 follow-up: invoice numbers are unique **per series**, not
-- globally. Every taxpayer numbers its own documents inside its own series, so
-- two organizations legitimately share `FR2026/000001`. Uniqueness is therefore
-- enforced on (series_id, sequence).

-- DropIndex
DROP INDEX IF EXISTS "transactions_invoice_number_key";

-- CreateIndex
CREATE UNIQUE INDEX "transactions_series_id_sequence_key"
  ON "transactions"("series_id", "sequence");
