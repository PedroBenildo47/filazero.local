# FilaZero

Plataforma de **gestão de filas presenciais**, pensada para Angola (PT/EN).
O cliente encontra um estabelecimento, escolhe uma fila, entra e recebe um
**ticket real**; acompanha a posição em tempo real. O estabelecimento chama,
atende e conclui — com regras de negócio no backend e persistência real em
PostgreSQL.

> **Princípio inegociável do projeto:** nada de dados simulados, mocks, fake API
> ou `localStorage` como base de dados. Uma funcionalidade só é considerada
> pronta quando funciona de ponta a ponta: Frontend → API → Backend → Database →
> resposta real → Frontend atualizado.

---

## Estado atual da construção

| Fase | Descrição | Estado |
| --- | --- | --- |
| 1 | Estrutura do projeto / arquitetura | ✅ Concluída |
| 2 | Database + migrations | ✅ Concluída |
| 3 | Authentication + roles | ✅ Concluída |
| 4 | Organizations + branches + members | ✅ Concluída |
| 5 | Queues | ✅ Concluída |
| 6 | Tickets + Queue Engine + notificações | ✅ Concluída |
| 7 | APIs | ✅ Concluída (36 endpoints) |
| 8 | Frontend integrado ao backend | ✅ Concluída |
| 9 | Search | ✅ Concluída (nome, categoria, cidade) |
| 10 | Real-time (SSE por fila) | ✅ Concluída |
| 11 | Notifications | ✅ Concluída (persistidas + UI) |
| 12 | Dashboards (cliente, staff, gestor, admin) | ✅ Concluída |
| 13 | Security + validation + error handling | ✅ Concluída |
| 14 | Tests (unitários, API HTTP, integração) | ✅ Concluída |
| 15 | Deploy (Dockerfile multi-stage + compose + docs) | ✅ Concluída |
| + | i18n PT/EN com seletor persistido | ✅ Concluída |
| + | Planos, subscrições e pagamentos B2B | ✅ Concluída |
| + | Email de recuperação de senha por SMTP (PT/EN) | ✅ Concluída |

O sistema está funcional de ponta a ponta: frontend Next.js bilingue (PT/EN)
consumindo apenas endpoints reais, queue engine com locking transacional,
notificações reais, tempo real por SSE, rate limiting e CORS, faturamento B2B com
webhook assinado e email transacional — e uma suíte de **307 verificações**
automatizadas.

## Stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript** (strict)
- **PostgreSQL** + **Prisma ORM** (migrations versionadas)
- **Zod** para validação em todos os limites da API
- **pino** para logging estruturado com redacção de segredos
- **bcryptjs** para hashing de passwords
- **SSE (Server-Sent Events)** para tempo real, sem infraestrutura adicional

## Requisitos

- Node.js >= 20
- PostgreSQL >= 14 (local, Docker ou serviço gerido)
- npm >= 10

## Configuração

```bash
# 1. instalar dependências
npm install

# 2. criar o ficheiro de ambiente
cp .env.example .env
#    preencher DATABASE_URL e AUTH_SECRET (openssl rand -base64 48)

# 3. aplicar as migrations (cria todo o schema)
npm run db:migrate:dev

# 4. (opcional) criar o primeiro administrador real
npm run db:seed

# 5. desenvolvimento
npm run dev
```

A aplicação fica em `http://localhost:3000`. Verificação real do backend:
`GET /api/health` (faz um `SELECT 1` verdadeiro à base de dados; devolve 503 se
o Postgres estiver inacessível).

### Variáveis de ambiente

Todas documentadas em [`.env.example`](./.env.example). Resumo:

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `DATABASE_URL` | sim | Ligação PostgreSQL usada pelo Prisma |
| `AUTH_SECRET` | sim | Segredo de assinatura de sessão (>= 32 caracteres) |
| `APP_URL` | sim | URL pública da aplicação |
| `ALLOWED_ORIGINS` | sim | Origens permitidas para CORS (lista separada por vírgulas) |
| `AUTH_SESSION_TTL_SECONDS` | não | Duração da sessão (default 604800 = 7 dias) |
| `AUTH_PASSWORD_RESET_TTL_SECONDS` | não | Validade do token de recuperação (default 1 hora) |
| `AUTH_EXPOSE_RESET_TOKEN` | não | **Só testes/dev**: devolve o token de reset na resposta |
| `PASSWORD_HASH_ROUNDS` | não | Custo do bcrypt (default 12) |
| `LOG_LEVEL` | não | Nível de log do pino |
| `SEED_ADMIN_*` | não | Usados apenas por `npm run db:seed` |

Nenhum segredo real é escrito no código nem no repositório.

## Scripts

