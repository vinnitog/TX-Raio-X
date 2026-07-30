# CLAUDE.md - TxRaioX

## Workspace Obrigatorio

Use sempre este workspace:

```text
C:\Users\Togszera\Desktop\cripto-project
```

Antes de ler, editar, testar, commitar ou fazer push, confirme que o terminal esta nesse diretorio.

## Contexto Compartilhado

Leia `PROJECT_CONTEXT.md` antes de alterar o projeto. Ele e a fonte versionada de objetivo, stack e decisoes iniciais.

## Stack Inicial

```text
HTML + CSS + JavaScript vanilla + Service Worker
```

Motivo:

Para PWA simples, mobile e offline, vanilla reduz build step e facilita deploy estatico.

Alternativas rejeitadas:

React/Vite: valido se surgirem muitas telas/estado. Electron: rejeitado; PWA deve ser tentado primeiro.

Antes da primeira feature real, valide se a stack continua adequada ao objetivo do app.

## Workflow Obrigatorio

Siga sempre esta ordem:

1. `senior-dev`
   - Use para qualquer ajuste, melhoria, bug, ideia nova, funcionalidade nova ou desenvolvimento.

2. `ui-ux-expert`, quando houver front-end
   - Para este projeto, qualquer mudanca de front-end deve passar por avaliacao UI/UX.
   - Verifique aparencia, responsividade, hierarquia visual, acessibilidade basica e consistencia.

3. `code-reviewer`
   - Revise minuciosamente alteracoes, riscos, regressao, fluxo quebrado e falta de testes.
   - Corrija o que for necessario antes de QA.

4. `qa-senior`
   - Faca analise de impacto.
   - Defina testes manuais, regressivos e automatizados.
   - Se mexeu em algo existente, teste regressivo e obrigatorio.

5. `qa-automate`
   - Crie ou ajuste testes automatizados com base nos casos definidos pelo QA senior.

6. Validacao final
   - Rode `.\test.cmd` ou `npm.cmd test`.
   - Revise diff e escopo.

7. Git
   - Trabalhe em `develop`.
   - Nunca faca push direto para `main`.
   - Use staging explicito.
   - Commit e push para `develop`.
   - Abra ou atualize PR `develop -> main` para aprovacao.

Se alguma dessas funcoes nao existir como agent real na sessao, execute como etapa explicita e registre no resumo final.

## Windows

No PowerShell, prefira:

```powershell
.\test.cmd
npm.cmd test
```

Nao use `npm test` se houver risco de bloqueio por ExecutionPolicy.

## Browser

Nao use Browser para `file://`, `localhost` ou `127.0.0.1`, salvo pedido explicito. Se aparecer `ERR_BLOCKED_BY_CLIENT`, pare a tentativa visual e cubra a validacao com testes automatizados ou inspecao estatica.
