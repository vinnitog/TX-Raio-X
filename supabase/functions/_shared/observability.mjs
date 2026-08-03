const REQUEST_ID_PATTERN = /^[a-zA-Z0-9._:-]{1,100}$/;

export function getRequestId(request, createId = () => crypto.randomUUID()) {
  const received = request.headers.get("x-request-id")?.trim() ?? "";
  return REQUEST_ID_PATTERN.test(received) ? received : createId();
}

export function withRequestId(headers = {}, requestId) {
  return { ...headers, "X-Request-Id": requestId };
}

export function createRequestTelemetry(logger, event, requestId, now = () => Date.now()) {
  const startedAt = now();
  const write = (level, outcome, fields = {}) => {
    const method = typeof logger?.[level] === "function" ? level : "log";
    logger?.[method]?.(event, {
      requestId,
      outcome,
      durationMs: Math.max(0, now() - startedAt),
      ...fields
    });
  };
  return Object.freeze({
    success(fields) { write("info", "success", fields); },
    ignored(fields) { write("info", "ignored", fields); },
    error(fields) { write("error", "error", fields); }
  });
}
