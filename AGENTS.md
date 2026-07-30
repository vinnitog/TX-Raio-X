# AGENTS.md - TxRaioX

## Workspace Obrigatorio

O workspace correto deste projeto e:

```text
C:\Users\Togszera\Desktop\cripto-project
```

Antes de qualquer leitura, edicao, teste, commit ou push, confirme que o comando esta rodando nesse diretorio.

## Contexto Do Projeto

Leia `PROJECT_CONTEXT.md` antes de alterar codigo, testes, docs ou configuracoes.

## Stack Inicial

Stack escolhida:

```text
HTML + CSS + JavaScript vanilla + Service Worker
```

Motivo:

Para PWA simples, mobile e offline, vanilla reduz build step e facilita deploy estatico.

Alternativas rejeitadas:

React/Vite: valido se surgirem muitas telas/estado. Electron: rejeitado; PWA deve ser tentado primeiro.

Antes da primeira feature real, o `senior-dev` deve confirmar se essa stack ainda faz sentido para o objetivo do projeto.

## Fluxo Obrigatorio De Desenvolvimento

Toda mudanca de desenvolvimento deve seguir esta ordem:

1. `senior-dev`
   - Sempre usar para ajustes, melhorias, bugs, ideias novas, funcionalidades novas e qualquer trabalho de desenvolvimento.
   - Implementa a mudanca com escopo pequeno, sem over-engineering e seguindo o padrao existente.

2. `ui-ux-expert`, quando houver front-end
   - Para este projeto, qualquer ajuste de front-end deve acionar `ui-ux-expert`, mesmo sem `/ui-ux`.
   - Valida aparencia, usabilidade, responsividade, hierarquia visual e consistencia.

3. `code-reviewer`
   - Entra logo apos o `senior-dev`, ou logo apos o `ui-ux-expert` quando houver front-end.
   - Faz revisao minuciosa das alteracoes, procurando regressao, bug, risco, quebra de fluxo e ausencia de cobertura.
   - Corrige o que for necessario antes de passar para QA.

4. `qa-senior`
   - Faz analise de impacto da mudanca.
   - Define casos de teste manuais, regressivos e automatizados conforme o impacto.
   - Se a mudanca toca algo existente, testes regressivos sao obrigatorios.

5. `qa-automate`
   - Cria ou ajusta testes automatizados a partir dos casos definidos pelo `qa-senior`.
   - Mantem os testes simples, executaveis localmente e alinhados ao app.

6. Validacao final
   - Rodar testes automatizados.
   - Revisar `git diff`.
   - Confirmar que nao entrou alteracao fora do escopo.

7. Git
   - Trabalhar sempre a partir de `develop`.
   - Nunca fazer push direto para `main`.
   - Fazer staging apenas dos arquivos revisados e pertencentes ao escopo.
   - Rodar `git diff --cached` antes de commitar.
   - Quando tudo estiver ok, fazer commit, push para `develop` e abrir ou atualizar PR `develop -> main` para aprovacao do usuario.

Se algum agent formal nao existir na sessao, simule a funcao como etapa explicita no proprio Codex e registre isso no resumo final. Quando houver ferramenta de subagents disponivel, usar subagents com esses papeis no prompt.

## Testes No Windows

No PowerShell, nao use `npm test`, porque `npm.ps1` pode ser bloqueado pela ExecutionPolicy.

Use um destes comandos:

```powershell
.\test.cmd
npm.cmd test
```

`test.cmd` e o caminho preferencial para evitar falhas de policy no Windows.

## Browser E ERR_BLOCKED_BY_CLIENT

Para este projeto, priorize testes automatizados locais e inspecoes estaticas para HTML/CSS/JS.

Se for necessario validar visualmente:

1. Rode primeiro `.\test.cmd`.
2. Nao usar Browser para `file://`, `localhost` ou `127.0.0.1`, salvo pedido explicito do usuario.
3. Se o usuario pedir Browser e aparecer `ERR_BLOCKED_BY_CLIENT`, pare imediatamente a tentativa visual.
4. Nao tente contornar com URLs alternativas repetidas, CDP bruto ou outro workaround.
5. Substitua a validacao visual por testes automatizados/estaticos que cubram o comportamento ou estilo alterado.

O objetivo e nao repetir ciclos improdutivos de Browser quando o bloqueio e do ambiente.

## Git E Escopo

- Preserve alteracoes existentes do usuario.
- Nao reverta arquivos que voce nao alterou.
- Antes de commitar, confira `git status --short --branch`.
- Nao inclua alteracoes pre-existentes sem necessidade.
- Use `git add -- <arquivo...>` com lista explicita; nao use `git add .` em worktree sujo.
- Se ja existir PR `develop -> main`, atualize/comente o PR existente em vez de tentar criar duplicado.
- Se houver service worker/cache, incremente a versao do cache quando HTML/CSS/JS mudar.
