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

### Retorno do checkout e observabilidade

Decisão registrada após o primeiro pagamento aprovado no sandbox: manter preço,
pacote, gratuidade e concessão de créditos inalterados, refinando somente a
experiência e a leitura operacional do checkout.

- O checkout abre em uma nova aba criada diretamente pelo gesto do usuário. Se o
  navegador bloquear a aba ou ela for fechada antes do redirecionamento, o fluxo
  usa a aba atual como fallback; a referência `opener` é removida antes de entregar
  a navegação ao Mercado Pago. Se esse isolamento não puder ser confirmado, a aba
  auxiliar é fechada e nunca recebe a URL externa.
- O retorno remove apenas os parâmetros conhecidos do Mercado Pago, incluindo
  `processing_mode` e `merchant_account_id`, e preserva parâmetros de autenticação,
  campanha e fragmentos que não pertencem ao pagamento.
- Repetir uma chave de checkout continua recuperando a mesma ordem, mas o conflito
  esperado deixa de gerar um erro `23505` nos logs: a escrita ignora a duplicata e
  consulta a ordem pelo mesmo usuário e chave.
- Um retorno `success` continua sendo apenas informativo. Nenhum saldo é liberado
  por URL; somente o webhook e o ledger server-side poderão confirmar a compra.

Critérios: uma única chamada por duplo clique, fallback quando popup for bloqueado,
fechamento da aba vazia em autenticação/falha, URL limpa após sucesso/pendência/
falha, preservação dos parâmetros não financeiros e uma única ordem por chave.
Edge Function atualizada no ambiente de testes em 31/07/2026; o smoke remoto
confirmou preflight 204 com a allowlist esperada e POST sem sessão em 401
`authentication_required`, sem efeito financeiro.

## Próximas iterações

### Webhook de pagamento em ambiente de teste

Decisão registrada em 31 de julho de 2026: o webhook é a única origem autorizada
para transformar um pagamento em créditos. O retorno do navegador continua sendo
apenas informativo e não altera ordem, pagamento ou ledger.

- A notificação precisa ter assinatura HMAC válida do Mercado Pago antes de
  qualquer consulta externa ou escrita no banco. O identificador assinado deve
  coincidir com o corpo da notificação.
- O probe vazio usado pelo painel para validar a URL recebe `200` apenas quando o
  body é exatamente `{}`, não há query nem headers `x-signature`/`x-request-id`,
  e termina sem consultar Mercado Pago ou banco. Toda requisição que contenha
  sinais de notificação financeira continua exigindo validação e assinatura.
- Depois da assinatura, a função consulta `/v1/payments/{id}` com o token do
  vendedor e usa essa resposta como fonte de verdade. O pagamento deve ser de
  teste, pertencer ao `collector_id` configurado e coincidir com a ordem em
  `external_reference`, valor inteiro em centavos e moeda.
- O `live_mode` esperado também é fixado no ambiente. A conta vendedora de teste
  atual produz pagamentos com `live_mode=true`; aceitar esse valor não habilita
  produção, pois o ambiente continua travado em `test` e o `collector_id` precisa
  coincidir com a conta vendedora de teste configurada.
- Uma função SQL `security definer`, executável somente por `service_role`, grava
  pagamento, estado da ordem e ledger na mesma transação. Repetições e chamadas
  concorrentes usam chaves únicas e não duplicam o crédito.
- Cada `payment_id` aprovado representa dinheiro efetivamente recebido e concede
  um pacote. Se uma preferência produzir dois pagamentos aprovados distintos,
  ambos concedem 10 créditos; o reembolso de um deles reverte somente seu próprio
  pacote. Repetir o mesmo `payment_id` continua sem duplicar saldo.
- `approved` soma os 10 créditos exatamente uma vez. `pending`, `authorized`,
  `in_process`, `in_mediation`, `rejected` e `cancelled` não alteram o ledger.
  Reembolso integral ou `charged_back` reverte os 10 créditos uma única vez,
  somente se o lançamento de compra existir. Reembolso parcial não altera o
  ledger automaticamente e exige conciliação manual.
- Payload bruto, e-mail, documento e dados do pagador não são persistidos nem
  registrados em logs. Falhas expõem apenas códigos operacionais limitados.
- O `ts` participa do HMAC, mas não recebe uma janela curta de expiração: o
  Mercado Pago documenta reenvios após 15 minutos, 6 horas e até vários dias.
  Replays válidos consultam novamente o recurso atual, cuja
  `date_last_updated` impede regressão, e chegam a uma transação idempotente; uma
  janela local de tempo descartaria reenvios legítimos sem ampliar a proteção
  financeira. Limitação de volume fica para a camada de infraestrutura.

Critérios do teste: assinatura inválida não chama Mercado Pago nem banco;
pagamento com vendedor, ambiente, ordem, valor ou moeda divergentes é rejeitado;
aprovação repetida mantém um pagamento e um crédito; estados sem aprovação não
creditam; reembolso integral e chargeback não produzem saldo negativo quando a
aprovação anterior não foi processada. Produção permanece bloqueada.

