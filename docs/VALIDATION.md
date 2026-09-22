# Validação — FilaZero

Evidência dos testes executados. Nada aqui é simulado:

- Fases 1–2 validadas num motor PostgreSQL real (PGlite/WASM).
- Fases 3–6, 8, 10, 13 e 14 validadas num **PostgreSQL 18.4 real**, com as
  migrations aplicadas pelo próprio Prisma (`prisma migrate deploy`).
- Os testes HTTP correm contra um **servidor de produção** (`next start`) e a
  base de dados real.

## Resumo

| Suíte | Âmbito | Resultado |
| --- | --- | --- |
| Build | `prisma validate` · `tsc --noEmit` · `next lint` · `next build` | ✅ 0 erros |
| `npm run test:unit` | lógica pura | ✅ **81/81** |
| `npm run test:integration` | camada de serviços contra PostgreSQL | ✅ **67/67** |
| `npm run test:api` | HTTP real: auth, RBAC, queue engine, concorrência, SSE, CORS, cabeçalhos, rate limiting, **billing + quotas**, **email por SMTP** | ✅ **159/159** |
| **Total** | | ✅ **307/307** |

Migrations aplicadas: `0001_init` (schema), `0002_rate_limits` (rate limiting) e
`0003_billing` (planos, subscrições, transações + catálogo).

## Como executar

```bash
cp .env.example .env      # DATABASE_URL a apontar para um Postgres real
npm install
npm run db:migrate:deploy

npm run test:unit          # lógica pura (não precisa de base de dados)
npm run test:integration   # camada de serviços
npm run test:api:with-server   # build + servidor + suíte HTTP completa
```

Notas de execução:

- Os testes usam `NODE_OPTIONS=--conditions=react-server` para que o pacote
  `server-only` resolva fora do runtime do Next.js.
- O fluxo completo de recuperação de senha só é testável com
  `AUTH_EXPOSE_RESET_TOKEN=true` (o `test:api:with-server` define-o). Em produção
  o valor por omissão é `false` e a rota não devolve o token.

## Billing — planos, subscrições e pagamentos (39 verificações)

| Área | Verificações |
| --- | --- |
| Catálogo | público, planos por omissão presentes, plano trial é grátis |
| Subscrição | trial automático na criação da organização, limites vindos do plano, cliente não lê billing nem faz checkout (403) |
| Checkout | transação criada `PENDING`, referência pagável `FZ-…`, instruções B2B, **nada fica pago só por iniciar** |
| Webhook | sem assinatura → 401; segredo errado → 401; assinatura expirada → 400; corpo adulterado → 401; **nenhuma delas alterou a transação** |
| Confirmação | webhook assinado → 200, transação `SUCCEEDED`, subscrição `ACTIVE` |
| Idempotência | replay → `duplicate: true` e o período **não** é estendido duas vezes |
| Erros | referência desconhecida → 404 |
| Bloqueio por pagamento | subscrição `EXPIRED` → criar filial devolve **402 `PAYMENT_REQUIRED`** e a filial não é criada |
| Quotas | plano com `maxBranches=1` → 2ª filial 403 `QUOTA_EXCEEDED`; `maxQueuesPerBranch=1` → 2ª fila 403 |
| Entitlement | atribuir plano devolve 200 e **não cria transação** |

Detalhe do desenho em [BILLING.md](./BILLING.md).

## Email de recuperação por SMTP (14 verificações)

Um servidor SMTP real é levantado no processo de teste e a aplicação é
configurada para lhe entregar as mensagens:

| Verificação | Resultado |
| --- | --- |
| O pedido de recuperação é aceite (200) e reporta entrega real | ✅ |
| Com SMTP configurado, o token **nunca** é devolvido por HTTP | ✅ |
| A mensagem chega por uma conversa SMTP real, para o destinatário correto | ✅ |
| O cookie `filazero_lang=en` seleciona o template inglês (e não o PT) | ✅ |
| Sem cookie, o template é português (e não o EN) | ✅ |
| O link do email contém um token utilizável | ✅ |
| Esse token redefine a senha e a nova senha funciona | ✅ |
| O token do email é de uso único (2ª utilização → 400) | ✅ |
| Outros utilizadores não são afetados | ✅ |

## Fase 13 — segurança (28 verificações na suíte HTTP)

**Cabeçalhos** (em `/api/health` e no HTML): `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy`, CSP com `default-src 'self'` e
`frame-ancestors 'none'`, `Permissions-Policy`, HSTS em produção, e
`X-Powered-By` ausente.

**CORS**: pré-voo de origem permitida → 204 com `Access-Control-Allow-Origin` e
credenciais; pré-voo de origem desconhecida → 403; pedido de origem desconhecida
→ 403 com o envelope padrão; origem permitida → 200 com eco da origem;
`Vary: Origin` presente; pedidos sem `Origin` não são afetados.

