# Auditoria funcional, de edge cases e seguranca

> Status histórico: este relatório descreve a integração Mercado Pago desativada em 22/08/2026; não é documentação do fluxo Stripe atual.

Data: 2026-07-31

Escopo: PWA, autenticacao Supabase, banco/RLS, Edge Function de checkout,
Mercado Pago em teste, service worker, deploy no GitHub Pages, dados locais e
dependencias externas.

Esta auditoria nao implementa webhook, concessao/consumo transacional de
creditos nem credenciais de producao. Esses itens continuam bloqueadores do
go-live.

## Resumo executivo

O app tem uma boa base defensiva: nao foi encontrado segredo versionado, dados
externos sao renderizados sem HTML executavel, o checkout fixa preco/moeda/pacote
no servidor, cria a ordem antes da preferencia, restringe o host de redirecionamento,
aplica RLS de leitura por usuario e rejeita a origem hostil testada.

O app ainda nao deve receber pagamentos reais. Alem das etapas financeiras ainda
nao implementadas, ha riscos prioritarios na idempotencia entre contas, ciclo de
vida das ordens, abuso da Edge Function, timeout do provedor, maquina de estados
financeira, publicacao excessiva no GitHub Pages e protecao do frontend/sessao.

O erro de checkout observado com usuario autenticado tambem deve ser resolvido
antes de continuar: o frontend usa a chave publicavel atual e a chamada
autenticada envia separadamente o JWT assimetrico da sessao. A funcao publicada
usa `verify_jwt = true`, cujo gateway legado pode rejeitar esse JWT antes que a
validacao interna por `auth.getUser()` seja executada.

## Inventario de funcoes e acoes

### Analise por hash

- Validacao de hash e selecao automatica ou explicita de rede.
- Consulta RPC com fallback, timeout e classificacao de pendente, ausente,
  rejeitada ou confirmada.
- Consulta de recibo, bloco, altura, logs, transferencias e aprovacoes.
- Interpretacao deterministica, exibicao tecnica, links de explorador e copia.
- Consumo de gratuidade/credito somente depois de uma analise concluida.

### Busca por carteira

- Validacao do endereco publico.
- Busca em uma rede ou em todas as redes suportadas pelo historico.
- Mesclagem, deduplicacao, ordenacao e limite 3/10 baseado no estado local.
- Selecao de uma transacao para analise completa.

### Uso e monetizacao local

- Duas analises gratuitas por navegador/origem.
- Creditos, grants idempotentes e direito legado em `localStorage`.
- Paywall e simulacao local de compra.
- Este estado e demonstrativo e nao e uma fronteira antifraude.

### Autenticacao

- Google OAuth, cadastro/login por e-mail e senha, confirmacao, recuperacao,
  sessao persistente e logout.
- PKCE, rotacao de refresh token e redirect allowlist configurados.
- Supabase JS e carregado de um CDN externo e a sessao persiste no navegador.

### Checkout

- Exige sessao, pacote conhecido e UUID v4 de idempotencia.
- Cria ou recupera ordem com snapshot de 10 creditos, BRL 4,90.
- Cria, consulta e reconcilia preferencia do Mercado Pago sandbox.
- Valida referencia externa, item, quantidade, moeda e valor retornados.
- Aceita somente redirect HTTPS dos hosts sandbox permitidos.
- Sanitiza parametros de retorno sem remover parametros de autenticacao.
- Nao concede credito no retorno do navegador.

### Banco e autorizacao

- Tabelas de ordens, pagamentos e ledger.
- RLS limita leitura autenticada aos registros do proprio usuario.
- Escritas financeiras ficam reservadas ao `service_role`.
- Idempotencia, integridade do ledger e anonimizacao ao excluir usuario estao
  modeladas na migration.
- Webhook e operacoes reais concorrentes no PostgreSQL ainda nao foram testados.

### PWA e publicacao

- Manifest, instalacao, cache versionado, fallback offline e atualizacao do SW.
- URLs com parametros financeiros nao sao persistidas no cache.
- GitHub Actions publica em Pages a partir de `main`.

## Matriz de cenarios exercitados

