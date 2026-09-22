# `src/server` — camada de servidor

Toda a lógica de negócio e de acesso a dados. **Nada aqui pode ser importado por
componentes de cliente.** O frontend fala com o backend apenas através das rotas
HTTP em `src/app/api`.

## Regras de camadas

```
Route handler (src/app/api/**/route.ts)
        │  valida entrada, monta AuthContext, chama o serviço
        ▼
Service (src/server/<módulo>/*.service.ts)
        │  regras de negócio, transações, concorrência
        ▼
Prisma / PostgreSQL (src/lib/db.ts)
```

- **Rotas** não contêm regras de negócio: validam (zod), autenticam
  (`requireAuth`), delegam.
- **Serviços** são a única porta para o banco em nome de um utilizador.
- Toda query multi-tenant é limitada por `organizationId`/`branchId`
  (`context.ts`). Nunca se confia no ID recebido.
- Permissões verificadas com `rbac.ts` (`requirePermission`) antes de cada
  mutação, e âmbito verificado com `assertOrganizationAccess` /
  `assertBranchAccess`.

## Módulos

| Módulo | Ficheiros | Estado |
| --- | --- | --- |
| `auth/` | `auth.service.ts`, `session.store.ts`, `session-cookie.ts`, `password.ts`, `tokens.ts`, `auth.schemas.ts` | ✅ Fase 3 |
| `organizations/` | `organization.service.ts`, `branch.service.ts`, `member.service.ts`, `public.service.ts` + schemas | ✅ Fase 4 |
| `queues/` | `queue.service.ts`, `queue.schemas.ts` | ✅ Fase 5 |
| `tickets/` | `ticket.service.ts`, `ticket.schemas.ts` | ✅ Fase 6 |
| `notifications/` | `notification.service.ts` | ✅ Fase 6 |
| `realtime/` | `bus.ts` (publish/subscribe por fila) | ✅ Fase 10 |
| `security/` | `rate-limit.rules.ts`, `rate-limit.service.ts` | ✅ Fase 13 |
| `billing/` | `plan.service.ts`, `plan-guard.ts`, `subscription.service.ts`, `payment-provider.ts`, `signature.ts`, `billing.rules.ts`, `billing.service.ts` | ✅ Billing |
| `email/` | `mailer.ts`, `templates.ts`, `email.service.ts` | ✅ Email |
| `audit/` | `audit.service.ts` | ✅ Fases 3–6 |
| `context.ts`, `rbac.ts`, `serializers.ts` | fundação transversal | ✅ Fase 1 |

## Autenticação (Fase 3)

- Tokens opacos de 256 bits; o banco guarda apenas `HMAC-SHA256(token, AUTH_SECRET)`
  (`sessions.token_hash`).
- Cookie `filazero_session`: `httpOnly`, `Secure` em produção, `SameSite=Lax`.
- `resolveAuthContext(token)` devolve `null` para token desconhecido, revogado,
  expirado, ou de utilizador não-ACTIVE.
- Recuperação de senha com tokens de uso único (`password_reset_tokens`,
  guardados em hash) e revogação de todas as sessões ao redefinir.
- Alterar senha revoga as outras sessões.

## Queue engine (Fase 6)

| Operação | Mecanismo |
| --- | --- |
| Entrar na fila | `SELECT ... FOR UPDATE` na linha da fila → incrementa `queues.ticket_sequence` de forma atómica; índice parcial `tickets_one_active_per_user_queue` impede tickets ativos duplicados |
| Posição | `computeLivePosition()` conta os `WAITING` à frente (FIFO por `joined_at`, `ticket_number`); a coluna `position` é cache reescrita em cada mutação |
| Chamar próximo | lock da fila (`FOR UPDATE`) + `SELECT ... FOR UPDATE SKIP LOCKED` no próximo `WAITING`; rejeita se já existe ticket em `CALLED`/`SERVING` |
| Atender / Concluir / Não compareceu | transições condicionais validadas (`status` de origem obrigatório) |
| Sair / Cancelar | estado terminal + recálculo de posições |
| Notificações | criadas na **mesma transação** da mudança de estado |

## Tempo real (Fase 10)

`bus.ts` publica eventos de domínio (sinais de invalidação, não estado) que a
rota `GET /api/queues/[queueId]/stream` entrega por SSE. Os serviços chamam
`publishQueueEvent` **depois** do commit, para nunca anunciar algo não
persistido. O bus é in-process: num deploy multi-instância substituir apenas
este módulo (Postgres LISTEN/NOTIFY ou Redis).

## Testes

| Comando | Alvo |
| --- | --- |
| `npm run test:unit` | lógica pura (`ticket.state.ts`, `member.rules.ts`, `rbac`, validação, erros, rate-limit rules, i18n) |
| `npm run test:integration` | camada de serviços contra PostgreSQL |
| `npm run test:api` | HTTP real (auth, RBAC, queue engine, concorrência, SSE, CORS, cabeçalhos, rate limiting, billing, email/SMTP) |

## Billing (guard de plano)

O “middleware” de limites vive em `billing/plan-guard.ts` e é chamado **dentro**
dos serviços de filial, fila e membro — não em middleware Edge, que não tem
acesso à base de dados. Assim não existe rota alternativa que contorne a
verificação. Estados de subscrição e quotas em `billing/`; regras puras
(períodos, normalização de eventos) em `billing.rules.ts`; assinatura de webhook
em `signature.ts`.

## Segurança (Fase 13)

`security/rate-limit.*` implementa o rate limiting com contadores em PostgreSQL:
UPSERT atómico na tabela `rate_limit_counters`, partilhado por todas as
instâncias. É aplicado nos **route handlers** de autenticação (nunca nos
serviços), para manter a camada de domínio livre de preocupações de transporte.
CORS vive em `src/middleware.ts` e os cabeçalhos em `next.config.mjs` — ver
`docs/SECURITY.md`.
