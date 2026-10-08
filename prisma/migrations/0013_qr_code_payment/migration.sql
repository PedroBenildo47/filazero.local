-- Phase 3 / Block 3: Angolan bank QR (EMVCo Merchant-Presented Mode).
--
-- Adds `QR_CODE` to the customer-facing payment methods. The new value is only
-- added here (never used in this transaction), which PostgreSQL 12+ allows.

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'QR_CODE';
