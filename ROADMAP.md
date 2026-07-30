# Roadmap — Tx Raio-X

## Agora: validar o produto

- Duas análises gratuitas por navegador.
- Desbloqueio beta de R$ 4,99.
- Busca pública por hash ou endereço EVM.
- Sem login, custódia ou conexão de carteira.

## Próxima etapa: conta recuperável e acesso durável

### Problema

O desbloqueio atual é salvo no `localStorage`. Usuários de cripto costumam limpar
histórico, cookies e dados do navegador com frequência. Perder o acesso pago ao
trocar de navegador, aparelho ou limpar dados reduz confiança e conversão.

### Experiência desejada

- Manter as duas análises gratuitas sem exigir cadastro.
- Pedir uma conta somente quando o usuário decidir desbloquear o beta.
- Oferecer dois caminhos:
  1. **Continuar com Google** para contas Google/Gmail, usando OAuth/OpenID Connect.
  2. **Cadastrar outro e-mail** com formulário simples de e-mail e senha.
- Permitir login em outro aparelho e restauração automática da compra.
- Oferecer recuperação de senha e verificação do e-mail sem atendimento manual.
- Não solicitar acesso à caixa de entrada do Gmail.

### Arquitetura

- Autenticação e sessões gerenciadas no backend.
- Senhas armazenadas somente por provedor de autenticação com hash seguro; nunca
  no frontend ou em texto puro.
- Pagamento validado de forma idempotente no servidor e convertido em um direito
  de acesso (`entitlement`) associado ao usuário autenticado.
- O backend cria uma sessão de checkout opaca, vinculada ao usuário e protegida
  por `state`/nonce; um pagamento de outra conta não pode ser reaproveitado.
- Validação confere identificador único, produto, valor, moeda e status, com
  proteção contra replay; preferencialmente por webhook assinado e confirmação
  direta no provedor.
- Provedor planejado: Mercado Pago Checkout Pro com Pix, criado pelo backend e
  confirmado por notificação/webhook mais consulta direta quando necessário.
- `localStorage` usado apenas como cache de conveniência, nunca como fonte
  definitiva do acesso pago.
- O cache terá expiração e uma política explícita para indisponibilidade do
  backend, sem conceder acesso indefinido nem bloquear silenciosamente uma
  compra legítima.
- Carteiras consultadas não serão associadas à conta ou salvas sem consentimento
  explícito.

### Dados mínimos

- Usuário: identificador, e-mail verificado e provedor de login.
- Direito de acesso: usuário, produto, status, pagamento e datas relevantes.
- Nenhuma chave privada, frase-semente ou permissão de movimentação.

### Segurança e privacidade

- Proteção contra enumeração de e-mails e tentativas repetidas de login.
- Sessões revogáveis, rotação após login e cookies `HttpOnly`, `Secure` e
  `SameSite`; endpoints mutáveis terão proteção contra CSRF.
- Fluxo para exclusão da conta e dos dados associados.
- Prazo de retenção documentado para conta, pagamento e registros de segurança.
- Política de privacidade atualizada antes da ativação.
- Login com Google significa autenticação; não autoriza leitura do Gmail.

### Critérios de aceite

- Compra restaurada após limpar dados do navegador e fazer login novamente.
- Compra disponível em outro navegador ou dispositivo após login.
- Login com Google e cadastro com outro e-mail podem ser vinculados por um fluxo
  explícito que exija login ou reautenticação na conta existente; coincidência
  de e-mail, sozinha, não autoriza a vinculação.
- Pagamento não pode ser ativado apenas manipulando parâmetros da URL, nem
  reutilizado em outra conta.
- Webhooks repetidos não duplicam o acesso; reembolso, chargeback ou pagamento
  invalidado atualizam ou revogam o direito conforme a regra comercial.
- Logout e revogação invalidam a sessão no servidor.
- Recuperação de senha e verificação de e-mail funcionam sem intervenção manual.
- Exclusão de conta e dados respeita o prazo de retenção informado.

## Experimento: usos extras e progressão

Na interface, chamar a unidade de **uso** ou **análise extra**. O termo técnico
`crédito` pode continuar apenas no backend.

### Hipótese de oferta

- Duas análises gratuitas para experimentar.
- Pacote de 3 usos por R$ 4,90 como primeira compra de baixo atrito.
- Beta ilimitado por R$ 14,90 como opção de maior valor.
- Manter R$ 4,99 como preço fundador até existir validação real; testar os novos
  valores antes de substituir a oferta atual.
- O ilimitado cobre o motor determinístico atual. Recursos futuros com custo
  variável, como IA remota, podem ter franquia própria.

### Gamificação responsável

- Começar com uma única missão educativa de segurança, concluída uma vez, que
  concede 1 uso extra.
- Mostrar progresso e conquista de forma discreta, sem roleta, aposta, urgência
  artificial ou promessa de retorno financeiro.
- Não conceder usos por ações fáceis de automatizar repetidamente.
- Saldo, concessões e compras devem ser registrados no servidor com razão,
  origem, validade e proteção contra duplicação.

### Critérios para validar

- Definir antes do experimento metas numéricas para conversão, canibalização do
  ilimitado, custo por uso concedido e fraude.
- A compra barata aumenta conversão sem reduzir excessivamente a escolha do
  ilimitado.
- A missão ensina algo útil e aumenta a segunda análise, não apenas cliques.
- Custo por uso concedido e abuso permanecem pequenos.
- Preços e recompensas podem ser alterados por configuração, sem nova versão do
  frontend.

## Depois

- Histórico mais completo: transferências de tokens e transações internas.
- Mais redes, incluindo busca de histórico na BNB Chain.
- Camada opcional de IA para melhorar a explicação, mantendo os fatos
  determinados pelo motor local.
