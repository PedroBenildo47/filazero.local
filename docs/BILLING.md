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

## 7. Painel financeiro da plataforma (Super Admin)

`GET /api/admin/finance?months=` (ver [API.md](./API.md)) agrega, para o dono da
plataforma: receita total, **receita por plano**, série mensal (fuso
`Africa/Luanda`), **MRR** (preços de subscrições `ACTIVE`, normalizados ao mês) e
a distribuição de subscrições por estado.

- Só transações `SUCCEEDED` contam como receita — o painel lê exatamente o mesmo
  dado que o webhook assinado produziu; não há forma de o administrador inflar
  receita.
- Transações `PENDING` aparecem separadas como "por liquidar".
- O diretório global (`/api/admin/organizations`) mostra o plano de cada
  organização, mas **não** permite alterar pagamentos: só atribuir plano
  (entitlement) e suspender/reativar.
- A eliminação permanente de uma organização é **bloqueada** quando existe
  qualquer transação `SUCCEEDED` (`409 CONFLICT`), protegendo o histórico
  financeiro; nesses casos a ação disponível é suspender.

## 8. Pagamentos e subscrições B2B (Fase 3)

O checkout passa a ser **inteligente**: o gestor escolhe o método e o sistema
gera o caminho correto, sempre com a mesma regra de ouro — só o webhook assinado
marca a transação como paga.

### 8.1 Métodos (`PaymentMethod`)

| Método | Transporte | Como liquida |
| --- | --- | --- |
| `MULTICAIXA_EXPRESS` | `INVOICE` | Referência + instruções passo-a-passo. Com `MULTICAIXA_API_URL`/`MULTICAIXA_API_KEY` é feito um pedido real ao gateway (EMIS/agregador) e devolvido o link de pagamento |
| `BANK_TRANSFER` | `INVOICE` | Referência + dados bancários (`BILLING_BANK_*`) para transferência |
| `CARD` | `STRIPE` | Checkout Session hospedada (Visa/Mastercard). Sem `STRIPE_SECRET_KEY` devolve **503** em vez de fingir uma página |

O `provider` guarda o **transporte** (`INVOICE`/`STRIPE`) e o `method` o método
escolhido pelo cliente; a verificação de assinatura é única para os dois.

### 8.2 Comprovativo de pagamento

`POST /api/organizations/{id}/transactions/{id}/proof` (`multipart/form-data`,
campo `file`, ≤ 5 MB). O tipo real é detectado pelos **bytes** (PDF, JPEG, PNG,
WebP) — a extensão declarada não é de confiança. O ficheiro é guardado na tabela
`payment_proofs` com hash SHA-256 e a transação passa `PENDING → UNDER_REVIEW`.

Subir um comprovativo **nunca** marca a transação como paga: é apenas a prova
para a equipa financeira. Só o webhook assinado pode passar a `SUCCEEDED`
(o claim condicional aceita `PENDING` e `UNDER_REVIEW`).

### 8.3 Fatura e recibo automático

- Ao passar a `SUCCEEDED`, é emitido o documento fiscal numa **série oficial por
  organização/ano** (`FR{ano}/{sequência}`, ex. `FR2026/000001`); só pagamentos
  reais consomem números, pelo que não há lacunas. Ver a secção 9 (AGT).
- O **recibo** é enviado automaticamente por email para o email da organização
  (ou, na sua falta, para o primeiro gestor), com a **fatura PDF anexada**. O
  envio acontece **depois** de o pagamento estar comprometido (SMTP nunca faz
  rollback de dinheiro) e é idempotente via `receipt_sent_at`.
- `GET /api/organizations/{id}/invoices` lista o histórico de faturas pagas,
  `GET .../invoices/{transactionId}` devolve a fatura detalhada e
  `GET .../invoices/{transactionId}/pdf` devolve a fatura fiscal em PDF.

### 8.4 Migração e testes

Migração `0007_b2b_payments`: `PaymentMethod`, valor `UNDER_REVIEW` em
`TransactionStatus`, colunas `method`/`invoice_number`/`proof_submitted_at`/
`receipt_sent_at`, e as tabelas `payment_proofs` e `billing_counters`.