| Dominio | Cenarios principais e edge cases | Resultado |
| --- | --- | --- |
| Hash/RPC | invalido, rede unica/auto, fallback, timeout, resposta incompleta, ID divergente, pendente, ausente e confirmada | Cobertos e verdes |
| Carteira | endereco invalido, rede unica/todas, falha parcial, deduplicacao, ordenacao e limites | Cobertos e verdes |
| Uso | limite gratis, credito, grant repetido, dados locais corrompidos, direito legado | Cobertos e verdes; corrida multiaba pendente |
| Auth | sessao, erro, Google, e-mail, recuperacao, logout e retorno combinado com checkout | Unitarios verdes; fluxo real e retry de falha transitoria pendentes |
| Checkout client | sem sessao, duplo clique, storage bloqueado, reload, troca de conta, resposta/host invalidos | Verdes; 2 riscos reproduzidos e 2 garantias desejadas marcadas como TODO |
| Edge checkout | origem, OPTIONS, metodo invalido, auth ausente/invalida, JSON malformado, body nao objeto, pacote/chave invalidos e campos injetados | Verdes; preflight remoto permitido/hostil validado |
| Ordem/provedor | ordem antes da preferencia, reuso, busca, lease, resposta incerta, rejeicao, divergencia e link falho | Cobertos em mock e verdes; timeout real pendente |
| Pagamento | aprovado, pendente, rejeitado e cancelado | Somente retorno seguro; ciclo financeiro depende do webhook |
| Webhook | repetido, fora de ordem, assinatura invalida, fraude, reembolso integral | Nao implementado; bloqueador |
| Ledger | concessao unica, consumo atomico, estorno e saldo em outro aparelho | Schema parcial; operacoes transacionais ainda nao implementadas |
| Banco/RLS | isolamento, escrita negada, delete/anonimizacao, concorrencia | Lint remoto verde; testes atuais sao estaticos |
| PWA | install, activate, offline, update e exclusao de callbacks financeiros | Unitarios verdes; teste de runtime real pendente |
| Deploy | branch/permissoes, headers, conteudo publicado e dependencias de Actions | Publicacao funciona; hardening pendente |

## Evidencias executadas

- `./test.cmd`: 145 aprovados, 0 falhas e 2 `TODO` de risco conhecido.
- Testes direcionados finais de checkout: 39 aprovados, 0 falhas e 2 `TODO`.
- `git diff --check`: aprovado.
- Sintaxe JavaScript: aprovada.
- `supabase db lint --linked --schema public --level warning --fail-on warning`:
  nenhum erro de schema.
- CORS remoto: origem `https://vinnitog.github.io` recebeu 204 e a origem
  `https://attacker.example` recebeu 403 sem `Allow-Origin`.
- POST remoto sem credencial recebeu 401.
- GitHub Pages respondeu 200 para `supabase/config.toml`, migration SQL e testes,
  confirmando que a raiz inteira do repositorio esta publica.
- A pagina publica nao enviou CSP, protecao de frame, `nosniff`, Referrer-Policy,
  Permissions-Policy ou HSTS na verificacao realizada.
- Busca por segredos no repositorio e historico nao encontrou credencial real;
  o token de exemplo versionado e sintetico e `.env.local` esta ignorado.

Dois testes normais reproduzem os comportamentos atuais e dois marcadores `TODO`
registram as garantias desejadas:

1. conta A inicia checkout, conta B sobrescreve o unico slot local e a conta A
   volta com uma nova chave, embora a preferencia anterior ainda possa ser paga;
2. storage bloqueado seguido de reload perde a tentativa em memoria e cria uma
   nova chave.

## Achados priorizados

### Bloqueadores antes de pagamento real

1. Implementar e validar assinatura do webhook, idempotencia repetida, eventos
   fora de ordem, status aprovado/pendente/rejeitado/cancelado e fraude.
2. Creditar, consumir e estornar no ledger por operacoes transacionais; saldo e
   compras devem pertencer ao usuario autenticado e ser recuperaveis em outro
   aparelho.
3. Resolver e testar a compatibilidade da verificacao JWT da Edge Function com o
   JWT assimetrico atual da sessao. A funcao ja valida o token com `auth.getUser()`; a
   configuracao de gateway deve seguir um caminho oficialmente suportado.
4. Testar RLS, triggers, delete/anonimizacao e concorrencia em PostgreSQL real,
   nao apenas por inspecao textual da migration.

### Alta prioridade

1. Guardar tentativa de checkout por usuario e definir quando uma chave termina,
   expira ou pode ser rotacionada sem permitir dupla cobranca.
2. Impor limite de tentativas ativas e rate limiting por conta/IP na Edge Function.
3. Adicionar timeout explicito ao Mercado Pago e tratar timeout como resultado
   incerto que exige conciliacao.
4. Impor transicoes financeiras validas no servidor, impedir regressao de status
   e tornar a identidade da preferencia imutavel depois do vinculo.
5. Publicar somente os arquivos estaticos necessarios, em vez da raiz do repo.
6. Reduzir o risco do SDK remoto: preferir dependencia local/empacotada e aplicar
   CSP compativel com Supabase, RPCs e checkout.
7. Configurar headers de seguranca no host/CDN: CSP com `frame-ancestors`,
   `nosniff`, Referrer-Policy, Permissions-Policy e HSTS onde suportado.

### Media prioridade

1. Tornar o consumo local resistente a corrida entre abas ou documentar
   explicitamente o limite anonimo como nao antifraude.
2. Permitir retry da autenticacao apos falha transitoria de CDN/rede sem reload.
3. Validar tamanho e `Content-Type` do body da Edge Function.
4. Melhorar observabilidade com request/order correlation ID, etapa, latencia,
   resultado do provedor e metricas do funil, sem registrar tokens ou PII.
