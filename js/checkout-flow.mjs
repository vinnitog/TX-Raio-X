const FINANCIAL_RETURN_PARAMETERS = Object.freeze([
  "checkout_status", "session_id", "source"
]);

export function openCheckoutTab(windowLike) {
  let tab;
  try {
    tab = windowLike.open("about:blank", "_blank");
  } catch {
    return null;
  }
  if (!tab) return null;

  try {
    tab.opener = null;
    if (tab.opener !== null) {
      tab.close();
      return null;
    }
  } catch {
    try {
      tab.close();
    } catch {
      // A aba atual continua sendo o fallback seguro.
    }
    return null;
  }

  return Object.freeze({
    navigate(url) {
      try {
        if (tab.closed) return false;
        tab.location.replace(url);
        return true;
      } catch {
        return false;
      }
    },
    close() {
      try {
        if (!tab.closed) tab.close();
      } catch {
        // Fechar a aba auxiliar é uma melhoria de UX, não requisito do checkout.
      }
    }
  });
}

export function navigateToCheckout(checkoutTab, checkoutUrl, locationLike) {
  try {
    if (checkoutTab?.navigate(checkoutUrl)) return "new_tab";
  } catch {
    // A navegação na aba auxiliar pode ser bloqueada depois que ela foi aberta.
  }
  checkoutTab?.close();
  try {
    locationLike.assign(checkoutUrl);
    return "same_tab";
  } catch {
    return "failed";
  }
}

export async function runCheckoutAttempt({ loading, openTab, startCheckout, openAuth, navigate }) {
  if (!loading.tryStart()) return { status: "busy" };
  const checkoutTab = openTab();
  let checkoutOpened = false;
  let sameTabRedirectStarted = false;
  try {
    const checkout = await startCheckout();
    if (checkout.status === "auth_required") {
      return { status: await openAuth() ? "auth_required" : "auth_unavailable" };
    }
    const destination = navigate(checkoutTab, checkout.checkoutUrl);
    checkoutOpened = destination === "new_tab";
    sameTabRedirectStarted = destination === "same_tab";
    return { status: destination };
  } finally {
    if (!checkoutOpened && !sameTabRedirectStarted) checkoutTab?.close();
    if (!sameTabRedirectStarted) loading.stop();
  }
}

function renderCheckoutLoading(buttons, isLoading) {
  for (const button of buttons) {
    button.disabled = isLoading;
    button.classList.toggle("is-loading", isLoading);
    button.setAttribute("aria-busy", String(isLoading));
    button.querySelector(".button-label").hidden = isLoading;
    button.querySelector(".checkout-loading-label").hidden = !isLoading;
  }
}

export function createCheckoutLoadingController(buttons) {
  let inProgress = false;

  return Object.freeze({
    tryStart() {
      if (inProgress) return false;
      inProgress = true;
      renderCheckoutLoading(buttons, true);
      return true;
    },
    stop() {
      if (!inProgress) return;
      inProgress = false;
      renderCheckoutLoading(buttons, false);
    },
    restoreAfterPageShow() {
      if (inProgress) this.stop();
    }
  });
}

export function createRetryableLoader(load, map = (value) => value) {
  let pending = null;
  return function getLoadedValue() {
    if (!pending) {
      pending = Promise.resolve()
        .then(load)
        .then(map)
        .catch((error) => {
          pending = null;
          throw error;
        });
    }
    return pending;
  };
}

export function sanitizeCheckoutReturn(href) {
  const url = new URL(href);
  const status = url.searchParams.get("checkout_status");
  if (!status) return { status: null, cleanedUrl: null };

  for (const parameter of FINANCIAL_RETURN_PARAMETERS) {
    url.searchParams.delete(parameter);
  }
  return { status, cleanedUrl: url.toString() };
}

export function replaceCheckoutReturn(historyLike, cleanedUrl) {
  try {
    historyLike.replaceState({}, "", cleanedUrl);
    return true;
  } catch {
    return false;
  }
}
