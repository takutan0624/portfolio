import admin from "firebase-admin";

const DEFAULT_MODEL = process.env.ANTIAGE_GOOGLE_AI_MODEL || "gemini-2.0-flash";
const MAX_BODY_BYTES = 120000;
const MAX_QUERY_CHARS = 1200;
const MAX_SYSTEM_CHARS = 1800;
const MAX_POINTS_PER_MIN = 45;

let adminApp;

function getAdminApp() {
  if (adminApp) return adminApp;
  const existing = admin.apps.find((app) => app.name === "antiage-google-search");
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
    "antiage-google-search"
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

function getGoogleApiKey() {
  return (
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
  const query = String(body.query || "").trim().slice(0, MAX_QUERY_CHARS);
  if (!query) {
    const err = new Error("query is required");
    err.status = 400;
    throw err;
  }

  const model = String(body.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const temperatureRaw = Number(body.temperature);
  const temperature = Number.isFinite(temperatureRaw)
    ? Math.max(0, Math.min(1, temperatureRaw))
    : 0.3;

  const maxOutputTokensRaw = Number(body.maxOutputTokens);
  const maxOutputTokens = Number.isFinite(maxOutputTokensRaw)
    ? Math.max(256, Math.min(4096, Math.floor(maxOutputTokensRaw)))
    : 1600;

  const systemPrompt = String(body.systemPrompt || "")
    .trim()
    .slice(0, MAX_SYSTEM_CHARS);

  const points =
    1 +
    Math.ceil(query.length / 300) +
    Math.ceil(maxOutputTokens / 500);

  return {
    model,
    query,
    temperature,
    maxOutputTokens,
    systemPrompt,
    points,
  };
}

function consumeRateLimit(key, points) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  if (!globalThis.__googleAntiageRateLimit) {
    globalThis.__googleAntiageRateLimit = new Map();
  }
  const bucket = globalThis.__googleAntiageRateLimit.get(key) || [];
  const recent = bucket.filter((entry) => now - entry.t < windowMs);
  const used = recent.reduce((sum, entry) => sum + entry.points, 0);

  if (used + points > MAX_POINTS_PER_MIN) {
    const oldest = recent[0]?.t || now;
    const retryAfterMs = Math.max(1000, windowMs - (now - oldest));
    return { allowed: false, retryAfterMs };
  }

  recent.push({ t: now, points });
  globalThis.__googleAntiageRateLimit.set(key, recent);
  return { allowed: true, retryAfterMs: 0 };
}

function extractTextFromCandidate(candidate) {
  const parts = candidate?.content?.parts;
  if (!Array.isArray(parts)) return "";
  const text = parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
  return text;
}

function extractSources(candidate) {
  const chunks = candidate?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return [];

  const seen = new Set();
  const out = [];

  for (const chunk of chunks) {
    const web = chunk?.web || {};
    const uri = String(web.uri || "").trim();
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    out.push({
      title: String(web.title || "source").slice(0, 140),
      url: uri.slice(0, 2048),
    });
    if (out.length >= 8) break;
  }

  return out;
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

  const googleApiKey = getGoogleApiKey();
  if (!googleApiKey) {
    res.status(500).json({
      error:
        "Google AI API key is not set. Set one of: ANTIAGE_GOOGLE_AI_API_KEY, ANTIAGE_GEMINI_API_KEY, GOOGLE_AI_API_KEY, GEMINI_API_KEY, GOOGLE_API_KEY",
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

    const model = encodeURIComponent(input.model);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(googleApiKey)}`;
    const payload = {
      systemInstruction: {
        parts: [
          {
            text:
              input.systemPrompt ||
              "あなたは美容分野のリサーチアシスタントです。検索結果を簡潔に要約し、重要情報を箇条書きで示してください。",
          },
        ],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: input.query }],
        },
      ],
      tools: [{ google_search: {} }],
      generationConfig: {
        temperature: input.temperature,
        maxOutputTokens: input.maxOutputTokens,
      },
    };

    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const raw = await upstream.text();
    if (!upstream.ok) {
      const err = parseUpstreamError(raw);
      if (upstream.status === 429) {
        res.status(429).json({ error: "Google AI rate limit reached. Please retry shortly." });
        return;
      }
      res.status(502).json({ error: `Google AI error: ${err.message}` });
      return;
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      res.status(502).json({ error: "Invalid Google AI response format" });
      return;
    }

    const candidate = data?.candidates?.[0] || null;
    const content = extractTextFromCandidate(candidate).slice(0, 20000);
    const sources = extractSources(candidate);

    if (!content) {
      res.status(502).json({ error: "Google AI returned empty content" });
      return;
    }

    res.status(200).json({
      content,
      sources,
      model: input.model,
    });
  } catch (e) {
    const msg = String(e?.message || "Internal server error");
    if (/private key|credential|service account|json/i.test(msg)) {
      res.status(500).json({ error: `Firebase Admin SDK config error: ${msg}` });
      return;
    }
    res.status(500).json({ error: `Internal server error: ${msg}` });
  }
}
