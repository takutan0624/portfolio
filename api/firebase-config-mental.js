import admin from "firebase-admin";

const ALLOWED_KEYS = [
  "apiKey",
  "authDomain",
  "projectId",
  "storageBucket",
  "messagingSenderId",
  "appId",
  "measurementId",
];
let cachedConfig = null;
let cachedConfigExpireAt = 0;
let serviceAccountProjectId = "";
let adminApp = null;

function getAdminApp() {
  if (adminApp) return adminApp;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_MENTAL || "";
  if (!raw) return null;
  try {
    const serviceAccount = JSON.parse(raw);
    adminApp = admin.initializeApp(
      {
        credential: admin.credential.cert(serviceAccount),
      },
      "firebase-config-mental"
    );
    return adminApp;
  } catch {
    return null;
  }
}

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
    process.env.NEXT_PUBLIC_FIREBASE_CONFIG ||
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
    apiKey:
      process.env.MENTAL_FIREBASE_API_KEY ||
      process.env.FIREBASE_API_KEY_MENTAL ||
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
      process.env.FIREBASE_API_KEY,
    authDomain:
      process.env.MENTAL_FIREBASE_AUTH_DOMAIN ||
      process.env.FIREBASE_AUTH_DOMAIN_MENTAL ||
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||
      process.env.FIREBASE_AUTH_DOMAIN,
    projectId:
      process.env.MENTAL_FIREBASE_PROJECT_ID ||
      process.env.FIREBASE_PROJECT_ID_MENTAL ||
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
      process.env.FIREBASE_PROJECT_ID,
    storageBucket:
      process.env.MENTAL_FIREBASE_STORAGE_BUCKET ||
      process.env.FIREBASE_STORAGE_BUCKET_MENTAL ||
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
      process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.MENTAL_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID_MENTAL,
    appId:
      process.env.MENTAL_FIREBASE_APP_ID ||
      process.env.FIREBASE_APP_ID_MENTAL ||
      process.env.NEXT_PUBLIC_FIREBASE_APP_ID ||
      process.env.FIREBASE_APP_ID,
    measurementId:
      process.env.MENTAL_FIREBASE_MEASUREMENT_ID ||
      process.env.FIREBASE_MEASUREMENT_ID_MENTAL ||
      process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID ||
      process.env.FIREBASE_MEASUREMENT_ID,
  };
  return pickConfig(obj);
}

async function getServiceAccountMeta() {
  if (serviceAccountProjectId) return { projectId: serviceAccountProjectId };
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_MENTAL || "";
  if (!raw) return { projectId: "" };
  try {
    const parsed = JSON.parse(raw);
    serviceAccountProjectId = parsed.project_id || "";
    return { projectId: serviceAccountProjectId };
  } catch {
    return { projectId: "" };
  }
}

async function fromFirebaseApi() {
  const now = Date.now();
  if (cachedConfig && now < cachedConfigExpireAt) return cachedConfig;

  const sa = await getServiceAccountMeta();
  if (!sa.projectId) return null;

  try {
    const app = getAdminApp();
    if (!app) return null;
    const credential = app?.options?.credential;
    if (!credential || typeof credential.getAccessToken !== "function") return null;
    const tokenInfo = await credential.getAccessToken();
    const token = tokenInfo?.access_token || tokenInfo?.accessToken || "";
    if (!token) return null;

    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const listRes = await fetch(
      `https://firebase.googleapis.com/v1beta1/projects/${encodeURIComponent(sa.projectId)}/webApps`,
      { method: "GET", headers }
    );
    if (!listRes.ok) return null;
    const listData = await listRes.json();
    const apps = Array.isArray(listData?.apps) ? listData.apps : [];
    if (apps.length === 0) return null;

    const preferredAppId = (process.env.MENTAL_FIREBASE_WEB_APP_ID || "").trim();
    let selected = apps[0];
    if (preferredAppId) {
      const found = apps.find((a) => String(a?.appId || "") === preferredAppId);
      if (found) selected = found;
    }
    const appName = selected?.name;
    if (!appName) return null;

    const cfgRes = await fetch(
      `https://firebase.googleapis.com/v1beta1/${appName}/config`,
      { method: "GET", headers }
    );
    if (!cfgRes.ok) return null;
    const cfgData = await cfgRes.json();
    const picked = pickConfig(cfgData);
    if (!picked) return null;

    cachedConfig = picked;
    cachedConfigExpireAt = now + 10 * 60 * 1000;
    return picked;
  } catch {
    return null;
  }
}

function guessProjectId() {
  return (
    process.env.MENTAL_FIREBASE_PROJECT_ID ||
    process.env.FIREBASE_PROJECT_ID_MENTAL ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    process.env.FIREBASE_PROJECT_ID ||
    serviceAccountProjectId ||
    "my-mental-partner"
  );
}

async function fromFirebaseHostingInit() {
  const explicitUrl = (process.env.MENTAL_FIREBASE_PUBLIC_CONFIG_URL || "").trim();
  const projectId = guessProjectId();
  const candidates = [
    explicitUrl,
    `https://${projectId}.web.app/__/firebase/init.json`,
    `https://${projectId}.firebaseapp.com/__/firebase/init.json`,
  ].filter(Boolean);

  for (const url of candidates) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) continue;
      const data = await res.json();
      const picked = pickConfig(data);
      if (picked) {
        cachedConfig = picked;
        cachedConfigExpireAt = Date.now() + 10 * 60 * 1000;
        return picked;
      }
    } catch {}
  }
  return null;
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

  const config =
    fromJsonEnv() ||
    fromFlatEnv() ||
    await fromFirebaseApi() ||
    await fromFirebaseHostingInit();
  if (!config) {
    res.status(500).json({ error: "Firebase web config is not set. Set FIREBASE_WEB_CONFIG_MENTAL or MENTAL_FIREBASE_API_KEY group." });
    return;
  }

  res.status(200).json(config);
}
