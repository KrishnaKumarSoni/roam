const { trending } = require("./_lib");

module.exports = async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const region = (url.searchParams.get("region") || "US").toUpperCase();
  const category = url.searchParams.get("category") || "0";
  try {
    const { status, json, cached } = await trending(region, category);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=1800");
    if (cached) res.setHeader("X-Cache", "HIT");
    if (status !== 200) {
      res.statusCode = status;
      res.end(JSON.stringify({ error: json.error?.message || "YouTube API error" }));
      return;
    }
    res.statusCode = 200;
    res.end(JSON.stringify(json));
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(e) }));
  }
};
