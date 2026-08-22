# Operadores e integrações — inventário inicial

| Serviço | Função | Dados potenciais | Risco inicial | Pendência antes da produção |
| --- | --- | --- | --- | --- |
| Supabase | autenticação, banco, Edge Functions e logs | conta, billing, ledger, controles operacionais | crítico | região, DPA, subprocessadores, retenção e transferência |
| Mercado Pago | checkout, pagamento e webhook | dados de pagamento e identificadores do pedido | crítico | contrato, retenção, incidentes, subprocessadores e taxas reais |
| Google | login OAuth opcional | e-mail, identificador e perfil básico | alto | configuração OAuth, termos/DPA aplicáveis e transferência |
| GitHub Pages | hospedagem estática | logs técnicos/IP conforme plataforma | médio | retenção, subprocessadores e transferência |
| Blockscout/RPCs públicos | consulta de blockchain | hash/rede; endereço público em busca | médio | endpoints finais, políticas e logs de cada operador |
| Cloudflare Turnstile | proteção de cadastro, se ativado | sinais de dispositivo/rede conforme fornecedor | alto | só ativar após mapear configuração, aviso, DPA e domínio definitivo |

Tier e papel jurídico são avaliações iniciais, não conclusões contratuais.
