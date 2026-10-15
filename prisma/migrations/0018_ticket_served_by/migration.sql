-- Attribute each ticket to the staff member who called/served it, for the
-- per-employee performance reports.

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN "served_by_id" UUID;

-- CreateIndex
CREATE INDEX "tickets_served_by_id_status_idx" ON "tickets"("served_by_id", "status");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_served_by_id_fkey" FOREIGN KEY ("served_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
