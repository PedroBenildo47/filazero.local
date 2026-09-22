# Arquitetura — FilaZero

Documento de referência da fundação (Fases 1–2) e das decisões que guiam as
fases seguintes.

## 1. Visão geral

FilaZero é uma aplicação full-stack **multi-tenant** de gestão de filas
presenciais. O domínio central é:

```
Organização  ─┬─ Filial ─── Fila ─── Ticket ─── Utilizador (cliente)
              └─ Membro (staff / manager)
```

O cliente entra numa fila e obtém um ticket persistido. O estado do ticket é a
única fonte da verdade sobre a sua posição; a UI apenas reflecte o que o backend
calcula.

## 2. Stack e justificação

| Escolha | Porquê |
| --- | --- |
| Next.js 15 (App Router) | Um único projeto para UI e API; rotas de servidor tipadas; deploy simples |
| TypeScript strict | Contratos explícitos entre camadas, menos bugs em runtime |
| PostgreSQL | Transações fortes e índices parciais — necessários para o queue engine |
| Prisma | Migrations versionadas + client tipado; sem SQL manual disperso |
| Zod | Validação única reutilizada em todos os limites |
| pino | Logs estruturados e redigidos, adequados a produção |

## 3. Camadas

```
┌──────────────────────────────────────────────────────────────┐
│  UI (src/app/**/page.tsx, componentes)                       │
│  · sem regras de negócio · sem dados permanentes              │
└───────────────┬──────────────────────────────────────────────┘
                │ fetch / server action
┌───────────────▼──────────────────────────────────────────────┐
│  Route handlers (src/app/api/**/route.ts)                     │
│  · parse → validate (zod) → build AuthContext → delegate      │
│  · nunca contêm regras de fila                                │
└───────────────┬──────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────┐
│  Serviços (src/server/<módulo>/*.service.ts)                  │
│  · regras de negócio, transações, locking, eventos            │
│  · autorização de domínio (assertOrganizationAccess, ...)     │
└───────────────┬──────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────┐
│  Prisma (src/lib/db.ts) → PostgreSQL                          │
└──────────────────────────────────────────────────────────────┘
```

Regra: **nenhum ficheiro em `src/server` ou `src/lib` pode ser importado por um
componente de cliente.** As dependências de Node são marcadas com o pacote
`server-only` e `serverExternalPackages` no `next.config.mjs`.

## 4. Multi-tenancy

- Toda a entidade operacional (`branches`, `queues`, `tickets`) é alcançável a
  partir de `organizations`.
- `organization_members` liga um utilizador a uma organização e, opcionalmente,
  a uma filial. `branch_id = NULL` significa acesso a **todas** as filiais.
- O `AuthContext` (`src/server/context.ts`) transporta as filiações activas e
  expõe:
  - `assertOrganizationAccess(ctx, organizationId)`
  - `assertBranchAccess(ctx, organizationId, branchId)`
- `ADMINISTRATOR` tem acesso global; `CUSTOMER` não precisa de filiação.
- Um `STAFF` da Organização A nunca acede a dados da Organização B: a query é
  sempre limitada pelo `organizationId` e validada antes de tocar no banco.

> Nota de integridade: o `@@unique([user_id, organization_id, branch_id])` do
> Prisma não impede duplicados com `branch_id IS NULL` (o Postgres trata NULLs
> como distintos). A migration adiciona o índice parcial
> `organization_members_all_branches_key` para fechar essa lacuna.

## 5. Autorização (RBAC)

`src/server/rbac.ts` é a **única** fonte de verdade das permissões:

| Papel | Capacidades principais |
| --- | --- |
| `CUSTOMER` | pesquisar, entrar/sair da própria fila, ver o próprio ticket e histórico |
| `STAFF` | ver a fila da organização, chamar, iniciar, concluir, cancelar |
| `MANAGER` | tudo o que o staff faz + gerir filas e membros da organização |
| `ADMINISTRATOR` | utilizadores, organizações, filiais, logs e estados da plataforma |

