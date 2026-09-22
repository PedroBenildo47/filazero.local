# Frontend — FilaZero (Fase 8)

Interface Next.js (App Router) que consome **apenas** os endpoints reais das
Fases 3–6 e o stream SSE da Fase 10. Não há dados simulados, nem serviços ou
Prisma importados no cliente.

## Princípios

1. **A API é a única porta.** Todo o dado vem de `/api/*`; o frontend nunca lê a
   base de dados directamente.
2. **O servidor decide.** Permissões e regras de fila estão no backend. A UI
   esconde o que não faz sentido, mas não é a autoridade.
3. **Sem estado duplicado.** O cliente não calcula posições nem estados — mostra
   o que a API devolve.
4. **Erros por código.** `ApiError.code` (ex.: `QUEUE_CLOSED`, `INVALID_STATE`,
   `CONFLICT`) conduz a mensagem, não o texto.

## Ficheiros-chave

| Ficheiro | Papel |
| --- | --- |
| `src/lib/api-client.ts` | `api<T>()` + `ApiError`; desembrulha `{ data }` / `{ error }` |
| `src/lib/ui.ts` | rótulos e formatação (estados, datas, papéis) |
| `src/components/SessionProvider.tsx` | sessão via `GET /api/auth/session` |
| `src/components/Nav.tsx` | navegação por papel |
| `src/components/RequireAuth.tsx` | guarda de UI (redireciona para `/login`) |
| `src/components/useQueueStream.ts` | `EventSource` + reconexão + ressincronização |
| `src/components/ui.tsx` | `Badge`, `Alert`, `Spinner`, `EmptyState` |

## Páginas

| Rota | Papel | O que faz |
| --- | --- | --- |
| `/` | público | Landing; explica o fluxo e liga a pesquisa/registo/login |
| `/registar` | público | Cria conta (`POST /api/auth/register`) e abre sessão |
| `/login` | público | `POST /api/auth/login`; respeita `?next=` |
| `/recuperar-senha` | público | Pede o link de recuperação (`POST /api/auth/password/forgot`) |
| `/redefinir-senha?token=` | público | Define a nova senha com o token do email |
| `/pesquisar` | público | `GET /api/public/organizations?q=&city=` |
| `/estabelecimento/[organizationId]` | público | Filiais e filas do estabelecimento |
| `/fila/[queueId]` | público | Estado da fila, contagem ao vivo e **Entrar na fila** |
| `/conta` | cliente | Ticket ativo com posição **ao vivo**, histórico e notificações |
| `/staff` | staff/gestor/admin | Estado da fila, chamar próximo, atender, concluir, no-show, cancelar |
| `/gestor` | gestor/admin | Filiais, filas (criar/abrir/fechar), filiações **e billing** (subscrição, quotas, planos, checkout, histórico) |
| `/admin` | administrador | Organizações: criar, alterar estado e atribuir planos |

## Fluxo do cliente

```
/  →  /pesquisar  →  /estabelecimento/{id}  →  /fila/{id}
   →  (login se necessário)  →  Entrar na fila
   →  /conta  →  posição ao vivo (SSE)  →  chamado  →  atendido  →  histórico
```

## Fluxo do estabelecimento

```
/login  →  /staff  →  escolher organização → filial → fila
       →  estado ao vivo (SSE)  →  Chamar próximo  →  Iniciar
       →  Concluir  →  próximo cliente
```

## Tempo real no cliente

`useQueueStream(queueId, resync)`:

- abre `new EventSource('/api/queues/{id}/stream')`;
- chama `resync()` no evento `ready` (**cada** ligação e reconexão) e em cada
  evento de domínio;
- em erro, fecha e volta a ligar após 3 s;
- ressincroniza também quando o separador volta a ficar visível.

`resync` não aplica o payload do evento: refaz o pedido autorizado
(`/api/tickets/me` no cliente, `/api/queues/{id}/state` no staff). É isto que
mantém o PostgreSQL como fonte da verdade.

## Sessão

- `SessionProvider` carrega `GET /api/auth/session` uma vez e expõe
  `user`, `memberships`, `refresh()` e `logout()`.
- O cookie `filazero_session` é `httpOnly`, por isso o JavaScript nunca o lê —
  só o navegador o envia.
- `RequireAuth` é conveniência de navegação; a autorização real é feita em cada
  endpoint.

