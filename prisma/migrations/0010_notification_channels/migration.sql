-- Phase 4 / Block 3: SMS and WhatsApp notifications.
--
-- Adds per-user consent flags and the delivery outbox. A delivery row is created
-- in the same transaction as its notification, then claimed and sent by the
-- dispatcher (`FOR UPDATE SKIP LOCKED`), so the external channel can never
-- describe an event that did not commit and retries stay idempotent.

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "sms_opt_in" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "whatsapp_opt_in" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "recipient" VARCHAR(32) NOT NULL,
    "provider" VARCHAR(40),
    "provider_message_id" VARCHAR(200),
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_deliveries_status_created_at_idx" ON "notification_deliveries"("status", "created_at");

-- CreateIndex
CREATE INDEX "notification_deliveries_user_id_created_at_idx" ON "notification_deliveries"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_notification_id_channel_key" ON "notification_deliveries"("notification_id", "channel");

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
