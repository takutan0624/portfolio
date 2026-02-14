const ALLOWED_HOSTS = new Set([
  "meguro-nono.com",
  "www.meguro-nono.com",
]);

const STATIC_FEEDS = [
  {
    key: "meguro_nono_event_info",
    source: "meguro-nono.com",
    type: "page",
    url: "https://meguro-nono.com/event_info/?date=&type=&pref%5B%5D=101&pref%5B%5D=81&pref%5B%5D=89",
  },
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

function parseAtomEntries(xml) {
  const blocks = String(xml || "").match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  const out = [];
  for (const block of blocks) {
    const title = getTagValue(block, ["title"]);
    const updated = getTagValue(block, ["updated", "published"]);
    const summary = stripHtml(getTagValue(block, ["summary", "content"]));
    const author = getTagValue(block, ["name", "author"]);
    let link = "";
    const relAlt = block.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*>/i);
    if (relAlt && relAlt[1]) link = decodeXmlEntities(relAlt[1]);
    if (!link) {
      const anyLink = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i);
      if (anyLink && anyLink[1]) link = decodeXmlEntities(anyLink[1]);
    }
    if (!title || !link) continue;
    out.push({
      title,
      link,
      pubDate: updated,
      description: summary,
      author,
    });
  }
  return out;
}

function parseFeedItems(xml) {
  const rss = parseRssItems(xml);
  if (rss.length > 0) return rss;
  return parseAtomEntries(xml);
}

function pad2(v) {
  return String(v).padStart(2, "0");
}

