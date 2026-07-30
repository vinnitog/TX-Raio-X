# Tx Raio-X

PWA que traduz transações EVM para português claro. O MVP oferece duas análises
gratuitas por navegador/perfil e origem. Depois disso, o pacote inicial adiciona
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
duas análises gratuitas, paywall e compra local de 10 créditos. O botão de compra
não inicia um pagamento real nesse ambiente.

## Buscar pela carteira

Clique em **Não tem o hash? Buscar pela carteira**, cole um endereço EVM público
e escolha uma rede. A busca consulta Ethereum, Base, Arbitrum e Polygon por meio
de instâncias públicas do Blockscout e não consome uma análise grátis.

No acesso gratuito, o resultado mostra as três transações normais indexadas mais
recentes da rede escolhida. Elas podem ser ordenadas da mais recente para a mais
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

Crie um checkout no provedor escolhido e preencha `CHECKOUT_URL` em
`js/config.mjs`. Também configure `PAYMENT_VERIFICATION_URL` com um endpoint que
consulte o provedor no servidor e retorne `{ "approved": true }` somente para
pagamentos aprovados de R$ 4,90 vinculados ao pacote de 10 análises.
Configure o retorno de pagamento aprovado para:

```text
https://seu-dominio/?payment_id=ID_DO_PAGAMENTO
```

O saldo é salvo no `localStorage`, mas nunca é concedido somente pelo
parâmetro de retorno. Não publique o checkout sem configurar a validação segura.
Enquanto o MVP depender de armazenamento local, a separação entre 3 e 10
resultados é uma segmentação comercial experimental, não uma barreira antifraude.

A direção planejada para produção é Mercado Pago Checkout Pro com Pix. A
integração ainda dependerá da criação segura do checkout e da confirmação do
pagamento no servidor.

## Testes

```powershell
.\test.cmd
```
