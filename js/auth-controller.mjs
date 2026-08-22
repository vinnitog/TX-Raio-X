import { getAuthRedirectUrl } from "./auth-config.mjs";
import { compactEmail, createAuthService, getAuthErrorMessage } from "./auth-service.mjs";
import { createPrivacyClient, getPrivacyErrorMessage } from "./privacy-client.mjs";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MINIMUM_PASSWORD_LENGTH = 8;

function getElements() {
  return {
    trigger: document.querySelector("#account-button"),
    triggerLabel: document.querySelector("#account-button-label"),
    dialog: document.querySelector("#auth-dialog"),
    close: document.querySelector("#auth-close"),
    guestView: document.querySelector("#auth-guest-view"),
    accountView: document.querySelector("#auth-account-view"),
    deleteView: document.querySelector("#auth-delete-view"),
    recoveryView: document.querySelector("#auth-recovery-view"),
    googleButton: document.querySelector("#auth-google-button"),
    form: document.querySelector("#auth-form"),
    title: document.querySelector("#auth-title"),
    subtitle: document.querySelector("#auth-subtitle"),
    email: document.querySelector("#auth-email"),
    password: document.querySelector("#auth-password"),
    submit: document.querySelector("#auth-submit"),
    submitLabel: document.querySelector("#auth-submit-label"),
    switchMode: document.querySelector("#auth-switch-mode"),
    forgotPassword: document.querySelector("#auth-forgot-password"),
    feedback: document.querySelector("#auth-feedback"),
    accountEmail: document.querySelector("#auth-account-email"),
    logout: document.querySelector("#auth-logout"),
    privacyFeedback: document.querySelector("#privacy-feedback"),
    privacyExport: document.querySelector("#privacy-export"),
    privacyDeleteStart: document.querySelector("#privacy-delete-start"),
    privacyDeleteForm: document.querySelector("#privacy-delete-form"),
    privacyDeleteConfirmation: document.querySelector("#privacy-delete-confirmation"),
    privacyDeleteFeedback: document.querySelector("#privacy-delete-feedback"),
    privacyDeleteConfirm: document.querySelector("#privacy-delete-confirm"),
    privacyDeleteCancel: document.querySelector("#privacy-delete-cancel"),
    recoveryForm: document.querySelector("#recovery-form"),
    recoveryPassword: document.querySelector("#recovery-password"),
    recoveryConfirmation: document.querySelector("#recovery-password-confirmation"),
    recoverySubmit: document.querySelector("#recovery-submit"),
    recoveryFeedback: document.querySelector("#recovery-feedback")
  };
}

function focusableElements(dialog) {
  return [...dialog.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), [href]:not([aria-disabled="true"])'
  )].filter((element) => !element.closest("[hidden]"));
}

async function loadAuthService() {
  const { supabase } = await import("./supabase-client.mjs");
  return createAuthService(supabase, getAuthRedirectUrl());
}

async function loadPrivacyService() {
  const { supabase } = await import("./supabase-client.mjs");
  return createPrivacyClient(supabase);
}

function downloadJson(data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "tx-raio-x-meus-dados.json";
  link.click();
  URL.revokeObjectURL(url);
}

