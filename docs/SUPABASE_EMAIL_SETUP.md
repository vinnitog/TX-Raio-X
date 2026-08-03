# E-mails de autenticação do Supabase

Os templates versionados ficam em:

- `supabase/templates/confirmation.html`;
- `supabase/templates/recovery.html`.

O `supabase/config.toml` aplica os arquivos ao ambiente local. Depois de alterar um
template, reinicie o Supabase local e valide a mensagem no Inbucket em
`http://127.0.0.1:54324`.

No projeto hospedado, o Supabase não publica esses arquivos pelo `db push`. Copie o
assunto e o HTML para **Authentication > Email Templates** no Dashboard:

- Confirm signup: `Confirme sua conta no Tx Raio-X`;
- Reset password: `Redefina sua senha do Tx Raio-X`.

Confirme também em **Authentication > URL Configuration**:

- Site URL: `https://vinnitog.github.io/TX-Raio-X/`;
- Redirect URL permitida: `https://vinnitog.github.io/TX-Raio-X/**`.

Mantenha o rastreamento de links desativado no provedor SMTP, porque a reescrita do
`{{ .ConfirmationURL }}` pode invalidar o fluxo. Antes da produção, configure SMTP
próprio, nome do remetente e DKIM/SPF; o servidor de e-mail padrão é adequado apenas
para testes limitados.
