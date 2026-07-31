# Estratégia de monetização — Tx Raio-X

Atualizada em: 2026-07-30

## Decisão

Adotar **freemium + pacote de uso**:

| Oferta | Preço | Entrega |
|---|---:|---|
| Experimentar | R$ 0 | 2 análises completas e 3 transações por busca de carteira |
| Pacote inicial | R$ 4,90 | 10 análises completas e até 10 transações por busca |

O pagamento é único, sem renovação automática. Os créditos não expiram durante o
beta. Uma nova compra soma mais 10 créditos.

## Trabalho e métrica de valor

Trabalho do usuário: quando uma transação parece confusa ou suspeita, obter uma
explicação objetiva para decidir o próximo passo sem conectar a carteira.

Métrica de valor cobrável: **análise Raio-X concluída**. Cobrar pelo hash colado,
pela busca de carteira ou por tempo não acompanha tão bem o benefício entregue.

## Modelos comparados

| Modelo | Ajuste ao público | Sustentabilidade | Fricção | Decisão |
|---|---|---|---|---|
| R$ 4,99 ilimitado no beta | Alto no primeiro pagamento | Baixa se RPC/IA tiver custo por uso | Muito baixa | Encerrar para novas compras; preservar legado |
| 10 análises por R$ 4,90 | Alto; mantém a barreira abaixo de R$ 5 | Alta; receita acompanha uso | Baixa | **Testar primeiro** |
| Assinatura mensal | Baixo para uso episódico | Alta se houver retenção | Alta | Reavaliar apenas com uso recorrente comprovado |
| Gratuito com anúncios/afiliados | Pode degradar confiança em cripto | Depende de escala e parceiros | Baixa para pagar | Rejeitar no MVP |

Ferramentas próximas costumam manter a função básica gratuita e cobrar por
conveniência. O Revoke.cash, por exemplo, mantém revogação individual gratuita e
cobra uma pequena taxa pelo lote. Isso reforça que o Tx Raio-X deve cobrar pela
conveniência repetida e pela tradução, não pelo acesso aos dados públicos.

## Economia unitária

Não há dados suficientes para afirmar CAC, LTV ou margem. Medir:

```text
receita líquida do pacote
  = R$ 4,90 - taxa fixa - taxa percentual - impostos - chargebacks

custo máximo por análise
  = receita líquida do pacote / 10

margem bruta do pacote
  = receita líquida - (análises consumidas × custo médio por análise)
```

O modelo continua válido somente se a margem suportar RPC, indexação, IA,
observabilidade e suporte esperado.

## Hipóteses críticas

| Área | Hipótese | Risco | Como validar |
|---|---|---|---|
| Valor | O Raio-X é útil o bastante após duas experiências | Alto | Conversão do paywall e repetição de uso |
| Usabilidade | “10 análises por R$ 4,90” é entendido sem explicação | Médio | Cliques no CTA, abandono e dúvidas recebidas |
| Viabilidade | R$ 4,90 cobre taxas e custo variável | Alto | Medir receita líquida e custo por análise |
| Viabilidade | Usuários aceitam pagar por dados públicos traduzidos | Alto | Checkout real, não pesquisa de opinião |
| Exequibilidade | Compra e saldo podem ser restaurados com segurança | Alto | Implementar conta e ledger antes da produção |

## Experimento de validação

Eventos mínimos:

1. `analysis_completed` com origem `free` ou `credit`;
2. `paywall_viewed`;
3. `checkout_started`;
4. `purchase_approved`;
5. `credit_consumed`;
6. `pack_repurchase`.

Funil principal:

```text
2ª análise concluída → paywall visto → checkout iniciado → compra aprovada
```

Primeira regra de decisão, definida antes de tráfego:

- manter oferta se houver ao menos 20 paywalls válidos e 2 compras aprovadas;
- revisar mensagem/preço se houver clique no checkout, mas nenhuma aprovação;
- revisar valor do produto se menos de 10% dos paywalls iniciarem checkout;
- não concluir falta de demanda com menos de 20 paywalls válidos.

Esses limiares são sinais iniciais, não evidência estatística definitiva.

## Arquitetura financeira do teste

Migration aplicada no projeto Supabase de desenvolvimento em 31 de julho de 2026;
o histórico local/remoto coincide e o lint remoto do schema `public` foi aprovado.

- Supabase Auth identifica a conta recuperável; a exclusão da conta anonimiza a
  referência ao usuário sem remover os registros financeiros.
- Ordens preservam o retrato do pacote comprado (10 créditos por R$ 4,90) e
  pagamentos preservam apenas identificadores operacionais do Mercado Pago.
- Créditos são derivados de um ledger append-only: compra soma, consumo e
  reembolso subtraem. Webhooks repetidos não duplicam lançamentos graças a chaves
  de idempotência únicas.
- No beta, apenas reembolso integral ou chargeback reverte os 10 créditos do
  pacote, uma única vez por pagamento. Reembolso parcial não altera o ledger de
  créditos automaticamente; fica pendente para conciliação e tratamento manual
  até existir uma política comercial e contábil específica.
- Nenhuma tabela financeira armazena hash, carteira, payload bruto do provedor ou
  dados pessoais. O navegador pode apenas consultar registros da própria conta;
  toda escrita fica restrita ao backend com `service_role`.

