const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ConsumeAnalysisHttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function getConsumeCorsHeaders(origin, allowedOrigins) {
  const headers = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
  if (origin && allowedOrigins.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

export function validateConsumeRequest(body) {
  return body
    && typeof body === "object"
    && !Array.isArray(body)
    && Object.keys(body).length === 1
    && UUID_V4_PATTERN.test(body.analysisId ?? "");
}

function jsonResponse(body, status, corsHeaders) {
  return Response.json(body, {
    status,
    headers: { ...corsHeaders, "Cache-Control": "no-store" }
  });
}

export function createConsumeAnalysisHandler({
  loadAllowedOrigins,
  authenticate,
  consumeCredit,
  logger = console
}) {
  return async function handleConsumeAnalysis(request) {
    let corsHeaders = {};
    try {
      const origin = request.headers.get("Origin") ?? "";
      const allowedOrigins = loadAllowedOrigins();
      corsHeaders = getConsumeCorsHeaders(origin, allowedOrigins);
      if (origin && !allowedOrigins.has(origin)) {
        throw new ConsumeAnalysisHttpError(403, "origin_not_allowed", "Origin is not allowed.");
      }
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }
      if (request.method !== "POST") {
        throw new ConsumeAnalysisHttpError(405, "method_not_allowed", "Use POST.");
      }

      const authorization = request.headers.get("Authorization") ?? "";
      const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
      if (!token) {
        throw new ConsumeAnalysisHttpError(401, "authentication_required", "Authentication is required.");
      }
      const user = await authenticate(token);
      if (!user?.id) {
        throw new ConsumeAnalysisHttpError(401, "invalid_session", "The authenticated session is invalid.");
      }

      const contentType = request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "application/json") {
        throw new ConsumeAnalysisHttpError(415, "unsupported_media_type", "Use application/json.");
      }
      const declaredLength = Number(request.headers.get("Content-Length"));
      if (Number.isFinite(declaredLength) && declaredLength > 1024) {
        throw new ConsumeAnalysisHttpError(413, "request_too_large", "Request is too large.");
      }
      const rawBody = await request.text();
      if (new TextEncoder().encode(rawBody).byteLength > 1024) {
        throw new ConsumeAnalysisHttpError(413, "request_too_large", "Request is too large.");
      }
      let body;
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = null;
      }
      if (!validateConsumeRequest(body)) {
        throw new ConsumeAnalysisHttpError(400, "invalid_request", "Analysis identifier is invalid.");
      }

      const result = await consumeCredit(user.id, body.analysisId);
      if (!result?.consumed) {
        throw new ConsumeAnalysisHttpError(402, "credits_exhausted", "No analysis credits are available.");
      }
      const balance = Number(result.balance);
      if (!Number.isSafeInteger(balance) || balance < 0) {
        throw new Error("Database returned an invalid credit balance.");
      }
      return jsonResponse({
        consumed: true,
        applied: Boolean(result.applied),
        balance
      }, 200, corsHeaders);
    } catch (error) {
      const status = error instanceof ConsumeAnalysisHttpError ? error.status : 500;
      const code = error instanceof ConsumeAnalysisHttpError ? error.code : "internal_error";
      logger.error("consume_analysis_error", {
        code,
        message: String(error?.message ?? error).slice(0, 200)
      });
      return jsonResponse({ error: code }, status, corsHeaders);
    }
  };
}
