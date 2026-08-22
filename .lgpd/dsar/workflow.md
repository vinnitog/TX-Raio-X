# Direitos do titular — fluxo operacional

Canal público e responsável ainda dependem do preenchimento de `.lgpd/controller-and-contact.md`.

## Acesso e portabilidade

1. O titular autenticado abre **Sua conta → Baixar meus dados**.
2. A Edge Function valida origem, JWT e rate limit antes de consultar dados.
3. O snapshot financeiro e operacional é gerado em uma única consulta transacional; os metadados atuais da conta vêm da sessão validada. O arquivo contém conta, provedores de login, ordens, pagamentos, ledger, recibos idempotentes, limites operacionais e pedidos de privacidade, sem chaves internas de idempotência, `status_detail` ou payload bruto do provedor.
4. A confirmação simplificada e o acesso são imediatos. Pedido complementar pelo canal oficial deve ter resposta em até 15 dias, sujeito à validação jurídica vigente.

## Exclusão

1. O titular entra na área autenticada e escolhe **Excluir minha conta**.
2. A interface exige uma segunda etapa e a digitação exata do e-mail.
3. O backend exige login e token emitidos nos últimos 10 minutos.
4. Uma solicitação mínima de auditoria é criada antes da exclusão definitiva no Supabase Auth.
5. A exclusão automática é bloqueada se houver saldo pago ou checkout não terminal; o canal humano deve resolver reembolso/espera sem apagar valor comprado.
6. Dados operacionais vinculados são apagados por cascade; registros financeiros preservados perdem o vínculo direto com a conta (`user_id = null`).
7. Falhas ficam marcadas sem mensagem privada e devem ser triadas pelo responsável.

Antes de produção, o fluxo deve bloquear ou tratar manualmente conta com saldo pago ou pagamento pendente. A anonimização não pode transformar uma aprovação posterior em cobrança sem crédito ou reembolso; a regra comercial e jurídica ainda está pendente.

Não solicitar documento por e-mail como primeira opção quando a sessão autenticada já confirma a identidade. Não registrar cópia de documento, token, senha ou payload integral no chamado.
