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

  // Enrich with real channel avatars (one extra call, up to 50 channel ids).
  try {
    const ids = [...new Set(items.map((v) => v.snippet?.channelId).filter(Boolean))].slice(0, 50);
    if (ids.length) {
      const ch = await fetchYouTube("channels", { part: "snippet", id: ids.join(","), maxResults: "50" });
      const map = {};
      (ch.json.items || []).forEach((c) => {
        const t = c.snippet?.thumbnails;
        map[c.id] = (t?.medium || t?.default || {}).url || null;
      });
      items.forEach((v) => { v.channelThumb = map[v.snippet?.channelId] || null; });
    }
  } catch (_) { /* avatars are best-effort */ }

  const data = { items };
  cache.set(key, { t: Date.now(), data });
  return { status: 200, json: data };
}

function categories(region) {
  return fetchYouTube("videoCategories", { part: "snippet", regionCode: region });
}

module.exports = { fetchYouTube, trending, categories };
