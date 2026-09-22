# API — FilaZero

Todas as respostas usam o envelope padrão:

```jsonc
// sucesso
{ "data": { /* ... */ } }

// erro
{ "error": { "code": "FORBIDDEN", "message": "...", "details": { /* opcional */ } } }
```

Autenticação por cookie `filazero_session` (httpOnly). Nenhum token é aceite por
cabeçalho `Authorization` nesta versão.

Códigos de erro: `BAD_REQUEST`, `VALIDATION_ERROR`, `UNAUTHENTICATED`,
`SESSION_EXPIRED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `QUEUE_CLOSED`,
`INVALID_STATE`, `RATE_LIMITED`, `PAYMENT_REQUIRED`, `QUOTA_EXCEEDED`,
`SERVICE_UNAVAILABLE`, `INTERNAL`.

### Recuperação de senha

`POST /api/auth/password/forgot` responde sempre `{ "accepted": true }` (sem
enumeração de contas). Com SMTP configurado envia o link no idioma do cookie
`filazero_lang` (PT por omissão) e devolve `delivered: true`, **sem** expor o
token. Sem SMTP, e apenas fora de produção (`AUTH_EXPOSE_RESET_TOKEN=true`),
devolve também `resetToken` para o fluxo continuar testável.

`POST /api/auth/password/reset` consome esse token (uso único) em
`{ token, password }`.

---

## Autenticação (Fase 3)

| Método | Rota | Acesso | Descrição |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | público | Cria conta CUSTOMER e abre sessão |
| POST | `/api/auth/login` | público | Autentica, abre sessão |
| POST | `/api/auth/logout` | sessão | Revoga a sessão e limpa o cookie |
| GET | `/api/auth/session` | sessão | Utilizador atual + filiações |
| POST | `/api/auth/password/forgot` | público | Pede recuperação (resposta uniforme) |
| POST | `/api/auth/password/reset` | público | Redefine com token de uso único |
| POST | `/api/auth/password/change` | sessão | Altera senha; revoga outras sessões |

`POST /api/auth/register`
```json
{ "name": "Ana", "email": "ana@exemplo.ao", "phone": "+244 900 000 000", "password": "..." }
```

`POST /api/auth/password/forgot` devolve `{ "accepted": true }`. Fora de produção
inclui `resetToken` (não há provedor de email configurado — ver
`docs/ARCHITECTURE.md`). Em produção **nunca** é devolvido.

## Organizações, filiais e membros (Fase 4)

| Método | Rota | Permissão |
| --- | --- | --- |
| GET | `/api/organizations` | sessão (admin vê todas; restantes só as suas) |
| POST | `/api/organizations` | `organization:manage` (ADMINISTRATOR) |
| GET | `/api/organizations/{id}` | membro da organização ou admin |
| PATCH | `/api/organizations/{id}` | MANAGER da organização ou admin |
| PATCH | `/api/organizations/{id}/status` | `platform:admin` |
| GET | `/api/organizations/{id}/branches` | membro da organização |
| POST | `/api/organizations/{id}/branches` | MANAGER da organização ou admin |
| GET | `/api/organizations/{id}/branches/{branchId}` | membro com acesso à filial |
| PATCH | `/api/organizations/{id}/branches/{branchId}` | MANAGER da organização ou admin |
| GET | `/api/organizations/{id}/members` | membro da organização |
| POST | `/api/organizations/{id}/members` | `member:manage` |
| PATCH | `/api/organizations/{id}/members/{memberId}` | `member:manage` |
| DELETE | `/api/organizations/{id}/members/{memberId}` | `member:manage` |
| GET | `/api/organizations/{id}/users?q=` | `member:manage` |
| GET | `/api/public/organizations?q=&city=&page=` | público |
| GET | `/api/public/organizations/{id}` | público |

`POST .../members` aceita um utilizador existente ou cria uma conta nova:
```jsonc
{ "userId": "…", "role": "STAFF", "branchId": "…" }
// ou
{ "name": "João", "email": "joao@exemplo.ao", "password": "…", "role": "MANAGER", "branchId": null }
```
`branchId: null` significa acesso a todas as filiais da organização.

## Filas (Fase 5)

| Método | Rota | Permissão |
| --- | --- | --- |
| GET | `/api/queues/{queueId}` | público (estado e nº de pessoas) |
| PATCH | `/api/queues/{queueId}` | `queue:manage` |
| PATCH | `/api/queues/{queueId}/status` | `queue:manage` |
| GET | `/api/queues/{queueId}/staff` | membro com acesso à filial |
| GET | `/api/branches/{branchId}/queues` | membro com acesso à filial |
| POST | `/api/branches/{branchId}/queues` | `queue:manage` |

`status`: `OPEN` · `PAUSED` · `CLOSED`. Ao passar de `OPEN` para outro estado,
todos os clientes em espera recebem notificação real.

## Tickets / queue engine (Fase 6)

| Método | Rota | Acesso | Descrição |
| --- | --- | --- | --- |
| POST | `/api/queues/{queueId}/tickets` | `ticket:join` | Entra na fila (ticket real + posição) |
| GET | `/api/queues/{queueId}/state` | staff da organização | Estado operacional da fila |
| POST | `/api/queues/{queueId}/call-next` | `ticket:call` | Chama o próximo (locking) |
| GET | `/api/tickets/me` | sessão | Ticket ativo + histórico |
| GET | `/api/tickets/{ticketId}` | dono ou staff da organização | Detalhe (posição calculada ao vivo) |
| POST | `/api/tickets/{ticketId}/leave` | dono (WAITING) ou staff | Sai da fila |
| POST | `/api/tickets/{ticketId}/serve` | `ticket:serve` | Inicia atendimento (`CALLED`→`SERVING`) |
| POST | `/api/tickets/{ticketId}/complete` | `ticket:complete` | Conclui (`SERVING`→`COMPLETED`) |
| POST | `/api/tickets/{ticketId}/no-show` | `ticket:cancel` | Marca não compareceu (`CALLED`→`NO_SHOW`) |
| POST | `/api/tickets/{ticketId}/cancel` | dono (WAITING) ou `ticket:cancel` | Cancela |

Transições inválidas devolvem `INVALID_STATE`; fila fechada devolve `QUEUE_CLOSED`.

## Tempo real (Fase 10)

| Método | Rota | Acesso | Descrição |
| --- | --- | --- | --- |
| GET | `/api/queues/{queueId}/stream` | sessão | Server-Sent Events da fila |

O stream emite `ready` ao ligar e depois os eventos de domínio:
`ticket.joined`, `ticket.left`, `ticket.called`, `ticket.serving`,
`ticket.completed`, `ticket.cancelled`, `ticket.no_show`,
`queue.status_changed`. Cada evento tem `id:` (para `Last-Event-ID`) e o stream
envia `retry: 3000` mais um keep-alive a cada 20 s.

```text
event: ready
data: {"queueId":"…","at":"2026-…"}

