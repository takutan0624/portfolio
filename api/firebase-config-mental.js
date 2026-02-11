const ALLOWED_KEYS = [
  "apiKey",
  "authDomain",
  "projectId",
  "storageBucket",
  "messagingSenderId",
  "appId",
  "measurementId",
];

function setHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function getAllowedOrigins() {
  const defaults = [
    "https://portfolio-flame-iota-d7n8dbh5mp.vercel.app",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ];
  const extra = (process.env.MENTAL_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set([...defaults, ...extra]);
}

function pickConfig(obj) {
  if (!obj || typeof obj !== "object") return null;
  const out = {};
  ALLOWED_KEYS.forEach((k) => {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  });
  if (!out.apiKey || !out.projectId || !out.appId) return null;
  return out;
}

function fromJsonEnv() {
  const raw =
    process.env.FIREBASE_WEB_CONFIG_MENTAL ||
    process.env.MENTAL_FIREBASE_WEB_CONFIG ||
    process.env.FIREBASE_CONFIG_MENTAL ||
    "";
  if (!raw) return null;
  try {
    return pickConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

function fromFlatEnv() {
  const obj = {
    apiKey: process.env.MENTAL_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY_MENTAL,
    authDomain: process.env.MENTAL_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN_MENTAL,
    projectId: process.env.MENTAL_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID_MENTAL,
    storageBucket: process.env.MENTAL_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET_MENTAL,
    messagingSenderId: process.env.MENTAL_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID_MENTAL,
    appId: process.env.MENTAL_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID_MENTAL,
    measurementId: process.env.MENTAL_FIREBASE_MEASUREMENT_ID || process.env.FIREBASE_MEASUREMENT_ID_MENTAL,
  };
  return pickConfig(obj);
}

export default async function handler(req, res) {
  const allowedOrigins = getAllowedOrigins();
  const origin = req.headers.origin || "";

  setHeaders(res);
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    if (!origin || !allowedOrigins.has(origin)) {
      res.status(403).end();
      return;
    }
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  if (origin && !allowedOrigins.has(origin)) {
    res.status(403).json({ error: "Origin not allowed" });
    return;
  }

  const config = fromJsonEnv() || fromFlatEnv();
  if (!config) {
    res.status(500).json({ error: "Firebase web config is not set" });
    return;
  }

  res.status(200).json(config);
}
