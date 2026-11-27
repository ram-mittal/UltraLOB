import crypto from "node:crypto";
import { extractAuthContext, isStrictProductionRuntime } from "./store.js";

export const VALID_ROLES = Object.freeze([
  "investor",
  "strategy_provider",
  "fund_manager",
  "risk_manager",
  "researcher",
  "admin"
]);

export const ROLE_PERMISSIONS = Object.freeze({
  guest: ["strategies:read", "market:read"],
  investor: [
    "strategies:read",
    "market:read",
    "portfolio:read",
    "portfolio:manage",
    "allocations:manage",
    "broker:manage",
    "copy:manage",
    "ai:evaluate",
    "ai:authorize",
    "mandates:manage",
    "reports:read",
    "execution:read"
  ],
  strategy_provider: [
    "strategies:read",
    "market:read",
    "strategies:create",
    "strategies:version",
    "backtests:run",
    "research:read"
  ],
  fund_manager: [
    "strategies:read",
    "market:read",
    "portfolio:read",
    "portfolio:manage",
    "mandates:manage",
    "allocations:manage",
    "broker:manage",
    "copy:manage",
    "ai:evaluate",
    "ai:authorize",
    "reports:read",
    "org:manage",
    "risk:read",
    "execution:read"
  ],
  risk_manager: [
    "strategies:read",
    "market:read",
    "portfolio:read",
    "risk:read",
    "risk:configure",
    "risk:kill_switch",
    "ai:evaluate",
    "audit:read",
    "execution:read"
  ],
  researcher: [
    "strategies:read",
    "market:read",
    "strategies:create",
    "backtests:run",
    "research:read"
  ],
  admin: ["*"]
});

export function roleHasPermission(role, permission) {
  const perms = ROLE_PERMISSIONS[role] || [];
  return perms.includes("*") || perms.includes(permission);
}

export function apiKeyAllowsScope(auth, requiredReadScope) {
  if (!auth || auth.authMethod !== "api_key") return true;
  if (!requiredReadScope) return false;
  const scopes = Array.isArray(auth.scopes) ? auth.scopes : [];
  return scopes.includes(requiredReadScope) || scopes.includes("*");
}

/**
 * Unified server-side authorization gate for API endpoints.
 * Enforces authentication, read-only x-api-key restrictions, and RBAC permissions.
 */
export function authorizeRequest(auth, permission = null, { isMutation = true, apiKeyScope = null } = {}) {
  if (!auth || !auth.authenticated) {
    return {
      ok: false,
      status: 401,
      code: "AUTH_REQUIRED",
      error: "Authentication required for this operation."
    };
  }

  if (auth.authMethod === "api_key") {
    if (isMutation) {
      return {
        ok: false,
        status: 403,
        code: "API_KEY_READ_ONLY",
        error: "Enterprise x-api-key credentials are strictly read-only and cannot modify state."
      };
    }
    if (apiKeyScope && !apiKeyAllowsScope(auth, apiKeyScope)) {
      return {
        ok: false,
        status: 403,
        code: "API_KEY_SCOPE_INSUFFICIENT",
        error: `Enterprise API key lacks required '${apiKeyScope}' read scope.`
      };
    }
  }

  if (permission) {
    const allowed = Array.isArray(permission)
      ? permission.some((p) => roleHasPermission(auth.role, p))
      : roleHasPermission(auth.role, permission);
    if (!allowed) {
      return {
        ok: false,
        status: 403,
        code: "FORBIDDEN_ROLE",
        error: `Role '${auth.role}' is not authorized to perform this action.`
      };
    }
  }

  return { ok: true };
}

/**
 * Validates record ownership (allows owner or admin; optionally same-org risk_manager/fund_manager when configured).
 */
export function authorizeOwnership(auth, ownerUserId, { allowSameOrgRoles = [], targetOrgId = null } = {}) {
  if (!auth || !auth.authenticated) {
    return { ok: false, status: 401, code: "AUTH_REQUIRED", error: "Authentication required." };
  }
  if (auth.role === "admin") return { ok: true };
  if (ownerUserId && ownerUserId === auth.userId) return { ok: true };
  if (
    allowSameOrgRoles.includes(auth.role) &&
    auth.orgId &&
    targetOrgId &&
    auth.orgId === targetOrgId
  ) {
    return { ok: true };
  }
  return {
    ok: false,
    status: 403,
    code: "FORBIDDEN_OWNERSHIP",
    error: "Access denied: resource belongs to another account."
  };
}