| Comando | Ação |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` / `npm start` | Build e execução de produção |
| `npm run typecheck` | TypeScript em modo estrito, sem emitir |
| `npm run lint` | ESLint |
| `npm run db:migrate:dev` | Cria/aplica migrations em desenvolvimento |
| `npm run db:migrate:deploy` | Aplica migrations em produção |
| `npm run db:seed` | Cria o administrador inicial (dados reais) |
| `npm run test:unit` | Testes unitários da lógica pura (81) |
| `npm run test:integration` | Testes da camada de serviços (67) |
| `npm run test:api` | Testes HTTP contra um servidor em execução (159) |
| `npm run test:api:with-server` | Build + servidor + suíte HTTP, tudo automático |

## Estrutura do projeto

```
filazero/
├── Dockerfile                     # multi-stage: deps · builder · migrator · runner
├── docker-compose.yml             # db + migrate (one-off) + app
├── .dockerignore
├── public/
├── prisma/
│   ├── schema.prisma              # modelo de dados (fonte da verdade)
│   ├── seed.ts                    # administrador + catálogo de planos
│   └── migrations/                # 0001_init · 0002_rate_limits · 0003_billing
├── src/
│   ├── app/                       # Next.js App Router
│   │   ├── page.tsx               # landing
│   │   ├── login/ registar/       # autenticação
│   │   ├── recuperar-senha/ redefinir-senha/
│   │   ├── pesquisar/             # pesquisa de estabelecimentos
│   │   ├── estabelecimento/[id]/  # detalhe com filiais e filas
│   │   ├── fila/[id]/             # detalhe da fila + entrar
│   │   ├── conta/                 # dashboard do cliente (ticket ao vivo)
│   │   ├── staff/                 # dashboard do staff
│   │   ├── gestor/                # dashboard do manager (+ billing)
│   │   ├── admin/                 # dashboard do administrador
│   │   └── api/                   # 41 endpoints REST + SSE + webhook
│   ├── components/                # sessão, idioma, navegação, guardas, SSE
│   ├── middleware.ts              # CORS hardening
│   ├── lib/                       # db, env, erros, http, i18n, api-client
│   └── server/                    # lógica de negócio (nunca no cliente)
│       ├── auth/ organizations/ queues/ tickets/
│       ├── billing/ email/ security/ realtime/
│       ├── notifications/ audit/
│       ├── context.ts rbac.ts serializers.ts
├── tests/
│   ├── unit/                      # lógica pura (node:test)
│   ├── integration/               # camada de serviços contra PostgreSQL
│   └── api/                       # HTTP contra o servidor real (+ sink SMTP)
├── scripts/run-api-tests.sh
└── docs/                          # ARCHITECTURE · API · FRONTEND · DATABASE
                                   # BILLING · SECURITY · DEPLOY · VALIDATION
