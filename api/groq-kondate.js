import admin from "firebase-admin";

const MODEL = "openai/gpt-oss-120b";
const ALLOWED_ROLES = new Set(["system", "user", "assistant"]);
const MAX_MESSAGES = 24;
const MAX_MESSAGE_CHARS = 4000;
const MAX_TOTAL_CHARS = 20000;
const MAX_BODY_BYTES = 200000;
const MAX_POINTS_PER_MIN = 90;

let adminApp;
function getServiceAccountRaw() {
  return (
    process.env.FIREBASE_SERVICE_ACCOUNT_KONDATE ||
    process.env.FIREBASE_SERVICE_ACCOUNT ||
    process.env.FIREBASE_SERVICE_ACCOUNT_MENTAL ||
    process.env.FIREBASE_SERVICE_ACCOUNT_ANTIAGE ||
    ""
  );
}

function getAdminApp() {
  if (adminApp) return adminApp;
  const raw = getServiceAccountRaw();
  if (!raw) {
    throw new Error("FIREBASE service account is not set");
  }
  const serviceAccount = JSON.parse(raw);
  adminApp = admin.initializeApp(
    {
      credential: admin.credential.cert(serviceAccount),
    },
    "groq-kondate"
  );
  return adminApp;
}

function getAllowedOrigins() {
  const defaults = [
    "https://portfolio-flame-iota-d7n8dbh5mp.vercel.app",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ];
  const extra = (process.env.KONDATE_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set([...defaults, ...extra]);
}

function setSecurityHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseRetryAfterMs(text, headerValue) {
  let retryAfterMs = 0;
  if (headerValue) {
    const sec = Number(headerValue);
    if (Number.isFinite(sec) && sec > 0) retryAfterMs = Math.ceil(sec * 1000);
  }
  if (!retryAfterMs && typeof text === "string") {
    const match = text.match(/try again in\s*([0-9.]+)s/i);
    if (match) retryAfterMs = Math.ceil(Number(match[1]) * 1000);
  }
  return retryAfterMs;
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) {
    const err = new Error("Invalid messages");
    err.status = 400;
    throw err;
  }

  const sanitized = [];
  let totalChars = 0;
  const sliced = messages.slice(-MAX_MESSAGES);
  for (const item of sliced) {
    if (!item || typeof item !== "object") continue;
    const role = ALLOWED_ROLES.has(item.role) ? item.role : "user";
    const rawContent = typeof item.content === "string" ? item.content : "";
    const content = rawContent.trim().slice(0, MAX_MESSAGE_CHARS);
    if (!content) continue;
    totalChars += content.length;
    sanitized.push({ role, content });
  }

  if (sanitized.length === 0) {
    const err = new Error("Empty messages");
    err.status = 400;
    throw err;
  }
  if (totalChars > MAX_TOTAL_CHARS) {
    const err = new Error("Input too large");
    err.status = 413;
    throw err;
  }
  return { messages: sanitized, totalChars };
}

function sanitizeGroqBody(rawBody) {
  const body = rawBody && typeof rawBody === "object" ? rawBody : {};
  const { messages, totalChars } = sanitizeMessages(body.messages);
  const temperature = clampNumber(body.temperature, 0, 1.2, 0.4);
  const max_tokens = Math.floor(clampNumber(body.max_tokens, 64, 3200, 2600));
  const points = 1 + Math.ceil(totalChars / 2000) + Math.ceil(max_tokens / 300);

  return {
    groqBody: { model: MODEL, messages, temperature, max_tokens },
    points,
  };
}

function consumeRateLimit(key, points) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  if (!globalThis.__groqKondateRateLimit) {
    globalThis.__groqKondateRateLimit = new Map();
  }
  const bucket = globalThis.__groqKondateRateLimit.get(key) || [];
  const recent = bucket.filter((entry) => now - entry.t < windowMs);
  const used = recent.reduce((sum, entry) => sum + entry.points, 0);

  if (used + points > MAX_POINTS_PER_MIN) {
    const oldest = recent[0]?.t || now;
    const retryAfterMs = Math.max(1000, windowMs - (now - oldest));
    return { allowed: false, retryAfterMs };
  }

  recent.push({ t: now, points });
  globalThis.__groqKondateRateLimit.set(key, recent);
  return { allowed: true, retryAfterMs: 0 };
}

