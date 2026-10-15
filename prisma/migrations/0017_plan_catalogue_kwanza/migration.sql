-- B2B plan catalogue aligned with the official landing page (Kwanza).
-- The end-customer (B2C) plan stays separate at 2.000 Kz/month.

UPDATE "plans"
SET "name" = 'Free',
    "description" = 'Começa grátis, para sempre.',
    "price_cents" = 0,
    "updated_at" = now()
WHERE "code" = 'trial';

UPDATE "plans"
SET "name" = 'Essencial',
    "description" = 'Uma clínica ou loja com poucas filas.',
    "price_cents" = 10000000,
    "updated_at" = now()
WHERE "code" = 'starter';

UPDATE "plans"
SET "name" = 'Profissional',
    "description" = 'Várias filiais e equipas maiores.',
    "price_cents" = 20000000,
    "updated_at" = now()
WHERE "code" = 'growth';

UPDATE "plans"
SET "name" = 'Enterprise',
    "description" = 'Rede multi-filial com necessidades próprias.',
    "price_cents" = 25000000,
    "updated_at" = now()
WHERE "code" = 'enterprise';