Hipótese: uma conta autenticada e um ledger server-side permitem restaurar o saldo
em outro aparelho e tratar reembolsos sem concessão duplicada. A integração começa
somente no ambiente de testes. Se a hipótese falhar, o checkout permanece
desativado e a migration pode ser revertida antes de existir tráfego de produção,
sem alterar preço, pacote ou gratuidade atuais.

### Critérios do checkout em ambiente de teste

- A única oferta aceita pelo backend é `analysis_pack_10`: 10 análises por
  R$ 4,90. Código, quantidade, preço e moeda são definidos no servidor.
- O checkout exige uma conta autenticada e cria a ordem financeira antes de criar
  a preferência no Mercado Pago.
- A chave de idempotência enviada pelo cliente identifica uma tentativa de compra;
  repetições devolvem a preferência já associada e não criam uma nova ordem. Uma
  tentativa concorrente pode receber `checkout_in_progress` enquanto a primeira é
  conciliada; o cliente deve repetir a mesma chave.
- O UUID da ordem é enviado como `external_reference`. URLs de retorno e webhook
  vêm de secrets/configuração do ambiente, nunca do corpo da requisição.
- A função entrega somente o `sandbox_init_point` enquanto
  `MERCADO_PAGO_ENVIRONMENT=test`; habilitar produção exige uma alteração explícita
  e uma nova revisão de segurança, taxas e margem.

Hipótese de exequibilidade: uma preferência do Checkout Pro pode ser criada e
recuperada sem duplicar ordens durante reenvios do navegador. Tentativas com
resultado incerto entram em conciliação pelo `external_reference`; depois de cinco
minutos sem preferência encontrada, uma nova tentativa pode adquirir o lease de
recuperação. Validar com chamadas repetidas usando a mesma chave e confirmar uma
única linha em `orders`. Se houver preferência órfã, duplicação ou divergência de
valor/moeda, manter o checkout desativado, reconciliar o ambiente de teste e
corrigir o fluxo antes do webhook.

### Hardening do checkout autenticado

Decisão registrada em 31 de julho de 2026: manter a oferta e a arquitetura
comercial inalteradas, corrigindo somente duas garantias técnicas do checkout de
teste.

- A Edge Function continuará exigindo `Authorization: Bearer <JWT>`, validado no
  próprio handler por `auth.getUser()`. A verificação JWT legada anterior ao
  handler será desativada para aceitar o JWT assimétrico atual sem tornar a função
  anônima.
- Cada conta manterá sua própria tentativa pendente no navegador. Alternar A → B
  → A deve reutilizar a chave de A e nunca criar uma segunda ordem por perda do
  slot local.
- O registro local anterior será migrado quando válido, preservando tentativas já
  iniciadas. Storage bloqueado após reload permanece um risco residual até a
  conciliação server-side por conta/status existir.

Critérios: chamada sem token ou com token inválido recebe 401 antes de banco ou
Mercado Pago; origem hostil continua em 403; repetições da mesma conta reutilizam
a ordem; contas diferentes nunca compartilham chaves; preço, pacote, moeda,
gratuidade e concessão de créditos não mudam. Falha em qualquer critério mantém o
checkout de teste desativado e impede o webhook/credenciais de produção.

Até o webhook fornecer um status terminal confiável, tentativas não expiram, não
são removidas e não são rotacionadas pelo navegador. Isso preserva idempotência,
mas significa que uma recompra intencional ainda não é suportada. O lifecycle que
encerra a tentativa e libera uma nova chave é bloqueador explícito do pagamento
real.

Validação publicada: versão 2 da função `checkout`, ativa no projeto de testes com
`verify_jwt=false`. O smoke remoto confirmou preflight permitido em 204, origem
hostil em 403, ausência de bearer em 401 `authentication_required` e bearer
inválido em 401 `invalid_session`, sempre sem efeito financeiro.

Correção CORS registrada após o smoke no navegador: `supabase.functions.invoke`
envia também `x-client-info`. O preflight só é considerado aprovado quando
`Access-Control-Allow-Headers` inclui esse header, além de `authorization`,
`apikey`, `content-type` e `idempotency-key`; status 204 isolado não basta.
Correção publicada no projeto de testes em 31/07/2026 e validada remotamente:
origin `https://vinnitog.github.io` recebeu 204 com todos os headers esperados;
origin semelhante e não autorizado recebeu 403 `origin_not_allowed` sem
`Access-Control-Allow-Origin`.

## Próximas iterações

1. Rodar apenas a oferta de R$ 4,90 para evitar dividir o pouco tráfego.
2. Instrumentar o funil sem armazenar hash ou endereço de carteira.
3. Integrar Mercado Pago e registrar créditos em ledger server-side idempotente.
4. Adicionar conta recuperável no momento da compra.
5. Depois de 10 compradores, comparar 10 por R$ 4,90 com 25 por R$ 9,90 em
   coortes separadas; não exibir vários planos no primeiro teste.

## Origem metodológica

Esta decisão adapta os frameworks de monetização, pricing, mapa de hipóteses e
experimentos do projeto [phuryn/pm-skills](https://github.com/phuryn/pm-skills).
