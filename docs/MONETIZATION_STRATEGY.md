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
