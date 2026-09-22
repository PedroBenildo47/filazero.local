# Base de dados — FilaZero

Motor: **PostgreSQL**. Schema definido em [`prisma/schema.prisma`](../prisma/schema.prisma).
Migration inicial: [`prisma/migrations/0001_init/migration.sql`](../prisma/migrations/0001_init/migration.sql).

## 1. Diagrama de relações

```
users ─┬─< sessions
       ├─< password_reset_tokens
       ├─< tickets >──── queues >──── branches >──── organizations
       ├─< organization_members >────────────────────┘
       ├─< notifications >── tickets
       └─< audit_logs (actor, opcional)
```

## 2. Tabelas

### `users`
Conta de acesso. `role` é o papel global; `password_hash` é sempre bcrypt.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid PK | |
| `name` | varchar(160) | |
| `email` | varchar(255) | único; normalizado para minúsculas na aplicação |
| `phone` | varchar(32) | opcional |
| `password_hash` | varchar(255) | nunca em texto simples |
| `role` | `UserRole` | CUSTOMER / STAFF / MANAGER / ADMINISTRATOR |
| `status` | `UserStatus` | ACTIVE / BLOCKED / DEACTIVATED |
| `email_verified_at`, `last_login_at` | timestamptz | |
| `created_at`, `updated_at` | timestamptz | |

Índices: `email` (único), `(role, status)`.

### `sessions`
Sessões/refresh tokens. Guarda **apenas o hash** do token.

Campos: `id`, `user_id`, `token_hash` (único), `expires_at`, `revoked_at`,
`ip_address`, `user_agent`, timestamps. Índice `(user_id, expires_at)`.

### `password_reset_tokens`
Recuperação de senha. Guarda **apenas o hash**, uso único.

Campos: `id`, `user_id`, `token_hash` (único), `expires_at`, `used_at`,
`created_at`. Índice `(user_id, expires_at)`.

### `organizations`
Empresa/estabelecimento.

Campos: `id`, `name`, `description`, `category`, `address`, `city`, `country`,
`phone`, `email`, `status` (`OrganizationStatus`), timestamps.
Índices: `status`, `city`, `category`, `name`.

### `branches`
Unidade/loja de uma organização.

Campos: `id`, `organization_id` (FK cascade), `name`, `address`, `city`,
`status` (`BranchStatus`), timestamps.
Restrições: `UNIQUE (organization_id, name)`; índices `(organization_id, status)` e `city`.

### `organization_members`
Liga um utilizador a uma organização/filial e define a sua função operacional.

Campos: `id`, `user_id`, `organization_id`, `branch_id` (nullable),
`role` (STAFF/MANAGER), `status` (`MemberStatus`), timestamps.

- `branch_id = NULL` → cobre todas as filiais da organização.
- `UNIQUE (user_id, organization_id, branch_id)`.
- **Índice parcial** `organization_members_all_branches_key`
  em `(user_id, organization_id) WHERE branch_id IS NULL` — impede filiações
  "todas as filiais" duplicadas (NULLs são distintos no índice composto normal).

### `queues`
Fila/serviço de uma filial.

| Campo | Notas |
| --- | --- |
| `id` | uuid PK |
| `organization_id` | FK cascade (mantém o scoping multi-tenant) |
| `branch_id` | FK cascade |
| `name` | |
| `description` | |
| `status` | `QueueStatus`: OPEN / PAUSED / CLOSED |
| `ticket_sequence` | contador monotónico por fila; base do `ticket_number` |
| `current_ticket_id` | ticket em atendimento (único, `ON DELETE SET NULL`) |
| timestamps | |

Restrições: `UNIQUE (branch_id, name)`; índices `(organization_id, status)`, `(branch_id, status)`.

### `tickets`
Entrada real de um cliente numa fila. É o coração do sistema.

| Campo | Notas |
| --- | --- |
| `id` | uuid PK |
| `queue_id` | FK cascade |
| `user_id` | FK cascade |
| `ticket_number` | sequencial por fila; `UNIQUE (queue_id, ticket_number)` |
| `status` | `TicketStatus` |
| `position` | **cache** da posição entre `WAITING`; recalculada a cada mutação |
| `joined_at` | default now; base do FIFO |
| `called_at`, `serving_at`, `completed_at`, `cancelled_at` | marcos temporais |
| timestamps | |

Índices:
- `(queue_id, status, joined_at)` — hot path genérico.
- `tickets_waiting_fifo_idx` em `(queue_id, joined_at) WHERE status = 'WAITING'` —
  acelera "próximo cliente" e mantém o índice pequeno apesar do histórico.
- `tickets_one_active_per_user_queue` em `(user_id, queue_id) WHERE status IN
  ('WAITING','CALLED','SERVING')` — impede que o mesmo cliente tenha dois tickets
  activos na mesma fila, permitindo reentrada após um estado terminal.
- `(user_id, status)`, `(user_id, created_at)`.

### `notifications`
Notificação real de um utilizador.

Campos: `id`, `user_id`, `type` (`NotificationType`), `title`, `message`,
`read`, `ticket_id` (opcional, `ON DELETE SET NULL`), `created_at`.
Índice: `(user_id, read, created_at)`.

### `audit_logs`
Registo append-only de acções administrativas e operacionais relevantes.

Campos: `id`, `actor_user_id` (opcional, `ON DELETE SET NULL`), `action`,
`entity_type`, `entity_id`, `description`, `metadata` (JSON), `ip_address`,
`user_agent`, `created_at`.
Índices: `(actor_user_id, created_at)`, `(entity_type, entity_id)`, `(action, created_at)`.
**Nunca** guardar segredos, passwords ou tokens em `metadata`.

## 3. Estados

### Ticket

```
WAITING ──► CALLED ──► SERVING ──► COMPLETED
   │           │           │
   └───────────┴───────────┴──► CANCELLED
   └───────────────────────────► NO_SHOW
```

- `COMPLETED`, `CANCELLED` e `NO_SHOW` são terminais.
- Um ticket terminal nunca regressa a `WAITING` sem uma operação explícita e
  autorizada.

### Fila
`OPEN` (aceita entradas) · `PAUSED` (não aceita novas entradas, mantém a fila) ·
`CLOSED` (encerrada; sem novas entradas).

## 4. Migrations

```bash
npm run db:migrate:dev      # desenvolvimento: cria e aplica
npm run db:migrate:deploy   # produção: aplica pendentes
npm run db:migrate:status   # estado actual
```

- Nunca alterar o banco manualmente; qualquer mudança passa por uma migration.
- A migration `0001_init` inclui SQL próprio (não expressável no DSL Prisma) para
  os índices parciais de integridade e de performance.
- Próximas migrations devem ser aditivas e versionadas por ordem.