## i18n (PT/EN)

Todo o texto da interface passa por `useI18n().t(key)`. O dicionário vive em
`src/lib/i18n.ts`:

- **PT é a fonte de verdade**; `en` é tipado como `Record<MessageKey, string>`,
  portanto uma chave em falta é um erro de compilação.
- `LanguageProvider` guarda a escolha em `localStorage` (`filazero.lang`) e num
  cookie (`filazero_lang`), atualiza `<html lang>` e cai para o idioma do
  navegador quando não há escolha (default: português).
- `LanguageSwitcher` na barra de navegação alterna PT/EN em qualquer página.
- **Mensagens de erro:** `tError(erro)` mapeia o `code` estável devolvido pela
  API (`QUEUE_CLOSED`, `RATE_LIMITED`, …) para texto traduzido. O backend não
  devolve texto para o utilizador — daí a i18n não ter tocado na lógica do
  backend.
- `formatDateTime` usa `Intl` com o locale ativo (`pt-PT` / `en-GB`).
- Estado → chave de tradução centralizado em `src/lib/ui.ts`
  (`ticketStatusKey`, `queueStatusKey`, `roleKey`, …).

Nota: o **corpo** das notificações é gerado pelo backend em português (é dado
persistido, não texto de interface); a UI traduz o tipo da notificação.

## Design system e temas

`src/app/globals.css` é o design system (sem framework de UI): tokens em CSS
custom properties, um tema claro e um escuro (`[data-theme="dark"]`), tipografia
com *tracking* negativo, bordas finas, superfícies em camadas, sombras suaves e
*glows* de gradiente.

- **Tema:** `ThemeProvider` persiste a escolha (`localStorage` +
  cookie `filazero_theme`); um script bloqueante no `<head>`
  (`THEME_INIT_SCRIPT`, via `next/script beforeInteractive`) aplica o tema antes
  da primeira pintura, evitando o *flash* de tema errado. Sem escolha do
  utilizador, segue a preferência do sistema (`prefers-color-scheme`).
  O `ThemeSwitcher` está na barra de navegação.
- **Interações:** *hover lift* em cartões e botões, anéis de foco acessíveis,
  realce de linhas de tabela, `:active` com compressão, e uma animação de
  entrada (`fade-up`) com escalonamento (`delay-1…5`).
- **Micro-animações:** *shimmer* nos esqueletos, *pulse* no indicador de tempo
  real, *blink* na reconexão, anel de posição em `conic-gradient` animado.
- **Acessibilidade:** `@media (prefers-reduced-motion: reduce)` desativa
  transições e animações.
- **Componentes:** `Card` (com subtítulo e variante *hover*), `StatCard`,
  `ProgressBar` (fica âmbar a partir de 80% da quota), `PositionRing`,
  `LiveStatus`, `Avatar`, `Person`, `Badge` (com ponto de estado) e `Alert`.

## Estilo

CSS simples e responsivo em `src/app/globals.css` (sem framework de UI). Foco em
mobile, conforme a especificação. Sem animações desnecessárias.

## Executar

```bash
npm run db:migrate:deploy
npm run dev            # http://localhost:3000
```

Para testar a interface de staff/gestor/admin é preciso existir pelo menos um
utilizador com esse papel (criado via `POST /api/organizations/{id}/members` ou
`npm run db:seed` para o administrador).

## Billing no cliente (`/gestor`)

- Lê `GET /api/organizations/{id}/subscription` (estado, plano, dias restantes,
  utilização vs quotas) e `GET /api/organizations/{id}/transactions`.
- Lista o catálogo público (`GET /api/plans`) e inicia o checkout
  (`POST /api/billing/checkout`); mostra a **referência** e os dados de
  pagamento, e abre a página do gateway quando existe.
- Avisa quando a subscrição não está operacional — o bloqueio real (402/403)
  acontece no backend, não na UI.
- `/admin` permite atribuir um plano (entitlement, audit-logged).

## Por implementar (explícito)

- **i18n PT/EN:** a interface está só em português.
- **Ecrãs de administração de utilizadores:** existe apenas a gestão de
  organizações; listar/bloquear utilizadores globalmente ainda não tem UI.
- **Notificações em tempo real no cliente:** chegam ao backend (persistidas) e
  são lidas por polling na página de conta; ainda não são empurradas por SSE.
