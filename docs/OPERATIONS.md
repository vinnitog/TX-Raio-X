# Operação e observabilidade

## Objetivo

Detectar falhas financeiras rapidamente sem registrar e-mail, hash de transação,
endereço de carteira, token de sessão ou payload do provedor.

## Eventos estruturados

As Edge Functions emitem um evento por requisição e devolvem `X-Request-Id` ao
cliente:

- `checkout_request`: `success`, `ignored` ou `error`, com status, código e duração;
- `mercado_pago_webhook_request`: resultado, crédito/reversão e duração;
- `consume_analysis_request`: endpoint legado de consumo, origem, idempotência e duração;
- `protected_analysis_request`: validação, entrega protegida, origem gratuita/paga e duração.

O identificador serve apenas para correlacionar suporte e logs. Mensagens internas,
IDs de usuário, e-mails, hashes, carteiras, tokens e payloads não entram nesses logs.

## Limites operacionais

- checkout: 10 chamadas por conta em 10 minutos;
- consumo: 30 chamadas por conta por minuto;
- análise protegida: 10 chamadas por conta por minuto;
- Supabase Auth: manter confirmação de e-mail e os limites de cadastro/login;
- antes de produção: ativar Turnstile no Supabase e na interface com chaves próprias.

Os contadores ficam no PostgreSQL, são serializados por conta e escopo e não usam
IP ou fingerprint do aparelho. Somente `service_role` pode chamar a função de
limite. Isso reduz automação simples, mas não prova que duas contas pertencem à
mesma pessoa.

## Alertas mínimos

Criar alertas no provedor de logs para janelas de 5 minutos:

- qualquer `internal_error` financeiro;
- 3 ou mais `invalid_signature` no webhook;
- taxa de erro acima de 5% no checkout, webhook ou análise protegida;
- p95 acima de 3 s no checkout ou 5 s na análise protegida;
- qualquer linha em `public.billing_reconciliation_anomalies` por mais de 15 min;
- crescimento anormal de cadastros, concessões grátis ou `rate_limited`.

## Conciliação

Executar ao menos diariamente no ambiente de teste e, em produção, a cada 15
minutos:

```sql
select *
from public.billing_reconciliation_anomalies
order by observed_at;
```

Uma anomalia não deve ser corrigida com edição manual do ledger. Reprocessar a
notificação assinada ou usar uma operação administrativa idempotente e auditada.

## Resposta a incidentes

1. Identificar função, código e `X-Request-Id`.
2. Conferir ordem e pagamento no Mercado Pago e no Supabase, sem copiar PII para o chamado.
3. Pausar publicação/credenciais de produção se houver crédito indevido, assinatura inválida aceita ou vazamento de segredo.
4. Preservar logs e horários; nunca registrar access token para reproduzir.
5. Corrigir e validar aprovação, repetição, reembolso e chargeback antes de reabrir o fluxo.
