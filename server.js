// Roam — local dev server (zero dependencies).
// Serves the static UI and proxies the YouTube API via the shared lib in /api.
const http = require("http");
const fs = require("fs");
const path = require("path");

// --- tiny .env loader ---
(function loadEnv() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch (_) {}
})();

const { trending, categories, rising } = require("./api/_lib");
const PORT = process.env.PORT || 4123;
const PUBLIC = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json",
};

function serveStatic(req, res) {
  let p = req.url.split("?")[0];
  if (p === "/") p = "/index.html";
  const file = path.join(PUBLIC, path.normalize(p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403).end("Forbidden"); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end("Not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "text/plain" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);

  if (u.pathname === "/api/trending") {
    const region = (u.searchParams.get("region") || "US").toUpperCase();
    const category = u.searchParams.get("category") || "0";
    try {
      const { status, json } = await trending(region, category);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(status === 200 ? json : { error: json.error?.message || "YouTube API error" }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  if (u.pathname === "/api/rising") {
    const region = (u.searchParams.get("region") || "US").toUpperCase();
    const q = u.searchParams.get("q") || "";
    try {
      const { status, json } = await rising(region, q);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(status === 200 ? json : { error: json.error?.message || "YouTube API error" }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  if (u.pathname === "/api/categories") {
    const region = (u.searchParams.get("region") || "US").toUpperCase();
    try {
      const { status, json } = await categories(region);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(json));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => console.log(`\n  Roam running at http://localhost:${PORT}\n`));
