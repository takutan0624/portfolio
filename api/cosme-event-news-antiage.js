const ALLOWED_HOSTS = new Set([
  "news.google.com",
]);

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
  const extra = (process.env.ANTIAGE_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set([...defaults, ...extra]);
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeXmlEntities(text) {
  if (!text) return "";
  return String(text)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)));
}

function stripCdata(text) {
  if (!text) return "";
  return String(text)
    .replace(/^<!\[CDATA\[/i, "")
    .replace(/\]\]>$/i, "")
    .trim();
}

function stripHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTagValue(block, tags) {
  for (const tag of tags) {
    const pattern = new RegExp(`<${escapeRegex(tag)}[^>]*>([\\s\\S]*?)</${escapeRegex(tag)}>`, "i");
    const m = block.match(pattern);
    if (m && m[1] != null) {
      return decodeXmlEntities(stripCdata(m[1]));
    }
  }
  return "";
}

function parseRssItems(xml) {
  const blocks = String(xml || "").match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const out = [];
  for (const block of blocks) {
    const title = getTagValue(block, ["title"]);
    const link = getTagValue(block, ["link", "guid"]);
    const pubDate = getTagValue(block, ["pubDate", "updated"]);
    const description = stripHtml(getTagValue(block, ["description", "content:encoded", "summary"]));
    const author = getTagValue(block, ["author", "dc:creator", "source"]);

    if (!title || !link) continue;
    out.push({ title, link, pubDate, description, author });
  }
  return out;
}

function readQuery(req, key, fallback = "") {
  if (req?.query && typeof req.query[key] === "string") return req.query[key];
  try {
    const url = new URL(req.url, "http://localhost");
    return url.searchParams.get(key) || fallback;
  } catch {
    return fallback;
  }
}

function toDateValue(v) {
  const t = new Date(v || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

function toAgeDays(v, nowTs) {
  const ts = toDateValue(v);
  if (!ts) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((nowTs - ts) / 86400000));
}

function dedupeByLink(items) {
  const map = new Map();
  for (const item of items || []) {
    if (!item || typeof item !== "object") continue;
    const key = String(item.link || "").trim();
    if (!key) continue;
    if (!map.has(key)) map.set(key, item);
  }
  return Array.from(map.values());
}

function normalizeKeywords(raw) {
  return Array.from(
    new Set(
      String(raw || "")
        .split(/[\n,、，]/g)
        .map((v) => v.trim())
        .filter(Boolean)
        .slice(0, 10)
    )
  );
}

function normalizeBoolean(raw, fallback = false) {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

function clampInt(raw, min, max, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function sanitizeNewsHostUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl || "").trim());
    if (u.protocol !== "https:") return "";
    if (!ALLOWED_HOSTS.has(u.hostname)) return "";
    return u.toString();
  } catch {
    return "";
  }
}

function buildGoogleNewsRssUrl(query) {
  const base = "https://news.google.com/rss/search";
  const params = new URLSearchParams({
    q: query,
    hl: "ja",
    gl: "JP",
    ceid: "JP:ja",
  });
  return `${base}?${params.toString()}`;
}

function buildQueries(keywords, recentDays) {
  const region = "(\"東京\" OR \"神奈川\" OR \"千葉\" OR \"首都圏\" OR \"都内\" OR \"横浜\" OR \"川崎\" OR \"幕張\")";
  const cosme = "(\"コスメ\" OR \"化粧品\" OR \"ビューティー\" OR \"メイク\")";
  const eventIntitle = "(intitle:ポップアップ OR intitle:イベント OR intitle:催事 OR intitle:フェア OR intitle:フェス)";
  const eventWords = "(\"ポップアップ\" OR \"イベント\" OR \"催事\" OR \"フェス\" OR \"フェスティバル\" OR \"体験会\" OR \"展示会\")";
  const donki = "(\"ドン・キホーテ\" OR \"ドンキ\" OR \"MEGAドンキ\" OR \"majica\")";
  const donkiEvent = "(\"コスメフェスティバル\" OR \"コスメフェス\" OR \"コスメ祭\" OR \"ビューティーフェス\" OR \"ビューティーイベント\" OR \"催事\" OR \"ポップアップ\")";
  const donkiSite = "(site:donki.com OR site:ppih.co.jp)";
  const extra = keywords.length > 0 ? `(${keywords.map((v) => `"${String(v).replace(/"/g, "")}"`).join(" OR ")})` : "";
  const extraClause = extra ? ` ${extra}` : "";
  const recencyClause = recentDays > 0 ? ` when:${recentDays}d` : "";

  return [
    `${region} ${cosme} ${eventIntitle}${extraClause}${recencyClause}`.trim(),
    `${region} ${cosme} ${eventWords}${extraClause}${recencyClause}`.trim(),
    `${donki} ${donkiEvent}${extraClause}${recencyClause}`.trim(),
    `${donki} ${cosme} ${eventWords}${extraClause}${recencyClause}`.trim(),
    `${donkiSite} ${cosme} ${donkiEvent}${extraClause}${recencyClause}`.trim(),
  ];
}

