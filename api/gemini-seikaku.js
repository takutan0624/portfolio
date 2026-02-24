import admin from "firebase-admin";

const DEFAULT_MODEL = process.env.SEIKAKU_GEMINI_MODEL || "gemini-2.5-pro";
const FALLBACK_MODEL = process.env.SEIKAKU_GEMINI_FALLBACK_MODEL || "gemini-2.5-flash";
const MAX_BODY_BYTES = 260000;
const MAX_PROMPT_CHARS = 24000;
const MAX_POINTS_PER_MIN = 80;

let adminApp;

function getAdminApp() {
  if (adminApp) return adminApp;
  const existing = admin.apps.find((app) => app.name === "seikaku-gemini");
  if (existing) {
    adminApp = existing;
    return adminApp;
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_ANTIAGE;
  if (!raw) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_ANTIAGE is not set");
  }
  const serviceAccount = JSON.parse(raw);
  adminApp = admin.initializeApp(
    { credential: admin.credential.cert(serviceAccount) },
    "seikaku-gemini"
  );
  return adminApp;
}

function getAllowedOrigins() {
  const defaults = [
    "https://portfolio-flame-iota-d7n8dbh5mp.vercel.app",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ];
  const extra = (process.env.ANTIAGE_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set([...defaults, ...extra]);
}

function setHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function getGeminiApiKey() {
  return (
    process.env.SEIKAKU_GEMINI_API_KEY ||
    process.env.ANTIAGE_GOOGLE_AI_API_KEY ||
    process.env.ANTIAGE_GEMINI_API_KEY ||
    process.env.GOOGLE_AI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    ""
  ).trim();
}

function sanitizeInput(rawBody) {
  const body = rawBody && typeof rawBody === "object" ? rawBody : {};
  const prompt = String(body.prompt || "").trim().slice(0, MAX_PROMPT_CHARS);
  if (!prompt) {
    const err = new Error("prompt is required");
    err.status = 400;
    throw err;
  }

  const schema = body.schema;
  if (!schema || typeof schema !== "object") {
    const err = new Error("schema is required");
    err.status = 400;
    throw err;
  }

  const model = String(body.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const temperatureRaw = Number(body.temperature);
  const temperature = Number.isFinite(temperatureRaw)
    ? Math.max(0, Math.min(1, temperatureRaw))
    : 0.4;

  const points = 1 + Math.ceil(prompt.length / 1200);
  return { prompt, schema, model, temperature, points };
}

function consumeRateLimit(key, points) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  if (!globalThis.__seikakuGeminiRateLimit) {
    globalThis.__seikakuGeminiRateLimit = new Map();
  }
  const bucket = globalThis.__seikakuGeminiRateLimit.get(key) || [];
  const recent = bucket.filter((entry) => now - entry.t < windowMs);
  const used = recent.reduce((sum, entry) => sum + entry.points, 0);

  if (used + points > MAX_POINTS_PER_MIN) {
    const oldest = recent[0]?.t || now;
    const retryAfterMs = Math.max(1000, windowMs - (now - oldest));
    return { allowed: false, retryAfterMs };
  }

  recent.push({ t: now, points });
  globalThis.__seikakuGeminiRateLimit.set(key, recent);
  return { allowed: true, retryAfterMs: 0 };
}

function parseUpstreamError(text) {
  try {
    const parsed = JSON.parse(text || "{}");
    const message = parsed?.error?.message || parsed?.error || text || "Upstream error";
    const code = parsed?.error?.code || "";
    return { message: String(message), code: String(code) };
  } catch {
    return { message: String(text || "Upstream error"), code: "" };
  }
}

async function callGeminiGenerateContent({ model, prompt, schema, temperature, geminiApiKey }) {
  const safeModel = encodeURIComponent(String(model || "").trim());
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${safeModel}:generateContent?key=${encodeURIComponent(geminiApiKey)}`;
  const upstream = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature,
      },
    }),
  });
  const text = await upstream.text();
  return { upstream, text };
}

function shouldTryFallbackModel({ upstreamStatus, upstreamText, requestedModel, fallbackModel }) {
  const primary = String(requestedModel || "").trim();
  const fallback = String(fallbackModel || "").trim();
  if (!primary || !fallback || primary === fallback) return false;
  if (upstreamStatus === 429) return true;
  const parsed = parseUpstreamError(upstreamText);
  const hint = `${parsed.message} ${parsed.code}`.toLowerCase();
  return hint.includes("resource_exhausted") || hint.includes("rate limit") || hint.includes("quota");
}

export default async function handler(req, res) {
  const allowedOrigins = getAllowedOrigins();
  const origin = req.headers.origin || "";
  const fetchSite = (req.headers["sec-fetch-site"] || "").toString();

  setHeaders(res);
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

  if (!origin || !allowedOrigins.has(origin)) {
    res.status(403).json({ error: "Origin not allowed" });
    return;
  }

  const geminiApiKey = getGeminiApiKey();
  if (!geminiApiKey) {
    res.status(500).json({
      error:
        "Gemini API key is not set. Set one of: SEIKAKU_GEMINI_API_KEY, ANTIAGE_GOOGLE_AI_API_KEY, ANTIAGE_GEMINI_API_KEY, GOOGLE_AI_API_KEY, GEMINI_API_KEY, GOOGLE_API_KEY",
    });
    return;
  }
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_ANTIAGE) {
    res.status(500).json({ error: "FIREBASE_SERVICE_ACCOUNT_ANTIAGE is not set" });
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

    const input = sanitizeInput(req.body);
    const ip = (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim();
    const rateKey = decoded.uid || ip || "unknown";
    const rate = consumeRateLimit(rateKey, input.points);
    if (!rate.allowed) {
      const retryAfterSec = Math.ceil(rate.retryAfterMs / 1000);
      res.setHeader("Retry-After", String(retryAfterSec));
      res.status(429).json({ error: `Rate limit exceeded. Please try again in ${retryAfterSec}s.` });
      return;
    }

    const primaryModel = String(input.model || "").trim() || DEFAULT_MODEL;
    const fallbackModel = String(FALLBACK_MODEL || "").trim();

    let usedModel = primaryModel;
    let fallbackUsed = false;
    let { upstream, text: upstreamText } = await callGeminiGenerateContent({
      model: primaryModel,
      prompt: input.prompt,
      schema: input.schema,
      temperature: input.temperature,
      geminiApiKey,
    });

    if (!upstream.ok && shouldTryFallbackModel({
      upstreamStatus: upstream.status,
      upstreamText,
      requestedModel: primaryModel,
      fallbackModel,
    })) {
      fallbackUsed = true;
      usedModel = fallbackModel;
      ({ upstream, text: upstreamText } = await callGeminiGenerateContent({
        model: fallbackModel,
        prompt: input.prompt,
        schema: input.schema,
        temperature: input.temperature,
        geminiApiKey,
      }));
    }

    if (!upstream.ok) {
      const parsed = parseUpstreamError(upstreamText);
      const msg = parsed.message || "Gemini request failed";
      if (upstream.status === 429) {
        const retryAfterHeader = Number(upstream.headers.get("retry-after") || "0");
        const retrySec = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
          ? Math.ceil(retryAfterHeader)
          : 15;
        res.setHeader("Retry-After", String(retrySec));
        const suffix = fallbackUsed ? " (fallback model also rate-limited)" : "";
        res.status(429).json({ error: `Rate limit reached. Please try again in ${retrySec}s.${suffix}` });
        return;
      }
      res.status(upstream.status).json({ error: msg.slice(0, 400) });
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(upstreamText);
    } catch {
      res.status(502).json({ error: "Failed to parse Gemini response" });
      return;
    }

    const raw = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw || typeof raw !== "string") {
      res.status(502).json({ error: "Gemini returned empty content" });
      return;
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      res.status(502).json({ error: "Gemini did not return valid JSON object" });
      return;
    }

    res.status(200).json({ ok: true, data, model: usedModel, fallbackUsed });
  } catch (err) {
    const status = Number(err?.status || 500);
    const message = String(err?.message || "Internal server error");
    res.status(status).json({ error: message.slice(0, 400) });
  }
}
