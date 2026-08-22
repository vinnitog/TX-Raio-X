# Estratégia de monetização — Tx Raio-X

Atualizada em: 2026-08-22

## Decisão

Adotar **freemium + pacote de uso**:

| Oferta | Preço | Entrega |
|---|---:|---|
| Experimentar | R$ 0 | 2 análises completas e 3 transações por busca de carteira |
| Pacote inicial | R$ 4,90 | 10 análises completas e até 10 transações por busca |

O pagamento é único, sem renovação automática. Os créditos não expiram durante o
beta. Uma nova compra soma mais 10 créditos.

## Provedor de pagamento — decisão de 22 de agosto de 2026

O checkout ativo passa a ser **Stripe Checkout em pagamento único**. A oferta,
preço e entrega permanecem em 10 análises por R$ 4,90, sem assinatura.

| Modelo avaliado | Benefício | Risco/custo | Decisão |
|---|---|---|---|
| Manter somente Mercado Pago | Preserva o fluxo já testado | Mantém código e operação que não serão usados | Encerrar |
| Manter Mercado Pago e Stripe | Redundância de provedor | Duplica webhooks, conciliação, testes e superfície de fraude | Rejeitar no MVP |
| Usar somente Stripe Checkout | Reaproveita o padrão seguro já validado no Bita Calc e reduz a superfície operacional | Exige nova homologação e confirmação das taxas para tíquete baixo | **Adotar** |

Os registros históricos do sandbox do Mercado Pago não serão apagados ou
reescritos: permanecem como trilha financeira imutável. Nenhuma nova ordem,
notificação, secret ou chamada externa usará esse provedor.

### Critérios do Stripe Checkout em teste

- `STRIPE_ENVIRONMENT=test` e credencial `sk_test_` são obrigatórios; produção
  continua bloqueada até revisão explícita.
- O backend aceita somente o Price ID configurado para `analysis_pack_10` e
  valida sessão, modo `payment`, valor de 490 centavos, moeda BRL, ordem e preço.
- A ordem autenticada é criada antes da sessão do Stripe. Repetições usam a mesma
  chave de idempotência e nunca criam crédito pelo retorno do navegador.
- Somente um webhook com assinatura Stripe válida, ambiente correspondente e
  recurso relido na API oficial pode gravar pagamento e ledger.
- `checkout.session.completed` ou `checkout.session.async_payment_succeeded`
  credita uma vez quando `payment_status=paid`. Falha/pêndencia não credita.
- `checkout.session.expired` encerra a ordem sem crédito e libera uma nova
  tentativa idempotente; cancelar no navegador apenas permite reabrir a mesma
  sessão ainda válida até ela expirar.
- Reembolso integral e disputa revertem o pacote uma vez; reembolso parcial fica
  para conciliação manual e não altera automaticamente o ledger.
- Produção depende de confirmar a taxa real da Stripe para R$ 4,90 e demonstrar
  margem positiva após taxa, impostos, custo de análise, fraude e suporte.

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

## Arquitetura financeira atual do teste

- Supabase Auth identifica a conta recuperável; a exclusão da conta anonimiza a
  referência ao usuário sem remover os registros financeiros necessários.
- Cada ordem Stripe preserva ambiente, Price ID, pacote, quantidade, valor e moeda.
  O navegador não informa preço nem recebe autoridade para aprovar uma compra.
- Existe no máximo um checkout Stripe aberto por conta e ambiente. A criação usa
  lock transacional e retorna a ordem aberta mesmo se a chave local for trocada.
- O Stripe Checkout é criado em `mode=payment`, com pagamento único, e a versão da
  API usada pelas Edge Functions fica explicitamente fixada.
- O webhook valida a assinatura sobre o corpo bruto, aplica janela de cinco
  minutos, rejeita eventos `livemode=true`, relê o recurso na Stripe e compara
  sessão, PaymentIntent, Price, ordem, valor, moeda e ambiente.
- Aprovação soma 10 créditos uma vez. Reembolso integral ou disputa aberta
  reverte o pacote uma vez. Reembolso parcial atualiza o pagamento, mas não muda
  o ledger automaticamente e exige conciliação e tratamento manual.
- Eventos repetidos ou fora de ordem são serializados por ordem e identificador do
  evento. Uma aprovação atrasada após um reembolso parcial ainda concede somente
  um pacote e preserva o valor já reembolsado.
- O retorno do navegador é informativo: ele apenas limpa `checkout_status`,
  `session_id` e `source`; jamais concede saldo.
- IDs financeiros e estados ficam no Supabase. Payload bruto, e-mail, documento,
  cartão, hash e carteira não são persistidos nas tabelas financeiras nem em logs.