Cada rota mutável chama `requirePermission(ctx, ...)` antes de executar. Esconder
um botão no frontend nunca é considerado controlo de acesso.

## 5.1 Autenticação e sessões (Fase 3, implementado)

- **Tokens opacos**, não JWT. 256 bits aleatórios (`randomBytes(32)`),
  devolvidos ao cliente uma única vez. A base de dados guarda apenas
  `HMAC-SHA256(token, AUTH_SECRET)` em `sessions.token_hash`, portanto uma fuga
  da base de dados não expõe tokens utilizáveis. O `AUTH_SECRET` também serve de
  chave de integração para os tokens de recuperação de senha.
- **Cookie** `filazero_session`: `httpOnly`, `Secure` em produção,
  `SameSite=Lax`, `Path=/`, expiração alinhada com `AUTH_SESSION_TTL_SECONDS`.
- **`resolveAuthContext`** devolve `null` para token desconhecido, revogado,
  expirado, ou pertencente a utilizador não-`ACTIVE`. Logout revoga a linha; a
  força da sessão está na base de dados, não no cliente.
- **Senhas** com bcrypt (`PASSWORD_HASH_ROUNDS`, >= 10). O login devolve o mesmo
  erro para email inexistente e senha errada (sem enumeração de contas).
- **Recuperação de senha**: token de uso único, guardado em hash, TTL
  (`AUTH_PASSWORD_RESET_TTL_SECONDS`); redefinir revoga todas as sessões.
  Não há provedor de email nesta fase — fora de produção o token é devolvido na
  resposta para permitir testar o fluxo; em produção a rota responde apenas
  `{ "accepted": true }`. **Entrega por email está por implementar.**
- **Proteção de rotas** vive no servidor: `requireAuth()` + `requirePermission()`
  + guardas de âmbito. Não há middleware de UI a decidir segurança.

## 6. Queue Engine (implementado — Fase 6)

Estados do ticket:

```
WAITING ──call──► CALLED ──serve──► SERVING ──complete──► COMPLETED
   │                │                 │
   └────leave───────┴─────────────────┴──► CANCELLED / NO_SHOW
```

Operações e garantias:

| Operação | Contrato |
| --- | --- |
| **Entrar na fila** | Validar utilizador, fila e `status = OPEN`; bloquear a linha da fila (`SELECT ... FOR UPDATE`) e incrementar `queues.ticket_sequence` para gerar `ticket_number`; calcular `position`; gravar ticket; o índice parcial `tickets_one_active_per_user_queue` impede tickets duplicados activos |
| **Posição** | Coluna `position` é **cache**; a verdade é o conjunto ordenado de tickets `WAITING` por `joined_at`. Recalculada em cada mutação da fila |
| **Chamar próximo** | `SELECT ... FOR UPDATE SKIP LOCKED` sobre `WAITING` ordenados FIFO (índice parcial `tickets_waiting_fifo_idx`); dois funcionários nunca recebem o mesmo ticket |
| **Iniciar / concluir** | Transição com `UPDATE ... WHERE id = ? AND status = ?`; zero linhas afectadas ⇒ `INVALID_STATE` |
| **Sair / cancelar** | Marca estado terminal e recalcula posições dos restantes |
| **Eventos** | Cada transição grava a notificação (`notifications`) e o `audit_log` na mesma transação; o transporte real-time é a Fase 10 |

Notificações escritas dentro da transação da mudança de estado: uma notificação
nunca descreve um evento que não aconteceu. Posições são recalculadas com uma
função de janela (`ROW_NUMBER()`) numa única instrução, e só os clientes cuja
posição **melhorou** recebem `POSITION_CHANGED`.

## 6.1 Frontend (Fase 8, implementado)

O frontend é Next.js (App Router) e consome **apenas** os endpoints REST/SSE.
Não importa serviços nem Prisma — toda a leitura de dados passa por `/api/*`.

