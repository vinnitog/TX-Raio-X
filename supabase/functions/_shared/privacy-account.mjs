import { createRequestTelemetry, getRequestId, withRequestId } from "./observability.mjs";

const MAX_BODY_BYTES = 2048;
const RECENT_AUTH_SECONDS = 600;

export class PrivacyAccountHttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function corsHeaders(origin, allowedOrigins) {
  const headers = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-request-id",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  };
  if (origin && allowedOrigins.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function bearerToken(request) {
  const value = request.headers.get("authorization") ?? "";
  return value.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
}

function isRecent(timestamp, nowSeconds) {
  const value = Math.floor(new Date(timestamp).getTime() / 1000);
  return Number.isFinite(value) && value <= nowSeconds + 30 && nowSeconds - value <= RECENT_AUTH_SECONDS;
}

export function createPrivacyAccountHandler({
  loadAllowedOrigins,
  authenticate,
  enforceRateLimit,
  exportAccount,
  checkErasureEligibility,
  beginErasure,
  deleteAccount,
  completeErasure,
  now = () => Date.now(),
  logger = console
}) {
  return async function handle(request) {
    const requestId = getRequestId(request);
    const telemetry = createRequestTelemetry(logger, "privacy_account", requestId, now);
    const origin = request.headers.get("origin") ?? "";
    let headers = corsHeaders(origin, new Set());
    try {
      const allowedOrigins = loadAllowedOrigins();
      headers = corsHeaders(origin, allowedOrigins);
      if (origin && !allowedOrigins.has(origin)) throw new PrivacyAccountHttpError(403, "origin_not_allowed");
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: withRequestId(headers, requestId) });
      if (request.method !== "POST") throw new PrivacyAccountHttpError(405, "method_not_allowed");

      const token = bearerToken(request);
      if (!token) throw new PrivacyAccountHttpError(401, "authentication_required");
      const identity = await authenticate(token);
      if (!identity?.user?.id || !identity.user.email) throw new PrivacyAccountHttpError(401, "invalid_session");
      if (!await enforceRateLimit(identity.user.id)) throw new PrivacyAccountHttpError(429, "rate_limited");

      if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
        throw new PrivacyAccountHttpError(415, "unsupported_media_type");
      }
      const length = Number(request.headers.get("content-length") ?? 0);
      if (length > MAX_BODY_BYTES) throw new PrivacyAccountHttpError(413, "request_too_large");
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) throw new PrivacyAccountHttpError(413, "request_too_large");
      let body;
      try { body = JSON.parse(raw); } catch { throw new PrivacyAccountHttpError(400, "invalid_json"); }

      const keys = Object.keys(body ?? {}).sort();
      if (body?.action === "export" && keys.join(",") === "action") {
        const data = await exportAccount(identity.user.id);
        telemetry.success({ action: "export" });
        return Response.json({
          schemaVersion: 1,
          generatedAt: new Date(now()).toISOString(),
          account: {
            id: identity.user.id,
            email: identity.user.email,
            providers: [...new Set((identity.user.identities ?? [])
              .map((item) => item?.provider)
              .filter((provider) => typeof provider === "string" && provider))],
            createdAt: identity.user.created_at ?? null,
            lastSignInAt: identity.user.last_sign_in_at ?? null
          },
          ...data
        }, { status: 200, headers: withRequestId(headers, requestId) });
      }

      if (body?.action !== "delete" || keys.join(",") !== "action,confirmation") {
        throw new PrivacyAccountHttpError(400, "invalid_request");
      }
      if (typeof body.confirmation !== "string"
        || body.confirmation.trim().toLowerCase() !== identity.user.email.trim().toLowerCase()) {
        throw new PrivacyAccountHttpError(400, "confirmation_mismatch");
      }
      const nowSeconds = Math.floor(now() / 1000);
      if (!isRecent(identity.user.last_sign_in_at, nowSeconds)
        || !Number.isInteger(identity.issuedAt)
        || identity.issuedAt > nowSeconds + 30
        || nowSeconds - identity.issuedAt > RECENT_AUTH_SECONDS) {
        throw new PrivacyAccountHttpError(403, "recent_authentication_required");
      }

      const erasureId = await beginErasure(identity.user.id);
      let eligibility;
      try {
        eligibility = await checkErasureEligibility(identity.user.id);
      } catch (error) {
        await completeErasure(erasureId, "failed").catch(() => {});
        throw error;
      }
      const validEligibility = Number.isSafeInteger(eligibility?.paidBalance)
        && eligibility.paidBalance >= 0
        && typeof eligibility?.hasOpenCheckout === "boolean";
      if (!validEligibility || eligibility.paidBalance > 0 || eligibility.hasOpenCheckout) {
        await completeErasure(erasureId, "failed").catch(() => {});
        throw new PrivacyAccountHttpError(409, "account_has_financial_commitments");
      }
      try {
        await deleteAccount(identity.user.id);
      } catch (error) {
        await completeErasure(erasureId, "failed").catch(() => {});
        throw error;
      }
      // A falha da trilha administrativa não pode transformar uma exclusão
      // irreversível já concluída em uma resposta enganosa de falha.
      await completeErasure(erasureId, "completed").catch(() => {});
      telemetry.success({ action: "delete" });
      return Response.json({ deleted: true }, { status: 200, headers: withRequestId(headers, requestId) });
    } catch (error) {
      const status = error instanceof PrivacyAccountHttpError ? error.status : 500;
      const code = error instanceof PrivacyAccountHttpError ? error.code : "internal_error";
      telemetry.error({ code, status });
      return Response.json({ error: code }, { status, headers: withRequestId(headers, requestId) });
    }
  };
}