function isTargetEvent(item) {
  const text = `${item.title || ""} ${item.description || ""}`;
  const hasCosme = /(コスメ|化粧品|ビューティー|メイク)/i.test(text);
  const hasEvent = /(ポップアップ|イベント|催事|フェス|フェスティバル|フェア|体験会|展示会)/i.test(text);
  const hasRegion = /(東京|神奈川|千葉|首都圏|都内|横浜|川崎|幕張)/i.test(text);
  const hasDonki = /(ドンキ|ドン・キホーテ|MEGAドンキ)/i.test(text);
  return hasCosme && hasEvent && (hasRegion || hasDonki);
}

function scoreItem(item, nowTs) {
  const text = `${item.title || ""} ${item.description || ""} ${item.link || ""}`;
  const ageDays = toAgeDays(item.pubDate, nowTs);
  const hasDonki = /(ドンキ|ドン・キホーテ|MEGAドンキ|majica|donki\.com|ppih\.co\.jp)/i.test(text);
  const hasRegion = /(東京|神奈川|千葉|首都圏|都内|横浜|川崎|幕張)/i.test(text);
  const hasEvent = /(ポップアップ|イベント|催事|フェス|フェスティバル|フェア|体験会|展示会)/i.test(text);
  const hasCosme = /(コスメ|化粧品|ビューティー|メイク)/i.test(text);

  let score = 0;
  if (hasDonki) score += 3000;
  if (hasRegion) score += 500;
  if (hasEvent) score += 500;
  if (hasCosme) score += 350;

  if (Number.isFinite(ageDays)) {
    if (ageDays <= 7) score += 1200;
    else if (ageDays <= 30) score += 700;
    else if (ageDays <= 60) score += 350;
    else if (ageDays <= 90) score += 120;
    else score -= Math.min(1200, Math.floor((ageDays - 90) * 12));
  } else {
    score -= 900;
  }
  return score;
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

  const max = clampInt(readQuery(req, "max", "40"), 1, 100, 40);
  const recentDays = clampInt(readQuery(req, "days", "90"), 7, 365, 90);
  const strictRecent = normalizeBoolean(readQuery(req, "strict_recent", ""), false);
  const hardMaxDays = Math.max(recentDays, Math.min(365, recentDays * 2));
  const keywords = normalizeKeywords(readQuery(req, "keywords", ""));
  const queries = buildQueries(keywords, recentDays);
  const nowTs = Date.now();

  try {
    const fetches = await Promise.all(
      queries.map(async (q) => {
        const rssUrl = sanitizeNewsHostUrl(buildGoogleNewsRssUrl(q));
        if (!rssUrl) return [];
        const upstream = await fetch(rssUrl, {
          method: "GET",
          headers: {
            "Accept": "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
            "User-Agent": "AntiageCosmeEventProxy/1.0 (+https://portfolio-flame-iota-d7n8dbh5mp.vercel.app)",
          },
        });
        if (!upstream.ok) return [];
        const xml = await upstream.text();
        return parseRssItems(xml).map((item) => ({
          ...item,
          query: q,
          source: item.author || "Google News",
        }));
      })
    );

    const merged = dedupeByLink(fetches.flat());
    const scored = merged
      .map((item) => ({ ...item, _ageDays: toAgeDays(item.pubDate, nowTs), _score: scoreItem(item, nowTs) }))
      .sort((a, b) => {
        if (b._score !== a._score) return b._score - a._score;
        return toDateValue(b.pubDate) - toDateValue(a.pubDate);
      });

    const withinRecent = scored.filter((item) => item._ageDays <= recentDays);
    const withinHard = scored.filter((item) => item._ageDays <= hardMaxDays);
    const withinHardTarget = withinHard.filter(isTargetEvent);
    const withinRecentTarget = withinRecent.filter(isTargetEvent);
    const targetOnly = scored.filter(isTargetEvent);

    let source = [];
    let mode = "recent_target";
    if (withinRecentTarget.length > 0) {
      source = withinRecentTarget;
      mode = "recent_target";
    } else if (!strictRecent && withinHardTarget.length > 0) {
      source = withinHardTarget;
      mode = "hard_window_target";
    } else if (!strictRecent && withinRecent.length > 0) {
      source = withinRecent;
      mode = "recent_fallback";
    } else if (!strictRecent && targetOnly.length > 0) {
      source = targetOnly;
      mode = "target_fallback";
    } else if (!strictRecent) {
      source = withinHard.length > 0 ? withinHard : scored;
      mode = "hard_window_fallback";
    }

    const picked = source
      .slice(0, max)
      .map(({ _ageDays, _score, ...item }) => item);

    const donkiCount = picked.filter((item) =>
      /(ドンキ|ドン・キホーテ|MEGAドンキ|majica|donki\.com|ppih\.co\.jp)/i.test(
        `${item.title || ""} ${item.description || ""} ${item.link || ""}`
      )
    ).length;
    const oldestDays = picked.reduce((acc, item) => {
      const d = toAgeDays(item.pubDate, nowTs);
      return Number.isFinite(d) ? Math.max(acc, d) : acc;
    }, 0);

    res.status(200).json({
      status: "ok",
      count: picked.length,
      mode,
      recentDays,
      strictRecent,
      donkiCount,
      oldestDays,
      queries,
      items: picked,
    });
  } catch (e) {
    res.status(502).json({
      error: `Cosme event fetch failed: ${e?.message || "unknown"}`,
    });
  }
}
