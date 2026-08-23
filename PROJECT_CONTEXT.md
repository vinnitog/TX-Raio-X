# PROJECT_CONTEXT.md - TxRaioX

Gerado em: 2026-07-28 17:04:23

## Descricao

PWA brasileira que traduz transacoes cripto em explicacoes claras e acionaveis

## Objetivo

Permitir duas análises gratuitas por conta verificada e vender pacotes de 10 análises por R$ 4,90, sem assinatura, custódia ou movimentação de ativos

## Publico Alvo

Brasileiros que usam criptomoedas e nao entendem dados tecnicos de exploradores blockchain

## Caracteristicas Informadas

- Interface visual: Sim
- Login/autenticacao: Sim, exigido para analises reais via Supabase Auth
- Banco de dados: Sim, Supabase
- Offline/PWA: Sim
- Mobile: Sim
- Dashboard/graficos: Nao
- API propria: Sim, Supabase Edge Functions
- Integracoes externas: Sim
- Multiusuario: Sim, com conta obrigatoria para analises reais e compras

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
- Duas análises reais gratuitas, concedidas uma única vez no backend por conta autenticada; limpar dados ou trocar de navegador não restaura a franquia.
- Em localhost e enderecos de loopback, o modo de demonstracao aplica o limite real de duas analises e permite simular a compra de 10 creditos sem pagamento.
- Modelo de cobranca: duas analises gratis e pacotes cumulativos de 10 analises por R$ 4,90, sem assinatura ou renovacao automatica.
- A analise concluida e a metrica de valor cobrada; buscas de carteira continuam gratuitas.
- Direitos legados do antigo beta ilimitado sao preservados, mas nao sao mais vendidos.
- Paywall e consumo hospedados são validados no backend; o navegador não concede franquia nem saldo.
- Conta via Google ou e-mail/senha é exigida para análises reais e recuperação de saldo; exemplo e busca pública continuam sem custódia, conexão de carteira ou recomendação financeira.
- Redes iniciais: Ethereum, Base, Arbitrum, Polygon e BNB Chain.
- Consultas por hash aceitam mais de um RPC por rede e so concluem ausencia quando todos os provedores configurados respondem sem encontrar a transacao.
- O Raio-X confirmado tambem consulta bloco e altura atual para exibir data, numero de confirmacoes, gas, intencao decodificada, eventos de transferencia/autorizacao e detalhes tecnicos.
- Os campos De, Para e Hash completo oferecem copia direta com feedback visual e alternativa para navegadores sem Clipboard API.
- Valores de tokens obtidos sem metadados de contrato sao identificados honestamente como unidades minimas, sem presumir simbolo ou casas decimais.
- Quando uma nova versao do service worker assume o controle de uma aba ja aberta, o app recarrega essa aba uma unica vez para aplicar os arquivos atualizados.
- O motor deterministico produz os fatos; IA remota fica fora do primeiro MVP para evitar custo, segredo no cliente e alucinacoes.
- O CTA de compra chama a Edge Function autenticada `checkout`; localhost preserva apenas a simulacao sem pagamento.
- A busca por endereco publico nao consome analise gratis; apenas a analise do hash escolhido consome.
- Historico inicial usa instancias publicas do Blockscout para Ethereum, Base, Arbitrum e Polygon.
- A busca por carteira permite uma rede especifica ou todas as redes com historico compativel: reune, ordena e entao limita o resultado globalmente a 3 transacoes normais no acesso gratuito e ate 10 depois da primeira compra; o usuario pode inverter a ordem exibida.
- A regra 3/10 da busca pública usa o entitlement da conta apenas como segmentacao comercial; a busca não consome saldo.
- A busca por endereco lista transacoes normais indexadas e nao deve ser apresentada como historico contabil completo.
- A busca por carteira permanece em um painel recolhivel abaixo do analisador por hash.
- O bloco "Como funciona" permanece ao final da pagina, depois da area principal do produto.
- Direcao de pagamento escolhida em 22 de agosto de 2026: Stripe Checkout em pagamento unico, mantendo validacao server-side; registros anteriores do sandbox do Mercado Pago ficam apenas como historico imutavel.
- A evolucao pos-validacao esta registrada em `ROADMAP.md`: conta recuperavel com Login com Google e alternativa de e-mail/senha.
- O direito de acesso pago e a franquia gratuita são persistidos no ledger e recuperados por conta.
- A migration inicial do Supabase para ordens, pagamentos e ledger foi aplicada no projeto de desenvolvimento com RLS, idempotencia e reversao integral; o lint remoto do schema public foi aprovado antes do checkout.
- O PWA integra Supabase Auth com Google, e-mail/senha, sessão persistente, logout e recuperação de senha; compras e saldo do ledger são recuperados pela conta autenticada, inclusive em outro navegador.
- A Edge Function `checkout` cria uma ordem autenticada antes da sessão do Stripe, aceita somente o pacote configurado e permanece bloqueada no ambiente de testes.
- O checkout valida o JWT assimétrico da sessão dentro da Edge Function com `auth.getUser`, antes do body e de qualquer efeito financeiro; a verificação legada do gateway fica desativada somente nessa função.
- Tentativas de checkout são preservadas por conta no navegador e o formato anterior é migrado sem trocar a chave. Recompra continua bloqueada até o webhook confirmar estado terminal e autorizar a rotação server-side.
- A versão 2 da Edge Function `checkout` foi publicada no ambiente de testes com autenticação manual e smoke remoto aprovado para CORS e rejeição de sessão ausente/inválida; o checkout autenticado real ainda deve ser validado pelo site.
- O fluxo anterior do Mercado Pago foi desativado no código; seus registros de sandbox permanecem apenas como histórico financeiro imutável até a política de retenção autorizar outra medida.
- O Stripe Checkout abre em nova aba com fallback seguro, mantém no servidor o Price e o retrato comercial da ordem e limpa somente os parâmetros Stripe conhecidos no retorno. Nenhum retorno do navegador concede créditos.
- O webhook Stripe valida assinatura sobre o corpo bruto, relê os recursos na API, rejeita ambiente/ordem/preço/valor/moeda divergentes e usa uma RPC transacional idempotente para atualizar pagamento, ordem e ledger.
- A franquia gratuita e o saldo pago são derivados do ledger da conta. A Edge Function `analyze-transaction` consulta e interpreta a transação no backend; a RPC de finalização consome primeiro `free_consumption` e depois `consumption`, com serialização e idempotência por UUID. Tentativas incertas preservam o mesmo identificador no `sessionStorage`, troca de conta falha fechada e recompra só gira a chave após ordem terminal confirmada por RLS.
- O cabeçalho apresenta o saldo pago recuperado ao lado da franquia grátis restante, sem esconder a compra na modal da conta e sem somar as duas origens em um total ambíguo.
- O site publicado não inclui o motor de análise nem os clientes RPC da análise por hash. Um cliente modificado precisa chamar a Edge Function autenticada, que aplica rate limit, confere saldo e só entrega o resultado após a finalização transacional. Como o repositório-fonte é público e os dados blockchain também são públicos, isso protege o serviço oficial e sua contabilidade, mas não pretende tornar o algoritmo propriedade secreta.
- A estrategia comercial, hipoteses e criterios do experimento estao em `docs/MONETIZATION_STRATEGY.md`.
- Mudancas futuras de preco, pacote, paywall ou checkout devem usar a skill local `tx-raio-x-monetization`.
- Direitos técnicos da conta incluem exportação JSON autenticada e exclusão definitiva com confirmação digitada e sessão emitida recentemente; a exclusão remove o vínculo de usuário dos registros financeiros e apaga dados operacionais vinculados.
- A retenção operacional remove rate limits após dois dias e pedidos de exclusão falhos após 90 dias; recibos pseudonimizados de análise duram a vida da conta para preservar idempotência e antifraude.
- Produção continua bloqueada até identificar controlador/canal, validar juridicamente política e retenções, comprovar contratos/transferências dos operadores e executar o exercício de incidente documentado.
- A exclusão automática da conta falha fechada quando existe saldo pago ou checkout não terminal; esses casos exigem resolução assistida para preservar valor e impedir aprovação órfã.
- O atalho de teclado para o conteúdo principal possui ocultação crítica inline: continua acessível no primeiro Tab e não aparece sem estilo ao voltar das páginas legais durante uma troca de cache do PWA.
- O event trigger que ativa RLS em novas tabelas públicas executa uma função `SECURITY DEFINER` no schema interno `app_private`, sem `EXECUTE` para papéis da Data API; proteção contra senhas vazadas permanece requisito operacional de produção dependente do Supabase Pro.
