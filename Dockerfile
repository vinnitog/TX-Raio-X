FROM caddy:2-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648

WORKDIR /srv

COPY Caddyfile /etc/caddy/Caddyfile
COPY index.html privacidade.html termos.html manifest.webmanifest sw.js ./
COPY css/ ./css/
COPY icons/ ./icons/
COPY js/app.mjs js/auth-config.mjs js/auth-controller.mjs js/auth-service.mjs js/privacy-client.mjs ./js/
COPY js/checkout-client.mjs js/checkout-flow.mjs js/config.mjs ./js/
COPY js/credit-client.mjs js/demo-analysis.mjs js/history-client.mjs js/supabase-client.mjs js/usage.mjs ./js/

ENV XDG_CONFIG_HOME=/tmp/caddy-config
ENV XDG_DATA_HOME=/tmp/caddy-data

USER 65532:65532