### Política de disputa encerrada

`charge.dispute.created` revoga os créditos de forma conservadora. Se a disputa for
encerrada a favor do Tx Raio-X e os fundos forem restabelecidos, a restauração de
créditos exige conciliação administrativa idempotente e auditada. A produção fica
bloqueada até esse procedimento ser exercitado; o MVP não restaura automaticamente
um saldo apenas com base no retorno do navegador ou em edição manual direta do
ledger.

### Critérios do checkout e webhook em teste

- usar somente `sk_test_`, Price de teste, endpoint de teste e
  `STRIPE_ENVIRONMENT=test`;
- criar a ordem antes da Checkout Session e reutilizar uma sessão aberta por conta;
- aceitar apenas o host exato `checkout.stripe.com` no redirecionamento;
- confirmar créditos somente por webhook assinado e recurso relido na Stripe;
- manter assinatura inválida, evento live, preço/valor/moeda divergente e ordem de
  outra conta sem efeitos financeiros;
- manter payment_intent.payment_failed retentável na mesma Checkout Session; somente
  falha assíncrona terminal ou expiração libera outra ordem;
- validar aprovação, pendência, recusa, cancelamento, expiração, repetição,
  reembolso parcial/integral, disputa e recuperação do saldo em outro aparelho;
- manter credenciais de produção, remoção remota do provedor anterior e publicação
  definitiva como uma mudança separada depois do smoke Stripe.

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

Revisão atualizada em 22 de agosto de 2026 pela tabela pública brasileira da
Stripe. No preço padrão, cartão nacional custa **3,99% + R$ 0,39** por transação;
cartão internacional acrescenta **2%**. Pix custa **1,19%**, mas aparece como
recurso disponível somente por convite. O Stripe Checkout está incluído no preço
do Payments. Fonte: https://stripe.com/br/pricing

| Meio | Tarifa pública | Custo estimado em R$ 4,90 | Líquido do pagamento | Líquido por análise |
| --- | ---: | ---: | ---: | ---: |
| Cartão nacional | 3,99% + R$ 0,39 | R$ 0,59 | R$ 4,31 | R$ 0,431 |
| Cartão internacional | 5,99% + R$ 0,39 | R$ 0,68 | R$ 4,22 | R$ 0,422 |
| Pix, se habilitado por convite | 1,19% | R$ 0,06 | R$ 4,84 | R$ 0,484 |

A tarifa de cartão nacional consome aproximadamente 12% do tíquete, antes de
impostos, infraestrutura, suporte, fraude e chargebacks. A Stripe informa que,
para preço padrão, emitir reembolso normalmente não adiciona tarifa para cartões,
mas a tarifa de processamento original não é devolvida. Por isso o pacote mantém
margem bruta de pagamento positiva, porém produção continua bloqueada até a tarifa
real da conta e o custo por análise serem conferidos no Dashboard.

1. Homologar apenas a oferta de R$ 4,90, sem dividir o tráfego.
2. Instrumentar o funil sem armazenar hash ou endereço de carteira.
3. Homologar Stripe Checkout e ledger idempotente em test mode.
4. Confirmar saldo recuperável e matriz de reversões.
5. Depois de 10 compradores, comparar 10 por R$ 4,90 com 25 por R$ 9,90 em
   coortes separadas, sem exibir vários planos no primeiro teste.

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

### Preservação de valor na exclusão da conta — 22 de agosto de 2026

Trabalho do usuário: encerrar a conta e exercer seus direitos sem perder uma compra já paga nem deixar um pagamento em andamento sem destino. A unidade de valor, a oferta de 10 análises por R$ 4,90 e a ordem de consumo não mudam.

Foram comparados três tratamentos: apagar imediatamente e perder saldo (rejeitado por destruir direito pago); reembolsar automaticamente (adiado porque exige política financeira e integração específica); ou bloquear somente a exclusão automática quando existir saldo pago ou checkout não terminal, direcionando o caso para resolução assistida (escolhido por ser conservador e reversível). Contas sem compromisso financeiro continuam com exclusão self-service.

Hipótese: o bloqueio evita crédito/reembolso órfão sem impedir a maioria dos pedidos. O evento estruturado existente é `privacy_account`, com resultado `error` e código categórico `account_has_financial_commitments`, sem e-mail, valor ou identificador financeiro. Critério: nenhuma conta com saldo positivo ou checkout aberto pode ser apagada automaticamente; contas com saldo zero e estados terminais devem concluir normalmente. Reversão: substituir o bloqueio pelo fluxo automático de reembolso apenas após validação jurídica, testes de idempotência e conciliação.
