import crypto from "node:crypto";
import {
  ensureDbReady,
  getMemoryStore,
  hashPassword,
  verifyPassword,
  hashRefreshToken,
  signToken,
  verifyToken,
  query
} from "./store.js";
import {
  VALID_ROLES,
  ROLE_PERMISSIONS,
  createRateLimiter,
  isSecureRequest,
  parseCookies,
  serializeCookie,
  verifyCsrfProtection
} from "./security.js";
import { recordAuditLog } from "../db/client.js";

const ACCESS_TOKEN_TTL_SECONDS = 300; // 5-minute short-lived access credentials
const REFRESH_TTL_SECONDS = 14 * 86400;
const REFRESH_COOKIE_NAME = "ultralob_rt";
const CSRF_COOKIE_NAME = "ultralob_csrf";

const authRateLimiter = createRateLimiter({ windowMs: 60_000, max: 40, keyPrefix: "auth" });

function createCsrfTokenValue() {
  return crypto.randomBytes(24).toString("base64url");
}

function attachSessionCookies(request, response, refreshToken, existingCsrf = null) {
  const secure = isSecureRequest(request);
  const csrfToken = existingCsrf || createCsrfTokenValue();
  response.setHeader("Set-Cookie", [
    serializeCookie(REFRESH_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      secure,
      sameSite: "Lax",
      path: "/api/auth",
      maxAge: REFRESH_TTL_SECONDS
    }),
    serializeCookie(CSRF_COOKIE_NAME, csrfToken, {
      httpOnly: false,
      secure,
      sameSite: "Lax",
      path: "/",
      maxAge: REFRESH_TTL_SECONDS
    })
  ]);
  return csrfToken;
}

function clearSessionCookies(request, response) {
  const secure = isSecureRequest(request);
  const expired = new Date(0);
  response.setHeader("Set-Cookie", [
    serializeCookie(REFRESH_COOKIE_NAME, "", {
      httpOnly: true,
      secure,
      sameSite: "Lax",
      path: "/api/auth",
      maxAge: 0,
      expires: expired
    }),
    serializeCookie(CSRF_COOKIE_NAME, "", {
      httpOnly: false,
      secure,
      sameSite: "Lax",
      path: "/",
      maxAge: 0,
      expires: expired
    })
  ]);
}

function sanitizeUser(user) {
  const role = user.role || "investor";
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role,
    permissions: ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.investor,
    org_id: user.org_id || null,
    org_name: user.org_name || null,
    createdAt: user.created_at || user.createdAt
  };
}

function createRefreshTokenValue() {
  return "ulr_" + crypto.randomBytes(36).toString("base64url");
}

function getClientIp(request) {
  return (
    request.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
    request.socket?.remoteAddress ||
    null
  );
}

