# Operação e observabilidade

## Objetivo

Detectar falhas financeiras rapidamente sem registrar e-mail, hash de transação,
endereço de carteira, token de sessão ou payload do provedor.

## Eventos estruturados

As Edge Functions emitem um evento por requisição e devolvem `X-Request-Id` ao
cliente:

- `checkout_request`: `success`, `ignored` ou `error`, com status, código e duração;
- `stripe_webhook_request`: resultado, crédito/reversão e duração;
- `consume_analysis_request`: endpoint legado de consumo, origem, idempotência e duração;
- `protected_analysis_request`: validação, entrega protegida, origem gratuita/paga e duração.
- `privacy_account`: exportação ou exclusão, código/status e duração, sem e-mail ou UUID de usuário.

O identificador serve apenas para correlacionar suporte e logs. Mensagens internas,
IDs de usuário, e-mails, hashes, carteiras, tokens e payloads não entram nesses logs.

## Limites operacionais

- checkout: 10 chamadas por conta em 10 minutos;
- consumo: 30 chamadas por conta por minuto;
- análise protegida: 10 chamadas por conta por minuto;
- direitos da conta: 10 chamadas por conta em 10 minutos;
- Supabase Auth: manter confirmação de e-mail e os limites de cadastro/login;
- Supabase Auth Pro: ativar proteção contra senhas vazadas antes de receber contas de produção;
- antes de produção: ativar Turnstile no Supabase e na interface com chaves próprias.

Os contadores ficam no PostgreSQL, são serializados por conta e escopo e não usam
IP ou fingerprint do aparelho. Somente `service_role` pode chamar a função de
limite. Isso reduz automação simples, mas não prova que duas contas pertencem à
mesma pessoa.

## Hospedagem Railway

O Railway executa apenas o container Caddy com a allowlist pública do PWA. O
healthcheck é `/health`; nenhuma credencial Stripe, `service_role`, migration ou
função backend entra na imagem. Os logs Caddy usam IP mascarado, removem headers de
IP encaminhados e descartam a query string. Retenção e região continuam pendentes de evidência do
fornecedor. O roteiro de deploy e smoke está em `docs/RAILWAY_DEPLOYMENT.md`.

## Branch protection da `main`

O workflow `Quality Gate` executa unitários, jornadas Playwright e pgTAP contra
um Postgres efêmero. Depois que o primeiro run concluir no GitHub, configurar a
regra da branch `main` com:

- pull request obrigatório com 0 aprovações exigidas enquanto houver apenas um
  colaborador, pois o autor não pode aprovar o próprio PR;
- status check obrigatório `quality-gate` atualizado antes do merge;
- conversa de revisão resolvida antes do merge;
- force push e exclusão da branch desabilitados.

Não aplicar a regra a `develop`: o fluxo do projeto permite push direto nessa
branch e exige PR revisado de `develop` para `main`. A configuração remota da
proteção é uma ação manual separada; este repositório apenas prepara o check e o
runbook.

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

## Retenção operacional

O job diário `tx-raio-x-operational-retention` remove rate limits com mais de 2 dias, pedidos de exclusão falhos com mais de 90 dias e reconcilia após 15 minutos uma solicitação `processing` cujo `user_id` já ficou nulo pela exclusão no Auth. A instalação automática ocorre somente quando `pg_cron` já está habilitado; confirmar a execução no painel antes da produção. Recibos de análise permanecem pela vida da conta porque removê-los reabriria a idempotência da franquia.

## Security Advisor do Supabase

- A função que ativa RLS automaticamente fica em `app_private`, fora dos schemas
  expostos pela Data API, e não concede `EXECUTE` a `anon`, `authenticated` ou
  `service_role`.
- O event trigger cobre criação direta em `public`; não substitui `ENABLE ROW LEVEL
  SECURITY` explícito nas migrations nem a revisão de tabelas movidas depois com
  `ALTER TABLE ... SET SCHEMA`.
- Após migrations de segurança, atualizar o Security Advisor e exigir zero aviso
  não justificado de função `SECURITY DEFINER` executável por clientes. RPCs
  intencionalmente expostas precisam de revisão, teste de isolamento e justificativa
  registrada; mover uma função interna para `app_private` não dispensa essa análise.
- A proteção contra senhas vazadas é uma configuração hospedada do Supabase Auth,
  disponível no plano Pro. Ativá-la em **Authentication > Attack Protection**;
  no plano gratuito, registrar o risco residual e não liberar produção com saldo
  pago sem controle compensatório aprovado.

## Resposta a incidentes

1. Identificar função, código e `X-Request-Id`.
2. Conferir ordem e pagamento na Stripe e no Supabase, sem copiar PII para o chamado.
3. Pausar publicação/credenciais de produção se houver crédito indevido, assinatura inválida aceita ou vazamento de segredo.
4. Preservar logs e horários; nunca registrar access token para reproduzir.
5. Corrigir e validar aprovação, repetição, reembolso e chargeback antes de reabrir o fluxo.

## Corte do provedor anterior

Depois do smoke Stripe, excluir a Edge Function remota `mercado-pago-webhook`,
remover todos os secrets `MERCADO_PAGO_*` do Supabase e apagar a URL de notificações
no painel anterior. Validar com `supabase functions list` e `supabase secrets list`.
Não apagar ordens, pagamentos ou ledger históricos; eles permanecem para
conciliação e retenção.
