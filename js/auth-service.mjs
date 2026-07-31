export function createAuthService(client, redirectTo) {
  return Object.freeze({
    getSession: () => client.auth.getSession(),
    onAuthStateChange: (callback) => client.auth.onAuthStateChange(callback),
    signInWithGoogle: () => client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo }
    }),
    signInWithPassword: (email, password) => client.auth.signInWithPassword({ email, password }),
    signUp: (email, password) => client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectTo }
    }),
    resetPassword: (email) => client.auth.resetPasswordForEmail(email, { redirectTo }),
    updatePassword: (password) => client.auth.updateUser({ password }),
    signOut: () => client.auth.signOut({ scope: "local" })
  });
}

export function getAuthErrorMessage(error) {
  const code = error?.code ?? "";
  const status = Number(error?.status ?? 0);

  if (code === "invalid_credentials") return "E-mail ou senha incorretos.";
  if (code === "email_not_confirmed") return "Confirme seu e-mail antes de entrar.";
  if (code === "weak_password") return "Use uma senha mais forte, com pelo menos 8 caracteres.";
  if (status === 429 || code.includes("rate_limit")) {
    return "Muitas tentativas. Aguarde um pouco e tente novamente.";
  }
  if (code === "email_exists" || code === "user_already_exists") {
    return "Não foi possível criar a conta. Tente entrar ou recuperar a senha.";
  }
  if (error instanceof TypeError) return "Não foi possível conectar. Verifique sua internet.";
  return "Não foi possível concluir agora. Tente novamente.";
}

export function compactEmail(email, maximumLength = 28) {
  if (!email || email.length <= maximumLength) return email ?? "";
  const [localPart, domain = ""] = email.split("@");
  const available = Math.max(4, maximumLength - domain.length - 4);
  return `${localPart.slice(0, available)}…@${domain}`;
}
