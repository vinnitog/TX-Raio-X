const FINANCIAL_RETURN_PARAMETERS = Object.freeze([
  "checkout_status", "collection_id", "collection_status", "payment_id", "status",
  "external_reference", "merchant_order_id", "preference_id", "payment_type", "site_id"
]);

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
