# Gaps de privacidade priorizados

## P0 — bloqueiam produção

- Identificar o controlador e publicar um canal válido para titulares/encarregado.
- Validar juridicamente bases, retenções e o rascunho de política.
- Verificar contratos/DPA, regiões, subprocessadores e transferências internacionais dos operadores críticos.
- Registrar evidência contratual e de retenção do Railway antes de torná-lo o domínio definitivo; manter logs minimizados e sem query strings.
- Executar o tabletop documentado, preencher responsáveis de plantão e registrar tempos/evidências.

## P1 — antes de aceitar usuários de produção

- Aplicar e testar remotamente a migration e Edge Function de exportação/exclusão já implementadas.
- Ativar a proteção do Supabase Auth contra senhas vazadas no plano Pro; se o ambiente permanecer no plano gratuito, aprovar formalmente controles compensatórios antes de vincular saldo pago a login por senha.
- Definir com jurídico/comercial o fluxo assistido para saldo pago e pagamentos pendentes; a exclusão automática já falha fechada nesses casos para impedir crédito ou reembolso órfão.
- Validar juridicamente a matriz de retenção; confirmar o Cron e configurar/evidenciar retenção de logs nos fornecedores.
- Definir idade mínima/público-alvo e tratamento de eventual conta de menor.
- Publicar e testar o canal após preencher o controlador; o workflow e SLA técnico já estão documentados.

## P2 — evolução controlada

- Validar periodicamente a exportação estruturada autenticada com uma conta de teste.
- Revisar operadores pelo menos quando contrato, região ou finalidade mudar.
- Não habilitar analytics, CAPTCHA ou suporte externo sem atualizar mapa, base, retenção e aviso.