id: 6f2c…
event: ticket.called
data: {"id":"6f2c…","type":"ticket.called","queueId":"…","organizationId":"…","ticketId":"…","ticketNumber":3,"at":"2026-…"}
```

Importante: **os eventos não transportam o estado**. São sinais de invalidação;
após os receber o cliente volta a pedir o estado pelos endpoints autorizados.

## Planos, subscrições e pagamentos (B2B)

| Método | Rota | Acesso | Descrição |
| --- | --- | --- | --- |
| GET | `/api/plans` | público | Catálogo de planos ativos |
| GET | `/api/organizations/{id}/subscription` | `billing:read` | Subscrição, plano, quotas e utilização |
| POST | `/api/organizations/{id}/subscription` | `organization:manage` | Atribuir plano (entitlement, **não** é pagamento) |
| GET | `/api/organizations/{id}/transactions` | `billing:read` | Histórico de pagamentos |
| POST | `/api/billing/checkout` | `billing:manage` | Inicia um checkout real (cria transação `PENDING`) |
| POST | `/api/billing/webhook` | assinatura | Confirmação do provider |

`POST /api/billing/checkout`
```json
{ "organizationId": "…", "planId": "…" }
```
Resposta: `{ reference, checkoutUrl, instructions, transaction }`. Um plano grátis
(0) devolve `400 BAD_REQUEST` — nesses casos atribui-se o plano.

`POST /api/billing/webhook` — sem autenticação de sessão; o credor é a
assinatura:

```
X-Filazero-Signature: t=1710000000,v1=<hex hmac-sha256(secret, "<t>.<raw body>")>
```

| Situação | Resposta |
| --- | --- |
| Assinatura ausente ou incorreta | `401 UNAUTHENTICATED` |
| Timestamp fora da tolerância | `400 BAD_REQUEST` |
| Evento repetido | `200` com `duplicate: true` (sem efeitos) |
| Referência desconhecida | `404 NOT_FOUND` |
| Webhooks desativados (sem segredo) | `503 SERVICE_UNAVAILABLE` |

Ao exceder o plano: `402 PAYMENT_REQUIRED` (subscrição expirada) ou
`403 QUOTA_EXCEEDED` (quota), com `details: { resource, current, limit }`.

## Notificações (Fase 6)

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/api/notifications?page=&pageSize=` | Lista + contagem de não lidas |
| PATCH | `/api/notifications/{notificationId}` | Marca uma como lida |
| POST | `/api/notifications/read-all` | Marca todas como lidas |

## Utilidade

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/api/health` | Verificação real da base de dados (`SELECT 1`) |

## Limites, CORS e cabeçalhos (Fase 13)

**Rate limiting** — apenas nas rotas de autenticação. Exceder devolve `429`:

```json
{ "error": { "code": "RATE_LIMITED", "message": "Too many requests…",
             "details": { "retryAfterSeconds": 137 } } }
```

com os cabeçalhos `Retry-After`, `RateLimit-Remaining: 0` e `RateLimit-Reset`.

| Rota | Por IP | Por conta |
| --- | --- | --- |
| `POST /api/auth/login` | 60 / 5 min | 8 / 5 min |
| `POST /api/auth/register` | 50 / hora | — |
| `POST /api/auth/password/forgot` | 30 / 15 min | 3 / 15 min |
| `POST /api/auth/password/reset` | 30 / 15 min | — |
| `POST /api/auth/password/change` | 30 / 15 min | — |

**CORS** — um pedido com `Origin` só passa se for da própria origem ou estiver
em `ALLOWED_ORIGINS`/`APP_URL`. Caso contrário: `403 FORBIDDEN`. Pré-voos
`OPTIONS` respondem `204` (permitido) ou `403`. Todas as respostas levam
`Vary: Origin`.

**Cabeçalhos de segurança** (todas as rotas): `Content-Security-Policy`,
`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
`Permissions-Policy`, `Cross-Origin-Opener-Policy`,
`Cross-Origin-Resource-Policy` e `Strict-Transport-Security` (produção).
`X-Powered-By` não é enviado.

Detalhe completo em [SECURITY.md](./SECURITY.md).
