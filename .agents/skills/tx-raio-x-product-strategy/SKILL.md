---
name: tx-raio-x-product-strategy
description: Gerar, priorizar e validar ideias de produto, monetização e preço para o Tx Raio-X com hipóteses testáveis e métricas comportamentais. Usar para ideias, roadmap, preço, pacote, gratuidade, paywall, posicionamento ou experimentos.
---

# Estratégia de produto do Tx Raio-X

Esta skill adapta frameworks do [phuryn/pm-skills](https://github.com/phuryn/pm-skills). Em preço, crédito, gratuidade ou checkout, use também `tx-raio-x-monetization` e registre a decisão antes de mudar o produto.

## Processo

1. Parta do problema e do comportamento atual; não de uma lista de features.
2. Gere opções nas lentes PM, design e engenharia.
3. Liste hipóteses de valor, usabilidade, viabilidade e exequibilidade.
4. Priorize a suposição mais crítica e menos comprovada.
5. Escolha o menor experimento que produza evidência comportamental.
6. Defina evento, segmento, janela, sucesso, falha, proteção e decisão posterior.

## Guardrails

- Não invente CAC, LTV, conversão, fraude, tarifa ou disposição a pagar.
- Não altere preço com base em preferência verbal isolada.
- Mantenha uma oferta principal por experimento no tráfego baixo.
- Métricas não podem carregar e-mail, hash, carteira, token ou payload financeiro.
- Preserve o benefício principal: tradução clara de uma transação pública sem conectar carteira.
- Prevenção de abuso deve ser proporcional; não aumente coleta de dados sem evidência.

## Template de decisão

- Problema e segmento
- Hipótese e suposição crítica
- Alternativas consideradas
- Experimento e instrumentação
- Critério de sucesso/falha
- Riscos (privacidade, fraude, margem, UX, segurança)
- Decisão reversível e próximo passo
