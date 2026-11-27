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
import { VALID_ROLES, ROLE_PERMISSIONS, createRateLimiter } from "./security.js";
import { recordAuditLog } from "../db/client.js";

const authRateLimiter = createRateLimiter({ windowMs: 60_000, max: 40, keyPrefix: "auth" });

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
  const accessToken = signToken(payload, 3600); // 1h short-lived access token
  const refreshToken = createRefreshTokenValue();
  const refreshHash = hashRefreshToken(refreshToken);
  const expiresAt = new Date(Date.now() + 14 * 86400 * 1000);

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

  return { token: accessToken, refreshToken, expiresIn: 3600 };
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

      return response.status(201).json({ user: sanitizeUser(user), ...tokens });
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
    return response.status(201).json({ user: sanitizeUser(user), ...tokens });
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
      return response.status(200).json({ user: sanitizeUser(user), ...tokens });
    }

    const mem = getMemoryStore();
    const user = mem.usersByEmail.get(cleanEmail);
    if (!user || !verifyPassword(rawPassword, user.passwordHash)) {
      return response.status(401).json({ error: "Invalid email or password." });
    }
    const tokens = await issueSessionTokens(user, false);
    return response.status(200).json({ user: sanitizeUser(user), ...tokens });
  }

  // POST /api/auth/refresh — Rotate refresh token and issue a fresh access token
  if (request.method === "POST" && subPath === "/refresh") {
    const { refreshToken } = request.body || {};
    if (!refreshToken || typeof refreshToken !== "string") {
      return response.status(400).json({ error: "refreshToken is required." });
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
        return response.status(401).json({ error: "Invalid or expired refresh token." });
      }
      if (row.status && row.status !== "ACTIVE") {
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
      return response.status(200).json({ user: sanitizeUser(user), ...tokens });
    }

    const mem = getMemoryStore();
    const entry = mem.refreshTokens.get(tokenHash);
    if (!entry || entry.revokedAt || entry.expiresAt <= Date.now()) {
      return response.status(401).json({ error: "Invalid or expired refresh token." });
    }
    entry.revokedAt = Date.now();
    const user = mem.usersById.get(entry.userId);
    if (!user) return response.status(401).json({ error: "User not found." });
    const tokens = await issueSessionTokens(user, false);
    return response.status(200).json({ user: sanitizeUser(user), ...tokens });
  }

  // POST /api/auth/logout — Revoke refresh token
  if (request.method === "POST" && subPath === "/logout") {
    const { refreshToken } = request.body || {};
    if (refreshToken && typeof refreshToken === "string") {
      const tokenHash = hashRefreshToken(refreshToken.trim());
      if (dbAvailable) {
        await query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1`, [tokenHash]);
      } else {
        const entry = getMemoryStore().refreshTokens.get(tokenHash);
        if (entry) entry.revokedAt = Date.now();
      }
    }
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
