-- Phase 4 / Block 4: kiosk (totem) mode and guest tickets.
--
-- Walk-in customers take a ticket without creating an account, so `user_id`
-- becomes nullable and optional guest identity is stored inline. A queue only
-- accepts kiosk tickets when `kiosk_enabled` is true.

-- AlterTable
ALTER TABLE "queues" ADD COLUMN     "kiosk_enabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "guest_name" VARCHAR(120),
ADD COLUMN     "guest_phone" VARCHAR(32),
ALTER COLUMN "user_id" DROP NOT NULL;
