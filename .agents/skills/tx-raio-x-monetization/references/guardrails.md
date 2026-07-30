# Guardrails comerciais

## Contexto fixo

- Público inicial: brasileiros que usam cripto e não entendem exploradores.
- Aquisição: majoritariamente self-service e sem relacionamento humano.
- Promessa: explicar dados públicos; não custodiar, conectar carteira ou recomendar investimentos.
- Entrada gratuita: duas análises completas.
- Checkout planejado: Mercado Pago Checkout Pro com Pix.
- Estágio atual: validação de disposição a pagar, não maximização de receita.

## Decisões atuais

- Cobrar por análise concluída, unidade que acompanha o valor e o custo futuro.
- Oferta principal: 10 análises por R$ 4,90, pagamento único e sem expiração durante o beta.
- Consumir as duas análises grátis antes dos créditos comprados.
- Liberar até 10 resultados por busca de carteira após a primeira compra.
- Preservar o antigo acesso ilimitado de quem já o possui.

## Restrições

- Não vender “ilimitado” se IA, RPC ou indexação puder gerar custo variável.
- Não usar urgência falsa, assinatura pré-marcada ou renovação automática escondida.
- Não chamar o armazenamento local de acesso durável.
- Não ativar compra por parâmetro de URL sem validação server-side.
- Não alterar preço sem registrar hipótese, métrica e regra de decisão.

## Base metodológica

Adaptação dos skills `monetization-strategy`, `pricing-strategy`,
`identify-assumptions-existing` e `brainstorm-experiments-existing` de
[phuryn/pm-skills](https://github.com/phuryn/pm-skills), combinando comparação de
modelos, métrica de valor, mapa de riscos e experimentos comportamentais.
