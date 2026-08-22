# Ciclo mínimo de dados

| Atividade | Dados principais | Sistema/operador | Destino esperado |
| --- | --- | --- | --- |
| Autenticação | UUID, e-mail, provedor, sessão | Supabase; Google quando escolhido | exclusão da conta, salvo obrigação aplicável |
| Gratuidade e consumo | UUID, deltas, timestamps, fingerprint idempotente | Supabase | ledger íntegro; vínculo conforme regra de eliminação |
| Compra | UUID, ordem, IDs/status/valor/moeda | Supabase e Mercado Pago | retenção mínima necessária; anonimização do vínculo quando cabível |
| Análise | hash público e resultado em trânsito | Edge Function e RPC público | não persistir payload bruto |
| Busca por carteira | endereço público em trânsito | Blockscout | não persistir pelo Tx Raio-X |
| Proteção operacional | contadores, fingerprint pseudonimizado, request ID | Supabase/logs | TTL e limpeza documentados |

Antes da produção, confirmar: identidade e contato do controlador/encarregado; DPAs e regiões dos operadores; base de transferência internacional; prazos jurídicos; canal de direitos; processo de incidente; política revisada.
