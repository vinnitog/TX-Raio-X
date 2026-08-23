# Deploy do PWA no Railway

O Railway hospeda somente a allowlist pública do PWA em um container Caddy. Banco,
autenticação, análises protegidas e pagamentos continuam no Supabase; nenhuma chave
Stripe, `service_role` ou secret de webhook pertence ao serviço Railway.

## Primeiro deploy

1. Faça merge de `develop` em `main`.
2. No Railway, crie um projeto com **Deploy from GitHub repo**, selecione o
   repositório `TX-Raio-X` e a branch `main`.
3. Não adicione variáveis de aplicação. O Railway fornece `PORT` automaticamente e
   o Caddy usa essa porta.
4. Aguarde o healthcheck `/health` ficar saudável e gere um domínio temporário em
   **Service > Settings > Networking**.
5. Valide que `/`, `/privacidade.html`, `/termos.html`, `/manifest.webmanifest` e
   `/sw.js` respondem corretamente; caminhos de código, testes, `.lgpd`, `docs` e
   `supabase` devem responder `404`.

## Integrações que dependem da URL final

Depois de escolher o domínio definitivo:

1. adicione a origem HTTPS em **Supabase Auth > URL Configuration** e mantenha
   apenas redirects necessários;
2. atualize `CHECKOUT_RETURN_URL` e `CHECKOUT_ALLOWED_ORIGINS` nos secrets das Edge
   Functions;
3. publique novamente `checkout` e execute login Google, recuperação de senha,
   checkout Stripe de teste, webhook e recuperação de saldo em outro navegador;
4. mantenha GitHub Pages durante a transição e remova a origem antiga somente após
   os fluxos acima passarem.

Nunca configure no Railway `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, Price IDs,
`SUPABASE_SERVICE_ROLE_KEY` ou tokens de CLI. A URL e a chave publicável do Supabase
já são públicas no frontend estático; os segredos permanecem apenas no Supabase.

## Custo e operação

- comece com uma réplica, limite de 0,25 vCPU e 256 MB de RAM; aumente somente após
  observar métricas reais;
- configure alerta e hard limit de Compute no workspace antes de divulgar a URL;
- evite ambientes efêmeros de PR sem necessidade, pois também consomem recursos;
- não ative Serverless no domínio principal se o cold start prejudicar login ou PWA;
- monitore healthcheck, reinícios, CPU, memória, egress e respostas 4xx/5xx;
- logs de acesso mascaram IP, removem headers de IP encaminhados e descartam toda query string, mas a
  retenção, região e subprocessadores do Railway ainda exigem evidência contratual.

## Smoke mínimo

```powershell
curl.exe -I https://SEU-DOMINIO/
curl.exe -i https://SEU-DOMINIO/health
curl.exe -I https://SEU-DOMINIO/supabase/config.toml
curl.exe -I https://SEU-DOMINIO/.lgpd/data-map.md
```

Resultado esperado: home e health `200`; arquivos internos `404`; headers CSP,
HSTS, `nosniff`, anti-frame e política de referência presentes na home.
