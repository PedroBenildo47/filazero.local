-- ===========================================================================
-- 0006_queue_public_code
--
-- Adds a short, human-typable public code to every queue so customers can
-- enter a queue by scanning a QR code, following a direct link, or typing the
-- code — without exposing (or requiring) the internal UUID.
--
-- Existing rows are back-filled deterministically from the row id, then the
-- column becomes NOT NULL + UNIQUE.
-- ===========================================================================

-- AddColumn
ALTER TABLE "queues" ADD COLUMN "public_code" VARCHAR(12);

-- Backfill (md5 of the UUID is unique per row; 8 hex chars keep it short).
UPDATE "queues"
SET "public_code" = UPPER(SUBSTR(MD5("id"::text), 1, 8))
WHERE "public_code" IS NULL;

-- Enforce
ALTER TABLE "queues" ALTER COLUMN "public_code" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "queues_public_code_key" ON "queues"("public_code");
