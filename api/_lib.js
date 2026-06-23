// Shared YouTube logic used by both the local server and Vercel functions.
// Uses the built-in https module so it runs on any Node version.
const https = require("https");

function fetchYouTube(pathName, params) {
  const key = process.env.YT_API_KEY;
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams({ ...params, key }).toString();
    https
      .get(`https://www.googleapis.com/youtube/v3/${pathName}?${qs}`, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(body) });
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

// ---- Shorts detection ----
function durationSeconds(iso) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || "") || [];
  return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
}

// A video is a Short iff youtube.com/shorts/{id} returns 200; a regular video
// redirects (303) to /watch. We only probe borderline-length clips.
function isShortByUrl(id) {
  return new Promise((resolve) => {
    const req = https.request(
      { method: "HEAD", hostname: "www.youtube.com", path: `/shorts/${id}`, headers: { "User-Agent": "Mozilla/5.0" } },
      (r) => { resolve(r.statusCode === 200); r.resume(); }
    );
    req.on("error", () => resolve(false));
    req.setTimeout(4000, () => { req.destroy(); resolve(false); });
    req.end();
  });
}

// Returns a Set of video ids that are Shorts.
async function findShorts(items) {
  const shorts = new Set();
  const toProbe = [];
  for (const v of items) {
    const secs = durationSeconds(v.contentDetails?.duration);
    if (secs === 0) continue; // live streams — keep
    if (secs <= 60) { shorts.add(v.id); continue; } // classic Shorts
    if (secs > 180) continue; // too long to be a Short
    const txt = `${v.snippet?.title || ""} ${v.snippet?.description || ""}`.toLowerCase();
    if (txt.includes("#short")) { shorts.add(v.id); continue; }
    toProbe.push(v.id); // 61-180s, untagged: verify via /shorts/ redirect
  }
  const flags = await Promise.all(toProbe.map(isShortByUrl));
  toProbe.forEach((id, i) => { if (flags[i]) shorts.add(id); });
  return shorts;
}

// 15-min warm-instance cache.
const cache = new Map();
const TTL = 15 * 60 * 1000;

// ---- Global trending set (for "Local Gems") ----
// A video is "global" if it trends in many countries at once. We compute this
// from a diverse basket ONCE every 2 hours and reuse it for every region, so
// the marginal cost is ~10 units / 2h no matter how much traffic we get.
const GLOBAL_BASKET = ["US", "IN", "GB", "BR", "JP", "DE", "FR", "NG", "ID", "MX"];
const GLOBAL_TTL = 2 * 60 * 60 * 1000;
const GLOBAL_MIN_COUNTRIES = 3; // appears in >=3 baskets => global monoculture
let globalCache = { t: 0, set: new Set() };

async function getGlobalSet() {
  if (globalCache.set.size && Date.now() - globalCache.t < GLOBAL_TTL) return globalCache.set;
  const counts = new Map();
  const lists = await Promise.all(
    GLOBAL_BASKET.map((rc) =>
      fetchYouTube("videos", { part: "snippet", chart: "mostPopular", regionCode: rc, maxResults: "50" })
        .catch(() => ({ json: {} }))
    )
  );
  lists.forEach((r) => (r.json.items || []).forEach((v) => counts.set(v.id, (counts.get(v.id) || 0) + 1)));
  const set = new Set();
  for (const [id, c] of counts) if (c >= GLOBAL_MIN_COUNTRIES) set.add(id);
  globalCache = { t: Date.now(), set };
  return set;
}