5. Corrigir a divergencia entre os termos, a interface e o comportamento atual
   de creditos vinculados a navegador versus conta.
6. Completar politica de privacidade, direitos LGPD, retencao, base legal e
   contato do controlador; revisar juridicamente antes do go-live.
7. Fixar GitHub Actions por SHA e tratar rejeicoes da revalidacao do service worker.
8. Revisar no projeto remoto politica de senha, CAPTCHA/rate limits, redirects,
   templates de e-mail e notificacoes de seguranca.

## Controles que passaram no pente fino

- Sem credencial real no repositorio ou bundle publico inspecionado.
- Chave publicavel do Supabase no frontend e esperada; `service_role` nao esta no cliente.
- Sem vetor de XSS encontrado na renderizacao de dados RPC/historico.
- URL de explorador usa configuracao confiavel e hash validado.
- Redirect do checkout e restrito a HTTPS e hosts sandbox conhecidos.
- Preco, moeda, quantidade, creditos e URLs de retorno nao podem ser sobrescritos
  pelo body enviado pelo navegador.
- Ordem e persistida antes da criacao da preferencia.
- Retorno do navegador nao concede saldo e nao e tratado como prova de pagamento.
- RLS basico bloqueia escrita financeira de `anon` e `authenticated` e isola leitura.
- CORS possui allowlist exata na funcao e rejeitou a origem hostil testada.
- Respostas da Edge Function usam `Cache-Control: no-store`.
- Service worker exclui URLs com parametros de pagamento do cache.

## Criterio de liberacao

Nao configurar credenciais de producao nem publicar checkout real enquanto todos
os bloqueadores e itens de alta prioridade ligados a pagamento, sessao e deploy
nao tiverem implementacao, testes automatizados, teste integrado sandbox e
evidencia de conciliacao. Depois disso, executar a matriz manual de aprovado,
pendente, rejeitado, cancelado, webhook repetido, evento fora de ordem, reembolso
integral, fraude, exclusao de usuario e recuperacao de saldo em outro aparelho.

## Acompanhamento das correcoes

Atualizado em 31 de julho de 2026, após a auditoria inicial:

- a verificação JWT legada do gateway foi desativada somente para `checkout`; o
  handler continua exigindo bearer e agora valida `auth.getUser(token)` antes de
  interpretar o body ou tocar banco/Mercado Pago;
- o body exige `application/json` e no máximo 4096 bytes;
- tentativas pendentes passaram a ser isoladas por conta, com migração segura do
  registro v1, última entrada válida determinística e persistência quando o
  storage volta a funcionar;
- o risco A → B → A foi resolvido e convertido em teste verde;
- a suíte passou a 158 aprovados, 0 falhas e 1 `TODO` para reload com storage
  totalmente bloqueado.
- a versão 2 de `checkout` foi publicada no projeto de testes com
  `verify_jwt=false`; smoke remoto confirmou CORS 204/403 e rejeições 401 geradas
  pelo handler para bearer ausente ou inválido.

Continuam bloqueadores: lifecycle server-side para encerrar tentativa e permitir
recompra, rate limiting/limite de ordens ativas, timeout do Mercado Pago, webhook,
ledger/consumo transacionais e hardening do deploy.

### Atualização — saldo e consumo por conta (1º de agosto de 2026)

- O webhook assinado e a RPC financeira transacional foram implementados e
  validados em sandbox; repetição do mesmo pagamento não duplica crédito.
- `get_credit_entitlement()` deriva saldo e benefício pago do ledger da própria
  conta sob RLS. Reembolso integral e chargeback removem a compra ativa e o saldo
  exibido nunca fica negativo.
- `consume-analysis` autentica com `auth.getUser()`, aplica CORS exato, aceita
  somente UUID v4 e chama uma RPC `security definer` restrita ao `service_role`.
  A RPC serializa consumos por conta, impede consumo sem saldo e registra `-1`
  idempotente no ledger append-only.
- A conta responsável é congelada antes da consulta blockchain e revalidada no
  débito. Uma resposta incerta reutiliza a tentativa persistida; se o navegador
  bloquear o `sessionStorage`, a análise paga falha antes do consumo.
- Ordens terminais liberam uma nova chave de checkout somente após consulta RLS;
  ordens pendentes ou falhas de rede preservam a chave anterior.
- Hash e rede não são enviados ao endpoint financeiro. Apenas um fingerprint da
  operação fica temporariamente no `sessionStorage` para reconciliar o UUID.

Limite residual e bloqueador de produção: `analyzer.mjs` e os clientes RPC são
entregues publicamente pela PWA. Um cliente alterado pode executar esse código sem
chamar o consumo, mesmo que o fluxo oficial esteja correto. Controle antifraude
do paywall exige mover a entrega paga para backend ou aceitar formalmente o risco
após medir abuso e custo. Também continuam pendentes rate limiting, timeout do
Mercado Pago e hardening da hospedagem.
