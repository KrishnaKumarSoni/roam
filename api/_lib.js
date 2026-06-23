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
function isShort(v) {
  const secs = durationSeconds(v.contentDetails?.duration);
  if (!secs) return false; // live streams have 0 — keep them
  if (secs <= 60) return true; // classic Shorts
  if (secs <= 181) {
    const txt = `${v.snippet?.title || ""} ${v.snippet?.description || ""}`.toLowerCase();
    if (txt.includes("#short")) return true;
  }
  return false;
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

  items = items.filter((v) => !isShort(v)).slice(0, 50);

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
