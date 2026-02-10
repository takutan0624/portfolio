import admin from "firebase-admin";

let adminApp;
function getAdminApp() {
  if (adminApp) return adminApp;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_MENTAL;
  if (!raw) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_MENTAL is not set");
  }
  const serviceAccount = JSON.parse(raw);
  adminApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  return adminApp;
}

export default async function handler(req, res) {
  const allowedOrigins = new Set([
    "https://portfolio-flame-iota-d7n8dbh5mp.vercel.app",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ]);
  const origin = req.headers.origin || "";
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

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "GROQ_API_KEY is not set" });
    return;
  }

  const authHeader = req.headers.authorization || "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    res.status(401).json({ error: "Missing Authorization Bearer token" });
    return;
  }

  try {
    getAdminApp();
    const decoded = await admin.auth().verifyIdToken(match[1]);
    if (decoded?.firebase?.sign_in_provider === "anonymous") {
      res.status(403).json({ error: "Anonymous users are not allowed" });
      return;
    }
    if (!origin || !allowedOrigins.has(origin)) {
      res.status(403).json({ error: "Origin not allowed" });
      return;
    }

    const now = Date.now();
    const windowMs = 60 * 1000;
    const maxRequests = 20;
    const ip = (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim();
    const key = decoded.uid || ip || "unknown";
    if (!globalThis.__groqRateLimit) {
      globalThis.__groqRateLimit = new Map();
    }
    const bucket = globalThis.__groqRateLimit.get(key) || [];
    const recent = bucket.filter((t) => now - t < windowMs);
    if (recent.length >= maxRequests) {
      res.status(429).json({ error: "Rate limit exceeded" });
      return;
    }
    recent.push(now);
    globalThis.__groqRateLimit.set(key, recent);

    const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(req.body ?? {}),
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      res.status(upstream.status).send(text.slice(0, 2000));
      return;
    }

    const data = JSON.parse(text);
    const content = data?.choices?.[0]?.message?.content ?? "";
    res.status(200).json({ content });
  } catch (error) {
    res.status(500).json({ error: error?.message || "Unknown error" });
  }
}