**Rate limiting** (contadores em PostgreSQL, migração `0002`):
as primeiras 8 tentativas de login da mesma conta são processadas e a 9ª devolve
`429 RATE_LIMITED` com `Retry-After` e `RateLimit-Remaining: 0`; outras contas
continuam a entrar; a recuperação de senha é limitada a 3 por conta e a 4ª
devolve 429.

Detalhe das regras e dos cabeçalhos em [SECURITY.md](./SECURITY.md).

## i18n PT/EN (7 testes unitários + smoke HTTP)

- Dicionários `pt` e `en` com as mesmas chaves (garantido pelo TypeScript e
  verificado em runtime), nenhuma tradução vazia, interpolação de parâmetros.
- Todas as mensagens de erro do backend (`BAD_REQUEST` … `RATE_LIMITED`) têm
  tradução nos dois idiomas — o mapeamento é feito por **código**, por isso a
  lógica do backend não mudou.
- Seletor de idioma persistido (`localStorage` + cookie) presente no HTML
  servido; português é o idioma por omissão.
- Smoke HTTP: `/`, `/pesquisar`, `/login` e `/registar` respondem 200.

## Fase 8 — frontend integrado

- `next build` compila as 10 páginas e os 36 endpoints.
- O frontend não importa serviços nem Prisma: toda a leitura passa por `/api/*`.
- Os smoke tests confirmam que as páginas públicas são servidas.

## Fase 10 — tempo real

| Verificação | Resultado |
| --- | --- |
| O stream responde 200 e `Content-Type: text/event-stream` | ✅ |
| Envia `ready` ao ligar | ✅ |
| Entrega `ticket.joined` quando um cliente entra | ✅ |
| O evento leva `id:` para `Last-Event-ID` | ✅ |
| O stream permanece aberto para eventos seguintes | ✅ |
| Entrega `ticket.called` quando o staff chama | ✅ |

## Fase 14 — testes

### Unitários (62)

| Ficheiro | Cobertura |
| --- | --- |
| `rbac.test.ts` | permissões por papel, `assertCan`, administrador tem todas |
| `validation.test.ts` | email/password/telefone, paginação, esquemas de organização/membro/fila |
| `errors.test.ts` | códigos → HTTP, mensagens estáveis |
| `ticket-state.test.ts` | máquina de estados do ticket |
| `member-rules.test.ts` | promoção de papel global |
| `rate-limit-rules.test.ts` | janelas, limites, `Retry-After` |
| `i18n.test.ts` | dicionários PT/EN, interpolação, cobertura dos códigos de erro |

### API sobre HTTP (107)

Autenticação, permissões por papel, queue engine, **concorrência real**
(entradas e `call-next` em paralelo), notificações, auditoria, SSE, CORS,
cabeçalhos de segurança, rate limiting e smoke do frontend.

### Integração da camada de serviços (67)

`tests/integration/phases-3-6.test.ts` exercita os serviços reais contra
PostgreSQL, incluindo `call-next` concorrente.

## Fundação (Fases 1–2)

`prisma validate`/`format`, geração das migrations, e 8 verificações de
integridade (índices parciais `tickets_one_active_per_user_queue` e
`organization_members_all_branches_key`, `UNIQUE (queue_id, ticket_number)`,
cascatas, enums).

## Fase 15 — deploy

Validado neste ambiente (que **não tem Docker**):

- `next build` com `output: "standalone"` produz `.next/standalone/server.js`,
  que é exatamente o que o stage `runner` copia;
- o `docker-compose.yml` é YAML válido: serviços `db`, `migrate`, `app`; volume
  `db-data`; `app` depende de `db` saudável e de `migrate` concluído; os targets
  referenciados (`migrator`, `runner`) existem no Dockerfile;
- os paths copiados entre stages existem no repositório (`public/`, `prisma/`,
  `.next/static`).

As imagens **não foram construídas** aqui — ver [DEPLOY.md](./DEPLOY.md).

## Limitações conhecidas (honestas)

- **Pagamentos com cartão:** o adaptador Stripe faz a chamada REST real mas
  **não foi exercitado** (sem credenciais de PSP neste ambiente). O provider
  `invoice` (B2B) é o que está testado de ponta a ponta.
- **Email:** sem `SMTP_HOST` não há envio; fora de produção o token é devolvido
  na resposta.
- **Corpo das notificações:** gerado pelo backend em português; a UI traduz o
  tipo, o texto vem da base de dados.
- **Tempo real multi-instância:** bus in-process; requer transporte partilhado.
- **CSP:** `script-src` com `'unsafe-inline'` (sem pipeline de nonce).
- **Docker:** imagens não construídas neste ambiente (sem Docker).