### Saldo recuperável e consumo transacional

Decisão histórica registrada em 1º de agosto de 2026: naquele estágio, a oferta
mantinha duas análises grátis por navegador e o pacote único de 10 análises por
R$ 4,90. A gratuidade por navegador e a entrega no cliente foram substituídas
pelas decisões de 2 de agosto descritas abaixo; preço e pacote não mudaram.

Modelos avaliados:

- manter créditos e consumo somente no `localStorage`: menor esforço, mas não
  recupera compras em outro aparelho e permite adulteração; rejeitado;
- permitir que o navegador insira consumos diretamente no ledger: recuperável,
  porém expõe uma capacidade de escrita financeira desnecessária; rejeitado;
- consultar o saldo com RLS e consumir por Edge Function + RPC transacional:
  pequena latência adicional, mas preserva autoria, idempotência e auditoria;
  escolhido para o teste;
- mover também a consulta blockchain e a análise para o backend: controle mais
  forte sobre a entrega, com maior custo e complexidade operacional; escolhido
  em 2 de agosto como bloqueador de segurança para produção.

Hipóteses históricas: o usuário entende que as duas análises gratuitas são usadas antes do
saldo da conta; o saldo aparece corretamente após login em outro aparelho; uma
falha de rede não duplica o consumo; e serialização por conta impede dois
consumos concorrentes quando resta somente um crédito. A análise paga só é
exibida depois de o consumo ser confirmado. Compras ativas preservam o benefício
de até 10 transações por busca, mesmo quando o saldo chega a zero; reembolso
integral ou chargeback remove esse benefício se não houver outra compra ativa.
Ao iniciar uma nova compra, o cliente só troca a chave idempotente anterior
depois de confirmar pela própria RLS que a ordem daquela conta chegou a um estado
terminal; falha de rede preserva a chave antiga e evita preferência duplicada.

Eventos e critérios: `credit_balance_loaded`, `credit_consumed` e
`credit_consumption_failed`, sem hash, carteira, e-mail ou payload financeiro.
O incremento é aprovado somente com saldo restaurado em outra sessão, consumo
`-1` único por identificador, rejeição sem saldo, isolamento entre contas e
regressão completa aprovada. Se qualquer critério falhar, o consumo pago
hospedado permanece bloqueado e o checkout continua restrito a testes; os
créditos já comprados permanecem intactos no ledger.

Esse limite foi encerrado em 2 de agosto: o site publicado não recebe o analisador
nem os provedores RPC usados na análise por hash. A Edge Function autenticada
consulta, interpreta e finaliza o consumo de forma transacional antes de devolver
o resultado. O identificador de uma tentativa incerta é mantido no
`sessionStorage` junto de um fingerprint local; o backend guarda somente o
fingerprint SHA-256 para idempotência, sem persistir hash bruto, carteira ou
resultado. O repositório-fonte e os dados blockchain são públicos, portanto a
proteção impede bypass do serviço oficial, mas não depende de segredo do algoritmo.

#### Visibilidade do saldo no cabeçalho

Decisão registrada em 1º de agosto de 2026: manter preço, pacote, gratuidade e
ordem de consumo inalterados, mas tornar o saldo recuperado visível sem exigir que
o usuário abra a área da conta. Foram comparadas três apresentações: saldo apenas
na modal da conta, um total único sem distinguir a origem e saldo pago acompanhado
da franquia grátis restante. A terceira foi escolhida por comunicar imediatamente
o valor comprado sem sugerir que créditos pagos e gratuitos tenham a mesma origem.

Critério de aceitação: uma conta com 10 créditos e duas análises grátis deve ver
`Saldo: 10 + 2 grátis` no cabeçalho; singular, saldo zero, carregamento e falha de
rede devem continuar claros e não podem alterar nem consumir créditos. A modal da
conta preserva apenas a informação de que compras e saldo acompanham a conta.

### Gratuidade única por conta verificada

Decisão registrada em 2 de agosto de 2026: retirar a franquia gratuita do
`localStorage` no site hospedado e conceder duas análises, uma única vez, à conta
autenticada. Uma análise Raio-X concluída continua sendo a unidade de valor; preço,
pacote pago e ausência de assinatura não mudam.

Modelos avaliados:

- duas análises por navegador: menor fricção, mas limpar dados ou abrir perfis
  permite gratuidade ilimitada; rejeitado;
- duas análises por conta com e-mail verificado, concessão e consumo server-side,
  CAPTCHA no cadastro e limites por conta/IP: mantém experimentação com abuso
  limitado e auditável; escolhido para o beta;
- exigir telefone ou instrumento de pagamento único: resistência maior a contas
  múltiplas, porém aumenta custo, coleta de dados e abandono; adiado até fraude
  mensurada justificar a fricção;
- remover a gratuidade: reduz abuso, mas elimina a principal prova de valor antes
  do checkout; rejeitado nesta fase.