function parseDateTextToIso(text) {
  const source = String(text || "");
  const full = source.match(/(20\d{2})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})/);
  if (full) {
    const y = Number(full[1]);
    const m = Number(full[2]);
    const d = Number(full[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${y}-${pad2(m)}-${pad2(d)}`;
  }
  const short = source.match(/(\d{1,2})\s*[\/月]\s*(\d{1,2})\s*日?/);
  if (short) {
    const now = new Date();
    let y = now.getFullYear();
    const m = Number(short[1]);
    const d = Number(short[2]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      if (m < now.getMonth() + 1 - 2) y += 1;
      return `${y}-${pad2(m)}-${pad2(d)}`;
    }
  }
  return "";
}

function extractLastHeading(htmlSnippet) {
  const matches = Array.from(String(htmlSnippet || "").matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi));
  if (matches.length === 0) return "";
  const last = matches[matches.length - 1]?.[1] || "";
  return stripHtml(decodeXmlEntities(last)).trim();
}

function parseMeguroEventInfoPage(html, pageUrl) {
  const out = [];
  const raw = String(html || "");
  const nowIso = new Date().toISOString();
  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRegex.exec(raw)) !== null) {
    const href = decodeXmlEntities(match[1] || "").trim();
    const anchorText = stripHtml(decodeXmlEntities(match[2] || "")).trim();
    if (!href) continue;
    if (!/(詳細|詳しく|detail|more|view)/i.test(anchorText)) continue;

    let absoluteLink = "";
    try {
      absoluteLink = new URL(href, pageUrl).toString();
    } catch {
      continue;
    }
    const before = raw.slice(Math.max(0, match.index - 2600), match.index);
    const title = extractLastHeading(before) || "イベント情報";
    const contextText = stripHtml(decodeXmlEntities(before.slice(-1400))).trim();
    if (/(終了|開催終了|closed)/i.test(contextText)) continue;
    const detectedDate = parseDateTextToIso(contextText);
    const description = contextText.slice(-220);

    out.push({
      title,
      link: absoluteLink,
      pubDate: detectedDate ? `${detectedDate}T00:00:00+09:00` : nowIso,
      description,
      author: "meguro-nono.com",
    });
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

function isTargetEvent(item) {
  const text = `${item.title || ""} ${item.description || ""}`;
  const hasCosme = /(コスメ|化粧品|ビューティー|メイク|美容)/i.test(text);
  const hasEvent = /(ポップアップ|イベント|催事|フェス|フェスティバル|フェア|体験会|展示会)/i.test(text);
  const hasRegion = /(東京|神奈川|千葉|首都圏|都内|横浜|川崎|幕張|千葉市|船橋|柏|目黒)/i.test(text);
  const hasDonki = /(ドンキ|ドン・キホーテ|MEGAドンキ)/i.test(text);
  const isMeguroNono = /(meguro-nono\.com)/i.test(`${item.feedSource || ""} ${item.source || ""} ${item.link || ""}`);
  if (isMeguroNono) return hasEvent || hasCosme;
  return hasCosme && hasEvent && (hasRegion || hasDonki);
}

function scoreItem(item, nowTs) {
  const text = `${item.title || ""} ${item.description || ""} ${item.link || ""}`;
  const sourceText = String(item.feedSource || item.source || "");
  const ageDays = toAgeDays(item.pubDate, nowTs);
  const hasDonki = /(ドンキ|ドン・キホーテ|MEGAドンキ|majica|donki\.com|ppih\.co\.jp)/i.test(text);
  const hasRegion = /(東京|神奈川|千葉|首都圏|都内|横浜|川崎|幕張|千葉市|船橋|柏|目黒)/i.test(text);
  const hasEvent = /(ポップアップ|イベント|催事|フェス|フェスティバル|フェア|体験会|展示会)/i.test(text);
  const hasCosme = /(コスメ|化粧品|ビューティー|メイク|美容)/i.test(text);
  const fromMeguroNono = /(meguro-nono\.com)/i.test(sourceText) || /meguro-nono\.com/i.test(text);

  let score = 0;
  if (hasDonki) score += 3000;
  if (hasRegion) score += 500;
  if (hasEvent) score += 500;
  if (hasCosme) score += 350;
  if (fromMeguroNono) score += 900;

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

function isMeguroSource(item) {
  return /meguro-nono\.com/i.test(`${item.feedSource || ""} ${item.source || ""} ${item.link || ""}`);
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

  const maxRaw = String(readQuery(req, "max", "80") || "").trim().toLowerCase();
  const max = maxRaw === "all" ? Number.MAX_SAFE_INTEGER : clampInt(maxRaw, 1, 150, 80);
  const recentDays = clampInt(readQuery(req, "days", "90"), 7, 365, 90);
  const strictRecent = normalizeBoolean(readQuery(req, "strict_recent", ""), false);
  const showAll = normalizeBoolean(readQuery(req, "all", ""), false);
  const hardMaxDays = Math.max(recentDays, Math.min(365, recentDays * 2));
  const nowTs = Date.now();

  try {
    const allFeeds = [...STATIC_FEEDS];

    const fetches = await Promise.all(
      allFeeds.map(async (feed) => {
        const rssUrl = sanitizeNewsHostUrl(feed.url);
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
        const parsedItems = feed.type === "page"
          ? parseMeguroEventInfoPage(xml, rssUrl)
          : parseFeedItems(xml);
        return parsedItems.map((item) => ({
          ...item,
          query: feed.query || "",
          feedKey: feed.key,
          feedSource: feed.source,
          source: item.author || feed.source || "Event Source",
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
    if (showAll) {
      source = scored;
      mode = "all";
    } else if (withinRecentTarget.length > 0) {
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

    const meguroFirst = [
      ...source.filter((item) => isMeguroSource(item)),
      ...source.filter((item) => !isMeguroSource(item)),
    ];

    const picked = meguroFirst
      .slice(0, max)
      .map(({ _ageDays, _score, ...item }) => item);

    const sourceStats = picked.reduce((acc, item) => {
      const key = String(item.feedSource || item.source || "unknown");
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

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
      showAll,
      recentDays,
      strictRecent,
      donkiCount,
      oldestDays,
      sourceStats,
      queries: [],
      items: picked,
    });
  } catch (e) {
    res.status(502).json({
      error: `Cosme event fetch failed: ${e?.message || "unknown"}`,
    });
  }
}
