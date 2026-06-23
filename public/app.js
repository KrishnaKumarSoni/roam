// ---- Regions YouTube supports a trending chart for (common set) ----
const REGIONS = [
  ["US", "United States"], ["IN", "India"], ["GB", "United Kingdom"],
  ["CA", "Canada"], ["AU", "Australia"], ["DE", "Germany"],
  ["FR", "France"], ["JP", "Japan"], ["KR", "South Korea"],
  ["BR", "Brazil"], ["MX", "Mexico"], ["ES", "Spain"],
  ["IT", "Italy"], ["NL", "Netherlands"], ["RU", "Russia"],
  ["ID", "Indonesia"], ["SA", "Saudi Arabia"], ["AE", "United Arab Emirates"],
  ["ZA", "South Africa"], ["NG", "Nigeria"], ["SG", "Singapore"],
];

const grid = document.getElementById("grid");
const featured = document.getElementById("featured");
const statusEl = document.getElementById("status");
const heroTitle = document.getElementById("hero-title");
const heroSub = document.getElementById("hero-sub");
const regionCodeEl = document.getElementById("region-code");
const themeToggle = document.getElementById("theme-toggle");
const regionBtn = document.getElementById("region-btn");
const regionMenu = document.getElementById("region-menu");
const regionCurrent = document.getElementById("region-current");
const sortSeg = document.querySelector(".sort-seg");
const catbar = document.getElementById("catbar");

const state = {
  region: localStorage.getItem("region") || "US",
  category: "0",
  sort: localStorage.getItem("sort") || "trending",
  items: [],
};

// ---- Theme ----
document.documentElement.setAttribute("data-theme", localStorage.getItem("theme") || "dark");
themeToggle.addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
});

// ---- Helpers ----
const fmt = (n) => {
  n = Number(n || 0);
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
};
const isoDuration = (iso) => {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || "") || [];
  const h = +m[1] || 0, mn = +m[2] || 0, s = +m[3] || 0;
  const pad = (x) => String(x).padStart(2, "0");
  return h ? `${h}:${pad(mn)}:${pad(s)}` : `${mn}:${pad(s)}`;
};
const timeAgo = (iso) => {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  const u = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [label, secs] of u) {
    const v = Math.floor(d / secs);
    if (v >= 1) return `${v} ${label}${v > 1 ? "s" : ""} ago`;
  }
  return "just now";
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const regionName = (code) => (REGIONS.find((r) => r[0] === code) || [code, code])[1];

function avatarHTML(channel, thumb) {
  if (thumb) return `<span class="av"><img loading="lazy" src="${esc(thumb)}" alt="${esc(channel)}"
    onerror="this.parentElement.textContent='${esc(channel.charAt(0).toUpperCase())}'" /></span>`;
  return `<span class="av">${esc(channel.charAt(0).toUpperCase())}</span>`;
}

// ---- Region dropdown ----
function buildRegionMenu() {
  regionMenu.innerHTML = "";
  REGIONS.forEach(([code, name]) => {
    const b = document.createElement("button");
    b.className = "region-opt" + (code === state.region ? " is-active" : "");
    b.setAttribute("role", "option");
    b.innerHTML = `<i class="ph ph-map-pin"></i><span>${esc(name)}</span><span class="code">${code}</span>`;
    b.addEventListener("click", () => {
      state.region = code;
      localStorage.setItem("region", code);
      regionCurrent.textContent = name;
      closeRegionMenu();
      buildRegionMenu();
      loadCategories(code).then(load);
    });
    regionMenu.appendChild(b);
  });
}
function openRegionMenu() { regionMenu.hidden = false; regionBtn.setAttribute("aria-expanded", "true"); }
function closeRegionMenu() { regionMenu.hidden = true; regionBtn.setAttribute("aria-expanded", "false"); }
regionBtn.addEventListener("click", (e) => { e.stopPropagation(); regionMenu.hidden ? openRegionMenu() : closeRegionMenu(); });
document.addEventListener("click", (e) => { if (!regionMenu.hidden && !regionMenu.contains(e.target)) closeRegionMenu(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeRegionMenu(); });

// ---- Sort segmented control ----
sortSeg.setAttribute("data-sort", state.sort);
sortSeg.querySelectorAll(".seg-btn").forEach((btn) => {
  btn.classList.toggle("is-active", btn.dataset.sort === state.sort);
  btn.addEventListener("click", () => {
    state.sort = btn.dataset.sort;
    localStorage.setItem("sort", state.sort);
    sortSeg.setAttribute("data-sort", state.sort);
    sortSeg.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("is-active", b === btn));
    renderVideos();
  });
});

// ---- Category chips ----
async function loadCategories(region) {
  catbar.innerHTML = `<button class="chip is-active" data-cat="0">All</button>`;
  state.category = "0";
  try {
    const res = await fetch(`/api/categories?region=${region}`);
    const data = await res.json();
    (data.items || []).filter((c) => c.snippet?.assignable).forEach((c) => {
      const b = document.createElement("button");
      b.className = "chip"; b.dataset.cat = c.id; b.textContent = c.snippet.title;
      catbar.appendChild(b);
    });
  } catch (_) { /* categories are optional */ }
  catbar.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      catbar.querySelectorAll(".chip").forEach((c) => c.classList.remove("is-active"));
      chip.classList.add("is-active");
      state.category = chip.dataset.cat;
      load();
    });
  });
}

