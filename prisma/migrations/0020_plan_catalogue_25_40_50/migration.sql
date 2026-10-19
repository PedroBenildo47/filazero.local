-- Plan catalogue aligned with the current commercial offer:
--   Free        → 0 Kz
--   Essencial   → 25.000 Kz / month
--   Profissional→ 40.000 Kz / month
--   Enterprise  → 50.000 Kz / month
-- The end-customer (B2C) plan stays separate at 2.000 Kz / month.

UPDATE "plans"
SET "name" = 'Free',
    "description" = 'Começa grátis, para sempre. Uma filial e até 5 filas.',
    "price_cents" = 0,
    "updated_at" = now()
WHERE "code" = 'trial';

UPDATE "plans"
SET "name" = 'Essencial',
    "description" = 'Para clínicas e lojas com poucas filas.',
    "price_cents" = 2500000,
    "updated_at" = now()
WHERE "code" = 'starter';

UPDATE "plans"
SET "name" = 'Profissional',
    "description" = 'Várias filiais e equipas maiores.',
    "price_cents" = 4000000,
    "updated_at" = now()
WHERE "code" = 'growth';

UPDATE "plans"
SET "name" = 'Enterprise',
    "description" = 'Rede multi-filial com necessidades próprias.',
    "price_cents" = 5000000,
    "updated_at" = now()
WHERE "code" = 'enterprise';
