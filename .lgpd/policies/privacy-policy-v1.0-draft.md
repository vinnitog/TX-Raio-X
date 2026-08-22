# Aviso de privacidade — rascunho v1.0

**Não publicado — requer revisão do controlador/jurídico.**
**Data do rascunho**: 22 de agosto de 2026

## Resumo

O Tx Raio-X usa dados de conta para autenticar, conceder a franquia, manter saldo e recuperar compras. Hashes e endereços consultados são dados públicos da blockchain; o produto não pede conexão de carteira, chave privada ou frase-semente. Hash, carteira e resultado bruto não são gravados nas tabelas de cobrança.

## Controlador e contato

**Pendente antes da publicação:** razão social/nome do controlador, CNPJ/CPF quando cabível, endereço e canal do encarregado ou canal exigido para agente de pequeno porte.

## Finalidades e dados

- Autenticação e recuperação: UUID, e-mail, provedor e sessão.
- Franquia, saldo e entrega: UUID, lançamentos, timestamps e chaves/fingerprints de idempotência.
- Compra e conciliação: IDs, status, valor, moeda e timestamps de pedido/pagamento.
- Segurança: contadores, request IDs e identificadores pseudonimizados estritamente necessários.
- Análise: hash/rede e respostas públicas tratados em trânsito, sem persistência do payload bruto pelo Tx Raio-X.

As bases legais propostas e os critérios de retenção constam nos artefatos internos e precisam de validação antes da publicação.

## Compartilhamentos

Supabase presta autenticação, banco, funções e logs; Google participa somente quando o login Google é escolhido; Stripe processa checkout/pagamento; Blockscout e provedores RPC respondem consultas públicas; GitHub Pages hospeda os arquivos estáticos. Regiões, subprocessadores e mecanismos de transferência precisam ser confirmados antes da publicação.

## Retenção e eliminação

Dados operacionais devem ser eliminados quando a finalidade terminar. Na exclusão da conta, registros financeiros necessários podem ser mantidos de forma bloqueada e sem vínculo direto, pelo período legal aplicável. Os prazos exatos dependem de validação jurídica e configuração dos operadores.

## Direitos do titular

O titular pode solicitar confirmação e acesso, correção, informação sobre compartilhamentos e, quando aplicável, anonimização, bloqueio, eliminação, portabilidade, revogação e revisão/informação sobre tratamento. O canal e o fluxo autenticado devem ser publicados antes da produção.

## Segurança e incidentes

O projeto usa autenticação, RLS, funções protegidas, validação server-side, idempotência, rate limiting e minimização de logs. Nenhuma medida elimina todo risco. Incidentes serão avaliados e comunicados conforme a LGPD e regulamentação vigente da ANPD.

## Mudanças

Mudanças materiais de finalidade, compartilhamento, retenção ou base geram nova versão e comunicação adequada.
