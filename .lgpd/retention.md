# Matriz de retenção técnica

Documento operacional; validar prazos legais e fiscais com jurídico/contabilidade antes da produção.

| Categoria | Retenção técnica | Exclusão/anomização | Justificativa |
|---|---|---|---|
| Sessão e perfil Supabase Auth | Até exclusão da conta | Exclusão definitiva via Admin API após reautenticação | Prestação do serviço e segurança |
| Rate limits por conta | Até 2 dias | Job diário `cleanup_expired_operational_data()` | Prevenção de abuso e diagnóstico curto |
| Recibos de análise (`analysis_id` + fingerprint SHA-256) | Vida da conta | Cascade na exclusão da conta | Idempotência e prevenção de reutilização da franquia |
| Pedidos de exclusão concluídos | A definir juridicamente | `user_id` vira `null`; sem e-mail ou payload | Evidência mínima de atendimento |
| Pedidos de exclusão falhos | 90 dias | Job diário | Diagnóstico e nova tentativa |
| Pedido `processing` após usuário já removido | 15 minutos até reconciliação | Job marca `completed` quando `user_id` já está nulo | Corrigir falha transitória da auditoria após exclusão confirmada |
| Ordens, pagamentos e ledger | Prazo fiscal/legal pendente | Na exclusão, `user_id` vira `null`; IDs financeiros permanecem | Obrigações legais, antifraude e reconciliação |
| Logs de Edge Functions/Supabase/Stripe | Configuração e prazo pendentes de evidência do fornecedor | Não registrar token, e-mail, carteira, hash bruto ou payload integral | Segurança e observabilidade mínima |

O job é instalado automaticamente apenas quando a extensão `pg_cron` já estiver habilitada. Antes da produção, confirmar no Supabase Cron a execução diária `tx-raio-x-operational-retention` e guardar evidência da última execução.
