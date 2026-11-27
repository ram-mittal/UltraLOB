import { extractAuthContext } from "./store.js";

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
  investor: ["strategies:read", "market:read", "portfolio:manage", "broker:manage", "copy:manage", "reports:read"],
  strategy_provider: ["strategies:read", "market:read", "strategies:create", "strategies:version", "backtests:run"],
  fund_manager: ["strategies:read", "market:read", "portfolio:manage", "mandates:manage", "allocations:manage", "reports:read", "org:manage"],
  risk_manager: ["strategies:read", "market:read", "risk:read", "risk:configure", "risk:kill_switch", "audit:read", "execution:read"],
  researcher: ["strategies:read", "market:read", "strategies:create", "backtests:run", "research:read"],
  admin: ["*"]
});

export function roleHasPermission(role, permission) {
  const perms = ROLE_PERMISSIONS[role] || [];
  return perms.includes("*") || perms.includes(permission);
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