| Página | Consome |
| --- | --- |
| `/` (landing) | estática; liga a pesquisa/registo/login |
| `/registar`, `/login` | `POST /api/auth/register`, `POST /api/auth/login` |
| `/pesquisar` | `GET /api/public/organizations` |
| `/estabelecimento/[id]` | `GET /api/public/organizations/{id}` |
| `/fila/[id]` | `GET /api/queues/{id}` + SSE + `POST /api/queues/{id}/tickets` |
| `/conta` (cliente) | `GET /api/tickets/me`, `/api/notifications`, SSE, `POST .../leave` |
| `/staff` | `GET /api/queues/{id}/state` + SSE + `call-next`/`serve`/`complete`/`no-show`/`cancel` |
| `/gestor` | organizações, filiais, filas, filiações |
| `/admin` | `GET/POST /api/organizations`, `PATCH .../status` |

Decisões:

- **Client Components + `fetch`** para manter o cookie de sessão e o `EventSource`
  naturais. A segurança real continua no servidor; os guardas de UI
  (`RequireAuth`) são apenas experiência de utilização.
- `src/lib/api-client.ts` desembrulha o envelope `{ data }` / `{ error }` e lança
  `ApiError` com o `code` estável do backend — a UI reage a códigos, não a
  mensagens.
- **Sem estado duplicado:** o cliente nunca calcula posições nem estados; mostra
  o que a API devolve.

## 7. Real-time (Fase 10, implementado)

- `GET /api/queues/{queueId}/stream` — Server-Sent Events, um canal por fila
  observada. Mais simples e robusto que WebSockets para um fluxo unidirecional.
- **Os eventos são sinais, não estado.** O payload contém `type`, `queueId`,
  `ticketId`, `ticketNumber` e estados — nunca nomes de clientes. Ao recebê-lo,
  o cliente refaz o pedido autorizado (`/api/tickets/me` para o cliente,
  `/api/queues/{id}/state` para o staff). A fonte da verdade continua a ser o
  PostgreSQL.
- Cada evento leva `id:` (para `Last-Event-ID`) e o stream envia `retry: 3000`,
  além de um comentário keep-alive a cada 20 s.
- Publicação: os serviços emitem o evento **depois** do commit da transação
  (`publishQueueEvent`), para que um evento nunca descreva uma alteração que
  não foi persistida.
- Reconexão: `useQueueStream` fecha e reabre o `EventSource`, ressincroniza no
  evento `ready` (ou seja, em cada (re)ligação) e quando o separador volta a
  ficar visível.
- **Limitação:** o bus (`src/server/realtime/bus.ts`) é in-process. Num deploy
  com várias instâncias é preciso um transporte partilhado (Postgres
  LISTEN/NOTIFY ou Redis); o módulo é o único ponto a substituir.

## 8. Erros e logging

- `AppError` + códigos estáveis (`UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`,
  `QUEUE_CLOSED`, `INVALID_STATE`, ...), mapeados para HTTP num único lugar
  (`src/lib/http.ts`).
- `route()` envolve cada handler, converte erros no envelope padrão e registra
  apenas os inesperados.
- Envelope: sucesso `{ "data": ... }`; erro
  `{ "error": { "code", "message", "details"? } }`.
- Erros do Prisma são traduzidos (`P2002` → conflito, `P2025` → não encontrado,
  `P2003` → recurso relacionado inexistente).
- Nunca se expõem stack traces nem detalhes internos ao cliente.

## 8.1 Segurança aplicada (Fase 13)

- **Rate limiting** com contadores em PostgreSQL (`rate_limit_counters`, migração
  `0002`): UPSERT atómico, partilhado por todas as instâncias, aplicado no
  *route handler* antes do hashing. Resposta 429 com `Retry-After`.
- **CORS** em `src/middleware.ts` (Edge): mesma origem ou lista explícita;
  `Origin: null` rejeitado; pré-voos tratados; `Vary: Origin` sempre.