async function trending(region, category) {
  const key = `${region}:${category}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return { status: 200, json: hit.data, cached: true };

  // Pull up to 2 pages so we still have a full grid after removing Shorts.
  let items = [];
  let pageToken;
  for (let p = 0; p < 2; p++) {
    const params = {
      part: "snippet,statistics,contentDetails",
      chart: "mostPopular",
      regionCode: region,
      maxResults: "50",
    };
    if (category && category !== "0") params.videoCategoryId = category;
    if (pageToken) params.pageToken = pageToken;

    const { status, json } = await fetchYouTube("videos", params);
    if (status !== 200) return { status, json };
    items = items.concat(json.items || []);
    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }

  const shorts = await findShorts(items);
  items = items.filter((v) => !shorts.has(v.id)).slice(0, 50);

  // Enrich with channel avatars + subscriber count (one call; statistics is free).
  try {
    const ids = [...new Set(items.map((v) => v.snippet?.channelId).filter(Boolean))].slice(0, 50);
    if (ids.length) {
      const ch = await fetchYouTube("channels", { part: "snippet,statistics", id: ids.join(","), maxResults: "50" });
      const map = {};
      (ch.json.items || []).forEach((c) => {
        const t = c.snippet?.thumbnails;
        const hidden = c.statistics?.hiddenSubscriberCount;
        map[c.id] = {
          thumb: (t?.medium || t?.default || {}).url || null,
          subs: hidden ? null : (+c.statistics?.subscriberCount || null),
        };
      });
      items.forEach((v) => {
        const m = map[v.snippet?.channelId] || {};
        v.channelThumb = m.thumb || null;
        v.channelSubs = m.subs ?? null;
      });
    }
  } catch (_) { /* enrichment is best-effort */ }

  // Tag each video with whether it's part of the global monoculture.
  try {
    const gset = await getGlobalSet();
    items.forEach((v) => { v.isGlobal = gset.has(v.id); });
  } catch (_) { items.forEach((v) => { v.isGlobal = false; }); }

  const data = { items };
  cache.set(key, { t: Date.now(), data });
  return { status: 200, json: data };
}

function categories(region) {
  return fetchYouTube("videoCategories", { part: "snippet", regionCode: region });
}

// ---- Rising creators ("Underdogs") ----
// Small channels punching way above their weight. Instead of expensive
// search.list (100 units), we fan out the mostPopular chart across every
// category (1 unit each). Niche categories (Pets, Autos, Science...) have a
// low bar to trend, so small channels surface there — yielding a big pool for
// ~25 units/region. Works in every region; cached 24h.
const RISING_TTL = 24 * 60 * 60 * 1000; // 24h
const RISING_SUB_FLOOR = 100;      // below this, sub counts are usually stale/artifacts (e.g. 2-sub VEVO)
const RISING_SUB_CEILING = 100000; // max channel size considered an underdog
const RISING_MIN_VIEWS = 3000;     // absolute floor so we don't show noise
const RISING_MIN_RATIO = 1.3;      // views must beat subs by this much ("nice ones")
const RISING_POOL_CAP = 200;

// Shared filter: is this an "underdog" video? (Shorts handled separately.)
function isUnderdog(v) {
  const subs = v.channelSubs;
  const views = +v.statistics?.viewCount || 0;
  if (subs == null || subs < RISING_SUB_FLOOR || subs > RISING_SUB_CEILING) return false;
  if (views < RISING_MIN_VIEWS || views / subs < RISING_MIN_RATIO) return false;
  if (/-\s*Topic$/.test(v.snippet?.channelTitle || "")) return false;
  return true;
}

async function rising(region) {
  const key = `rising:${region}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < RISING_TTL) return { status: 200, json: hit.data, cached: true };

  // 1) Category ids for this region.
  let catIds = [];
  try {
    const c = await categories(region);
    catIds = (c.json?.items || []).filter((x) => x.snippet?.assignable).map((x) => x.id);
  } catch (_) {}

  // 2) Fan out mostPopular across the overall chart + every category (1 unit each).
  const charts = ["0", ...catIds];
  const lists = await Promise.all(
    charts.map((cat) => {
      const p = { part: "snippet,statistics,contentDetails", chart: "mostPopular", regionCode: region, maxResults: "50" };
      if (cat !== "0") p.videoCategoryId = cat;
      return fetchYouTube("videos", p).catch(() => ({ json: {} }));
    })
  );
  const byId = new Map();
  lists.forEach((r) => (r.json?.items || []).forEach((v) => byId.set(v.id, v)));
  let vids = [...byId.values()];
  if (!vids.length) {
    const data = { items: [] };
    cache.set(key, { t: Date.now() - (RISING_TTL - 30 * 60 * 1000), data }); // retry soon
    return { status: 200, json: data };
  }

  // 3) Subscriber counts + avatars for the pooled channels.
  const chIds = [...new Set(vids.map((v) => v.snippet?.channelId).filter(Boolean))];
  const subMap = {}, thumbMap = {};
  for (let i = 0; i < chIds.length; i += 50) {
    const { json } = await fetchYouTube("channels", { part: "snippet,statistics", id: chIds.slice(i, i + 50).join(","), maxResults: "50" });
    (json.items || []).forEach((c) => {
      const t = c.snippet?.thumbnails;
      thumbMap[c.id] = (t?.medium || t?.default || {}).url || null;
      subMap[c.id] = c.statistics?.hiddenSubscriberCount ? null : (+c.statistics?.subscriberCount || null);
    });
  }
  vids.forEach((v) => {
    v.channelSubs = subMap[v.snippet?.channelId] ?? null;
    v.channelThumb = thumbMap[v.snippet?.channelId] || null;
  });

  // 4) Keep underdogs, drop Shorts (probe only the small survivor set), rank by reach.
  let cand = vids.filter(isUnderdog);
  const shorts = await findShorts(cand);
  cand = cand.filter((v) => !shorts.has(v.id));
  cand.sort((a, b) => (b.statistics.viewCount / Math.max(b.channelSubs, 1)) - (a.statistics.viewCount / Math.max(a.channelSubs, 1)));

  const data = { items: cand.slice(0, RISING_POOL_CAP) };
  cache.set(key, { t: Date.now(), data });
  return { status: 200, json: data };
}

module.exports = { fetchYouTube, trending, categories, rising };