async function issueSessionTokens(user, dbAvailable) {
  const payload = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role || "investor",
    orgId: user.org_id || null
  };
  const accessToken = signToken(payload, ACCESS_TOKEN_TTL_SECONDS); // 5-minute short-lived access token
  const refreshToken = createRefreshTokenValue();
  const refreshHash = hashRefreshToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);

  if (dbAvailable) {
    await query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [user.id, refreshHash, expiresAt.toISOString()]
    );
  } else {
    getMemoryStore().refreshTokens.set(refreshHash, {
      userId: user.id,
      expiresAt: expiresAt.getTime(),
      revokedAt: null
    });
  }

  return { token: accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

function buildAuthResponsePayload(request, response, user, tokens) {
  const cookies = parseCookies(request.headers?.cookie || "");
  const csrfToken = attachSessionCookies(request, response, tokens.refreshToken, cookies[CSRF_COOKIE_NAME] || null);
  const isBrowserClient = String(request.headers?.["x-ultralob-client"] || "").toLowerCase() === "browser";
  const body = {
    user: sanitizeUser(user),
    token: tokens.token,
    expiresIn: tokens.expiresIn,
    csrfToken
  };
  // Browser clients hold the refresh token exclusively in the HttpOnly cookie
  if (!isBrowserClient) {
    body.refreshToken = tokens.refreshToken;
  }
  return body;
}

export default async function authHandler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  const subPath = (request.path || request.url || "").replace(/^\/api\/auth/, "").split("?")[0];

  // Apply sliding-window rate limit on auth requests
  let rateLimited = false;
  authRateLimiter(request, {
    status: (code) => ({
      json: (body) => {
        rateLimited = true;
        return response.status(code).json(body);
      }
    })
  }, () => {});
  if (rateLimited) return;

  const dbAvailable = await ensureDbReady().catch(() => false);
  const cookies = parseCookies(request.headers?.cookie || "");

  // GET /api/auth/csrf — Bootstrap double-submit CSRF cookie & report whether HttpOnly refresh cookie exists
  if (request.method === "GET" && subPath === "/csrf") {
    const existingCsrf = cookies[CSRF_COOKIE_NAME];
    const csrfToken = existingCsrf || createCsrfTokenValue();
    if (!existingCsrf) {
      response.setHeader("Set-Cookie", serializeCookie(CSRF_COOKIE_NAME, csrfToken, {
        httpOnly: false,
        secure: isSecureRequest(request),
        sameSite: "Lax",
        path: "/",
        maxAge: REFRESH_TTL_SECONDS
      }));
    }
    return response.status(200).json({
      csrfToken,
      hasSession: Boolean(cookies[REFRESH_COOKIE_NAME])
    });
  }

  // POST /api/auth/register
  if (request.method === "POST" && subPath === "/register") {
    const { name, email, password, role = "investor", organization_name } = request.body || {};
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanName = String(name || "").trim();
    const rawPassword = String(password || "");
    const cleanRole = VALID_ROLES.includes(role) && role !== "admin" ? role : "investor";

    if (!cleanName || cleanName.length < 2) {
      return response.status(400).json({ error: "Name must be at least 2 characters." });
    }
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return response.status(400).json({ error: "Enter a valid email address." });
    }
    if (rawPassword.length < 6) {
      return response.status(400).json({ error: "Password must be at least 6 characters." });
    }

    const passwordHash = hashPassword(rawPassword);

    if (dbAvailable) {
      const existing = await query("SELECT id FROM users WHERE email = $1", [cleanEmail]);
      if (existing.rows.length > 0) {
        return response.status(409).json({ error: "An account with this email already exists." });
      }

      let orgId = null;
      let orgName = null;
      if (organization_name && String(organization_name).trim().length >= 2) {
        orgName = String(organization_name).trim().slice(0, 100);
        const slug =
          orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") +
          "-" +
          crypto.randomBytes(3).toString("hex");
        const orgRes = await query(
          `INSERT INTO organizations (name, slug, type) VALUES ($1, $2, 'FUND') RETURNING id`,
          [orgName, slug]
        );
        orgId = orgRes.rows[0].id;
      }

      const userRes = await query(
        `INSERT INTO users (email, name, password_hash, role, org_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, email, name, role, org_id, created_at`,
        [cleanEmail, cleanName, passwordHash, cleanRole, orgId]
      );
      const user = { ...userRes.rows[0], org_name: orgName };
      if (orgId) {
        await query(
          `INSERT INTO org_members (org_id, user_id, org_role) VALUES ($1, $2, 'OWNER')`,
          [orgId, user.id]
        );
      }
      await query(`INSERT INTO investor_profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [user.id]);

      const tokens = await issueSessionTokens(user, true);
      await recordAuditLog({
        actorUserId: user.id,
        actorRole: user.role,
        action: "USER_REGISTERED",
        targetType: "user",
        targetId: user.id,
        details: { role: user.role, org_id: orgId },
        ipAddress: getClientIp(request)
      });

      return response.status(201).json(buildAuthResponsePayload(request, response, user, tokens));
    }

    // Memory fallback when DATABASE_URL is not configured
    const mem = getMemoryStore();
    if (mem.usersByEmail.has(cleanEmail)) {
      return response.status(409).json({ error: "An account with this email already exists." });
    }
    const user = {
      id: crypto.randomUUID(),
      name: cleanName,
      email: cleanEmail,
      role: cleanRole,
      org_id: organization_name ? "org-" + crypto.randomBytes(4).toString("hex") : null,
      org_name: organization_name ? String(organization_name).trim() : null,
      passwordHash,
      createdAt: new Date().toISOString()
    };
    mem.usersByEmail.set(cleanEmail, user);
    mem.usersById.set(user.id, user);

    const tokens = await issueSessionTokens(user, false);
    return response.status(201).json(buildAuthResponsePayload(request, response, user, tokens));
  }

  // POST /api/auth/login
  if (request.method === "POST" && subPath === "/login") {
    const { email, password } = request.body || {};
    const cleanEmail = String(email || "").trim().toLowerCase();
    const rawPassword = String(password || "");
    if (!cleanEmail || !rawPassword) {
      return response.status(400).json({ error: "Email and password are required." });
    }

    if (dbAvailable) {
      const res = await query(
        `SELECT u.id, u.email, u.name, u.password_hash, u.role, u.org_id, u.status, u.created_at, o.name AS org_name
         FROM users u LEFT JOIN organizations o ON u.org_id = o.id
         WHERE u.email = $1`,
        [cleanEmail]
      );
      const user = res.rows[0];
      if (!user || !verifyPassword(rawPassword, user.password_hash)) {
        return response.status(401).json({ error: "Invalid email or password." });
      }
      if (user.status !== "ACTIVE") {
        return response.status(403).json({ error: `Account status is ${user.status}.` });
      }
      await query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);
      const tokens = await issueSessionTokens(user, true);
      await recordAuditLog({
        actorUserId: user.id,
        actorRole: user.role,
        action: "USER_LOGIN",
        targetType: "user",
        targetId: user.id,
        ipAddress: getClientIp(request)
      });
      return response.status(200).json(buildAuthResponsePayload(request, response, user, tokens));
    }

    const mem = getMemoryStore();
    const user = mem.usersByEmail.get(cleanEmail);
    if (!user || !verifyPassword(rawPassword, user.passwordHash)) {
      return response.status(401).json({ error: "Invalid email or password." });
    }
    const tokens = await issueSessionTokens(user, false);
    return response.status(200).json(buildAuthResponsePayload(request, response, user, tokens));
  }

  // POST /api/auth/refresh — Rotate HttpOnly cookie or API refresh token and issue fresh 5-min access JWT
  if (request.method === "POST" && subPath === "/refresh") {
    const bodyToken = request.body?.refreshToken;
    const cookieToken = cookies[REFRESH_COOKIE_NAME];
    const usingCookie = !bodyToken && Boolean(cookieToken);

    if (usingCookie) {
      const csrf = verifyCsrfProtection(request, { requireCookieMatch: true });
      if (!csrf.ok) return response.status(csrf.status).json({ error: csrf.error, code: csrf.code });
    }

    const refreshToken = bodyToken || cookieToken;
    if (!refreshToken || typeof refreshToken !== "string") {
      return response.status(401).json({ error: "Valid refresh session is required." });
    }
    const tokenHash = hashRefreshToken(refreshToken.trim());

    if (dbAvailable) {
      const res = await query(
        `SELECT rt.id AS rt_id, rt.user_id, rt.expires_at, rt.revoked_at,
                u.email, u.name, u.role, u.org_id, u.status, u.created_at, o.name AS org_name
         FROM refresh_tokens rt
         JOIN users u ON rt.user_id = u.id
         LEFT JOIN organizations o ON u.org_id = o.id
         WHERE rt.token_hash = $1`,
        [tokenHash]
      );
      const row = res.rows[0];
      if (!row || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) {
        if (usingCookie) clearSessionCookies(request, response);
        return response.status(401).json({ error: "Invalid or expired refresh token." });
      }
      if (row.status && row.status !== "ACTIVE") {
        if (usingCookie) clearSessionCookies(request, response);
        return response.status(403).json({ error: `Account status is ${row.status}.` });
      }
      await query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`, [row.rt_id]);
      const user = {
        id: row.user_id,
        email: row.email,
        name: row.name,
        role: row.role,
        org_id: row.org_id,
        org_name: row.org_name,
        created_at: row.created_at
      };
      const tokens = await issueSessionTokens(user, true);
      return response.status(200).json(buildAuthResponsePayload(request, response, user, tokens));
    }

    const mem = getMemoryStore();
    const entry = mem.refreshTokens.get(tokenHash);
    if (!entry || entry.revokedAt || entry.expiresAt <= Date.now()) {
      if (usingCookie) clearSessionCookies(request, response);
      return response.status(401).json({ error: "Invalid or expired refresh token." });
    }
    entry.revokedAt = Date.now();
    const user = mem.usersById.get(entry.userId);
    if (!user) {
      if (usingCookie) clearSessionCookies(request, response);
      return response.status(401).json({ error: "User not found." });
    }
    const tokens = await issueSessionTokens(user, false);
    return response.status(200).json(buildAuthResponsePayload(request, response, user, tokens));
  }

  // POST /api/auth/logout — Revoke refresh token & clear HttpOnly session cookies
  if (request.method === "POST" && subPath === "/logout") {
    const bodyToken = request.body?.refreshToken;
    const cookieToken = cookies[REFRESH_COOKIE_NAME];
    if (!bodyToken && cookieToken) {
      const csrf = verifyCsrfProtection(request, { requireCookieMatch: true });
      if (!csrf.ok) return response.status(csrf.status).json({ error: csrf.error, code: csrf.code });
    }
    const refreshToken = bodyToken || cookieToken;
    if (refreshToken && typeof refreshToken === "string") {
      const tokenHash = hashRefreshToken(refreshToken.trim());
      if (dbAvailable) {
        await query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1`, [tokenHash]);
      } else {
        const entry = getMemoryStore().refreshTokens.get(tokenHash);
        if (entry) entry.revokedAt = Date.now();
      }
    }
    clearSessionCookies(request, response);
    return response.status(200).json({ status: "logged_out" });
  }

  // GET /api/auth/me
  if (request.method === "GET" && subPath === "/me") {
    const auth = request.headers?.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const decoded = verifyToken(token);
    if (!decoded) {
      return response.status(401).json({ error: "Not authenticated." });
    }

    if (dbAvailable) {
      const res = await query(
        `SELECT u.id, u.email, u.name, u.role, u.org_id, u.status, u.created_at, o.name AS org_name
         FROM users u LEFT JOIN organizations o ON u.org_id = o.id
         WHERE u.id = $1`,
        [decoded.id]
      );
      const user = res.rows[0];
      if (!user || user.status !== "ACTIVE") {
        return response.status(401).json({ error: "Session invalidated or account inactive." });
      }
      return response.status(200).json({ user: sanitizeUser(user) });
    }

    const user = getMemoryStore().usersById.get(decoded.id);
    if (!user) {
      return response.status(401).json({ error: "Session no longer valid." });
    }
    return response.status(200).json({ user: sanitizeUser(user) });
  }

  return response.status(404).json({ error: "Auth endpoint not found." });
}