- **Cabeçalhos** em `next.config.mjs`: CSP, nosniff, DENY frame, Referrer-Policy,
  Permissions-Policy, COOP/CORP, HSTS em produção, sem `X-Powered-By`.
- Detalhe em [SECURITY.md](./SECURITY.md).

## 8.2 i18n (frontend)

`src/lib/i18n.ts` contém os dicionários PT/EN (fonte de verdade em PT, `en`
tipado como `Record<MessageKey, string>`). `LanguageProvider` persiste a escolha
(`localStorage` + cookie `filazero_lang`), atualiza `<html lang>` e expõe
`t()`, `tError()` e `formatDateTime()`. As mensagens de erro são resolvidas por
**código**, não por texto — por isso a i18n não exigiu qualquer alteração no
backend.

## 8.3 Billing e email

- **Billing** (`src/server/billing/`): catálogo de planos, uma subscrição por
  organização, transações imutáveis e um guard de quotas aplicado nos serviços.
  Só o webhook assinado marca uma transação como paga; atribuir um plano é uma
  alteração de entitlement e não cria transação. A normalização de eventos e a
  aritmética de períodos são funções puras (`billing.rules.ts`); a verificação de
  assinatura (`signature.ts`) é compatível com o esquema do Stripe.
- **Email** (`src/server/email/`): SMTP configurável por ambiente, templates
  PT/EN puros (`templates.ts`) e um serviço que nunca propaga falhas de entrega ao
  cliente (evitando sondar endereços).
- Detalhe em [BILLING.md](./BILLING.md).

## 9. Ambientes e deploy

- Configuração exclusivamente por variáveis de ambiente, validadas por zod
  (`src/lib/env.ts`) de forma **lazy** — o build não exige base de dados, mas o
  primeiro pedido falha rapidamente se a configuração estiver errada.
- `prisma migrate deploy` aplica migrations em produção; nunca há alterações
  manuais ao schema.
- Recomendado para produção: Postgres gerido com pooler (`DATABASE_URL`) e, se
  necessário, `DIRECT_URL` para migrações.

Empacotamento: `Dockerfile` multi-stage (`deps` → `builder` → `migrator` →
`runner` com `output: "standalone"`), `docker-compose.yml` (db + migrate one-off
+ app) e [DEPLOY.md](./DEPLOY.md).

## 9.1 Estado de implementação

| Fase | Estado |
| --- | --- |
| 1–2 Arquitetura + base de dados | ✅ |
| 3 Autenticação + roles | ✅ |
| 4 Organizações + filiais + membros | ✅ |
| 5 Filas | ✅ |
| 6 Queue engine + notificações | ✅ |
| 7 APIs | ✅ (36 endpoints, incl. SSE) |
| 8 Frontend integrado | ✅ |
| 9 Search | ✅ (nome, categoria, cidade) |
| 10 Real-time (SSE) | ✅ |
| 11 Notificações | ✅ |
| 12 Dashboards | ✅ (cliente, staff, gestor, admin) |
| 13 Segurança | ✅ rate limiting (PostgreSQL), CORS por middleware, cabeçalhos |
| 14 Testes | ✅ 81 unit + 67 integração + 159 HTTP |
| 15 Deploy | ✅ Dockerfile multi-stage, compose, `.dockerignore`, DEPLOY.md |
| + i18n PT/EN | ✅ seletor persistido, dicionários tipados |
| + Billing B2B | ✅ planos, subscrições, checkout, webhook assinado, quotas |
| + Email SMTP | ✅ templates PT/EN, entrega real |

## 10. Definição de "pronto"

Uma funcionalidade só é considerada pronta quando o caminho completo funciona:

```
Frontend → API → Backend → Database → Resposta real → Frontend actualizado
```

Exemplo aplicado: "Entrar na fila" só está pronto quando cria um ticket
persistente e a posição continua correta depois de recarregar a página.
