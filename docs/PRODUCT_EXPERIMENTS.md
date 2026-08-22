# Experimentos de produto

## Regra de decisão

Ideias são tratadas como hipóteses. Não mudamos preço, pacote, gratuidade nem coleta de dados sem evidência comportamental e guardrails de segurança/privacidade.

## Prioridade atual — clareza da conta

- **Problema**: a interface dizia que a conta era opcional mesmo quando uma análise real exige autenticação.
- **Hipótese**: explicar a conta como proteção da franquia e recuperação de compras reduz surpresa sem prejudicar a primeira análise.
- **Suposição crítica**: usuários entendem que exemplo e leitura são livres, enquanto análises reais exigem conta.
- **Mudança**: corrigir cópia no fluxo e tornar privacidade acessível dentro da conta.
- **Métrica futura**: `auth_opened`, `signup_started`, `signup_verified` e `analysis_started`, sempre sem e-mail, hash, carteira ou payload financeiro.
- **Sucesso**: redução de tentativas bloqueadas por autenticação sem queda material na conclusão da primeira análise verificada.
- **Guardrail**: não adicionar analytics de terceiros antes de mapa de dados, base proposta e configuração de retenção.

## Preço e pacote

Manter 10 análises por R$ 4,90, pagamento único. Ainda não há evidência comportamental suficiente para trocar preço ou exibir múltiplos planos. Depois de 10 compradores reais, comparar uma alternativa em coortes separadas, conforme `docs/MONETIZATION_STRATEGY.md`.

## Backlog validável

| Ideia | Hipótese principal | Menor teste | Risco dominante |
| --- | --- | --- | --- |
| Prévia do resultado antes do login | valor percebido aumenta antes da fricção | exemplo contextual, sem dado real | confundir exemplo com análise real |
| Pacote maior | compradores recorrentes valorizam menor preço unitário | coorte única após recompra observada | diluir tráfego e margem |
| Canal self-service de dados | confiança e atendimento melhoram | confirmação/acesso autenticado | exportar dado de outra conta |
| Verificação mais forte contra abuso | custo da gratuidade cai | somente após abuso mensurado | coleta e abandono desproporcionais |