// ---- Render ----
function sortedItems() {
  const items = state.items.slice();
  if (state.sort === "newest") items.sort((a, b) => new Date(b.snippet.publishedAt) - new Date(a.snippet.publishedAt));
  return items;
}

function showSkeletons() {
  featured.innerHTML = "";
  grid.innerHTML = "";
  for (let i = 0; i < 12; i++) {
    const c = document.createElement("div");
    c.className = "card skeleton";
    c.style.animationDelay = `${i * 0.03}s`;
    c.innerHTML = `<div class="thumb-wrap"></div>
      <div class="card-body"><div class="av"></div>
      <div class="sk-rows"><div class="sk-line"></div><div class="sk-line short"></div></div></div>`;
    grid.appendChild(c);
  }
}

function setStatus(msg, isError) {
  if (!msg) { statusEl.hidden = true; return; }
  statusEl.hidden = false; statusEl.textContent = msg;
  statusEl.classList.toggle("error", !!isError);
}

function thumbOf(s, size) {
  const t = s.thumbnails || {};
  if (size === "big") return (t.maxres || t.standard || t.high || t.medium || {}).url || "";
  return (t.medium || t.high || t.default || {}).url || "";
}

function renderFeatured(v) {
  const s = v.snippet || {}, st = v.statistics || {}, cd = v.contentDetails || {};
  const channel = s.channelTitle || "Unknown";
  featured.innerHTML = `
    <a class="feat-card" href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener">
      <img src="${esc(thumbOf(s, "big"))}" alt="${esc(s.title || "")}" />
      <div class="feat-shade"></div>
      ${cd.duration ? `<span class="duration">${isoDuration(cd.duration)}</span>` : ""}
      <div class="feat-body">
        <span class="feat-tag"><i class="ph-fill ph-crown-simple"></i> #1 in ${esc(regionName(state.region))}</span>
        <div class="feat-title">${esc(s.title || "Untitled")}</div>
        <div class="feat-meta">
          ${avatarHTML(channel, v.channelThumb)}
          <span>${esc(channel)}</span><span class="dot">·</span>
          <span>${fmt(st.viewCount)} views</span><span class="dot">·</span>
          <span>${timeAgo(s.publishedAt)}</span>
        </div>
      </div>
    </a>`;
}

function renderVideos() {
  const items = sortedItems();
  featured.innerHTML = "";
  grid.innerHTML = "";
  if (!items.length) { setStatus("No trending videos returned for this region or category.", false); return; }
  setStatus(null);

  renderFeatured(items[0]);

  items.slice(1).forEach((v, idx) => {
    const i = idx + 1;
    const s = v.snippet || {}, st = v.statistics || {}, cd = v.contentDetails || {};
    const thumb = thumbOf(s);
    const channel = s.channelTitle || "Unknown";
    const a = document.createElement("a");
    a.className = "card";
    a.href = `https://www.youtube.com/watch?v=${v.id}`;
    a.target = "_blank"; a.rel = "noopener";
    a.style.animationDelay = `${Math.min(idx, 16) * 0.03}s`;
    a.innerHTML = `
      <div class="thumb-wrap">
        <span class="rank">#${i + 1}</span>
        <div class="thumb-fallback" style="display:none"><i class="ph ph-image-broken"></i></div>
        <img loading="lazy" src="${esc(thumb)}" alt="${esc(s.title || "")}"
             onload="this.style.opacity=1"
             onerror="this.style.display='none';this.previousElementSibling.style.display='grid'"
             style="opacity:0;transition:opacity .4s" />
        ${cd.duration ? `<span class="duration">${isoDuration(cd.duration)}</span>` : ""}
        <div class="play"><i class="ph-fill ph-play"></i></div>
      </div>
      <div class="card-body">
        ${avatarHTML(channel, v.channelThumb)}
        <div class="card-text">
          <div class="card-title">${esc(s.title || "Untitled")}</div>
          <div class="card-channel">${esc(channel)}</div>
          <div class="card-meta">${fmt(st.viewCount)} views<span class="dot">·</span>${timeAgo(s.publishedAt)}</div>
        </div>
      </div>`;
    grid.appendChild(a);
  });
}

// ---- Load ----
async function load() {
  const name = regionName(state.region);
  heroTitle.textContent = name;
  regionCodeEl.textContent = state.region;
  heroSub.textContent = `The most-watched videos in ${name}, refreshed live.`;
  setStatus(null);
  showSkeletons();
  try {
    const res = await fetch(`/api/trending?region=${state.region}&category=${state.category}`);
    const data = await res.json();
    if (!res.ok || data.error) {
      featured.innerHTML = ""; grid.innerHTML = "";
      setStatus(`Could not load videos: ${data.error || res.statusText}`, true);
      return;
    }
    state.items = data.items || [];
    renderVideos();
  } catch (e) {
    featured.innerHTML = ""; grid.innerHTML = "";
    setStatus(`Network error: ${e}`, true);
  }
}

// ---- Boot ----
regionCurrent.textContent = regionName(state.region);
buildRegionMenu();
(async () => { await loadCategories(state.region); load(); })();
