# Segurança — FilaZero (Fase 13)

Defesa em profundidade: autenticação, autorização, validação, isolamento
multi-tenant, limites de abuso e cabeçalhos. Tudo verificado por testes HTTP
reais (`tests/api/run.ts`).

## 1. Autenticação

| Mecanismo | Detalhe |
| --- | --- |
| Hashing de passwords | bcrypt, custo `PASSWORD_HASH_ROUNDS` (>= 10) |
| Sessões | token opaco de 256 bits; a BD guarda só `HMAC-SHA256(token, AUTH_SECRET)` |
| Cookie | `filazero_session`: `httpOnly`, `Secure` em produção, `SameSite=Lax` |
| Expiração | `AUTH_SESSION_TTL_SECONDS`; tokens de reset com TTL próprio |
| Enumeração de contas | login e recuperação devolvem sempre a mesma resposta |
| Recuperação de senha | token de uso único (guardado em hash); redefinir revoga todas as sessões |
| Alteração de senha | revoga as **outras** sessões do mesmo utilizador |

## 2. Rate limiting (contadores em PostgreSQL)

Motor: `src/server/security/rate-limit.service.ts` com um UPSERT atómico numa
tabela (`rate_limit_counters`). Por estar na base de dados, o limite é partilhado
por todas as instâncias e sobrevive a reinícios — não é memória de processo.

Regras: `src/server/security/rate-limit.rules.ts`.

| Rota | Chave | Janela | Máx. |
| --- | --- | --- | --- |
| `POST /api/auth/login` | IP | 5 min | 60 |
| `POST /api/auth/login` | conta (hash do email) | 5 min | 8 |
| `POST /api/auth/register` | IP | 1 h | 50 |
| `POST /api/auth/password/forgot` | IP | 15 min | 30 |
| `POST /api/auth/password/forgot` | conta | 15 min | 3 |
| `POST /api/auth/password/reset` | IP | 15 min | 30 |
| `POST /api/auth/password/change` | IP | 15 min | 30 |

- O contador é consumido **antes** do hashing, para também travar abuso de CPU.
- Emails nunca são guardados na tabela: a chave usa `sha256(email)`.
- Exceder devolve `429` com `RATE_LIMITED` e cabeçalhos `Retry-After`,
  `RateLimit-Remaining`, `RateLimit-Reset`.
- Aplicado no *route handler*, não nos serviços — a camada de domínio fica livre
  de preocupações de transporte.

## 3. CORS

Em `src/middleware.ts` (Edge), sobre `/api/:path*`:

- pedidos **sem** `Origin` (curl, app móvel, `fetch` do próprio site) passam;
- `Origin: null` é **rejeitado** (frames sandbox / `file://`);
- mesma origem (`Origin.host === Host`) passa sempre;
- caso contrário, a origem tem de estar em `ALLOWED_ORIGINS` ou `APP_URL`;
- pré-voos `OPTIONS` respondem `204` com `Access-Control-Allow-*` ou `403`;
- todas as respostas levam `Vary: Origin`, para as caches não misturarem origens.

## 4. Cabeçalhos de segurança

Definidos em `next.config.mjs` (`headers()`), aplicados a todas as rotas:

| Cabeçalho | Valor |
| --- | --- |
| `Content-Security-Policy` | `default-src 'self'`; `frame-ancestors 'none'`; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`; `connect-src 'self'` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `X-DNS-Prefetch-Control` | `off` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` (só produção) |
| `X-Powered-By` | removido (`poweredByHeader: false`) |

`script-src` inclui `'unsafe-inline'` porque o Next.js injecta os scripts de
hidratação; `'unsafe-eval'` só é enviado em desenvolvimento. Uma política com
nonce é o passo seguinte.

## 5. Autorização e multi-tenancy

- Permissões por papel numa única fonte (`src/server/rbac.ts`).
- `assertOrganizationAccess` / `assertBranchAccess` em cada operação de tenant —
  mudar um ID no pedido não dá acesso a outra organização.
- Erros nunca expõem stack traces; detalhes técnicos vão para o log com redacção
  de `password`, `token`, `authorization` e cookies.

## 6. Validação e erros

- Todo o limite da API valida com zod (corpo e query).
- Identificadores malformados devolvem `400` (`P2023` mapeado), não `500`.
- Envelope estável: `{ "error": { "code", "message", "details"? } }` — o cliente
  traduz por **código**, o que também permitiu a i18n sem tocar no backend.

## 7. Verificação

Os testes HTTP cobrem: cabeçalhos em API e HTML, pré-voos permitidos e
recusados, origem desconhecida → 403, `Vary: Origin`, limites por conta, 
`Retry-After`, isolamento entre contas e o facto de outras contas continuarem a
funcionar. Ver [VALIDATION.md](./VALIDATION.md).
