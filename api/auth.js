import crypto from "node:crypto";
import { getStore, saveStore, hashPassword, verifyPassword, signToken, verifyToken } from "./store.js";

function sanitizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt
  };
}

export default function authHandler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  const subPath = (request.path || request.url || "").replace(/^\/api\/auth/, "").split("?")[0];

  if (request.method === "POST" && subPath === "/register") {
    const { name, email, password } = request.body || {};
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanName = String(name || "").trim();
    const rawPassword = String(password || "");

    if (!cleanName || cleanName.length < 2) {
      return response.status(400).json({ error: "Name must be at least 2 characters." });
    }
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return response.status(400).json({ error: "Enter a valid email address." });
    }
    if (rawPassword.length < 6) {
      return response.status(400).json({ error: "Password must be at least 6 characters." });
    }

    const store = getStore();
    if (store.users[cleanEmail]) {
      return response.status(409).json({ error: "An account with this email already exists." });
    }

    const user = {
      id: "usr-" + crypto.randomUUID().slice(0, 8),
      name: cleanName,
      email: cleanEmail,
      passwordHash: hashPassword(rawPassword),
      createdAt: new Date().toISOString()
    };
    store.users[cleanEmail] = user;
    saveStore();

    const token = signToken({ id: user.id, email: user.email, name: user.name });
    return response.status(201).json({ user: sanitizeUser(user), token });
  }

  if (request.method === "POST" && subPath === "/login") {
    const { email, password } = request.body || {};
    const cleanEmail = String(email || "").trim().toLowerCase();
    const rawPassword = String(password || "");
    if (!cleanEmail || !rawPassword) {
      return response.status(400).json({ error: "Email and password are required." });
    }

    const store = getStore();
    const user = store.users[cleanEmail];
    if (!user || !verifyPassword(rawPassword, user.passwordHash)) {
      return response.status(401).json({ error: "Invalid email or password." });
    }

    const token = signToken({ id: user.id, email: user.email, name: user.name });
    return response.status(200).json({ user: sanitizeUser(user), token });
  }

  if (request.method === "GET" && subPath === "/me") {
    const auth = request.headers?.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const decoded = verifyToken(token);
    if (!decoded) {
      return response.status(401).json({ error: "Not authenticated." });
    }
    return response.status(200).json({ user: { id: decoded.id, email: decoded.email, name: decoded.name } });
  }

  return response.status(404).json({ error: "Auth endpoint not found." });
}