function parseUpstreamError(text) {
  if (!text) return { message: "Upstream request failed", code: "" };
  try {
    const parsed = JSON.parse(text);
    const message = parsed?.error?.message || parsed?.error || "Upstream request failed";
    const code = parsed?.error?.code || "";
    return { message: String(message), code: String(code) };
  } catch {
    return { message: String(text), code: "" };
  }
}

export default async function handler(req, res) {
  const allowedOrigins = getAllowedOrigins();
  const origin = req.headers.origin || "";
  const fetchSite = (req.headers["sec-fetch-site"] || "").toString();

  setSecurityHeaders(res);
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    if (!origin || !allowedOrigins.has(origin)) {
      res.status(403).end();
      return;
    }
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const contentType = (req.headers["content-type"] || "").toString().toLowerCase();
  if (!contentType.includes("application/json")) {
    res.status(415).json({ error: "Unsupported Content-Type" });
    return;
  }

  const contentLength = Number(req.headers["content-length"] || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    res.status(413).json({ error: "Payload too large" });
    return;
  }

  if (fetchSite === "cross-site") {
    res.status(403).json({ error: "Cross-site request blocked" });
    return;
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is not configured" });
    return;
  }

  const authHeader = req.headers.authorization || "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    res.status(401).json({ error: "Missing Authorization Bearer token" });
    return;
  }

  try {
    const app = getAdminApp();
    let decoded;
    try {
      decoded = await admin.auth(app).verifyIdToken(match[1], true);
    } catch {
      res.status(401).json({ error: "Invalid Firebase ID token" });
      return;
    }
    if (decoded?.firebase?.sign_in_provider === "anonymous") {
      res.status(403).json({ error: "Anonymous users are not allowed" });
      return;
    }
    if (!origin || !allowedOrigins.has(origin)) {
      res.status(403).json({ error: "Origin not allowed" });
      return;
    }

    const { groqBody, points } = sanitizeGroqBody(req.body);
    const ip = (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim();
    const rateKey = decoded.uid || ip || "unknown";
    const rate = consumeRateLimit(rateKey, points);
    if (!rate.allowed) {
      const retryAfterSec = Math.ceil(rate.retryAfterMs / 1000);
      res.setHeader("Retry-After", String(retryAfterSec));
      res.status(429).json({ error: `Rate limit exceeded. Please try again in ${retryAfterSec}s.` });
      return;
    }

    const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(groqBody),
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      const upstreamErr = parseUpstreamError(text);
      const retryAfterMs = parseRetryAfterMs(
        upstreamErr.message,
        upstream.headers.get("retry-after")
      );
      if (upstream.status === 429) {
        const retrySec = Math.ceil((retryAfterMs || 12000) / 1000);
        res.setHeader("Retry-After", String(retrySec));
        res.status(429).json({ error: `Rate limit reached. Please try again in ${retrySec}s.` });
        return;
      }
      res.status(502).json({ error: "AI service error. Please retry shortly." });
      return;
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      res.status(502).json({ error: "Invalid AI response format" });
      return;
    }

    const content = data?.choices?.[0]?.message?.content ?? "";
    res.status(200).json({ content: String(content).slice(0, 30000) });
  } catch (error) {
    const msg = String(error?.message || "Internal server error");
    if (/already exists/i.test(msg)) {
      res.status(500).json({ error: "Firebase Admin app init conflict. Check function app naming." });
      return;
    }
    if (/private key|credential|service account|json/i.test(msg)) {
      res.status(500).json({ error: `Firebase Admin SDK config error: ${msg}` });
      return;
    }
    res.status(500).json({ error: `Internal server error: ${msg}` });
  }
}
