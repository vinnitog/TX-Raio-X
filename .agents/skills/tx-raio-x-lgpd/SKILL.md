---
name: tx-raio-x-lgpd
description: Mapear e revisar privacidade e LGPD no Tx Raio-X, incluindo autenticação Supabase, pagamentos Mercado Pago, dados públicos de blockchain, logs, retenção, direitos do titular, fornecedores e incidentes. Usar antes de qualquer mudança que trate dados de conta, pagamento, fraude, telemetria ou suporte.
---

# LGPD no Tx Raio-X

Esta skill adapta o projeto [goul4rt/lgpd-skills](https://github.com/goul4rt/lgpd-skills) à arquitetura real do Tx Raio-X.

> O resultado é uma avaliação técnica de privacidade, não aconselhamento jurídico. Bases legais, prazos de retenção, controlador, encarregado e texto público exigem validação humana especializada.

## Princípios

- Minimize: não persista hash bruto, carteira, resultado ou IP bruto quando um fingerprint/contador bastar.
- Finalidade antes da coleta: cada dado precisa de finalidade, base proposta, sistema, fornecedor, retenção e responsável.
- Não use consentimento como base genérica para autenticação, compra ou segurança operacional.
- Preserve separação entre dados públicos da blockchain e dados pessoais ligados à conta.
- Nunca publique uma nova política de privacidade como final sem revisão do controlador/jurídico.

## Fluxo

1. Atualize `.lgpd/data-map.md` por inspeção de schemas, Edge Functions, storage, logs e integrações.
2. Atualize `.lgpd/legal-basis.md`, marcando toda base como proposta até validação jurídica.
3. Registre fornecedores, transferências e pendências em `.lgpd/vendors.md` e `.lgpd/gaps.md`.
4. Defina retenção e eliminação compatíveis com as FKs e obrigações aplicáveis.
5. Garanta caminho para confirmação/acesso, correção, eliminação/anonimização e informação sobre compartilhamentos.
6. Mantenha runbook de incidente alinhado ao Art. 48 da LGPD e às normas vigentes da ANPD.
7. Gere política em `.lgpd/policies/*-draft.md` e pare para revisão antes de publicar.

## Invariantes do produto

- Ao excluir a conta, dados operacionais sem obrigação de retenção devem ser eliminados; registros financeiros necessários devem perder o vínculo direto com o usuário e ficar bloqueados para finalidade incompatível.
- O ledger é fonte de verdade de saldo e precisa manter integridade contábil e idempotência.
- Logs não recebem e-mail, token, hash, carteira, payload de pagamento ou segredo.
- A busca por carteira é somente leitura e seu endereço não é salvo pelo Tx Raio-X.
- Novos vendors, CAPTCHA, analytics ou observabilidade entram no mapa antes de produção.

Consulte `references/data-lifecycle.md` para o mapa mínimo esperado.