A suite `tests/api/b2b-payments.spec.ts` exercita os três métodos, o upload e
download do comprovativo, a rejeição de ficheiros falsos, a confirmação de uma
transação em `UNDER_REVIEW` pelo webhook, o número de fatura sequencial, o
histórico e o **recibo entregue por SMTP real**. O `payment-methods.test.ts`
cobre as regras puras (métodos, numeração, detecção de tipo e template do
recibo em PT/EN).

**Limitação honesta:** tal como o adaptador Stripe, o adaptador Multicaixa
Express (chamada REST real) **não foi exercitado** neste sandbox por não existir
credencial de PSP. O caminho por referência + webhook é integralmente funcional e
testado.

---

## 9. Faturas PDF e conformidade AGT (Fase 4, Bloco 1)

O documento fiscal é emitido **no momento em que o webhook confirma o
pagamento**, dentro da mesma transação de base de dados que marca a transação
como `SUCCEEDED` — nunca antes.

### 9.1 Série e numeração oficiais

- `model InvoiceSeries` — uma série por `(organização, tipo de documento, ano)`.
  O código é `{tipo}{ano}` (ex. `FR2026`) e a numeração é atómica
  (`next_number`), pelo que pagamentos simultâneos nunca repetem um número.
- Número oficial: `FR2026/000001` (6 dígitos). A unicidade é garantida por
  `@@unique([seriesId, sequence])` — o número é único **dentro da série**, não
  globalmente, porque cada contribuinte tem a sua própria série.
- O tipo por omissão é `FR` (**Factura-Recibo**), o documento adequado a
  pagamento imediato.

### 9.2 IVA e totais

- Os preços dos planos (`amountCents`) são **com IVA incluído** (bruto).
- `vatBreakdown(grossCents, rateBps)` deriva a base tributável e o IVA com
  arredondamento a cêntimo: `base = round(bruto × 10000 / (10000 + taxa))`.
- Taxa padrão: **14%** (`IVA_RATE_BPS=1400`). Base, IVA e total ficam gravados na
  transação (`subtotal_cents`, `vat_cents`, `vat_rate_bps`).

### 9.3 NIF

- `Organization.taxId` (NIF do cliente) é editável no painel do gestor e aceita
  9 ou 10 dígitos (normalizado: espaços/pontos/hífenes removidos).
- O NIF indicado no checkout (`taxId`) tem precedência sobre o da organização.
- O NIF do emitente vem de `PLATFORM_TAX_ID`.

### 9.4 Hash, QR e certificação

- A string canónica (`buildInvoiceCanonical`) junta emitente, cliente, tipo,
  série, sequência, data, base, IVA, total, moeda e os **4 primeiros caracteres do
  hash do documento anterior** (encadeamento).
- `signInvoice` assina com **RSA-SHA256** quando `AGT_PRIVATE_KEY` (PEM) está
  definido — nesse caso `agt_certified = true`. Sem certificado, usa um
  **HMAC-SHA256** determinístico (`AGT_HASH_SECRET`) e marca o documento como
  **não certificado**.
- O PDF A4 (`pdf-lib` + `qrcode`) imprime todos os campos legais, o QR com o
  payload pipe-separated e a nota de certificação. **Limitação honesta:** uma
  assinatura *certificada pela AGT* exige o certificado de software emitido pela
  AGT; sem essa chave o documento é válido como fatura, mas é marcado como não
  certificado.

### 9.5 Migração e testes

Migrações `0008_invoicing_agt` (enum `InvoiceDocumentType`, `organizations.tax_id`,
`invoice_series`, campos fiscais em `transactions`) e `0009_invoice_number_per_series`
(unicidade por série). A suite `tests/api/invoicing-agt.spec.ts` cobre a rejeição
de NIF inválido, o formato da série, o cálculo do IVA, o NIF do cliente e do
emitente, o hash e o QR, o avanço da série e o download do PDF (com isolamento de
tenant). `tests/unit/agt.test.ts` cobre as regras puras.
