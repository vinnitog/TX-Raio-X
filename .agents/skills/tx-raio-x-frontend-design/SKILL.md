---
name: tx-raio-x-frontend-design
description: Revisar e melhorar o front-end do Tx Raio-X preservando sua identidade visual, acessibilidade e fluxos de análise, autenticação e compra. Usar em qualquer alteração de HTML, CSS, JavaScript visual, responsividade, conteúdo de interface ou estados de interação.
---

# Front-end design do Tx Raio-X

Esta skill adapta princípios do [Impeccable](https://github.com/pbakaus/impeccable) ao produto. Ela complementa, sem substituir, `senior-dev` e `ui-ux-expert`.

## Direção do produto

- Preserve o mundo visual existente: fundo azul-escuro, verde-lima para ações e saldo, azul para informação, superfícies sóbrias e linguagem direta.
- Trate a landing/preço como superfície de persuasão e o analisador, autenticação e resultados como superfícies operacionais.
- Faça refinamento, não redesign disfarçado. Mudança estrutural exige evidência e escopo explícito.
- Mantenha HTML, CSS e JavaScript vanilla. Não adicione framework para resolver um ajuste local.

## Ordem da revisão

1. Corrija tarefa bloqueada, estado enganoso, risco de perda e caminho inacessível.
2. Cubra carregamento, vazio, erro, sucesso, desabilitado e recuperação.
3. Corrija hierarquia, responsividade, foco, contraste e consistência.
4. Só então aplique polimento visual ou movimento.

## Regras específicas

- A interface deve dizer a verdade: conta é necessária para análise real, mas não para exemplo nem leitura da página.
- Nunca peça conexão de carteira, chave privada ou frase-semente.
- Controles têm alvo mínimo de 44 px, foco visível e rótulo que nomeia a ação.
- Diálogos devem prender foco, fechar de forma previsível e não substituir uma página quando a tarefa precisa de espaço próprio.
- Preserve texto do usuário em erros; explique o problema e a recuperação.
- Teste nomes/e-mails longos, zoom de 200%, teclado, mobile de 320 px, rede lenta, offline, 401, 429 e 5xx.
- Use tokens de `css/app.css`; evite cor e dimensão reutilizável hard-coded.
- Movimento comunica estado, dura em geral 150–250 ms e respeita `prefers-reduced-motion`.
- Incremente a versão do cache do Service Worker quando HTML, CSS ou JavaScript mudar.

## Saída obrigatória

Registre achados com severidade P0–P3, impacto e correção. Valide com `./test.cmd`, revisão do diff e, quando houver mudança visual, os casos de `references/review-checklist.md`.
