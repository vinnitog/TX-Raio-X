export class PrivacyClientError extends Error {
  constructor(code = "request_failed") {
    super(code);
    this.name = "PrivacyClientError";
    this.code = code;
  }
}

async function errorCode(error) {
  try {
    const payload = await error?.context?.clone?.().json();
    return typeof payload?.error === "string" ? payload.error : "request_failed";
  } catch { return "request_failed"; }
}

export function createPrivacyClient(supabase) {
  async function invoke(body) {
    const { data, error } = await supabase.functions.invoke("privacy-account", { body });
    if (error) throw new PrivacyClientError(await errorCode(error));
    return data;
  }
  return Object.freeze({
    exportAccount: () => invoke({ action: "export" }),
    deleteAccount: (confirmation) => invoke({ action: "delete", confirmation })
  });
}

export function getPrivacyErrorMessage(error) {
  if (error?.code === "recent_authentication_required") {
    return "Por segurança, saia e entre novamente. Depois, repita a exclusão em até 10 minutos.";
  }
  if (error?.code === "confirmation_mismatch") return "Digite exatamente o e-mail da conta.";
  if (error?.code === "account_has_financial_commitments") {
    return "A exclusão automática está bloqueada porque há saldo pago ou pagamento em andamento. Preserve a conta; um fluxo seguro de atendimento será disponibilizado antes da produção.";
  }
  if (error?.code === "rate_limited") return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  if (error instanceof TypeError) return "Não foi possível conectar. Verifique sua internet.";
  return "Não foi possível concluir agora. Tente novamente.";
}
