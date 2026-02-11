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
    const maxRequests = 40;
    const ip = (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim();
    const key = decoded.uid || ip || "unknown";
    if (!globalThis.__groqRateLimit) {
      globalThis.__groqRateLimit = new Map();
    }
    const bucket = globalThis.__groqRateLimit.get(key) || [];
    const recent = bucket.filter((t) => now - t < windowMs);
    if (recent.length >= maxRequests) {
      const oldest = recent[0] || now;
      const retryAfterMs = Math.max(1000, windowMs - (now - oldest));
      const retryAfterSec = Math.ceil(retryAfterMs / 1000);
      res.setHeader("Retry-After", String(retryAfterSec));
      res.status(429).json({ error: `Rate limit exceeded. Please try again in ${retryAfterSec}s.` });
      return;
    }
    recent.push(now);
    globalThis.__groqRateLimit.set(key, recent);

    const callGroq = async (body) => {
      const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body ?? {}),
      });
      const t = await resp.text();
      return { resp, text: t };
    };

    const isAnalysis = req.body?.analysis === true;
    const groqBody = { ...(req.body ?? {}) };
    delete groqBody.analysis;

    const defaultAnalysis = {
      patterns: {
        "全か無か思考": 0,
        "過度の一般化": 0,
        "心のフィルター": 0,
        "マイナス化思考": 0,
        "結論の飛躍": 0,
        "拡大解釈・過小評価": 0,
        "感情的決めつけ": 0,
        "べき思考": 0,
        "レッテル貼り": 0,
        "個人化": 0,
      },
      comment: "分析に失敗しました。もう一度お試しください。",
    };

    const extractJson = (raw) => {
      if (typeof raw !== "string") return null;
      const tagStart = raw.indexOf("<json>");
      const tagEnd = raw.indexOf("</json>");
      let candidate = raw;
      if (tagStart !== -1 && tagEnd !== -1 && tagEnd > tagStart) {
        candidate = raw.slice(tagStart + 6, tagEnd);
      } else {
        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        if (start !== -1 && end !== -1 && end > start) {
          candidate = raw.slice(start, end + 1);
        }
      }
      try {
        return JSON.parse(candidate);
      } catch {
        return null;
      }
    };

    const finalizeAnalysis = (rawContent) => {
      const parsed = extractJson(rawContent);
      if (parsed && parsed.patterns && parsed.comment) return parsed;
      return defaultAnalysis;
    };

    const upstream = await callGroq(groqBody);
    const text = upstream.text;
    if (!upstream.resp.ok) {
      try {
        const parsed = JSON.parse(text);
        if (parsed?.error?.code === "json_validate_failed") {
          const body = { ...(groqBody ?? {}) };
          delete body.response_format;
          body.messages = (body.messages || []).map((m) => ({ ...m }));
          const last = body.messages[body.messages.length - 1];
          if (last && typeof last.content === "string") {
            last.content += "\nJSONのみで出力してください。説明や装飾は禁止。";
          }
          const retry = await callGroq(body);
          if (!retry.resp.ok) {
            if (isAnalysis) {
              res.status(200).json(defaultAnalysis);
              return;
            }
            res.status(retry.resp.status).send(retry.text.slice(0, 2000));
            return;
          }
          try {
            const retryData = JSON.parse(retry.text);
            const retryContent = retryData?.choices?.[0]?.message?.content ?? "";
            if (isAnalysis) {
              res.status(200).json(finalizeAnalysis(retryContent));
              return;
            }
            res.status(200).json({ content: retryContent });
            return;
          } catch {}
        }
      } catch {}
      if (isAnalysis) {
        res.status(200).json(defaultAnalysis);
        return;
      }
      res.status(upstream.resp.status).send(text.slice(0, 2000));
      return;
    }

    const data = JSON.parse(text);
    const content = data?.choices?.[0]?.message?.content ?? "";
    if (isAnalysis) {
      res.status(200).json(finalizeAnalysis(content));
      return;
    }
    res.status(200).json({ content });
  } catch (error) {
    res.status(500).json({ error: error?.message || "Unknown error" });
  }
}
