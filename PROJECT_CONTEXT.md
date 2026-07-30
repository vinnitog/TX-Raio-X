# PROJECT_CONTEXT.md - TxRaioX

Gerado em: 2026-07-28 17:04:23

## Descricao

PWA brasileira que traduz transacoes cripto em explicacoes claras e acionaveis

## Objetivo

Permitir duas analises gratuitas por navegador/perfil e origem, e desbloqueio beta por R$ 4,99, sem custodia ou movimentacao de ativos

## Publico Alvo

Brasileiros que usam criptomoedas e nao entendem dados tecnicos de exploradores blockchain

## Caracteristicas Informadas

- Interface visual: Sim
- Login/autenticacao: Nao
- Banco de dados: Nao
- Offline/PWA: Sim
- Mobile: Sim
- Dashboard/graficos: Nao
- API propria: Nao
- Integracoes externas: Sim
- Multiusuario: Nao

## Stack Escolhida

```text
HTML + CSS + JavaScript vanilla + Service Worker
```

## Motivo Da Stack

Para PWA simples, mobile e offline, vanilla reduz build step e facilita deploy estatico.

## Alternativas Rejeitadas

React/Vite: valido se surgirem muitas telas/estado. Electron: rejeitado; PWA deve ser tentado primeiro.

## Revisao Obrigatoria De Stack

Antes da primeira feature real, o `senior-dev` deve validar se a stack escolhida ainda faz sentido.

Se houver front-end, `ui-ux-expert` deve validar impacto visual e UX.

O `code-reviewer` deve apontar risco de stack inadequada, excesso de complexidade ou falta de base para evolucao.

## Workflow Padrao

1. `senior-dev`
2. `ui-ux-expert`, quando houver front-end
3. `code-reviewer`
4. `qa-senior`
5. `qa-automate`
6. Validacao final com testes e diff
7. Commit/push em `develop` e PR `develop -> main`

## Comandos De Validacao

```powershell
.\test.cmd
npm.cmd test
git diff --check
```

## Notas De Escopo

- Trabalhar sempre em `develop`.
- Nunca fazer push direto para `main`.
- Preservar alteracoes existentes do usuario.
- Fazer staging explicito por arquivo.
- Manter documentacao de contexto versionada neste arquivo.

## Decisoes Do MVP

- Nome de trabalho: Tx Raio-X.
- Duas analises reais gratuitas por navegador/perfil e origem; no MVP, limpar ou trocar o navegador reinicia deliberadamente esse limite anonimo.
- Em localhost e enderecos de loopback, o modo de demonstracao aplica o limite real de duas analises e permite simular o desbloqueio beta sem pagamento.
- Desbloqueio beta: pagamento unico de R$ 4,99.
- Paywall inicial deliberadamente simples, salvo no dispositivo.
- Sem login, custodia, conexao de carteira ou recomendacao financeira.
- Redes iniciais: Ethereum, Base, Arbitrum, Polygon e BNB Chain.
- Consultas por hash aceitam mais de um RPC por rede e so concluem ausencia quando todos os provedores configurados respondem sem encontrar a transacao.
- O Raio-X confirmado tambem consulta bloco e altura atual para exibir data, numero de confirmacoes, gas, intencao decodificada, eventos de transferencia/autorizacao e detalhes tecnicos.
- Os campos De, Para e Hash completo oferecem copia direta com feedback visual e alternativa para navegadores sem Clipboard API.
- Valores de tokens obtidos sem metadados de contrato sao identificados honestamente como unidades minimas, sem presumir simbolo ou casas decimais.
- Quando uma nova versao do service worker assume o controle de uma aba ja aberta, o app recarrega essa aba uma unica vez para aplicar os arquivos atualizados.
- O motor deterministico produz os fatos; IA remota fica fora do primeiro MVP para evitar custo, segredo no cliente e alucinacoes.
- Pagamento real depende da configuracao de um link em `js/config.mjs`.
- A busca por endereco publico nao consome analise gratis; apenas a analise do hash escolhido consome.
- Historico inicial usa instancias publicas do Blockscout para Ethereum, Base, Arbitrum e Polygon.
- A busca por carteira exige uma rede especifica: retorna as 3 transacoes normais mais recentes no acesso gratuito e ate 10 no beta desbloqueado; o usuario pode inverter a ordem exibida.
- Enquanto o entitlement estiver no localStorage, a regra 3/10 e segmentacao comercial experimental, nao controle antifraude.
- A busca por endereco lista transacoes normais indexadas e nao deve ser apresentada como historico contabil completo.
- A busca por carteira permanece em um painel recolhivel abaixo do analisador por hash.
- O bloco "Como funciona" permanece ao final da pagina, depois da area principal do produto.
- Direcao de pagamento escolhida para producao: Mercado Pago Checkout Pro com Pix, mantendo validacao server-side.
- A evolucao pos-validacao esta registrada em `ROADMAP.md`: conta recuperavel com Login com Google e alternativa de e-mail/senha.
- O direito de acesso pago devera migrar do `localStorage` para um entitlement validado e persistido no servidor.
