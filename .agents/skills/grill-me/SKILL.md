---
name: grill-me
description: Entrevista rigorosa e explicita para eliminar suposicoes de um plano, requisito, decisao ou design antes da execucao. Use somente quando o usuario invocar grill-me ou pedir para ser entrevistado/grillado; nao acione automaticamente em tarefas ja claras.
---

# Grill Me

Entreviste o usuario ate existir entendimento compartilhado. Mapeie o assunto como uma arvore de decisoes: cada resposta pode abrir novas decisoes dependentes.

Esta adaptacao para Codex combina o front door `grill-me` com o procedimento reutilizavel `grilling` de `mattpocock/skills`, evitando a dependencia do `Skill tool` usada no original.

## Rodadas

A fronteira e o conjunto de decisoes cujos pre-requisitos ja estao resolvidos. Em cada rodada:

1. Recalcule a fronteira a partir das respostas anteriores.
2. Pergunte toda a fronteira que pode ser decidida agora, numerando as perguntas.
3. Para cada pergunta, apresente uma recomendacao concreta e o principal trade-off.
4. Espere as respostas antes de abrir decisoes que dependem delas.

Use este formato:

```text
Q1 - <titulo>: <pergunta e opcoes realmente distintas>
Recomendacao: <resposta sugerida e motivo>

Q2 - <titulo>: <pergunta>
Recomendacao: <resposta sugerida e motivo>
```

Nao antecipe uma pergunta cuja resposta dependa de outra ainda aberta na mesma rodada.

## Fatos e decisoes

Descobrir fatos e responsabilidade do agente. Inspecione arquivos, configuracoes e fontes disponiveis antes de perguntar algo que possa ser verificado. Delegue pesquisa apenas quando houver autorizacao e isso puder avancar em paralelo; a ausencia de subagentes nao bloqueia a investigacao local.

Decisoes pertencem ao usuario. Nao transforme uma recomendacao em consentimento nem execute mudancas durante a entrevista.

## Encerramento

A sessao termina quando a fronteira estiver vazia: todas as decisoes relevantes foram visitadas e nenhuma suposicao material ficou silenciosa. Resuma o entendimento, as decisoes e os trade-offs. So inicie a execucao depois que o usuario confirmar que o entendimento esta correto.
