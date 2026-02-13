const ALLOWED_HOSTS = new Set([
  "news.google.com",
  "prtimes.jp",
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
    .replace(/&quot;/g, '"')
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

function sanitizeRssUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || "").trim());
    if (url.protocol !== "https:") return "";
    if (!ALLOWED_HOSTS.has(url.hostname)) return "";
    return url.toString();
  } catch {
    return "";
  }
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

  const rssUrl = sanitizeRssUrl(readQuery(req, "rss_url", ""));
  if (!rssUrl) {
    res.status(400).json({ error: "Invalid rss_url" });
    return;
  }
  const maxItemsRaw = Number(readQuery(req, "max_items", "40"));
  const maxItems = Number.isFinite(maxItemsRaw) ? Math.max(1, Math.min(120, Math.floor(maxItemsRaw))) : 40;

  try {
    const upstream = await fetch(rssUrl, {
      method: "GET",
      headers: {
        "Accept": "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
        "User-Agent": "AntiageRSSProxy/1.0 (+https://portfolio-flame-iota-d7n8dbh5mp.vercel.app)",
      },
    });
    if (!upstream.ok) {
      res.status(502).json({ error: `Upstream RSS error: ${upstream.status}` });
      return;
    }
    const xml = await upstream.text();
    const items = parseRssItems(xml).slice(0, maxItems);
    res.status(200).json({ status: "ok", items });
  } catch (e) {
    res.status(502).json({ error: `RSS fetch failed: ${e?.message || "unknown"}` });
  }
}
