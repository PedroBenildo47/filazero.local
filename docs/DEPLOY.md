# Deploy — FilaZero (Fase 15)

Empacotamento de produção com Docker. Nenhum segredo é necessário para
construir a imagem: a validação de ambiente é lazy, portanto a mesma imagem
serve qualquer ambiente.

## 1. Imagem (multi-stage)

| Stage | Conteúdo | Para que serve |
| --- | --- | --- |
| `deps` | `npm ci` com `prisma/` presente | gera o Prisma Client uma só vez |
| `builder` | `prisma generate` + `next build` | produz `.next/standalone` |
| `migrator` | `node_modules` + CLI do Prisma + `prisma/` | corre `prisma migrate deploy` |
| `runner` | standalone + estáticos, utilizador `nextjs` (não-root) | serve a aplicação |

```bash
docker build --target runner   -t filazero:latest .
docker build --target migrator -t filazero:migrate .
```

O `runner` arranca com `node server.js`, expõe `:3000` e tem um `HEALTHCHECK`
que chama `GET /api/health` (esse endpoint faz um `SELECT 1` real).

## 2. Stack completa (recomendado)

`docker-compose.yml` sobe três serviços:

```
db       postgres:16-alpine, volume persistente, healthcheck pg_isready
migrate  one-off: prisma migrate deploy  (termina com sucesso antes do app)
app      depende de db saudável e de migrate concluído
```

```bash
cp .env.example .env
# editar .env: definir pelo menos AUTH_SECRET (openssl rand -base64 48)
docker compose up --build -d
docker compose logs -f app
```

O `app` só arranca depois de `migrate` terminar com sucesso, pelo que o schema
nunca fica atrás do código.

## 3. Variáveis de ambiente essenciais

Todas documentadas em [`.env.example`](../.env.example). As que impedem o
arranque se faltarem:

| Variável | Nota |
| --- | --- |
| `DATABASE_URL` | ligação PostgreSQL |
| `AUTH_SECRET` | >= 32 caracteres; assina as sessões e os tokens de reset |
| `APP_URL` | URL pública (usada nos links de email e no CORS) |
| `ALLOWED_ORIGINS` | origens extra permitidas (o próprio `APP_URL` já é aceite) |

Funcionalidades opcionais:

| Variável | Efeito se vazia |
| --- | --- |
| `SMTP_HOST` | não há envio de email; o link de reset só aparece fora de produção |
| `PAYMENT_WEBHOOK_SECRET` | o webhook de pagamentos recusa correr (503) — nenhum caminho sem assinatura |
| `PAYMENT_CHECKOUT_URL_TEMPLATE` | checkout devolve só a referência e os dados bancários (B2B) |
| `STRIPE_SECRET_KEY` | `PAYMENT_PROVIDER=stripe` falha com 503 em vez de fingir um checkout |
| `BILLING_BANK_*` | a fatura não imprime dados bancários |

Produção: `AUTH_EXPOSE_RESET_TOKEN=false` (por omissão).

## 4. Migrações

```bash
# via compose (corre antes do app)
docker compose run --rm migrate

# sem compose
docker run --rm -e DATABASE_URL=... filazero:migrate
```

As migrações aplicadas são `0001_init`, `0002_rate_limits` e `0003_billing`
(esta última inclui o catálogo de planos).

## 5. Contentor único

Se não usar compose, a ordem é: base de dados -> migração -> aplicação.

```bash
docker network create filazero
docker run -d --name fz-db --network filazero \
  -e POSTGRES_PASSWORD=... -e POSTGRES_DB=filazero postgres:16-alpine

docker run --rm --network filazero -e DATABASE_URL=... filazero:migrate

docker run -d --name fz-app --network filazero -p 3000:3000 \
  -e DATABASE_URL=... -e AUTH_SECRET=... -e APP_URL=https://filazero.ao \
  -e ALLOWED_ORIGINS=https://filazero.ao filazero:latest
```

## 6. Proxy reverso e TLS

Termine o TLS num proxy (Caddy, Traefik, nginx) e encaminhe para `app:3000`.

- Envie `X-Forwarded-For` (usado para o rate limiting por IP) e `X-Forwarded-Proto`.
- HSTS já é emitido pela aplicação em produção; não o duplique com `max-age`
  diferente.
- O SSE (`/api/queues/{id}/stream`) precisa de buffering desativado:
  nginx `proxy_buffering off;`, `proxy_read_timeout 1h;`.

## 7. Operação

| Tarefa | Comando |
| --- | --- |
| Ver logs | `docker compose logs -f app` |
| Estado | `docker compose ps` |
| Verificação | `curl -f https://<host>/api/health` |
| Parar | `docker compose down` |
| Parar e apagar dados | `docker compose down -v` |

**Backups:** `pg_dump` do serviço `db`:

```bash
docker compose exec db pg_dump -U filazero filazero > backup-$(date +%F).sql
```

**Atualizar:**

```bash
git pull
docker compose build app migrate
docker compose up -d       # migrate corre primeiro, o app arranca depois
```

Para reverter, faça checkout da versão anterior e repita; as migrações são
aditivas, por isso uma imagem anterior continua a funcionar com o schema novo.

## 8. Notas de escala

- **Múltiplas instâncias:** o bus de tempo real é in-process
  (`src/server/realtime/bus.ts`). Com mais de uma réplica é preciso um
  transporte partilhado (Postgres LISTEN/NOTIFY ou Redis) — é o único ponto a
  substituir.
- **Rate limiting** já é partilhado (contadores em PostgreSQL).
- **Pool de ligações:** com um pooler (PgBouncer), use `DATABASE_URL` com
  `?pgbouncer=true&connection_limit=1` e reserve uma ligação direta para
  migrações.

## 9. Limitação desta validação

O sandbox onde o projeto foi construído **não tem Docker**, por isso as imagens
não foram construídas aqui: o que foi validado é o `next build` com
`output: "standalone"` (origem do `server.js` do runner), a sintaxe do
`docker-compose.yml` e a coerência dos caminhos copiados entre stages. O
primeiro `docker compose up --build` deve ser corrido num ambiente com Docker.
