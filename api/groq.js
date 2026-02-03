import admin from "firebase-admin";

let adminApp;
function getAdminApp() {
  if (adminApp) return adminApp;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is not set");
  }
  const serviceAccount = JSON.parse(raw);
  adminApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  return adminApp;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
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
    await admin.auth().verifyIdToken(match[1]);

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
