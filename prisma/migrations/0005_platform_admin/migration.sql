-- ===========================================================================
-- 0005_platform_admin
--
-- Indexes supporting the Super Admin (platform operator) surface:
--   * organizations: newest-first global listing / filters
--   * transactions: revenue aggregation over paid transactions
--   * audit_logs: global reverse-chronological audit trail
--
-- No new tables are required: the existing schema (organizations, plans,
-- subscriptions, transactions, audit_logs) already models everything the
-- platform panel reads. Permanent organization deletion relies on the existing
-- ON DELETE CASCADE foreign keys.
-- ===========================================================================

-- CreateIndex
CREATE INDEX "organizations_created_at_idx" ON "organizations"("created_at");

-- CreateIndex
CREATE INDEX "transactions_status_paid_at_idx" ON "transactions"("status", "paid_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");
