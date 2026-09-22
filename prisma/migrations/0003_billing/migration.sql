-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('INVOICE', 'STRIPE');

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "price_cents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'AOA',
    "interval" "BillingInterval" NOT NULL DEFAULT 'MONTHLY',
    "max_branches" INTEGER NOT NULL,
    "max_queues_per_branch" INTEGER NOT NULL,
    "max_staff" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "current_period_start" TIMESTAMPTZ(6) NOT NULL,
    "current_period_end" TIMESTAMPTZ(6) NOT NULL,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "subscription_id" UUID,
    "plan_id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'INVOICE',
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "amount_cents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "reference" VARCHAR(64) NOT NULL,
    "provider_reference" VARCHAR(200),
    "provider_event_id" VARCHAR(200),
    "paid_at" TIMESTAMPTZ(6),
    "failure_reason" VARCHAR(300),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE INDEX "plans_active_idx" ON "plans"("active");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_organization_id_key" ON "subscriptions"("organization_id");

-- CreateIndex
CREATE INDEX "subscriptions_status_current_period_end_idx" ON "subscriptions"("status", "current_period_end");

-- CreateIndex
CREATE INDEX "subscriptions_plan_id_idx" ON "subscriptions"("plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_reference_key" ON "transactions"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_provider_event_id_key" ON "transactions"("provider_event_id");

-- CreateIndex
CREATE INDEX "transactions_organization_id_status_idx" ON "transactions"("organization_id", "status");

-- CreateIndex
CREATE INDEX "transactions_status_created_at_idx" ON "transactions"("status", "created_at");

-- CreateIndex
CREATE INDEX "transactions_plan_id_idx" ON "transactions"("plan_id");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Default product catalogue.
--
-- Real product data, present in every migrated database so a new organization
-- can always be placed on a trial without a manual seed step. Idempotent thanks
-- to the unique `code` (the seed re-applies the same values).
-- ---------------------------------------------------------------------------
INSERT INTO "plans" (
  "id", "code", "name", "description", "price_cents", "currency", "interval",
  "max_branches", "max_queues_per_branch", "max_staff", "active",
  "created_at", "updated_at"
) VALUES
  ('00000000-0000-4000-8000-000000000001', 'trial', 'Trial',
   'Periodo de avaliacao, sem custo.', 0, 'AOA', 'MONTHLY', 3, 15, 10, true, now(), now()),
  ('00000000-0000-4000-8000-000000000002', 'starter', 'Starter',
   'Uma clinica ou loja com poucas filas.', 2500000, 'AOA', 'MONTHLY', 3, 20, 15, true, now(), now()),
  ('00000000-0000-4000-8000-000000000003', 'growth', 'Growth',
   'Varias filiais e equipas maiores.', 7500000, 'AOA', 'MONTHLY', 10, 40, 60, true, now(), now()),
  ('00000000-0000-4000-8000-000000000004', 'enterprise', 'Enterprise',
   'Rede multi-filial com necessidades proprias.', 20000000, 'AOA', 'MONTHLY', 100, 200, 1000, true, now(), now())
ON CONFLICT ("code") DO NOTHING;
