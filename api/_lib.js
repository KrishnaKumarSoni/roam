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

// ---- Rising creators ("real" Underdogs) ----
// Find recent, high-view videos from SMALL channels — these never appear in the
// trending chart. We cast a wide net (top-viewed videos in the last 72h), drop
// mega-channels, and return an enriched pool the client filters instantly.
const RISING_TTL = 24 * 60 * 60 * 1000; // 24h
const RISING_WINDOW_H = 72;
const RISING_SUB_CEILING = 100000; // max channel size considered an underdog
const RISING_MIN_VIEWS = 3000;     // absolute floor so we don't show noise
const RISING_MIN_RATIO = 1.3;      // views must beat subs by this much ("nice ones")
const RISING_PAGES = 2;            // viewCount pages per seed — deeper pages hold the smaller channels
const RISING_POOL_CAP = 300;
// search.list costs 100 units/call (vs 1 for trending), so the seed sweep is the
// quota driver. Keep it modest and cache 24h. needs a query term (region-only
// search returns nothing), so we sweep broad seeds to approximate "rising region-wide".
const RISING_SEEDS = ["music", "gaming", "vlog", "comedy", "news", "sports", "dance", "cooking"];

// Shared filter: is this an "underdog" video?
function isUnderdog(v) {
  const subs = v.channelSubs;
  const views = +v.statistics?.viewCount || 0;
  if (subs == null || subs <= 0 || subs > RISING_SUB_CEILING) return false;
  if (views < RISING_MIN_VIEWS || views / subs < RISING_MIN_RATIO) return false;
  if (/-\s*Topic$/.test(v.snippet?.channelTitle || "")) return false;
  return true;
}

async function rising(region, query) {
  const q = (query || "").trim();
  const key = `rising:${region}:${q.toLowerCase() || "_all"}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < RISING_TTL) return { status: 200, json: hit.data, cached: true };

  const publishedAfter = new Date(Date.now() - RISING_WINDOW_H * 3600 * 1000).toISOString();
  const seeds = q ? [q] : RISING_SEEDS;
  const byId = new Map();

  // A) Cheap source (1 unit): underdogs already hiding in the trending chart.
  //    Always included, so the feed is never empty even if search quota is gone.
  try {
    const tr = await trending(region, "0");
    (tr.json?.items || []).forEach((v) => { if (isUnderdog(v)) byId.set(v.id, v); });
  } catch (_) {}

  // B) Search sweep (100 units/call) — the main source. Page deep into
  //    order=viewCount: page 1 is mega-channels (filtered out), deeper pages
  //    hold the smaller channels with high views — i.e. the actual underdogs.
  let searchOk = false;
  const searchSeed = async (seed) => {
    const out = [];
    let pageToken;
    for (let p = 0; p < (q ? RISING_PAGES + 1 : RISING_PAGES); p++) {
      const params = {
        part: "snippet", type: "video", order: "viewCount",
        regionCode: region, publishedAfter, maxResults: "50", q: seed,
      };
      if (pageToken) params.pageToken = pageToken;
      const { status, json } = await fetchYouTube("search", params).catch(() => ({ status: 0, json: {} }));
      if (status !== 200) break; // quota/errors: stop quietly, keep what we have
      searchOk = true;
      (json.items || []).forEach((it) => { if (it.id?.videoId) out.push(it.id.videoId); });
      pageToken = json.nextPageToken;
      if (!pageToken) break;
    }
    return out;
  };
  const seedResults = await Promise.all(seeds.map(searchSeed));
  const ids = [...new Set(seedResults.flat())].filter((id) => !byId.has(id));

  if (ids.length) {
    // Video details (views, duration, publish time).
    let vids = [];
    for (let i = 0; i < ids.length; i += 50) {
      const { json } = await fetchYouTube("videos", { part: "snippet,statistics,contentDetails", id: ids.slice(i, i + 50).join(","), maxResults: "50" });
      vids = vids.concat(json.items || []);
    }
    const shorts = await findShorts(vids);
    vids = vids.filter((v) => !shorts.has(v.id));

    // Channel subscriber counts + avatars.
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
    for (const v of vids) {
      v.channelThumb = thumbMap[v.snippet?.channelId] || null;
      v.channelSubs = subMap[v.snippet?.channelId] ?? null;
      if (isUnderdog(v)) byId.set(v.id, v);
    }
  }

  const out = [...byId.values()].sort(
    (a, b) => (b.statistics.viewCount / Math.max(b.channelSubs, 1)) - (a.statistics.viewCount / Math.max(a.channelSubs, 1))
  );
  const data = { items: out.slice(0, RISING_POOL_CAP), window: RISING_WINDOW_H };
  // Full 24h cache only when the search sweep succeeded; otherwise cache briefly
  // so the pool recovers once search quota resets.
  const ttl = searchOk ? RISING_TTL : 30 * 60 * 1000;
  cache.set(key, { t: Date.now() - (RISING_TTL - ttl), data });
  return { status: 200, json: data };
}

module.exports = { fetchYouTube, trending, categories, rising };
