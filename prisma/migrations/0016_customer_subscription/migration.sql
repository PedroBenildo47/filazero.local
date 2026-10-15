-- End-customer (B2C) subscription: 1 month free, then 2.000 Kz / month.

-- CreateTable
CREATE TABLE "customer_subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "current_period_start" TIMESTAMPTZ(6) NOT NULL,
    "current_period_end" TIMESTAMPTZ(6) NOT NULL,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_payments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "subscription_id" UUID,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "method" "PaymentMethod" NOT NULL DEFAULT 'MULTICAIXA_EXPRESS',
    "provider" "PaymentProvider" NOT NULL DEFAULT 'INVOICE',
    "amount_cents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "reference" VARCHAR(64) NOT NULL,
    "provider_reference" VARCHAR(200),
    "provider_event_id" VARCHAR(200),
    "proof_submitted_at" TIMESTAMPTZ(6),
    "paid_at" TIMESTAMPTZ(6),
    "failure_reason" VARCHAR(300),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_payment_proofs" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "content" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_payment_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_subscriptions_user_id_key" ON "customer_subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "customer_subscriptions_status_current_period_end_idx" ON "customer_subscriptions"("status", "current_period_end");

-- CreateIndex
CREATE UNIQUE INDEX "customer_payments_reference_key" ON "customer_payments"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "customer_payments_provider_event_id_key" ON "customer_payments"("provider_event_id");

-- CreateIndex
CREATE INDEX "customer_payments_user_id_status_idx" ON "customer_payments"("user_id", "status");

-- CreateIndex
CREATE INDEX "customer_payments_status_created_at_idx" ON "customer_payments"("status", "created_at");

-- CreateIndex
CREATE INDEX "customer_payment_proofs_payment_id_created_at_idx" ON "customer_payment_proofs"("payment_id", "created_at");

-- AddForeignKey
ALTER TABLE "customer_subscriptions" ADD CONSTRAINT "customer_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "customer_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payment_proofs" ADD CONSTRAINT "customer_payment_proofs_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "customer_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
