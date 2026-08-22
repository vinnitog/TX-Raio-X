# Direção de design — Tx Raio-X

## Trabalho que a interface faz

O Tx Raio-X transforma uma transação EVM pública em uma explicação curta e acionável, sem conectar carteira. A página inicial precisa construir confiança rapidamente; o analisador e o resultado precisam desaparecer atrás da tarefa.

## Mundo visual preservado

- Fundo azul-marinho, superfícies profundas e bordas discretas.
- Verde-lima reservado a ação principal, saldo e progressão positiva.
- Azul-claro para informação, conta e controles secundários.
- Tipografia sans legível; monoespaçada apenas para hashes, endereços e dados técnicos.
- Cantos moderados e uma única forma de elevação por superfície.

## Hierarquia

1. Colar hash e analisar.
2. Buscar um hash por carteira pública.
3. Entender o resultado e próximo passo.
4. Comprar mais análises quando a franquia/saldo terminar.

A autenticação é requisito operacional para análise real, não a proposta central. Exemplo e leitura da página continuam disponíveis sem conta.

## Qualidade mínima

- WCAG AA, teclado completo, alvos de 44 px e zoom de 200%.
- Estados de carregamento, erro, sucesso, vazio, saldo zero e offline.
- Sem afirmações que contradigam backend, cobrança ou privacidade.
- Sem animação decorativa; movimento apenas para revelar ou confirmar estado.
- Teste em 320 px, breakpoint intermediário e desktop largo.
