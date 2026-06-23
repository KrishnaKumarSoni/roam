const { categories } = require("./_lib");

module.exports = async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const region = (url.searchParams.get("region") || "US").toUpperCase();
  try {
    const { status, json } = await categories(region);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    res.statusCode = status;
    res.end(JSON.stringify(json));
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(e) }));
  }
};
