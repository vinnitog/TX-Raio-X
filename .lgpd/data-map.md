# Mapa de dados — Tx Raio-X

**Versão**: 0.1 (inventário técnico)
**Data**: 22 de agosto de 2026

| Atividade | Finalidade | Dados | Origem/sistema | Compartilhamento | Retenção observada ou pendente |
| --- | --- | --- | --- | --- | --- |
| Autenticação | criar e recuperar conta | UUID, e-mail, provedor, metadados e sessão | titular; Supabase Auth; Google quando escolhido | Supabase e Google | até exclusão/encerramento; política de sessão do Supabase |
| Franquia e saldo | conceder e consumir análises | UUID, deltas, tipo, timestamps, idempotência | Supabase/Postgres | Supabase | ledger sem prazo técnico automático; revisar necessidade |
| Checkout e pagamento | criar pedido, confirmar, reverter e conciliar | UUID, IDs do pedido/pagamento, status, valor, moeda, timestamps | app, Mercado Pago e webhook | Supabase e Mercado Pago | vínculo do usuário fica nulo na exclusão; período financeiro exato pendente |
| Análise por hash | produzir explicação | hash público, rede, resposta RPC e resultado | titular e RPCs públicos, via Edge Function | provedores RPC públicos | hash/resultado bruto não persistidos; fingerprint idempotente protegido |
| Busca por carteira | localizar transações recentes | endereço público, rede e hashes retornados | titular e Blockscout | instâncias Blockscout | não persistido pelo Tx Raio-X |
| Proteção operacional | limitar abuso e investigar falhas | UUID, fingerprint pseudonimizado, janela, contadores, request ID | Edge Functions/Postgres/logs | Supabase | rate limits com limpeza prevista; retenção de logs do provedor pendente |

Não foram identificados dados sensíveis como requisito do produto. Crianças/adolescentes não são público-alvo declarado; é necessário decidir idade mínima antes da produção.
