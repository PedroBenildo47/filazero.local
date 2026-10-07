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
| GET | `/api/organizations` | membro ativo (apenas as próprias organizações) |
| POST | `/api/organizations` | `organization:manage` (ADMINISTRATOR) |
| GET | `/api/organizations/{id}` | membro ativo da organização |
| PATCH | `/api/organizations/{id}` | MANAGER da organização |
| PATCH | `/api/organizations/{id}/status` | `platform:admin` |
| GET | `/api/organizations/{id}/branches` | membro da organização |
| POST | `/api/organizations/{id}/branches` | MANAGER da organização |
| GET | `/api/organizations/{id}/branches/{branchId}` | membro com acesso à filial |
| PATCH | `/api/organizations/{id}/branches/{branchId}` | MANAGER da organização |
| GET | `/api/organizations/{id}/members` | membro da organização |
| POST | `/api/organizations/{id}/members` | `member:manage` |
| PATCH | `/api/organizations/{id}/members/{memberId}` | `member:manage` |
| DELETE | `/api/organizations/{id}/members/{memberId}` | `member:manage` |
| GET | `/api/organizations/{id}/users?q=` | `member:manage` |
| GET | `/api/organizations/{id}/analytics` | gestor com vínculo ativo na organização |
| GET | `/api/admin/metrics` | `platform:admin` (apenas agregados globais) |
| GET | `/api/public/organizations?q=&city=&page=` | público |
| GET | `/api/public/organizations/{id}` | público |
| POST | `/api/public/organizations/register` | público, limitado por IP |

`POST /api/public/organizations/register` aceita `multipart/form-data`. Envie os
campos de texto `ownerName`, `ownerEmail`, `ownerPhone`, `password`,
`organizationName`, `category`, `description`, `address`, `city`, `country`,
`organizationPhone` e `organizationEmail`. Campos opcionais vazios podem ser
omitidos. Anexe os documentos usando os campos `document.<TIPO>`:

| Setor | Tipos obrigatórios |
| --- | --- |
| Padrão | `COMPANY_REGISTRATION`, `TAX_REGISTRATION` |
| Categoria contendo “Banco” ou “Instituição Financeira” | Os dois anteriores, `BANKING_LICENSE` e `REGULATOR_AUTHORIZATION` |

Cada documento tem limite de 8 MiB; o corpo multipart total tem limite de 34
MiB. São aceites PDF, JPEG e PNG, conferindo a assinatura do ficheiro além do
MIME declarado. Os bytes são armazenados na tabela privada
`organization_documents`; esta API não disponibiliza leitura pública dos
ficheiros. O limite é de 5 pedidos por IP/hora.

Quando os campos e os documentos obrigatórios passam essas validações, a
transação cria a conta de gestor, a organização `ACTIVE`, a associação, os
documentos, a sessão e o trial configurado. A resposta HTTP 201 inclui a conta,
a organização e `activated: true`. A validação automática confirma presença,
tipo e assinatura básica do ficheiro; não confirma autenticidade jurídica das
licenças nem executa análise antimalware. Para setores regulados, essa garantia
mais forte exige integração com um verificador externo ou revisão manual.

`POST .../members` aceita um utilizador existente ou cria uma conta nova:
```jsonc
{ "userId": "…", "role": "STAFF", "branchId": "…" }
// ou
{ "name": "João", "email": "joao@exemplo.ao", "password": "…", "role": "MANAGER", "branchId": null }
```
`branchId: null` significa acesso a todas as filiais da organização.

O papel `ADMINISTRATOR` é o dono da plataforma e não tem permissões de cliente,
staff, gestor, faturação ou operação. Além de criar organizações e atribuir
planos/estados, usa a **superfície de plataforma** descrita abaixo. Leituras de
organizações, filiais, membros, billing, filas, tickets, histórico e SSE
exigem membership e role operacional, e continuam a responder `403 FORBIDDEN`
para o Super Admin — o isolamento multi-tenant não é enfraquecido.

## Painel de plataforma (Super Admin)

