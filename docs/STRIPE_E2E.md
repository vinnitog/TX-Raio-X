# Homologação Stripe em modo de teste

Este roteiro valida Stripe Checkout real, webhook publicado e ledger do Supabase
sem habilitar produção. Use apenas `sk_test_`, Price de teste e endpoint de teste.

## Configuração

1. No Dashboard Stripe em modo de teste, crie um produto para o pacote de 10
   análises e um preço único de **R$ 4,90 BRL**. Copie o `price_...`.
2. Crie o endpoint:
   `https://SEU-PROJETO.supabase.co/functions/v1/stripe-webhook`.
   Fixe a versão do endpoint em 2026-02-25.clover, a mesma usada pelas Edge Functions.
3. Inscreva o endpoint somente nestes eventos:
   - `checkout.session.completed`;
   - `checkout.session.async_payment_succeeded`;
   - `checkout.session.async_payment_failed`;
   - `checkout.session.expired`;
   - `payment_intent.payment_failed`;
   - `charge.refunded`;
   - `charge.dispute.created`.
4. Copie o signing secret `whsec_...` desse endpoint. O secret da Stripe CLI é
   diferente e não deve substituir o secret do endpoint publicado.
5. Preencha um arquivo local ignorado pelo Git a partir de
   `supabase/functions/.env.example` e carregue os secrets:

```powershell
supabase secrets set --env-file .\supabase\functions\.env.local
supabase db push
supabase functions deploy checkout
supabase functions deploy stripe-webhook
```

Não remova os recursos remotos antigos antes do smoke Stripe. Depois que checkout,
webhook e ledger passarem na matriz, faça o corte operacional em uma mudança
separada e revisada:

```powershell
supabase functions delete mercado-pago-webhook
supabase secrets unset MERCADO_PAGO_ENVIRONMENT MERCADO_PAGO_ACCESS_TOKEN MERCADO_PAGO_WEBHOOK_SECRET MERCADO_PAGO_COLLECTOR_ID MERCADO_PAGO_PAYMENT_LIVE_MODE MERCADO_PAGO_WEBHOOK_URL
supabase secrets list
supabase functions list
```

No painel do Mercado Pago, exclua também a URL de notificações do projeto. Confirme
que não existe versão publicada de `mercado-pago-webhook`, secret `MERCADO_PAGO_*`
nem endpoint apontando para o Supabase. Esses comandos alteram o ambiente remoto e
não fazem parte do deploy de código automático.

## Matriz obrigatória

Para cada cenário, registre `order.id`, `cs_test_...`, `pi_...`, `evt_...`, status
da ordem/pagamento e soma do ledger. Nunca cole e-mail, cartão, token ou payload
integral nos registros de QA.

| Cenário | Resultado esperado |
|---|---|
| Cartão `4242 4242 4242 4242` | uma ordem, um pagamento aprovado e `purchase +10` |
| Duplo clique/repetição da mesma chave | mesma ordem e mesma Checkout Session |
| Reenvio do mesmo evento | nenhuma nova linha de compra no ledger |
| Cartão recusado de teste | sem crédito; a mesma ordem e Checkout Session continuam reutilizáveis para outro cartão |
| Falha assíncrona terminal | sem crédito; ordem rejeitada e nova tentativa liberada |
| Cancelar e voltar | nenhum crédito; mesma sessão pode ser reaberta enquanto válida |
| Sessão expirada | ordem cancelada e nova tentativa liberada |
| Reembolso parcial | pagamento atualizado, saldo não revertido automaticamente |
| Reembolso integral | uma única reversão `refund -10` |
| Disputa/fraude de teste | uma única reversão `chargeback -10` |
| Disputa encerrada a favor do app | restauração manual idempotente e auditada; sem edição direta do ledger |
| Outro navegador/aparelho | saldo recuperado pela mesma conta autenticada |
| Assinatura inválida ou evento `livemode=true` | HTTP 400 e nenhum efeito financeiro |
| Price, valor, moeda, sessão ou ordem divergente | rejeição sem escrita financeira |

O retorno do navegador é apenas informativo. A aprovação só pode aparecer no
saldo depois que o webhook assinado concluir a RPC transacional.

## Gates de produção

- migration e pgTAP executados no projeto de desenvolvimento;
- matriz acima aprovada e evidências conciliadas;
- taxa real da Stripe para R$ 4,90 confirmada e margem positiva;
- endpoint, alertas, retenção e procedimento de incidente revisados;
- procedimento de disputa ganha/fundos restabelecidos exercitado e auditável;
- LGPD/DPA/subprocessadores/transferências da Stripe validados;
- novas credenciais `sk_live_` somente em mudança separada e revisada.
