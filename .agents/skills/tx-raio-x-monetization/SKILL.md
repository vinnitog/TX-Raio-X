---
name: tx-raio-x-monetization
description: Projetar, revisar e validar a monetização do Tx Raio-X. Usar ao alterar preço, gratuidade, créditos, paywall, checkout, benefícios pagos, métricas comerciais ou experimentos de disposição a pagar.
---

# Monetização do Tx Raio-X

Preservar uma oferta simples para um produto brasileiro, anônimo e de baixo contato, sem comprometer a sustentabilidade quando houver custo variável de RPC ou IA.

## Fluxo obrigatório

1. Ler `PROJECT_CONTEXT.md`, `docs/MONETIZATION_STRATEGY.md` e [references/guardrails.md](references/guardrails.md).
2. Definir o trabalho do usuário e o valor entregue antes de discutir preço.
3. Tratar uma análise Raio-X concluída como métrica de valor principal.
4. Comparar pelo menos três modelos distintos. Avaliar ajuste ao público, fricção, recorrência, custo variável, risco e esforço operacional.
5. Registrar hipóteses de valor, usabilidade, viabilidade e exequibilidade.
6. Escolher uma única oferta principal por experimento. Evitar planos demais no início.
7. Definir evento, funil, métrica, limiar de sucesso e regra de decisão antes de implementar.
8. Manter preço, tamanho do pacote e limites em configuração, nunca espalhados pela interface.
9. Preservar direitos pagos existentes durante migrações.
10. Exigir validação server-side, idempotência e conta recuperável antes de produção; `localStorage` serve somente para demonstração.

## Formato da recomendação

Entregar:

- modelo recomendado e métrica de valor;
- oferta, preço, público e promessa;
- alternativas rejeitadas e motivo;
- hipóteses críticas e como testá-las;
- eventos do funil e limiares de decisão;
- impactos em produto, engenharia, suporte e termos;
- plano de reversão se o teste falhar.

Não apresentar estimativas de CAC, LTV ou margem como fatos sem dados. Expressar a economia unitária como fórmula e listar os dados ainda necessários.