Superfície dedicada (`/api/admin/*`), acessível **apenas** ao papel
`ADMINISTRATOR` (`platform:admin`). É o único ponto que lê intencionalmente
através de organizações; as rotas tenant mantêm-se `403 FORBIDDEN` para o Super
Admin.

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/api/admin/metrics` | Contagens agregadas (organizações/utilizadores) |
| GET | `/api/admin/organizations?status=&planCode=&q=&page=&pageSize=` | Diretório global de organizações |
| GET | `/api/admin/organizations/{id}` | Detalhe (inclui filiais e contagens) |
| PATCH | `/api/admin/organizations/{id}/status` | Suspender/reativar (`ACTIVE`/`SUSPENDED`) |
| DELETE | `/api/admin/organizations/{id}` | Eliminação permanente (corpo `{ confirmName }`) |
| GET | `/api/admin/finance?months=` | Receita consolidada, MRR e subscrições |
| GET | `/api/admin/audit-logs?action=&entityType=&actorUserId=&from=&to=&page=&pageSize=` | Auditoria global |

Regras:

- A receita conta apenas transações `SUCCEEDED`; não existe atalho de
  administrador para marcar um pagamento como pago.
- A eliminação permanente é bloqueada quando a organização tem pelo menos uma
  transação `SUCCEEDED` (`409 CONFLICT`) — nesse caso só pode ser suspensa. É
  também exigido confirmar o nome exato (`400 BAD_REQUEST` se não corresponder).
- A eliminação é transacional (cascata de filiais, filas, senhas, membros,
  subscrição e transações) e os registos de auditoria **sobrevivem**, com um
  snapshot da organização em `metadata`.

`GET /api/organizations/{id}/analytics?from=&to=&timezone=` devolve séries
agregadas, sem dados pessoais nem identificadores de tickets. `from` é
inclusivo, `to` é exclusivo, o intervalo padrão são os últimos 30 dias e o
máximo é 366 dias. O fuso horário IANA predefinido é `Africa/Luanda`.

- `issuedByDay` e `issuedByWeek` contam tickets por `joinedAt`, incluindo todos
    os estados.
- `queuePerformance` agrupa tickets concluídos no intervalo por fila; espera é
    `joinedAt` até `servingAt`, e atendimento é `servingAt` até `completedAt`.
    Médias sem amostras são `null`.
- `completedByHour` contém os 24 horários locais e conta conclusões por
    `completedAt`.

A API permite apenas utilizadores com papel global `MANAGER` e vínculo ativo
`MANAGER` nessa organização. O escopo de filial é derivado dos vínculos: um
vínculo com `branchId: null` abrange todas as filiais; vínculos específicos
restringem todas as agregações a essas filiais. `ADMINISTRATOR`, `STAFF` e
gestores de outras organizações recebem `403 FORBIDDEN`.

## Filas (Fase 5)

| Método | Rota | Permissão |
| --- | --- | --- |
| GET | `/api/queues/{ref}` | público (estado e nº de pessoas) |
| PATCH | `/api/queues/{queueId}` | `queue:manage` |
| PATCH | `/api/queues/{queueId}/status` | `queue:manage` |
| GET | `/api/queues/{queueId}/staff` | membro com acesso à filial |
| GET | `/api/branches/{branchId}/queues` | membro com acesso à filial |
| POST | `/api/branches/{branchId}/queues` | `queue:manage` |

`status`: `OPEN` · `PAUSED` · `CLOSED`. Ao passar de `OPEN` para outro estado,
todos os clientes em espera recebem notificação real.

### Código público e entrada do cliente (Fase 2)

Cada fila tem um **código público** curto, único e legível (`publicCode`, ex.
`7F3A9C2B`), independente do UUID. O `GET /api/queues/{ref}` aceita **UUID ou
código público** (insensível a maiúsculas), pelo que o mesmo endpoint serve o QR
Code, o link direto e a entrada manual.

O cliente entra na fila por duas vias:

1. **QR Code / link / código** — o QR gerado no painel do gestor codifica
   `/fila/{publicCode}`. A página `/pesquisar` lê o QR pela câmara
   (`BarcodeDetector`, com degradação graciosa) ou aceita o código/link colado.
2. **Pesquisa manual** — a lista pública (`/api/public/organizations`) permite
escolher a empresa e a fila.

Uma fila recém-criada fica imediatamente visível no diretório público e
resolúvel por código; suspender a organização (`SUSPENDED`) remove o acesso
público no mesmo instante, e reativar restaura-o. Uma fila `CLOSED` continua a
resolver pelo QR (a página abre), mas não aceita novas senhas.

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
