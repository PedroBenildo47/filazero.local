-- FASE 4: queue ticket prefixes and service counters (guichês).

-- AlterTable
ALTER TABLE "queues" ADD COLUMN "prefix" VARCHAR(3);

-- CreateTable
CREATE TABLE "counters" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "counters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "counters_branch_id_name_key" ON "counters"("branch_id", "name");

-- CreateIndex
CREATE INDEX "counters_organization_id_active_idx" ON "counters"("organization_id", "active");

-- AlterTable
ALTER TABLE "organization_members" ADD COLUMN "counter_id" UUID;

-- CreateIndex
CREATE INDEX "organization_members_counter_id_idx" ON "organization_members"("counter_id");

-- AddForeignKey
ALTER TABLE "counters" ADD CONSTRAINT "counters_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counters" ADD CONSTRAINT "counters_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_counter_id_fkey" FOREIGN KEY ("counter_id") REFERENCES "counters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
