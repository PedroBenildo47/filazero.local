-- Commercial subscription model: 1 month free trial, then 2.000 Kz / month.
--
-- The `starter` plan becomes the paid monthly plan at 2.000 Kz (200000 cents).
-- The `trial` plan stays free and is granted for 30 days (TRIAL_DAYS=30).

UPDATE "plans"
SET "name" = 'FilaZero Mensal',
    "description" = '1 mês de teste grátis, depois 2.000 Kz por mês.',
    "price_cents" = 200000,
    "interval" = 'MONTHLY',
    "active" = true,
    "updated_at" = now()
WHERE "code" = 'starter';

UPDATE "plans"
SET "description" = '1 mês de teste grátis (30 dias).',
    "updated_at" = now()
WHERE "code" = 'trial';