export async function initAuthController({
  elements = getElements(),
  loadAuth = loadAuthService,
  loadPrivacy = loadPrivacyService,
  saveExport = downloadJson,
  scheduleFrame = requestAnimationFrame,
  onSessionChange = () => {}
} = {}) {
  if (!elements.trigger || !elements.dialog) return;

  let auth;
  let privacy;
  let mode = "sign-in";
  let currentSession = null;
  let busy = false;
  let recoveryMode = false;

  function setFeedback(message = "", isError = false, target = elements.feedback) {
    target.textContent = message;
    target.classList.toggle("is-error", isError);
  }

  function setBusy(isBusy, activeControl = null) {
    busy = isBusy;
    for (const control of elements.dialog.querySelectorAll("button, input")) {
      control.disabled = isBusy;
    }
    elements.dialog.setAttribute("aria-busy", String(isBusy));
    for (const control of [elements.googleButton, elements.submit, elements.logout, elements.recoverySubmit, elements.privacyExport, elements.privacyDeleteConfirm]) {
      control.classList.remove("is-loading");
    }
    activeControl?.classList.toggle("is-loading", isBusy);
  }

  async function runAuthRequest(request, activeControl) {
    setBusy(true, activeControl);
    try {
      return await request();
    } catch (error) {
      return { data: null, error };
    } finally {
      setBusy(false);
    }
  }

  function renderMode() {
    const isSignUp = mode === "sign-up";
    elements.title.textContent = isSignUp ? "Crie sua conta" : "Entre na sua conta";
    elements.subtitle.textContent = isSignUp
      ? "Proteja suas análises grátis e recupere compras em outro aparelho."
      : "Proteja sua franquia e recupere compras sem conectar nenhuma carteira.";
    elements.submitLabel.textContent = isSignUp ? "Criar conta" : "Entrar com e-mail";
    elements.switchMode.textContent = isSignUp
      ? "Já tem conta? Entrar"
      : "Ainda não tem conta? Criar conta";
    elements.forgotPassword.hidden = isSignUp;
    elements.password.autocomplete = isSignUp ? "new-password" : "current-password";
    setFeedback();
  }

  function renderSession(session) {
    currentSession = session;
    const email = session?.user?.email ?? "";
    const signedIn = Boolean(session?.user);
    elements.guestView.hidden = signedIn;
    elements.accountView.hidden = !signedIn;
    elements.deleteView.hidden = true;
    elements.recoveryView.hidden = true;
    elements.trigger.classList.toggle("is-authenticated", signedIn);
    elements.triggerLabel.textContent = signedIn ? compactEmail(email) : "Entrar";
    elements.trigger.setAttribute(
      "aria-label",
      signedIn ? `Conta conectada: ${email}` : "Entrar ou criar conta"
    );
    elements.accountEmail.textContent = email;
    Promise.resolve(onSessionChange(session)).catch(() => {});
  }

  function openDialog(view = "default") {
    if (view === "recovery") {
      elements.guestView.hidden = true;
      elements.accountView.hidden = true;
      elements.recoveryView.hidden = false;
      setFeedback("", false, elements.recoveryFeedback);
    } else if (view === "delete") {
      elements.guestView.hidden = true;
      elements.accountView.hidden = true;
      elements.recoveryView.hidden = true;
      elements.deleteView.hidden = false;
      elements.privacyDeleteForm.reset();
      setFeedback("", false, elements.privacyDeleteFeedback);
    } else {
      renderSession(currentSession);
      renderMode();
    }
    if (!elements.dialog.open) elements.dialog.showModal();
    scheduleFrame(() => {
      const target = view === "recovery" ? elements.recoveryPassword
        : view === "delete" ? elements.privacyDeleteConfirmation
          : currentSession?.user ? elements.privacyExport : elements.googleButton;
      target.focus();
    });
  }

  function validateCredentials() {
    const email = elements.email.value.trim();
    const password = elements.password.value;
    if (!EMAIL_PATTERN.test(email)) {
      setFeedback("Informe um e-mail válido.", true);
      elements.email.focus();
      return null;
    }
    if (password.length < MINIMUM_PASSWORD_LENGTH) {
      setFeedback("A senha precisa ter pelo menos 8 caracteres.", true);
      elements.password.focus();
      return null;
    }
    return { email, password };
  }

  elements.trigger.addEventListener("click", () => openDialog(recoveryMode ? "recovery" : "default"));
  elements.close.addEventListener("click", () => elements.dialog.close());
  elements.dialog.addEventListener("click", (event) => {
    if (event.target === elements.dialog && !busy) elements.dialog.close();
  });
  elements.dialog.addEventListener("cancel", (event) => {
    if (busy) event.preventDefault();
  });
  elements.dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusable = focusableElements(elements.dialog);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  elements.switchMode.addEventListener("click", () => {
    mode = mode === "sign-in" ? "sign-up" : "sign-in";
    renderMode();
    elements.email.focus();
  });

  elements.googleButton.addEventListener("click", async () => {
    setFeedback();
    const { error } = await runAuthRequest(
      () => auth.signInWithGoogle(),
      elements.googleButton
    );
    if (error) {
      setFeedback(getAuthErrorMessage(error), true);
    }
  });

  elements.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const credentials = validateCredentials();
    if (!credentials) return;
    setFeedback();
    const response = await runAuthRequest(
      () => mode === "sign-up"
        ? auth.signUp(credentials.email, credentials.password)
        : auth.signInWithPassword(credentials.email, credentials.password),
      elements.submit
    );
    if (response.error) {
      setFeedback(getAuthErrorMessage(response.error), true);
      return;
    }
    elements.password.value = "";
    if (mode === "sign-up" && !response.data.session) {
      setFeedback("Confira seu e-mail para confirmar a conta. Se ela já existir, tente entrar.");
      return;
    }
    elements.dialog.close();
  });

  elements.forgotPassword.addEventListener("click", async () => {
    const email = elements.email.value.trim();
    if (!EMAIL_PATTERN.test(email)) {
      setFeedback("Digite seu e-mail acima para receber as instruções.", true);
      elements.email.focus();
      return;
    }
    const { error } = await runAuthRequest(
      () => auth.resetPassword(email),
      elements.forgotPassword
    );
    setFeedback(
      error
        ? getAuthErrorMessage(error)
        : "Se houver uma conta para este e-mail, enviaremos as instruções de recuperação.",
      Boolean(error)
    );
  });

  elements.logout.addEventListener("click", async () => {
    const { error } = await runAuthRequest(
      () => auth.signOut(),
      elements.logout
    );
    if (error) {
      setFeedback(getAuthErrorMessage(error), true);
      return;
    }
    elements.dialog.close();
  });

  elements.privacyExport.addEventListener("click", async () => {
    setFeedback("", false, elements.privacyFeedback);
    const response = await runAuthRequest(() => privacy.exportAccount(), elements.privacyExport);
    if (response?.error) {
      setFeedback(getPrivacyErrorMessage(response.error), true, elements.privacyFeedback);
      return;
    }
    saveExport(response);
    setFeedback("Arquivo preparado com os dados vinculados à sua conta.", false, elements.privacyFeedback);
  });

  elements.privacyDeleteStart.addEventListener("click", () => openDialog("delete"));
  elements.privacyDeleteCancel.addEventListener("click", () => openDialog("default"));
  elements.privacyDeleteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const confirmation = elements.privacyDeleteConfirmation.value.trim();
    if (confirmation.toLowerCase() !== (currentSession?.user?.email ?? "").toLowerCase()) {
      setFeedback("Digite exatamente o e-mail da conta.", true, elements.privacyDeleteFeedback);
      elements.privacyDeleteConfirmation.focus();
      return;
    }
    const response = await runAuthRequest(
      () => privacy.deleteAccount(confirmation),
      elements.privacyDeleteConfirm
    );
    if (response?.error) {
      setFeedback(getPrivacyErrorMessage(response.error), true, elements.privacyDeleteFeedback);
      return;
    }
    await auth.signOut().catch(() => {});
    renderSession(null);
    elements.dialog.close();
  });

  elements.recoveryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = elements.recoveryPassword.value;
    if (password.length < MINIMUM_PASSWORD_LENGTH) {
      setFeedback("A nova senha precisa ter pelo menos 8 caracteres.", true, elements.recoveryFeedback);
      elements.recoveryPassword.focus();
      return;
    }
    if (password !== elements.recoveryConfirmation.value) {
      setFeedback("As senhas não coincidem.", true, elements.recoveryFeedback);
      elements.recoveryConfirmation.focus();
      return;
    }
    const { error } = await runAuthRequest(
      () => auth.updatePassword(password),
      elements.recoverySubmit
    );
    if (error) {
      setFeedback(getAuthErrorMessage(error), true, elements.recoveryFeedback);
      return;
    }
    recoveryMode = false;
    elements.recoveryForm.reset();
    elements.dialog.close();
  });

  try {
    auth = await loadAuth();
    privacy = await loadPrivacy();
    auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") recoveryMode = true;
      renderSession(session);
      if (event === "PASSWORD_RECOVERY") openDialog("recovery");
    });
    const { data } = await auth.getSession();
    if (!recoveryMode) renderSession(data.session);
    elements.trigger.disabled = false;
    return Object.freeze({
      available: true,
      open() {
        openDialog(recoveryMode ? "recovery" : "default");
        return true;
      }
    });
  } catch {
    elements.trigger.disabled = true;
    elements.triggerLabel.textContent = "Conta indisponível";
    elements.trigger.setAttribute("aria-label", "Conta indisponível sem conexão");
    return Object.freeze({ available: false, open: () => false });
  }
}