export function requireAuth(req, res, next) {
  const ctx = extractAuthContext(req);
  if (!ctx.authenticated) {
    return res.status(401).json({ error: "Authentication required.", code: "AUTH_REQUIRED" });
  }
  req.auth = ctx;
  next();
}

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const ctx = req.auth || extractAuthContext(req);
    if (!ctx.authenticated) {
      return res.status(401).json({ error: "Authentication required.", code: "AUTH_REQUIRED" });
    }
    if (ctx.role === "admin" || allowedRoles.includes(ctx.role)) {
      req.auth = ctx;
      return next();
    }
    return res.status(403).json({
      error: `Role '${ctx.role}' is not authorized for this action.`,
      code: "FORBIDDEN_ROLE",
      required_roles: allowedRoles
    });
  };
}

/**
 * Lightweight sliding-window in-memory rate limiter for auth & sensitive endpoints.
 */
const buckets = new Map();

export function createRateLimiter({ windowMs = 60_000, max = 60, keyPrefix = "global" } = {}) {
  return function rateLimiter(req, res, next) {
    const ip =
      req.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      "local";
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || now - bucket.windowStart >= windowMs) {
      buckets.set(key, { windowStart: now, count: 1 });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > max) {
      return res.status(429).json({
        error: "Too many requests. Please slow down and try again shortly.",
        code: "RATE_LIMITED"
      });
    }
    next();
  };
}

export function clearRateLimitBuckets() {
  buckets.clear();
}

export function parseCookies(cookieHeader = "") {
  const out = {};
  if (!cookieHeader || typeof cookieHeader !== "string") return out;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const rawVal = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(rawVal);
    } catch {
      out[key] = rawVal;
    }
  }
  return out;
}

export function isSecureRequest(request) {
  const proto = String(request?.headers?.["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  if (proto === "https" || request?.secure === true) return true;
  if (isStrictProductionRuntime()) return true;
  return false;
}

export function serializeCookie(name, value, {
  httpOnly = false,
  secure = false,
  sameSite = "Lax",
  path = "/",
  maxAge = undefined,
  expires = undefined
} = {}) {
  const parts = [`${name}=${encodeURIComponent(value ?? "")}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (maxAge !== undefined) parts.push(`Max-Age=${Math.floor(Number(maxAge))}`);
  if (expires instanceof Date) parts.push(`Expires=${expires.toUTCString()}`);
  if (httpOnly) parts.push("HttpOnly");
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function normalizeHostValue(val) {
  if (!val) return "";
  const first = String(val).split(",")[0].trim();
  try {
    return new URL(first.includes("://") ? first : `https://${first}`).host.toLowerCase();
  } catch {
    return "";
  }
}

export function verifyCsrfProtection(request, { requireCookieMatch = false } = {}) {
  const method = String(request?.method || "GET").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return { ok: true };

  // 1. Validate Origin / Referer when supplied by a browser
  const allowedHosts = new Set([
    normalizeHostValue(request?.headers?.["x-forwarded-host"]),
    normalizeHostValue(request?.headers?.host),
    normalizeHostValue(process.env.RENDER_EXTERNAL_HOSTNAME)
  ].filter(Boolean));

  const origin = request?.headers?.origin;
  if (origin) {
    const origHost = normalizeHostValue(origin);
    if (!origHost || (allowedHosts.size > 0 && !allowedHosts.has(origHost))) {
      return {
        ok: false,
        status: 403,
        code: "CSRF_ORIGIN_MISMATCH",
        error: "Cross-origin state-changing request blocked."
      };
    }
  } else if (request?.headers?.referer) {
    const refHost = normalizeHostValue(request.headers.referer);
    if (!refHost || (allowedHosts.size > 0 && !allowedHosts.has(refHost))) {
      return {
        ok: false,
        status: 403,
        code: "CSRF_ORIGIN_MISMATCH",
        error: "Cross-origin referer blocked."
      };
    }
  }

  // 2. Enforce Double-Submit X-CSRF-Token when session cookies or browser client marker are present
  const cookies = parseCookies(request?.headers?.cookie || "");
  const isBrowserMarker = String(request?.headers?.["x-ultralob-client"] || "").toLowerCase() === "browser";
  const hasCsrfCookie = Boolean(cookies.ultralob_csrf);
  const needsDoubleSubmit = requireCookieMatch || hasCsrfCookie || (isBrowserMarker && Boolean(cookies.ultralob_rt));

  if (needsDoubleSubmit) {
    const headerToken = String(request?.headers?.["x-csrf-token"] || "").trim();
    const cookieToken = String(cookies.ultralob_csrf || "").trim();
    if (!headerToken || !cookieToken) {
      return {
        ok: false,
        status: 403,
        code: "CSRF_TOKEN_INVALID",
        error: "Missing CSRF protection token."
      };
    }
    const a = Buffer.from(headerToken, "utf8");
    const b = Buffer.from(cookieToken, "utf8");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return {
        ok: false,
        status: 403,
        code: "CSRF_TOKEN_INVALID",
        error: "Invalid CSRF protection token."
      };
    }
  }

  return { ok: true };
}
