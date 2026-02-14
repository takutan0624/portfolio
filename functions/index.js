const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/https");
const Parser = require("rss-parser");

setGlobalOptions({ maxInstances: 10 });

const parser = new Parser({
  timeout: 15000,
  customFields: {
    item: ["media:content", "dc:creator"],
  },
});

const REGION_WORDS = ["東京", "神奈川", "千葉", "首都圏"];
const COSME_WORDS = ["コスメ", "化粧品", "ビューティー", "メイク"];
const EVENT_WORDS = ["ポップアップ", "イベント", "催事", "フェス", "フェスティバル", "フェア", "体験会"];
const DONKI_WORDS = ["ドンキ", "ドン・キホーテ", "MEGAドンキ"];

function getAllowedOrigins() {
  const defaults = [
    "https://portfolio-flame-iota-d7n8dbh5mp.vercel.app",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ];
  const extra = String(process.env.ANTIAGE_ALLOWED_ORIGINS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return new Set([...defaults, ...extra]);
}

function setCommonHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function handleCors(req, res) {
  const allowedOrigins = getAllowedOrigins();
  const origin = req.headers.origin || "";
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    if (!origin || !allowedOrigins.has(origin)) {
      res.status(403).end();
      return true;
    }
    res.status(204).end();
    return true;
  }

  if (origin && !allowedOrigins.has(origin)) {
    res.status(403).json({error: "Origin not allowed"});
    return true;
  }
  return false;
}

function normalizeKeywords(raw) {
  if (!raw) return [];
  return Array.from(
    new Set(
      String(raw)
        .split(/[\n,、，]/g)
        .map((v) => v.trim())
        .filter(Boolean)
        .slice(0, 8),
    ),
  );
}

function escapeQuotes(text) {
  return String(text || "").replace(/"/g, "").trim();
}

function buildGoogleNewsUrl(query) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ja&gl=JP&ceid=JP:ja`;
}

function buildQueries(extraKeywords) {
  const areaGroup = REGION_WORDS.map((w) => `"${w}"`).join(" OR ");
  const cosmeGroup = COSME_WORDS.map((w) => `"${w}"`).join(" OR ");
  const eventTitleGroup = ["intitle:ポップアップ", "intitle:イベント", "intitle:催事", "intitle:フェア"].join(" OR ");
  const eventWordGroup = EVENT_WORDS.map((w) => `"${w}"`).join(" OR ");
  const extraGroup = extraKeywords.length > 0 ? extraKeywords.map((w) => `"${escapeQuotes(w)}"`).join(" OR ") : "";
  const extraClause = extraGroup ? `(${extraGroup})` : "";

  const q1 = `(${areaGroup}) (${cosmeGroup}) (${eventTitleGroup}) ${extraClause}`.trim();
  const q2 = `(${areaGroup}) (${cosmeGroup}) (${eventWordGroup}) ${extraClause}`.trim();
  const q3 = `("ドン・キホーテ" OR "ドンキ" OR "MEGAドンキ") ("コスメフェスティバル" OR "コスメフェス" OR "ビューティーイベント" OR "催事") ${extraClause}`.trim();

  return [q1, q2, q3];
}

function dedupeByLink(items) {
  const map = new Map();
  for (const item of items) {
    const key = String(item.link || "").trim();
    if (!key) continue;
    if (!map.has(key)) map.set(key, item);
  }
  return Array.from(map.values());
}

function toDateValue(value) {
  const t = new Date(value || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

function pickSource(item) {
  const fromCreator = item?.["dc:creator"];
  if (typeof fromCreator === "string" && fromCreator.trim()) return fromCreator.trim();
  const fromSource = item?.source?.title;
  if (typeof fromSource === "string" && fromSource.trim()) return fromSource.trim();
  return "Google News";
}

function normalizeItem(item, queryUsed) {
  return {
    title: String(item.title || "").trim(),
    link: String(item.link || "").trim(),
    pubDate: String(item.pubDate || ""),
    date: String(item.pubDate || "").split(" ")[0] || "",
    source: pickSource(item),
    description: String(item.contentSnippet || item.content || "").replace(/\s+/g, " ").trim().slice(0, 240),
    query: queryUsed,
  };
}

function isTargetEvent(item) {
  const text = `${item.title || ""} ${item.description || ""}`;
  const hasCosme = /(コスメ|化粧品|ビューティー|メイク)/i.test(text);
  const hasEvent = /(ポップアップ|イベント|催事|フェス|フェスティバル|フェア|体験会)/i.test(text);
  const hasArea = /(東京|神奈川|千葉|首都圏)/i.test(text);
  const hasDonki = /(ドンキ|ドン・キホーテ|MEGAドンキ)/i.test(text);
  return hasCosme && hasEvent && (hasArea || hasDonki);
}

exports.getCosmeEventNews = onRequest(async (req, res) => {
  setCommonHeaders(res);
  if (handleCors(req, res)) return;

  if (req.method !== "GET") {
    res.status(405).json({error: "Method Not Allowed"});
    return;
  }

  const rawMax = Number(req.query.max || "40");
  const max = Number.isFinite(rawMax) ? Math.max(1, Math.min(100, Math.floor(rawMax))) : 40;
  const extraKeywords = normalizeKeywords(req.query.keywords || "");
  const queries = buildQueries(extraKeywords);

  try {
    const allResults = [];
    for (const query of queries) {
      const feedUrl = buildGoogleNewsUrl(query);
      const feed = await parser.parseURL(feedUrl);
      const items = Array.isArray(feed.items) ? feed.items : [];
      for (const item of items) {
        allResults.push(normalizeItem(item, query));
      }
    }

    const merged = dedupeByLink(allResults).sort((a, b) => toDateValue(b.pubDate) - toDateValue(a.pubDate));
    const filtered = merged.filter(isTargetEvent);
    const picked = (filtered.length > 0 ? filtered : merged).slice(0, max);

    res.status(200).json({
      status: "ok",
      count: picked.length,
      queries,
      items: picked,
    });
  } catch (e) {
    res.status(502).json({
      error: `RSS fetch failed: ${e?.message || "unknown"}`,
      queries,
    });
  }
});