```

## Arquitetura em camadas

```
Frontend (React)  →  Route handler (src/app/api/**)  →  Service  →  Prisma  →  PostgreSQL
```

Regras críticas nunca vivem no frontend. O acesso a dados de outra organização
é bloqueado no backend (`assertOrganizationAccess` / `assertBranchAccess`), não
apenas escondendo botões.

## Autenticação

- Tokens opacos de 256 bits; a base de dados guarda apenas
  `HMAC-SHA256(token, AUTH_SECRET)` em `sessions.token_hash`.
- Cookie `filazero_session`: `httpOnly`, `Secure` em produção, `SameSite=Lax`.
- Recuperação de senha com token de uso único e revogação de todas as sessões.
- Alterar senha revoga as outras sessões do mesmo utilizador.

## Queue engine (integridade garantida)

| Cenário | Garantia |
| --- | --- |
| Duas entradas em simultâneo | `SELECT ... FOR UPDATE` na fila + `queues.ticket_sequence` |
| Cliente entra duas vezes na mesma fila | Índice parcial `tickets_one_active_per_user_queue` |
| Dois funcionários chamam "próximo" ao mesmo tempo | Lock da fila + `FOR UPDATE SKIP LOCKED`; o segundo recebe `INVALID_STATE` |
| Ticket concluído volta a `WAITING` | Transições de estado validadas (`ticket.state.ts`) |
| Nº de ticket duplicado | `UNIQUE (queue_id, ticket_number)` |

A posição mostrada ao cliente é **calculada ao vivo** a partir dos tickets
`WAITING`; a coluna `position` é apenas cache.

## Tempo real (Fase 10)

- `GET /api/queues/{queueId}/stream` — Server-Sent Events por fila.
- Eventos: `ticket.joined`, `ticket.left`, `ticket.called`, `ticket.serving`,
  `ticket.completed`, `ticket.cancelled`, `ticket.no_show`, `queue.status_changed`.
- **Os eventos não transportam o estado** — são sinais de invalidação. Ao
  receber um evento (ou ao reconectar) o cliente ressincroniza pelos endpoints
  reais. A fonte da verdade continua a ser o PostgreSQL.
- `useQueueStream` reconecta automaticamente e ressincroniza quando o separador
  volta a ficar visível.
- O bus de eventos (`src/server/realtime/bus.ts`) é o único ponto a substituir
  para um transporte partilhado (Postgres LISTEN/NOTIFY ou Redis) num deploy com
  múltiplas instâncias — limitação documentada em `docs/ARCHITECTURE.md`.

## Segurança (Fase 13)

- **Rate limiting** com contadores em PostgreSQL (funciona multi-instância):
  login por IP e por conta, registo por IP, recuperação de senha por IP e por
  conta. Resposta `429` com `Retry-After`.
- **CORS** aplicado por middleware: só origens em `ALLOWED_ORIGINS`/`APP_URL`
  (ou a própria origem) passam; pré-voos `OPTIONS` respondem 204/403.
- **Cabeçalhos**: CSP, `X-Content-Type-Options`, `X-Frame-Options`, 
  `Referrer-Policy`, `Permissions-Policy`, COOP/CORP e HSTS em produção.
- Detalhes em [docs/SECURITY.md](./docs/SECURITY.md).

## Faturamento B2B (planos, subscrições e pagamentos)

- Catálogo de planos em base de dados (`trial`, `starter`, `growth`, `enterprise`)
  com quotas de filiais, filas por filial e equipa.
- Uma subscrição por organização; trial automático na criação da organização.
- **Só o webhook assinado marca uma transação como paga** — não existe atalho de
  administrador. Atribuir um plano é uma alteração de entitlement, não um
  pagamento, e não cria transação.
- Guardas nos serviços: subscrição expirada → `402 PAYMENT_REQUIRED`; quota
  excedida → `403 QUOTA_EXCEEDED`.
- Webhook com HMAC-SHA256 compatível com o esquema do Stripe, tolerância
  temporal (anti-replay) e idempotência por `provider_event_id`.
- Detalhes em [docs/BILLING.md](./docs/BILLING.md).

## Email transacional

- SMTP configurável por variáveis de ambiente, com templates PT/EN.
- A recuperação de senha envia um link real (`/redefinir-senha?token=…`) no
  idioma do pedido (cookie `filazero_lang`).
- Sem SMTP configurado o token só é devolvido fora de produção; com SMTP
  configurado nunca é devolvido por HTTP.

## Testes

| Suíte | Âmbito | Verificações |
| --- | --- | --- |
| `npm run test:unit` | RBAC, validação, erros, máquina de estados, membros, rate limit, i18n, assinatura de webhook, regras de billing, templates de email | 81 |
| `npm run test:integration` | Camada de serviços contra PostgreSQL (Fases 3–6) | 67 |
| `npm run test:api` | HTTP real: auth, RBAC, queue engine, concorrência, SSE, CORS, cabeçalhos, rate limiting, billing + quotas, email por SMTP | 159 |
| **Total** | | **307** |

Ver [docs/VALIDATION.md](./docs/VALIDATION.md) para a evidência completa.

## Documentação

- [Arquitetura](./docs/ARCHITECTURE.md) — camadas, tenancy, tempo real, roadmap
- [API](./docs/API.md) — endpoints, permissões e formatos
- [Frontend](./docs/FRONTEND.md) — páginas, i18n e consumo da API
- [Base de dados](./docs/DATABASE.md) — tabelas, relações, estados e índices
- [Billing](./docs/BILLING.md) — planos, subscrições, checkout e webhook
- [Segurança](./docs/SECURITY.md) — rate limiting, CORS e cabeçalhos
- [Deploy](./docs/DEPLOY.md) — Docker, migrações e operação
- [Validação](./docs/VALIDATION.md) — evidência dos testes executados

## Limitações conhecidas (explícitas)

- **Pagamentos com cartão:** o adaptador Stripe está implementado (chamada REST
  real) mas **não foi exercitado** — não há credenciais de PSP neste ambiente.
  O provider `invoice` (transferência B2B) é integralmente funcional e testado.
- **Email:** sem `SMTP_HOST` configurado não há envio; fora de produção o token é
  então devolvido na resposta (`AUTH_EXPOSE_RESET_TOKEN`).
- **Corpo das notificações:** é gerado pelo backend em português. A UI traduz o
  tipo da notificação; o texto vem da base de dados.
- **Tempo real multi-instância:** o bus é in-process; com mais de uma instância
  é necessário um transporte partilhado (Postgres LISTEN/NOTIFY ou Redis).
- **CSP:** `script-src` inclui `'unsafe-inline'` porque o Next.js injecta scripts
  de hidratação; uma política com nonce é o passo seguinte.
- **Docker:** as imagens não foram construídas neste ambiente (sem Docker). O
  que foi validado: `next build` com `output: "standalone"`, a sintaxe do
  `docker-compose.yml` e a coerência dos paths entre stages.
- **i18n do backend:** as mensagens da API mantêm-se em inglês (estáveis, por
  código); a tradução acontece no cliente.

## Pronto para GitHub / VS Code

Código modular, tipos estritos, funções pequenas, migrations versionadas, sem
segredos no repositório. Recomendações de extensões em `.vscode/extensions.json`.
