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

// 15-min warm-instance cache.
const cache = new Map();
const TTL = 15 * 60 * 1000;

async function trending(region, category) {
  const key = `${region}:${category}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return { status: 200, json: hit.data, cached: true };

  const params = {
    part: "snippet,statistics,contentDetails",
    chart: "mostPopular",
    regionCode: region,
    maxResults: "50",
  };
  if (category && category !== "0") params.videoCategoryId = category;

  const { status, json } = await fetchYouTube("videos", params);
  if (status !== 200) return { status, json };

  // Enrich with real channel avatars (one extra call, up to 50 channel ids).
  try {
    const ids = [...new Set((json.items || []).map((v) => v.snippet?.channelId).filter(Boolean))].slice(0, 50);
    if (ids.length) {
      const ch = await fetchYouTube("channels", { part: "snippet", id: ids.join(","), maxResults: "50" });
      const map = {};
      (ch.json.items || []).forEach((c) => {
        const t = c.snippet?.thumbnails;
        map[c.id] = (t?.default || t?.medium || {}).url || null;
      });
      (json.items || []).forEach((v) => { v.channelThumb = map[v.snippet?.channelId] || null; });
    }
  } catch (_) { /* avatars are best-effort */ }

  cache.set(key, { t: Date.now(), data: json });
  return { status: 200, json };
}

function categories(region) {
  return fetchYouTube("videoCategories", { part: "snippet", regionCode: region });
}

module.exports = { fetchYouTube, trending, categories };
