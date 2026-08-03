import { createRequestTelemetry, getRequestId, withRequestId } from "./observability.mjs";
import { TransactionLookupError } from "./transaction-chain.mjs";

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^0x[0-9a-f]{64}$/;
const NETWORKS = new Set(["auto", "ethereum", "base", "arbitrum", "polygon", "bnb"]);

export class ProtectedAnalysisHttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function validateProtectedAnalysisRequest(body) {
  return body
    && typeof body === "object"
    && !Array.isArray(body)
    && Object.keys(body).length === 3
    && UUID_V4_PATTERN.test(body.analysisId ?? "")
    && HASH_PATTERN.test(body.hash ?? "")
    && NETWORKS.has(body.network);
}

export async function fingerprintProtectedAnalysis(hash, network) {
  const encoded = new TextEncoder().encode(`${network}:${hash}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoded));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function corsHeaders(origin, allowedOrigins) {
  const headers = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
  if (origin && allowedOrigins.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function jsonResponse(body, status, headers, requestId) {
  return Response.json(body, {
    status,
    headers: withRequestId({ ...headers, "Cache-Control": "no-store" }, requestId)
  });
}

function normalizeEntitlement(result) {
  const balance = Number(result?.balance);
  const freeRemaining = Number(result?.free_remaining);
  if (!Number.isSafeInteger(balance) || balance < 0
    || !Number.isSafeInteger(freeRemaining) || freeRemaining < 0) {
    throw new Error("Invalid entitlement response.");
  }
  return { balance, freeRemaining };
}

export function createProtectedAnalysisHandler({
  loadAllowedOrigins,
  authenticate,
  enforceRateLimit,
  loadEntitlement,
  loadReceipt,
  findTransaction,
  analyzeTransaction,
  finalizeAnalysis,
  logger = console,
  now = () => Date.now()
}) {
  return async function handleProtectedAnalysis(request) {
    let headers = {};
    const requestId = getRequestId(request);
    const telemetry = createRequestTelemetry(logger, "protected_analysis_request", requestId, now);
    try {
      const origin = request.headers.get("Origin") ?? "";
      const allowedOrigins = loadAllowedOrigins();
      headers = corsHeaders(origin, allowedOrigins);
      if (origin && !allowedOrigins.has(origin)) {
        throw new ProtectedAnalysisHttpError(403, "origin_not_allowed", "Origin is not allowed.");
      }
      if (request.method === "OPTIONS") {
        telemetry.ignored({ code: "preflight", status: 204 });
        return new Response(null, { status: 204, headers: withRequestId(headers, requestId) });
      }
      if (request.method !== "POST") {
        throw new ProtectedAnalysisHttpError(405, "method_not_allowed", "Use POST.");
      }

      const token = (request.headers.get("Authorization") ?? "")
        .match(/^Bearer\s+(.+)$/i)?.[1];
      if (!token) {
        throw new ProtectedAnalysisHttpError(401, "authentication_required", "Authentication is required.");
      }
      const user = await authenticate(token);
      if (!user?.id) {
        throw new ProtectedAnalysisHttpError(401, "invalid_session", "Session is invalid.");
      }
      if (!await enforceRateLimit(user.id)) {
        throw new ProtectedAnalysisHttpError(429, "rate_limited", "Too many analysis requests.");
      }

      const contentType = request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "application/json") {
        throw new ProtectedAnalysisHttpError(415, "unsupported_media_type", "Use application/json.");
      }
      const declaredLength = Number(request.headers.get("Content-Length"));
      if (Number.isFinite(declaredLength) && declaredLength > 2048) {
        throw new ProtectedAnalysisHttpError(413, "request_too_large", "Request is too large.");
      }
      const rawBody = await request.text();
      if (new TextEncoder().encode(rawBody).byteLength > 2048) {
        throw new ProtectedAnalysisHttpError(413, "request_too_large", "Request is too large.");
      }
      let body;
      try { body = JSON.parse(rawBody); } catch { body = null; }
      if (!validateProtectedAnalysisRequest(body)) {
        throw new ProtectedAnalysisHttpError(400, "invalid_request", "Analysis request is invalid.");
      }

      const fingerprint = await fingerprintProtectedAnalysis(body.hash, body.network);
      const receipt = await loadReceipt(user.id, body.analysisId);
      const receiptFingerprint = typeof receipt?.request_fingerprint === "string"
        ? receipt.request_fingerprint
        : null;
      if (receiptFingerprint && receiptFingerprint !== fingerprint) {
        throw new ProtectedAnalysisHttpError(409, "analysis_conflict", "Analysis identifier is bound.");
      }

      const before = normalizeEntitlement(await loadEntitlement(user.id));
      if (!receiptFingerprint && before.balance + before.freeRemaining < 1) {
        throw new ProtectedAnalysisHttpError(402, "credits_exhausted", "No analysis is available.");
      }

      let transactionData;
      try {
        transactionData = await findTransaction(body.hash, body.network);
      } catch (error) {
        if (error instanceof TransactionLookupError) {
          const status = error.code === "transaction_not_found" ? 404
            : error.code === "unsupported_network" ? 400 : 503;
          throw new ProtectedAnalysisHttpError(status, error.code, "Transaction lookup failed.");
        }
        throw error;
      }
      const analysis = analyzeTransaction(transactionData);
      const finalized = await finalizeAnalysis(user.id, body.analysisId, fingerprint);
      if (finalized?.conflict) {
        throw new ProtectedAnalysisHttpError(409, "analysis_conflict", "Analysis identifier is bound.");
      }
      if (!finalized?.consumed) {
        throw new ProtectedAnalysisHttpError(402, "credits_exhausted", "No analysis is available.");
      }
      const entitlement = normalizeEntitlement(finalized);
      if (!["free", "paid"].includes(finalized.source)) {
        throw new Error("Invalid analysis source.");
      }

      telemetry.success({ status: 200, source: finalized.source, applied: Boolean(finalized.applied) });
      return jsonResponse({
        analysis,
        consumption: { source: finalized.source, applied: Boolean(finalized.applied) },
        entitlement
      }, 200, headers, requestId);
    } catch (error) {
      const status = error instanceof ProtectedAnalysisHttpError ? error.status : 500;
      const code = error instanceof ProtectedAnalysisHttpError ? error.code : "internal_error";
      telemetry.error({ code, status });
      return jsonResponse({ error: code }, status, headers, requestId);
    }
  };
}
