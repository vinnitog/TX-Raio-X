# Tx Raio-X

PWA que traduz transações EVM para português claro. O MVP oferece duas análises
gratuitas, uma única vez por conta autenticada. Depois disso, o pacote inicial adiciona
10 análises por R$ 4,90, sem assinatura.

As próximas evoluções estão registradas em `ROADMAP.md` e a decisão comercial em
`docs/MONETIZATION_STRATEGY.md`.

## Executar

Na raiz do projeto:

```powershell
py -m http.server 4173
```

Acesse `http://localhost:4173`. Use **Ver exemplo — não usa análise grátis** para testar a
interface sem consumir o limite.

Em `localhost`, `127.0.0.1` e `::1`, o app simula o fluxo comercial completo:
duas análises gratuitas locais, paywall e compra local de 10 créditos. O botão de compra
não inicia um pagamento real nesse ambiente.

## Autenticação

O cabeçalho oferece uma conta com Google ou e-mail e senha pelo Supabase
Auth. Também estão disponíveis logout e recuperação de senha. As análises reais
exigem conta, enquanto o exemplo e a busca pública continuam sem conectar nem associar uma
carteira à conta.

O frontend usa somente a URL do projeto e a chave pública `publishable`. Segredos
OAuth e chaves `service_role` permanecem no Supabase e nunca devem ser adicionados
ao repositório. Franquia, saldo pago e consumo são derivados do ledger da conta
e recuperados em outros navegadores ou aparelhos.

## Banco de desenvolvimento

As tabelas financeiras são mantidas em migrations versionadas do Supabase. Para
aplicar as migrations no projeto de desenvolvimento, autentique o CLI sem salvar
tokens no repositório e revise o dry-run antes do push:

```powershell
supabase login
supabase link --project-ref <project-ref>
supabase db push --dry-run
supabase db push
```

Não use credenciais de produção nesta etapa.

## Buscar pela carteira

Clique em **Não tem o hash? Buscar pela carteira**, cole um endereço EVM público
e escolha uma rede ou **Todas as redes compatíveis**. A busca consulta Ethereum,
Base, Arbitrum e Polygon por meio
de instâncias públicas do Blockscout e não consome uma análise grátis.

No acesso gratuito, o resultado mostra as três transações normais indexadas mais
recentes no total, depois de reunir e ordenar as redes selecionadas. Elas podem ser
ordenadas da mais recente para a mais
antiga ou no sentido inverso. Transferências internas ou eventos específicos de
tokens podem não aparecer nesta primeira versão. A primeira compra aumenta a
busca para até dez transações.

## Analisar um hash

Cada rede pode ter RPCs alternativos. Quando um provedor responde
`result: null`, o app considera os demais em paralelo e só informa ausência
quando todos os RPCs configurados para a rede respondem sem encontrar a
transação.

Em transações confirmadas, o Raio-X também apresenta bloco, data, confirmações,
gas, endereços completos, intenção decodificada para chamadas conhecidas,
movimentações encontradas nos logs e uma área recolhível com dados técnicos.
Quantidades de tokens sem metadados são mostradas como unidades mínimas, sem
inventar símbolo ou casas decimais.

O service worker procura atualizações ao abrir o app. Quando uma nova versão
assume uma aba que já estava sob controle, ela é recarregada uma vez para evitar
que HTML e módulos JavaScript de versões diferentes permaneçam misturados.

## Pagamento

O endpoint `supabase/functions/checkout` exige uma
sessão Supabase válida, recebe `POST { "packageCode": "analysis_pack_10" }` com um
header `Idempotency-Key` em UUID v4, cria a ordem e só então cria uma sessão do
Stripe Checkout. Preço, quantidade de análises, moeda e retorno não são
aceitos do navegador.

Configure apenas credenciais de teste. Copie
`supabase/functions/.env.example` para um arquivo local ignorado pelo Git e defina:

```text
STRIPE_ENVIRONMENT=test
STRIPE_SECRET_KEY=<sk_test_...>
STRIPE_WEBHOOK_SECRET=<whsec_... do endpoint de teste>
STRIPE_PRICE_ANALYSIS_PACK_10=<price_... de R$ 4,90>
CHECKOUT_RETURN_URL=<URL HTTPS do site de teste>
CHECKOUT_ALLOWED_ORIGINS=<origens HTTPS separadas por vírgula>
```

Para carregar os secrets no projeto de desenvolvimento e publicar somente essa
função:

```powershell
supabase secrets set --env-file .\supabase\functions\.env.local
supabase functions deploy checkout
supabase functions deploy stripe-webhook
```

A função recusa qualquer ambiente diferente de `test` e aceita somente uma
credencial `sk_test_`. O webhook assinado consulta o recurso diretamente na
Stripe e concede ou reverte saldo por RPC transacional idempotente;
parâmetros das URLs de retorno nunca aprovam uma compra.

Fora de localhost, os CTAs carregam a sessão Supabase, pedem login quando
necessário e invocam a função com uma chave de idempotência por tentativa. O botão
fica indisponível durante a criação para impedir cliques duplicados. O retorno do
Stripe Checkout apenas informa o estado do teste; não adiciona análises no navegador.

A produção permanece bloqueada até a configuração do CAPTCHA, revisão final de
segredos/políticas/alertas, smoke manual completo e confirmação da tarifa efetiva.
O roteiro de homologação e o corte remoto da integração anterior estão em
docs/STRIPE_E2E.md. A remoção remota só ocorre depois do smoke Stripe, para não
interromper a conciliação durante a troca.

## Deploy no Railway

O repositório inclui `Dockerfile`, `Caddyfile` e `railway.json`. O Railway serve
somente a allowlist pública do PWA, usa a porta dinâmica da plataforma e valida
`/health`. Não configure secrets Stripe ou `service_role` no Railway: pagamentos,
ledger e análises protegidas continuam nas Edge Functions do Supabase.

Após conectar o repositório e obter a URL HTTPS, atualize os redirects do Supabase
Auth e os secrets `CHECKOUT_RETURN_URL` e `CHECKOUT_ALLOWED_ORIGINS`. O passo a
passo, controles de custo e smoke estão em `docs/RAILWAY_DEPLOYMENT.md`.

## Análise protegida

No site hospedado, a consulta RPC e o motor determinístico executam na Edge
Function `analyze-transaction`. Ela valida sessão, origem, rate limit e saldo, e
só retorna o resultado depois que uma RPC transacional registra o consumo. O
artefato público do GitHub Pages e do Railway é montado por lista permitida e não publica funções,
migrations, testes ou o motor usado no backend.

## Testes

```powershell
.\test.cmd
```