Não existe garantia de uma pessoa por e-mail. O objetivo operacional é limitar o
custo do abuso, não prometer bloqueio perfeito. A defesa usa confirmação de e-mail,
limites nativos do Supabase Auth, CAPTCHA quando as chaves do ambiente estiverem
configuradas, limitação de análise por conta/IP e alertas de padrões anormais. Não
será usado fingerprint oculto do dispositivo nem bloqueio indiscriminado de
domínios. Telefone poderá ser testado somente após evidência de abuso relevante.

Na migração, contas existentes recebem a concessão única de duas análises. Como o
uso gratuito anterior ficou apenas no navegador e não pode ser reconciliado com
segurança, essa concessão é um bônus de transição único; compras e consumos pagos
permanecem intactos. Novas contas recebem a concessão idempotente no backend e não
a recuperam ao limpar dados, trocar navegador ou reinstalar o PWA.

Hipóteses e critérios: login não deve reduzir materialmente a conclusão da primeira
análise; a mesma conta deve manter a franquia consumida em outro aparelho; chamadas
concorrentes e repetidas não podem gerar mais de duas gratuitas; e criação anormal
de contas deve aparecer na observabilidade sem armazenar hashes, carteiras ou IP
bruto. Medir `signup_started`, `signup_verified`, `free_analysis_consumed`,
`free_allowance_exhausted` e bloqueios por limite. Se a conversão verificada cair
sem reduzir abuso, reavaliar a mensagem de login; se o custo abusivo permanecer
relevante, testar verificação mais forte antes de alterar preço ou pacote.

### Taxas e margem do pacote de R$ 4,90

Revisão registrada em 2 de agosto de 2026 com base nas tarifas públicas do Mercado
Pago para pagamentos online. Sobre R$ 4,90, antes de impostos, infraestrutura,
reembolsos e chargebacks:

| Meio/prazo | Tarifa divulgada | Custo estimado | Receita líquida do pagamento | Líquido por análise |
| --- | ---: | ---: | ---: | ---: |
| Pix, na hora | 0,99% | R$ 0,05 | R$ 4,85 | R$ 0,485 |
| Cartão, 30 dias | 3,99% | R$ 0,20 | R$ 4,70 | R$ 0,470 |
| Cartão, na hora/14 dias | 4,99% | R$ 0,24 | R$ 4,66 | R$ 0,466 |
| Boleto, 3 dias | R$ 3,49 | R$ 3,49 | R$ 1,41 | R$ 0,141 |

O pacote tem margem de pagamento entre 95,01% e 99,01% nos meios percentuais,
mas boleto consumiria cerca de 71,2% do preço. Por isso o beta excluirá o tipo
`ticket` e limitará cartão a uma parcela na preferência; saldo Mercado Pago, Pix,
crédito e débito permanecem disponíveis. A validação de uma preferência recuperada
também precisa conferir essas regras para não reabrir boleto ou parcelamento por
engano.

A margem de contribuição real ainda depende de impostos da empresa, plano/quota do
Supabase, custo dos provedores RPC, suporte e perdas por fraude. Como o motor não usa
IA paga, o teto conservador disponível para todos esses custos é R$ 4,65 por pacote
no cenário de cartão mais caro. A produção permanece bloqueada até registrar o custo
real por análise e manter reserva para reembolsos/chargebacks; a tarifa efetiva da
conta deve ser conferida novamente em **Seu negócio > Custos > Checkouts** antes de
publicar credenciais reais.

1. Rodar apenas a oferta de R$ 4,90 para evitar dividir o pouco tráfego.
2. Instrumentar o funil sem armazenar hash ou endereço de carteira.
3. Integrar Mercado Pago e registrar créditos em ledger server-side idempotente.
4. Adicionar conta recuperável no momento da compra.
5. Depois de 10 compradores, comparar 10 por R$ 4,90 com 25 por R$ 9,90 em
   coortes separadas; não exibir vários planos no primeiro teste.

## Origem metodológica

Esta decisão adapta os frameworks de monetização, pricing, mapa de hipóteses e
experimentos do projeto [phuryn/pm-skills](https://github.com/phuryn/pm-skills).

### Clareza da conta e confiança — 22 de agosto de 2026

Decisão: manter duas análises gratuitas por conta, pacote de 10 por R$ 4,90,
ordem de consumo e checkout inalterados. A mudança desta rodada corrige somente
a comunicação: análises reais exigem conta; exemplo e leitura da página não.
Também torna o aviso de privacidade acessível no fluxo de autenticação.

Hipótese: remover a expressão enganosa “conta opcional” reduz surpresa no primeiro
uso sem diminuir materialmente a conclusão do cadastro. Medir futuramente apenas
eventos pseudonimizados de abertura, início e confirmação do cadastro e início de
análise. Nenhuma telemetria nova entra nesta rodada. Preço e pacote só serão
reavaliados com comportamento real suficiente, conforme os critérios já definidos.
