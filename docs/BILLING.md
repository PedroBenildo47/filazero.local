# Planos, subscrições e pagamentos — FilaZero

Faturamento **B2B por organização**: cada organização tem uma subscrição, um
plano com quotas e um histórico de transações.

## 1. Modelo de dados (migração `0003_billing`)

```
plans ──< subscriptions >── organizations ──< transactions >── plans
```

| Tabela | Notas |
| --- | --- |
| `plans` | catálogo real (`trial`, `starter`, `growth`, `enterprise`) inserido pela migração; `price_cents`, `currency`, `interval`, e as quotas `max_branches`, `max_queues_per_branch`, `max_staff` |
| `subscriptions` | **uma por organização** (`organization_id` único); estado, período atual, `cancel_at_period_end` |
| `transactions` | registo imutável de cada tentativa: valor, moeda, `reference` única, `provider`, `provider_reference`, `provider_event_id` (**único**), `paid_at`, `failure_reason` |

Estados: `TRIALING`, `ACTIVE`, `PAST_DUE`, `CANCELLED`, `EXPIRED` (subscrição) e
`PENDING`, `SUCCEEDED`, `FAILED`, `REFUNDED` (transação).

## 2. Regra inegociável: só o webhook marca como pago

Não existe endpoint de administração para "confirmar um pagamento". Uma
transação só passa a `SUCCEEDED` pelo caminho:

```
checkout (PENDING) → pagamento no provider → webhook assinado → SUCCEEDED
```

O que o administrador da plataforma pode fazer é **atribuir um plano**
(`POST /api/organizations/{id}/subscription`): é uma alteração de entitlement
(contrato B2B, período piloto), audit-logged, e **não cria nem marca nenhuma
transação** — há um teste que verifica exatamente isso.

## 3. Limites do plano

`src/server/billing/plan-guard.ts`, aplicado dentro dos serviços (não em
middleware de UI):

| Operação | Verificação |
| --- | --- |
| criar filial | subscrição operacional → senão **402 `PAYMENT_REQUIRED`**; e `branches < max_branches` → senão **403 `QUOTA_EXCEEDED`** |
| criar fila | idem + `queues na filial < max_queues_per_branch` |
| adicionar membro | idem + `staff < max_staff` |

Porque a verificação está no serviço, não há rota alternativa que a contorne.
Uma subscrição é operacional quando o estado é `TRIALING` ou `ACTIVE` **e** o
período ainda não terminou.

Ao criar uma organização é atribuído automaticamente um trial
(`TRIAL_DAYS`, plano `TRIAL_PLAN_CODE`). Sem catálogo de planos, a organização
fica sem subscrição e qualquer escrita faturável é bloqueada com 402 — nunca
"passa por engano".

## 4. Checkout e provider

`POST /api/billing/checkout` cria primeiro a **referência pagável** (uma linha
`transactions` PENDING) e só depois pede a sessão ao provider. Se o provider
falhar, a transação fica `FAILED` com o motivo — não há estado escondido.

| `PAYMENT_PROVIDER` | Comportamento |
| --- | --- |
| `invoice` (por omissão) | devolve a referência + dados bancários (`BILLING_BANK_*`) para transferência B2B; se `PAYMENT_CHECKOUT_URL_TEMPLATE` estiver definido, devolve também um link de gateway |
| `stripe` | cria uma **Checkout Session real** via `POST https://api.stripe.com/v1/checkout/sessions` (`mode=payment`, `client_reference_id` = referência). Sem `STRIPE_SECRET_KEY` a rota devolve **503** em vez de fingir uma página de pagamento |

## 5. Webhook

`POST /api/billing/webhook` — não autenticado (o credor é o provider), protegido
por assinatura:

```
X-Filazero-Signature: t=<unix>,v1=<hex hmac-sha256(secret, "<t>.<raw body>")>
```

- o corpo **cru** é o que está assinado (a rota lê `request.text()`);
- comparação `timingSafeEqual`;
- tolerância temporal (`PAYMENT_WEBHOOK_TOLERANCE_SECONDS`) → assinatura velha é
  rejeitada com 400 (*anti-replay*);
- o esquema é **igual ao do Stripe**, por isso o mesmo verificador serve os dois
  providers (`src/server/billing/signature.ts`);
- `provider_event_id` é único → um evento repetido é acknowledgeado como
  duplicado e **não** aplica nada duas vezes;
- a aplicação é **uma transação** de base de dados: claim condicional
  (`UPDATE ... WHERE status = 'PENDING'`), extensão do período e entrada de
  auditoria. Duas chamadas concorrentes: uma ganha, a outra vê `duplicate`.

Payload aceite (gateway próprio):

```json
{ "id": "evt_123", "type": "payment.succeeded",
  "data": { "reference": "FZ-…", "providerReference": "bank-…", "paidAt": "2026-…" } }
```

Também entende `checkout.session.completed` e `payment_intent.payment_failed` do
Stripe. Sem `PAYMENT_WEBHOOK_SECRET` o endpoint responde **503**: não existe
caminho sem assinatura que possa marcar algo como pago.

## 6. Sem mocks

- Não há valores simulados: `FAILED`/`SUCCEEDED` resultam de chamadas reais.
- Não há atalho de administrador para marcar como pago.
- Os testes usam o **mesmo** caminho que o provider: assinam o corpo com o
  segredo real e fazem `POST` ao endpoint; verificam 401/400 em assinaturas
  ausentes, erradas, adulteradas e expiradas, e confirmam que a transação
  continua `PENDING` depois de todas elas.

**Limitação honesta:** nenhuma cobrança real foi processada neste sandbox porque
não existem credenciais de PSP. O adaptador Stripe está implementado (chamada
REST real) mas **não foi exercitado**. O provider `invoice` é integralmente
funcional e testado. Ligar um PSP real é: definir `PAYMENT_PROVIDER=stripe` +
as duas chaves, e apontar o webhook do PSP para `/api/billing/webhook`.
