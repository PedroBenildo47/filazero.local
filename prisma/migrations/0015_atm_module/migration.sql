-- ATM network (Multicaixa): location and cash status.

-- CreateEnum
CREATE TYPE "AtmStatus" AS ENUM ('OPERATIONAL', 'OUT_OF_CASH', 'OFFLINE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AtmReportSource" AS ENUM ('COMMUNITY', 'MANAGER', 'ADMIN', 'FEED');

-- CreateTable
CREATE TABLE "atms" (
    "id" UUID NOT NULL,
    "bank" VARCHAR(120) NOT NULL,
    "label" VARCHAR(160),
    "address" VARCHAR(255) NOT NULL,
    "city" VARCHAR(120) NOT NULL,
    "province" VARCHAR(120),
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "status" "AtmStatus" NOT NULL DEFAULT 'UNKNOWN',
    "cash_level" INTEGER,
    "notes" VARCHAR(300),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_reported_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "atms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "atm_reports" (
    "id" UUID NOT NULL,
    "atm_id" UUID NOT NULL,
    "status" "AtmStatus" NOT NULL,
    "note" VARCHAR(300),
    "source" "AtmReportSource" NOT NULL DEFAULT 'COMMUNITY',
    "reporter_user_id" UUID,
    "reporter_name" VARCHAR(120),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "atm_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "atms_city_status_idx" ON "atms"("city", "status");

-- CreateIndex
CREATE INDEX "atms_status_idx" ON "atms"("status");

-- CreateIndex
CREATE INDEX "atms_bank_idx" ON "atms"("bank");

-- CreateIndex
CREATE INDEX "atm_reports_atm_id_created_at_idx" ON "atm_reports"("atm_id", "created_at");

-- CreateIndex
CREATE INDEX "atm_reports_source_created_at_idx" ON "atm_reports"("source", "created_at");

-- AddForeignKey
ALTER TABLE "atm_reports" ADD CONSTRAINT "atm_reports_atm_id_fkey" FOREIGN KEY ("atm_id") REFERENCES "atms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atm_reports" ADD CONSTRAINT "atm_reports_reporter_user_id_fkey" FOREIGN KEY ("reporter_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
