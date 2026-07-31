# Roadmap — Tx Raio-X

## Progresso da infraestrutura de pagamento

- [x] Projeto de desenvolvimento criado no Supabase.
- [x] Cliente OAuth do Google criado para localhost, GitHub Pages e callback do Supabase.
- [x] Integrar no app o login com Google, e-mail/senha, sessão, logout e recuperação de senha.
- [ ] Concluir o teste manual ponta a ponta com Google, confirmação/recuperação por e-mail, recarga da sessão e logout.
- [x] Criar e revisar localmente a migration de ordens, pagamentos e ledger.
- [x] Autenticar/vincular o Supabase CLI e aplicar a migration no projeto de desenvolvimento.
- [x] Criar a Edge Function de checkout bloqueada em modo de teste.
- [x] Configurar a credencial de teste e publicar a Edge Function no projeto de desenvolvimento.
- [x] Integrar o redirecionamento autenticado do PWA ao Checkout Pro de teste.
- [ ] Executar e conferir a primeira ordem/preferência real no fluxo autenticado.
- [ ] Implementar e validar o webhook idempotente do Mercado Pago.
- [ ] Mover consumo pago para uma Edge Function transacional.
- [ ] Validar pagamento, webhook repetido, reembolso integral e troca de aparelho.
- [ ] Confirmar taxas e margem antes de habilitar credenciais de produção.

## Agora: validar o produto

- Duas análises gratuitas por navegador.
- Pacote cumulativo de 10 análises por R$ 4,90, sem assinatura.
- Busca pública por hash ou endereço EVM.
- Conta opcional; sem custódia ou conexão de carteira.
- Medir o funil definido em `docs/MONETIZATION_STRATEGY.md`.

## Próxima etapa: conta recuperável e acesso durável

### Problema

O saldo atual é salvo no `localStorage`. Usuários de cripto costumam limpar
histórico, cookies e dados do navegador com frequência. Perder o acesso pago ao
trocar de navegador, aparelho ou limpar dados reduz confiança e conversão.

### Experiência desejada

- Manter as duas análises gratuitas sem exigir cadastro.
- Pedir uma conta somente quando o usuário decidir comprar um pacote.
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

## Experimento posterior: progressão

Na interface, chamar a unidade de **uso** ou **análise extra**. O termo técnico
`crédito` pode continuar apenas no backend.

### Oferta atual

- Duas análises gratuitas para experimentar.
- Pacote único de 10 usos por R$ 4,90 como primeira compra de baixo atrito.
- Não vender ilimitado enquanto recursos futuros puderem gerar custo variável.
- Depois de 10 compradores, testar 25 usos por R$ 9,90 em coortes separadas,
  sem adicionar vários planos à página inicial.

### Gamificação responsável

- Começar com uma única missão educativa de segurança, concluída uma vez, que
  concede 1 uso extra.
- Mostrar progresso e conquista de forma discreta, sem roleta, aposta, urgência
  artificial ou promessa de retorno financeiro.
- Não conceder usos por ações fáceis de automatizar repetidamente.
- Saldo, concessões e compras devem ser registrados no servidor com razão,
  origem, validade e proteção contra duplicação.

### Critérios para validar

- Definir antes do experimento metas numéricas para conversão, recompra, custo
  por uso concedido e fraude.
- A compra barata converte sem tornar negativa a margem do pacote.
- A missão ensina algo útil e aumenta a segunda análise, não apenas cliques.
- Custo por uso concedido e abuso permanecem pequenos.
- Preços e recompensas podem ser alterados por configuração, sem nova versão do
  frontend.

## Depois

- Histórico mais completo: transferências de tokens e transações internas.
- Mais redes, incluindo busca de histórico na BNB Chain.
- Camada opcional de IA para melhorar a explicação, mantendo os fatos
  determinados pelo motor local.
